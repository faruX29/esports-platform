"""
Haftalık haberler — Pazartesi sabahı, önceki haftanın tamamı (Pzt 00:00 – Paz 24:00 TSİ).

İki haber:
  - turk_haftasi : Türk takımlarının haftası (sonuçlar + gelecek haftanın maçları)
  - surprizler   : Fextopus'un emin olup yanıldığı S/A/B maçları

Liste VERİDEN gelir ve ekler.maclar'da saklanır; sayfa onu maç kartları olarak
çizer, haftalık video da aynı listeyi okur (haber ile video birebir aynı maçlar).
Gemini yalnız başlık + özet + giriş paragraflarını yazar → maç/skor uydurma riski yok.

Türk takımı tanımı tek kaynaktan: turk_takimlar görünümü (backend/sql/turk_takimlar.sql).
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from psycopg.types.json import Jsonb

from database import Database
from etl.news_generator import NewsGenerator, _AD_KURALI, tam_turnuva_adi

logger = logging.getLogger(__name__)

TSI = timezone(timedelta(hours=3))
AY = {1: 'Ocak', 2: 'Şubat', 3: 'Mart', 4: 'Nisan', 5: 'Mayıs', 6: 'Haziran', 7: 'Temmuz',
      8: 'Ağustos', 9: 'Eylül', 10: 'Ekim', 11: 'Kasım', 12: 'Aralık'}
OYUN = {'valorant': 'VALORANT', 'csgo': 'CS2', 'cs2': 'CS2', 'lol': 'LoL', 'league-of-legends': 'LoL'}

# Sayfadaki listede en fazla bu kadar maç (kurucu: "6-10 arası maç olabilir").
# Sayımlar (galibiyet/mağlubiyet) haftanın TÜM Türk maçlarından yapılır.
LISTE_SONUC = 10
LISTE_GELECEK = 8
# Sürpriz: Fextopus favorisinin en az bu olasılıkla kaybettiği maç. Haftada 4-11 tane
# çıkıyor (24 Eki ölçümü); en çarpıcı 5'i, 3'ten azsa haber yok.
SURPRIZ_ESIK = 0.65
SURPRIZ_LISTE = 5
SURPRIZ_MIN = 3

_JSON_KURALI = (
    "- JSON string içinde çift tırnak (\") kullanma; vurgu için tek tırnak (').\n"
    "- Yanıtı yalnızca şu JSON şemasında ver:\n"
    '{"title": "...", "summary": "...", "paragraphs": ["1. paragraf", "2. paragraf"]}'
)

TURK_HAFTASI_PROMPT = (
    "Sen profesyonel bir espor editörüsün. Türk takımlarının geçen haftasını özetleyen "
    "haftalık bülteni yazıyorsun.\n\n"
    "- Haftanın maç listesi sayfada AYRICA tablo olarak gösteriliyor: listeyi tek tek "
    "TEKRAR ETME. En önemli 2-3 hikâyeyi anlat (en büyük galibiyet, sürpriz sonuç, "
    "Fextopus'un doğru ya da yanlış bildiği önemli maç), sonra gelecek haftanın öne çıkan "
    "Türk takımı maçına değin.\n"
    "- Yalnızca rapordaki veriyi kullan; skor, takım, oyuncu UYDURMA. Rapordaki sayımları "
    "değiştirme.\n"
    "- Elenme, tur atlama, şampiyonluk, sıralama YAZMA: raporda turnuva durumu yok, "
    "yalnızca maç sonucu var.\n"
    "- 'Fextopus' bizim tahmin motorumuzun adıdır; 'model' deme.\n"
    "- Klişe dolgu yok ('nefes kesen', 'heyecan dolu', 'zafere ulaştı').\n"
    "- Başlık (title) 'Türk takımları' ifadesini içersin, en fazla 12 kelime. "
    "Özet (summary) 2 cümle. Gövde 2-3 paragraf.\n" + _JSON_KURALI
) + _AD_KURALI

SURPRIZ_PROMPT = (
    "Sen profesyonel bir espor editörüsün. Fextopus'un (bizim tahmin motorumuz) geçen hafta "
    "en emin olup YANILDIĞI maçları anlatan haftalık yazıyı yazıyorsun.\n\n"
    "- Amaç şeffaflık: yanılgıyı küçümseme, özür dileme, savunma yapma. Düz ve tarafsız anlat.\n"
    "- Maç listesi sayfada ayrıca tablo olarak var: hepsini tek tek sayma. En çarpıcı 1-2 "
    "sürprizi (en yüksek olasılıkla yanıldığı) öne çıkar, haftanın genel isabetini rapordaki "
    "sayıyla ver.\n"
    "- Yanılgının NEDENİNE dair yorum yapma (kadro, form, strateji verisi yok); yalnızca olanı anlat.\n"
    "- Elenme, tur atlama, şampiyonluk YAZMA: raporda turnuva durumu yok.\n"
    "- Yalnızca rapordaki veriyi kullan; skor, takım UYDURMA. 'model' deme, 'Fextopus' de.\n"
    "- Başlık (title) 'Fextopus' kelimesini içersin, en fazla 12 kelime. Özet (summary) 2 cümle. "
    "Gövde 2-3 paragraf.\n" + _JSON_KURALI
) + _AD_KURALI


def hafta_baslangici(bugun: Optional[date] = None) -> date:
    """Önceki haftanın Pazartesi'si (TSİ). Pazartesi sabahı koşunca biten haftayı verir."""
    bugun = bugun or datetime.now(TSI).date()
    return bugun - timedelta(days=bugun.weekday() + 7)


def hafta_etiketi(pzt: date) -> str:
    """'19-25 Ekim' / '27 Ekim - 2 Kasım'."""
    paz = pzt + timedelta(days=6)
    if pzt.month == paz.month:
        return f"{pzt.day}-{paz.day} {AY[paz.month]}"
    return f"{pzt.day} {AY[pzt.month]} - {paz.day} {AY[paz.month]}"


def _sinir(pzt: date) -> tuple[datetime, datetime]:
    bas = datetime.combine(pzt, datetime.min.time(), tzinfo=TSI)
    return bas, bas + timedelta(days=7)


_MAC_SECIMI = """
    SELECT m.id, m.scheduled_at, m.status, m.winner_id,
           m.team_a_id, m.team_b_id, m.team_a_score, m.team_b_score,
           m.prediction_team_a, m.prediction_team_b, COALESCE(m.number_of_games, 1) AS bo,
           ta.name AS a, tb.name AS b,
           tn.name AS sahne, tn.league_name, tn.event_name,
           UPPER(LEFT(COALESCE(tn.tier, ''), 1)) AS sev, g.slug AS oyun,
           EXISTS (SELECT 1 FROM turk_takimlar k WHERE k.team_id = m.team_a_id) AS tr_a,
           EXISTS (SELECT 1 FROM turk_takimlar k WHERE k.team_id = m.team_b_id) AS tr_b
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    LEFT JOIN tournaments tn ON tn.id = m.tournament_id
    LEFT JOIN games g ON g.id = m.game_id
"""

# Önem sırası: seviye, sonra saat. Bilinmeyen seviye en sonda.
_SEVIYE_SIRA = "CASE UPPER(LEFT(COALESCE(tn.tier, ''), 1)) WHEN 'S' THEN 0 WHEN 'A' THEN 1 " \
               "WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 ELSE 5 END"


def _sozluk(cur) -> list[dict]:
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    for r in rows:
        r["a"], r["b"] = (r["a"] or "").strip(), (r["b"] or "").strip()
        r["turnuva"] = tam_turnuva_adi(r["league_name"], r["event_name"], r["sahne"])
        r["oyun_ad"] = OYUN.get(r["oyun"] or "", (r["oyun"] or "").upper())
        pa, pb = r["prediction_team_a"], r["prediction_team_b"]
        if pa is not None and pb is not None:
            r["fav"] = r["a"] if float(pa) >= float(pb) else r["b"]
            r["fav_id"] = r["team_a_id"] if float(pa) >= float(pb) else r["team_b_id"]
            r["fav_p"] = round(max(float(pa), float(pb)) * 100)
        else:
            r["fav"] = r["fav_id"] = r["fav_p"] = None
        w = r["winner_id"]
        r["kazanan"] = r["a"] if w == r["team_a_id"] else (r["b"] if w == r["team_b_id"] else None)
        r["dogru"] = (w == r["fav_id"]) if (w is not None and r["fav_id"] is not None) else None
    return rows


_SEVIYE_PUAN = {"S": 0, "A": 1, "B": 2, "C": 3, "D": 4}
TAKIM_TAVAN = 3          # öne çıkanlarda bir Türk takımı en fazla bu kadar maçla


def _one_cikanlar(rows: list[dict]) -> list[dict]:
    """"Öne çıkan" sırası: seviye, ama sürpriz bir seviye öne alınır — Fextopus %65+ emin
    olup yanıldıysa ya da Türk takımı favori değilken kazandıysa. Bir takım listeyi tek
    başına doldurmasın diye takım başına tavan. Tavanı aşanlar silinmez, sona eklenir
    (sayım tüm maçlardan yapılır)."""
    def puan(m):
        p = _SEVIYE_PUAN.get(m["sev"] or "", 5)
        if m["dogru"] is False:
            kazanan_tr = (m["tr_a"] and m["winner_id"] == m["team_a_id"]) or \
                         (m["tr_b"] and m["winner_id"] == m["team_b_id"])
            if kazanan_tr or (m["fav_p"] or 0) >= SURPRIZ_ESIK * 100:
                p -= 1
        return (p, m["scheduled_at"])
    sayac: dict[int, int] = {}
    secilen, artan = [], []
    for m in sorted(rows, key=puan):
        trler = [tid for tid, tr in ((m["team_a_id"], m["tr_a"]), (m["team_b_id"], m["tr_b"])) if tr]
        if any(sayac.get(t, 0) >= TAKIM_TAVAN for t in trler):
            artan.append(m)
            continue
        for t in trler:
            sayac[t] = sayac.get(t, 0) + 1
        secilen.append(m)
    return secilen + artan


class HaftalikUretici(NewsGenerator):
    """NewsGenerator'ın LLM yardımcılarını (_generate_with_backoff, _parse_llm_json) kullanır."""

    # ── Veri ──────────────────────────────────────────────────────────────
    def turk_sonuclari(self, pzt: date) -> list[dict]:
        bas, bit = _sinir(pzt)
        with Database.get_connection() as conn, conn.cursor() as cur:
            cur.execute(_MAC_SECIMI + f"""
                WHERE m.status = 'finished' AND m.winner_id IS NOT NULL
                  AND m.scheduled_at >= %s AND m.scheduled_at < %s
                  AND EXISTS (SELECT 1 FROM turk_takimlar k WHERE k.team_id IN (m.team_a_id, m.team_b_id))
                ORDER BY {_SEVIYE_SIRA}, m.scheduled_at
            """, (bas, bit))
            return _one_cikanlar(_sozluk(cur))

    def turk_gelecek(self, pzt: date) -> list[dict]:
        """Yayın haftasının (pzt+7) maçları. PandaScore programı eksik olabilir: olan kadarı."""
        bas, bit = _sinir(pzt + timedelta(days=7))
        with Database.get_connection() as conn, conn.cursor() as cur:
            cur.execute(_MAC_SECIMI + f"""
                WHERE m.status = 'not_started'
                  AND m.scheduled_at >= %s AND m.scheduled_at < %s
                  AND EXISTS (SELECT 1 FROM turk_takimlar k WHERE k.team_id IN (m.team_a_id, m.team_b_id))
                ORDER BY {_SEVIYE_SIRA}, m.scheduled_at
                LIMIT %s
            """, (bas, bit, LISTE_GELECEK))
            return _sozluk(cur)

    def surprizler(self, pzt: date) -> tuple[list[dict], dict]:
        """(yanılınan maçlar en emin önce, haftanın S/A/B isabeti)."""
        bas, bit = _sinir(pzt)
        with Database.get_connection() as conn, conn.cursor() as cur:
            cur.execute(_MAC_SECIMI + """
                WHERE m.status = 'finished' AND m.winner_id IS NOT NULL
                  AND m.prediction_team_a IS NOT NULL AND m.prediction_team_b IS NOT NULL
                  AND m.scheduled_at >= %s AND m.scheduled_at < %s
                  AND UPPER(LEFT(COALESCE(tn.tier, ''), 1)) IN ('S', 'A', 'B')
                ORDER BY m.scheduled_at
            """, (bas, bit))
            tum = _sozluk(cur)
        tahminli = [m for m in tum if m["dogru"] is not None]
        isabet = {"mac": len(tahminli), "dogru": sum(1 for m in tahminli if m["dogru"])}
        yanlis = sorted((m for m in tahminli if not m["dogru"] and m["fav_p"] >= SURPRIZ_ESIK * 100),
                        key=lambda m: -m["fav_p"])
        return yanlis[:SURPRIZ_LISTE], isabet

    # ── Rapor (LLM'e giden, açık cümlelerle) ──────────────────────────────
    @staticmethod
    def _sonuc_cumlesi(m: dict) -> str:
        s = (f"{m['a']} {m['team_a_score']}-{m['team_b_score']} {m['b']} "
             f"({m['oyun_ad']}, {m['turnuva']}, {m['sev'] or '?'} seviye). Kazanan: {m['kazanan']}.")
        if m["fav_p"] == 50:
            # %50'de "favori" yok; LLM "X'i %50 favori gösterdi" yazmasın
            s += " Fextopus bu maçı başa baş (%50-%50) görmüştü."
        elif m["fav"]:
            s += (f" Fextopus {m['fav']} için %{m['fav_p']} demişti, "
                  f"{'doğru bildi' if m['dogru'] else 'yanıldı'}.")
        return s

    @staticmethod
    def takim_sayimi(sonuclar: list[dict]) -> list[dict]:
        """Türk takımı başına G/M (derbide iki taraf da sayılır). En çok maç oynayan önce."""
        say: dict[int, dict] = {}
        for m in sonuclar:
            for tid, ad, tr in ((m["team_a_id"], m["a"], m["tr_a"]), (m["team_b_id"], m["b"], m["tr_b"])):
                if not tr:
                    continue
                k = say.setdefault(tid, {"id": tid, "ad": ad, "oyun": m["oyun_ad"], "g": 0, "m": 0})
                k["g" if m["winner_id"] == tid else "m"] += 1
        # Aynı ad farklı oyunda (Bushido Wildcats CS2 + LoL) → oyunu yanına yaz
        adlar = [k["ad"] for k in say.values()]
        for k in say.values():
            if adlar.count(k["ad"]) > 1:
                k["ad"] = f"{k['ad']} ({k['oyun']})"
        return sorted(say.values(), key=lambda k: (-(k["g"] + k["m"]), -k["g"], k["ad"]))

    def _turk_raporu(self, pzt: date, sonuclar, gelecek, sayim) -> str:
        g = sum(k["g"] for k in sayim)
        mg = sum(k["m"] for k in sayim)
        satir = [
            f"HAFTA: {hafta_etiketi(pzt)} {pzt.year}",
            f"Türk takımlarının bu haftaki maç sayısı: {len(sonuclar)}. "
            f"Türk takımlarının toplam galibiyeti: {g}, toplam mağlubiyeti: {mg}.",
            "Takım takım (galibiyet-mağlubiyet): "
            + "; ".join(f"{k['ad']} {k['g']}-{k['m']}" for k in sayim[:8]),
            "",
            "ÖNEMLİ MAÇLAR (önem sırasıyla):",
        ]
        satir += [f"- {self._sonuc_cumlesi(m)}" for m in sonuclar[:LISTE_SONUC]]
        if gelecek:
            satir += ["", "GELECEK HAFTA (programda olanlar):"]
            for m in gelecek[:4]:
                t = m["scheduled_at"].astimezone(TSI)
                s = f"- {m['a']} - {m['b']}, {t.day} {AY[t.month]} {t:%H:%M} ({m['oyun_ad']}, {m['turnuva']})"
                if m["fav_p"] == 50:
                    s += ". Fextopus başa baş görüyor (%50-%50), favori yok"
                elif m["fav"]:
                    s += f". Fextopus favorisi: {m['fav']} %{m['fav_p']}"
                satir.append(s + ".")
        return "\n".join(satir)

    def _surpriz_raporu(self, pzt: date, yanlis, isabet) -> str:
        oran = round(100 * isabet["dogru"] / isabet["mac"]) if isabet["mac"] else 0
        satir = [
            f"HAFTA: {hafta_etiketi(pzt)} {pzt.year}",
            f"Fextopus bu hafta S/A/B seviyesinde {isabet['mac']} maçı tahmin etti, "
            f"{isabet['dogru']} tanesini doğru bildi (%{oran}).",
            f"Aşağıdakiler Fextopus'un en az %{round(SURPRIZ_ESIK * 100)} emin olup yanıldığı maçlar "
            "(en emin olduğu önce):",
        ]
        satir += [f"- {self._sonuc_cumlesi(m)}" for m in yanlis]
        return "\n".join(satir)

    # ── Kayıt ─────────────────────────────────────────────────────────────
    @staticmethod
    def _var_mi(variant: str, pzt: date) -> bool:
        with Database.get_connection() as conn, conn.cursor() as cur:
            cur.execute("""SELECT 1 FROM news_articles WHERE content_type = 'haftalik'
                           AND variant = %s AND ekler->>'hafta' = %s LIMIT 1""",
                        (variant, pzt.isoformat()))
            return cur.fetchone() is not None

    @staticmethod
    def _kaydet(variant: str, article: dict, turnuva_adi: str, hero: str, ekler: dict) -> None:
        content = "\n\n".join(article["paragraphs"]) if isinstance(article.get("paragraphs"), list) \
            else article.get("content", "")
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO news_articles (
                        match_id, content_type, title, summary, content, variant,
                        game_slug, tier, tournament_name, hero_score, ekler
                    )
                    VALUES (NULL, 'haftalik', %s, %s, %s, %s, NULL, 'A', %s, %s, %s)
                """, (article.get("title", ""), article.get("summary", ""), content, variant,
                      turnuva_adi, hero, Jsonb(ekler)))
            conn.commit()

    def _uret(self, variant: str, rapor: str, prompt: str) -> Optional[dict]:
        logger.info("📄 %s raporu:\n%s", variant, rapor)
        raw = self._generate_with_backoff(
            "Aşağıdaki haftalık raporu kullanarak Türkçe haber üret:\n\n" + rapor,
            variant, system_prompt=prompt)
        return self._parse_llm_json(raw) if raw else None

    # ── Giriş noktası ─────────────────────────────────────────────────────
    def generate_weekly(self, pzt: Optional[date] = None, yaz: bool = True) -> dict:
        """yaz=False → yalnız raporları loglar, LLM'e gitmez ve kaydetmez (deneme)."""
        pzt = pzt or hafta_baslangici()
        etiket = hafta_etiketi(pzt)
        logger.info("🗓️  Haftalık içerik: %s (%s)", etiket, pzt.isoformat())
        stats = {"generated": 0, "skipped": 0, "failed": 0}

        # 1) Türk takımlarının haftası
        if self._var_mi("turk_haftasi", pzt):
            logger.info("⏭️  turk_haftasi zaten var (%s)", pzt)
            stats["skipped"] += 1
        else:
            sonuclar = self.turk_sonuclari(pzt)
            if not sonuclar:
                logger.info("⏭️  Bu hafta Türk takımı maçı yok")
                stats["skipped"] += 1
            else:
                gelecek = self.turk_gelecek(pzt)
                sayim = self.takim_sayimi(sonuclar)
                rapor = self._turk_raporu(pzt, sonuclar, gelecek, sayim)
                if not yaz:
                    logger.info("📄 turk_haftasi raporu (deneme):\n%s", rapor)
                else:
                    article = self._uret("turk_haftasi", rapor, TURK_HAFTASI_PROMPT)
                    if article is None:
                        stats["failed"] += 1
                    else:
                        g = sum(k["g"] for k in sayim)
                        mg = sum(k["m"] for k in sayim)
                        self._kaydet("turk_haftasi", article, "Türk Takımları", f"{g}G · {mg}M", {
                            "hafta": pzt.isoformat(), "etiket": etiket,
                            "maclar": [m["id"] for m in sonuclar[:LISTE_SONUC]],
                            "gelecek": [m["id"] for m in gelecek],
                            "mac_sayisi": len(sonuclar), "galibiyet": g, "maglubiyet": mg,
                        })
                        stats["generated"] += 1
                        logger.info("✅ turk_haftasi yazıldı: %s", article.get("title", "")[:70])
                        time.sleep(4)

        # 2) Fextopus'u yanıltan maçlar
        if self._var_mi("surprizler", pzt):
            logger.info("⏭️  surprizler zaten var (%s)", pzt)
            stats["skipped"] += 1
        else:
            yanlis, isabet = self.surprizler(pzt)
            if len(yanlis) < SURPRIZ_MIN:
                logger.info("⏭️  Sürpriz az (%d < %d), haber yok", len(yanlis), SURPRIZ_MIN)
                stats["skipped"] += 1
            else:
                rapor = self._surpriz_raporu(pzt, yanlis, isabet)
                if not yaz:
                    logger.info("📄 surprizler raporu (deneme):\n%s", rapor)
                else:
                    article = self._uret("surprizler", rapor, SURPRIZ_PROMPT)
                    if article is None:
                        stats["failed"] += 1
                    else:
                        self._kaydet("surprizler", article, "Fextopus Karnesi", f"{len(yanlis)} sürpriz", {
                            "hafta": pzt.isoformat(), "etiket": etiket,
                            "maclar": [m["id"] for m in yanlis],
                            "isabet": isabet,
                        })
                        stats["generated"] += 1
                        logger.info("✅ surprizler yazıldı: %s", article.get("title", "")[:70])
        return stats
