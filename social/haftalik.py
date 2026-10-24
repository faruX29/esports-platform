# -*- coding: utf-8 -*-
"""Haftalık videolar — Pazartesi sabahı, önceki haftanın haftalık haberlerinden (1080x1920).

Kullanım:  python haftalik.py [YYYY-AA-GG]   (haftanın Pazartesi'si; boşsa önceki hafta)

Maç listesi HABERİN KENDİSİNDEN okunur (news_articles.ekler, content_type='haftalik'):
video ile sayfadaki liste birebir aynı maçlar. Haber yoksa video da yok.

  turk-haftasi-<pzt>.mp4     Türk takımlarının haftası: başlık → sonuçlar (kenar rengi Türk
                             takımının sonucu) → gelecek haftanın Türk maçı + soru
  fextopus-yanildi-<pzt>.mp4 Fextopus'u yanıltan maçlar: başlık → liste → haftanın isabeti

Tasarım kuralları (karar-kayitlari/sosyal_video_tasarim.md): radara benzemez, tek konu =
tek video, yalnız Inter, gerçek saydamlık (Katman), her videonun kapanışı farklı.
"""
import os, subprocess, sys
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFilter

import radar
from radar import W, H, FPS, BG, INK, MUTED, FAINT, MOR, GRI, YOL, AY, logo, ffmpeg_yolu, _turk_mu
from champions import inter, Katman, ortala, yapistir, kisa, _alt_bilgi, _eas, KIRMIZI, YESIL, KUTU, CIZGI, ELENDI
from karne import _carpi
import psycopg

S_BASLIK, S_LISTE, S_KAPANIS = 3.0, 9.0, 5.0
LISTE_MAKS = 8          # ekrana sığan satır (156px + 12px aralık)
OYUN = {'valorant': 'VALORANT', 'csgo': 'CS2', 'cs2': 'CS2', 'lol': 'LoL', 'league-of-legends': 'LoL'}
TSI = timezone(timedelta(hours=3))


def hafta_baslangici(bugun=None):
    """backend/etl/weekly_news.py ile aynı: önceki haftanın Pazartesi'si (TSİ)."""
    bugun = bugun or datetime.now(TSI).date()
    return bugun - timedelta(days=bugun.weekday() + 7)


# ── Veri ──────────────────────────────────────────────────────────────────
def haberler(pzt):
    """{variant: ekler} — o haftanın haftalık haberleri."""
    with psycopg.connect(os.environ['DATABASE_URL']) as cn:
        rows = cn.execute("""SELECT variant, ekler FROM news_articles
                             WHERE content_type = 'haftalik' AND ekler->>'hafta' = %s""",
                          (pzt.isoformat(),)).fetchall()
    return {v: e for v, e in rows}


def maclar(ids):
    """id sırasını koruyarak maç ayrıntıları."""
    if not ids:
        return []
    with psycopg.connect(os.environ['DATABASE_URL']) as cn:
        rows = cn.execute("""
          SELECT m.id, m.scheduled_at, m.status, m.winner_id, m.team_a_score, m.team_b_score,
                 m.prediction_team_a,
                 ta.id, ta.name, ta.acronym, ta.logo_url, tb.id, tb.name, tb.acronym, tb.logo_url,
                 tn.league_name, tn.event_name, g.slug
          FROM matches m
          JOIN teams ta ON ta.id = m.team_a_id
          JOIN teams tb ON tb.id = m.team_b_id
          LEFT JOIN tournaments tn ON tn.id = m.tournament_id
          LEFT JOIN games g ON g.id = m.game_id
          WHERE m.id = ANY(%s)""", (list(ids),)).fetchall()
    bul = {}
    for (mid, saat, durum, kazanan, sa, sb, pa, aid, aad, aac, alogo, bid, bad, bac, blogo,
         lig, etk, oyun) in rows:
        m = {
            'id': mid, 'saat': saat + timedelta(hours=3), 'bitti': durum == 'finished' and kazanan,
            'a': {'id': aid, 'ad': (aad or '').strip(), 'ac': aac, 'logo': alogo, 'tr': _turk_mu(tid=aid)},
            'b': {'id': bid, 'ad': (bad or '').strip(), 'ac': bac, 'logo': blogo, 'tr': _turk_mu(tid=bid)},
            'sa': sa, 'sb': sb, 'pa': float(pa) if pa is not None else None,
            'etiket': ' · '.join(x for x in (OYUN.get(oyun or '', (oyun or '').upper()),
                                             radar.etkinlik_adi(lig, etk) or lig) if x),
        }
        m['kazanan'] = m['a'] if kazanan == aid else (m['b'] if kazanan == bid else None)
        if m['pa'] is not None:
            m['fav'] = m['a'] if m['pa'] >= 0.5 else m['b']
            m['fav_yuzde'] = round(max(m['pa'], 1 - m['pa']) * 100)
            m['dogru'] = m['kazanan'] is not None and m['kazanan']['id'] == m['fav']['id']
        else:
            m['fav'] = m['fav_yuzde'] = m['dogru'] = None
        bul[mid] = m
    return [bul[i] for i in ids if i in bul]


# ── Zemin: radardan (mor, orta) ve Champions'tan (kırmızı köşe) ayrı ─────────
@lru_cache(maxsize=4)
def _zemin_cache(ust, alt):
    c = Image.new('RGB', (W, H), BG)
    g = Image.new('RGB', (W, H), BG)
    gd = ImageDraw.Draw(g)
    gd.ellipse([W - 700, -300, W + 300, 700], fill=ust)       # sağ üst
    gd.ellipse([-500, 1300, 500, 2300], fill=alt)             # sol alt
    return Image.blend(c, g.filter(ImageFilter.GaussianBlur(260)), 0.26).convert('RGBA')

ZEMIN_TURK = ((150, 20, 40), (40, 60, 120))
ZEMIN_SURPRIZ = ((90, 40, 150), (130, 30, 60))


def _zemin(renkler):
    return _zemin_cache(*renkler).copy()


# ── Ortak parçalar ────────────────────────────────────────────────────────
def _satir(im, d, y, m, a, mod):
    """Maç satırı. mod='turk': kenar rengi Türk takımının sonucu (derbide nötr).
    mod='surpriz': sağda çarpı, Fextopus barı kırmızı."""
    h = 156
    ic_son = W - (210 if mod == 'surpriz' else 76)
    kenar, dolgu, kalin = CIZGI, KUTU, 2
    if mod == 'turk' and m['bitti'] and m['a']['tr'] != m['b']['tr']:
        tr = m['a'] if m['a']['tr'] else m['b']
        kazandi = m['kazanan'] and m['kazanan']['id'] == tr['id']
        kenar, dolgu, kalin = (YESIL, (18, 40, 30), 3) if kazandi else (KIRMIZI, (46, 20, 28), 3)
    d.rounded_rectangle([50, y, W - 50, y + h], 24, fill=dolgu, outline=kenar, width=kalin)
    d.text((76, y + 12), m['etiket'].upper()[:58], font=inter(800, 20), fill=FAINT)

    f_ad = inter(800, 30)
    for tm, x, sag in ((m['a'], 76, False), (m['b'], ic_son, True)):
        lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 46)
        s = tm['ac'] if tm.get('ac') and len(tm['ac']) <= 6 else kisa(tm, d, f_ad, 170)
        renk = INK if (m['kazanan'] is None or m['kazanan']['id'] == tm['id']) else MUTED
        if not sag:
            yapistir(im, lg, x, y + 46)
            d.text((x + 58, y + 50), s, font=f_ad, fill=renk)
        else:
            yapistir(im, lg, x - lg.width, y + 46)
            d.text((x - 58 - d.textlength(s, font=f_ad), y + 50), s, font=f_ad, fill=renk)
    orta = f"{m['sa']} - {m['sb']}" if m['bitti'] else f"{m['saat']:%H:%M}"
    f_s = inter(900, 42)
    d.text(((76 + ic_son - d.textlength(orta, font=f_s)) / 2, y + 42), orta, font=f_s, fill=INK)

    if m['fav']:
        fav_sol = m['fav']['id'] == m['a']['id']
        etiket = f"Fextopus: {m['fav']['ac'] or m['fav']['ad']} %{m['fav_yuzde']}"
        if m['bitti']:
            etiket += ' · bildi' if m['dogru'] else ' · yanıldı'
        d.text((76, y + 92), etiket, font=inter(600, 22), fill=FAINT)
        bx0, bx1, by = 76, ic_son, y + 126
        d.rounded_rectangle([bx0, by, bx1, by + 14], 7, fill=GRI)
        dolu = int((bx1 - bx0) * (m['fav_yuzde'] / 100) * a)
        if dolu > 4:
            kutu = [bx0, by, bx0 + dolu, by + 14] if fav_sol else [bx1 - dolu, by, bx1, by + 14]
            d.rounded_rectangle(kutu, 7, fill=MOR if m['dogru'] or not m['bitti'] else ELENDI)
    if mod == 'surpriz':
        d.line([(ic_son + 34, y + 20), (ic_son + 34, y + h - 20)], fill=CIZGI, width=2)
        _carpi(d, W - 130, y + h / 2, ELENDI)


def _liste(c, baslik_ust, baslik, renk_ust, liste, t, mod):
    a0 = _eas(t / 0.1)
    with Katman(c, a0) as (im, d):
        d.text((80, 96), baslik_ust, font=inter(800, 28), fill=renk_ust)
        d.text((80, 140), baslik, font=inter(900, 66), fill=INK)
    # Kısa liste boş alanı üstte bırakmasın: başlık ile alt bilgi arasında dikey ortala
    y = 250 + max(0, (1680 - 250 - 168 * len(liste)) // 2 - 40)
    adim = 0.6 / max(1, len(liste))      # satırlar sahnenin ilk %70'inde belirsin
    for i, m in enumerate(liste):
        ai = _eas((t - 0.08 - i * adim) / 0.16)
        with Katman(c, ai) as (im, d):
            _satir(im, d, y, m, ai, mod)
        y += 168


def _etiketler(liste):
    """Yalnız listede geçen oyunların etiketi."""
    var = {m['etiket'].split(' · ')[0] for m in liste}
    return ' '.join(e for o, e in (('CS2', '#cs2'), ('VALORANT', '#valorant'), ('LoL', '#leagueoflegends'))
                    if o in var)


def _kareler(sahneler, renkler):
    # Sahne geçişi videonun kendi zeminine söner; parıltı ve alt bilgi yerinde kalır (titremesin)
    bos = _zemin(renkler)
    _alt_bilgi(bos)
    bos = bos.convert('RGB')
    for sure, ciz in sahneler:
        n = int(sure * FPS)
        son = ciz is sahneler[-1][1]
        for i in range(n):
            t = i / (n - 1)
            im = ciz(t)
            kalan = (1 - t) * sure
            if kalan < 0.3 and not son:
                im = Image.blend(im, bos, (0.3 - kalan) / 0.3)
            yield im


def _yaz(dosya, kareler, aciklama):
    pr = subprocess.Popen([ffmpeg_yolu(), '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
        '-r', str(FPS), '-i', '-', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', dosya], stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for im in kareler:
        pr.stdin.write(im.tobytes())
    pr.stdin.close(); pr.wait()
    with open(os.path.splitext(dosya)[0] + '.txt', 'w', encoding='utf-8') as f:
        f.write(aciklama)
    print(f'  {dosya}  ({os.path.getsize(dosya) // 1024} KB)')


# ── Video 1: Türk takımlarının haftası ────────────────────────────────────
def turk_haftasi(ekler):
    sonuc = maclar(ekler.get('maclar', []))[:LISTE_MAKS]
    gelecek = maclar(ekler.get('gelecek', []))
    etiket, g, mg = ekler.get('etiket', ''), ekler.get('galibiyet', 0), ekler.get('maglubiyet', 0)

    def baslik(t):
        c = _zemin(ZEMIN_TURK)
        a1, a2 = _eas(t / 0.3), _eas((t - 0.3) / 0.3)
        with Katman(c, a1) as (im, d):
            ortala(d, 520 + (1 - a1) * 26, 'TÜRK', inter(900, 170), INK)
            ortala(d, 700 + (1 - a1) * 26, 'TAKIMLARI', inter(900, 150), KIRMIZI)
        with Katman(c, a2) as (im, d):
            ortala(d, 920, f'Geçen hafta · {etiket}', inter(700, 44), MUTED)
            # sayaç: renk dili, az yazı
            gs, ms = f'{int(g * a2)} G', f'{int(mg * a2)} M'
            f = inter(900, 96)
            gw, mw = d.textlength(gs, font=f), d.textlength(ms, font=f)
            x0 = (W - (gw + 90 + mw)) / 2
            d.text((x0, 1030), gs, font=f, fill=YESIL)
            d.text((x0 + gw + 90, 1030), ms, font=f, fill=KIRMIZI)
            ortala(d, 1170, f"{ekler.get('mac_sayisi', len(sonuc))} maçın en önemlileri", inter(600, 34), FAINT)
        _alt_bilgi(c)
        return c.convert('RGB')

    def liste(t):
        c = _zemin(ZEMIN_TURK)
        _liste(c, f'TÜRK TAKIMLARI · {etiket.upper()}', 'GEÇEN HAFTA', KIRMIZI, sonuc, t, 'turk')
        _alt_bilgi(c)
        return c.convert('RGB')

    ilk = gelecek[0] if gelecek else None

    def kapanis(t):
        c = _zemin(ZEMIN_TURK)
        a1, a2 = _eas(t / 0.25), _eas((t - 0.35) / 0.25)
        if ilk and ilk['fav']:
            tk = ilk['a'] if ilk['a']['tr'] else ilk['b']
            rakip = ilk['b'] if tk is ilk['a'] else ilk['a']
            p_turk = round((ilk['pa'] if tk is ilk['a'] else 1 - ilk['pa']) * 100)
            s = ilk['saat']
            with Katman(c, a1) as (im, d):
                ortala(d, 330, 'BU HAFTA', inter(800, 34), MUTED)
                for tm, cx in ((tk, 300), (rakip, W - 300)):
                    lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 170)
                    yapistir(im, lg, cx - lg.width / 2, 420 + (170 - lg.height) / 2)
                    f = inter(800, 40); n = kisa(tm, d, f, 380)
                    d.text((cx - d.textlength(n, font=f) / 2, 620), n, font=f, fill=INK)
                ortala(d, 480, 'vs', inter(800, 50), FAINT)
                ortala(d, 700, f'{s.day} {AY[s.month]} · {s:%H:%M}', inter(600, 36), MUTED)
                bx0, bx1, by = 140, W - 140, 800
                d.rounded_rectangle([bx0, by, bx1, by + 26], 13, fill=GRI)
                d.rounded_rectangle([bx0, by, bx0 + int((bx1 - bx0) * p_turk / 100 * a1), by + 26], 13, fill=MOR)
                d.text((bx0, by + 44), f"{tk['ac'] or tk['ad']} %{p_turk}", font=inter(900, 40), fill=MOR)
                r = f"%{100 - p_turk} {rakip['ac'] or rakip['ad']}"
                d.text((bx1 - d.textlength(r, font=inter(900, 40)), by + 44), r, font=inter(900, 40), fill=MUTED)
            with Katman(c, a2) as (im, d):
                # Ek yok (Esports'ı/'u): Türkçe ünlü uyumunu ada göre tahmin etmiyoruz
                soru = ('Fextopus bu maçı başa baş görüyor.' if p_turk == 50
                        else f"Fextopus'un favorisi: {tk['ad'] if p_turk > 50 else rakip['ad']}")
                ortala(d, 1040, soru, inter(800, 40), INK)
                ortala(d, 1110, 'Sen ne diyorsun?', inter(900, 60), MOR)
                ortala(d, 1240, "Haftanın tamamı fextesports.com'da", inter(500, 32), MUTED)
        else:
            with Katman(c, a1) as (im, d):
                ortala(d, 760, 'Haftanın tüm maçları', inter(800, 54), INK)
                ortala(d, 840, "fextesports.com'da", inter(900, 64), MOR)
        _alt_bilgi(c)
        return c.convert('RGB')

    # Açıklama (paylaşım metni)
    s = [f"Türk takımları geçen hafta ({etiket}): {g} galibiyet, {mg} mağlubiyet.", '']
    for m in sonuc:
        tr = m['a'] if m['a']['tr'] else m['b']
        isaret = '+' if m['kazanan'] and m['kazanan']['id'] == tr['id'] else '-'
        s.append(f"{isaret} {m['a']['ad']} {m['sa']}-{m['sb']} {m['b']['ad']}")
    if ilk:
        s += ['', f"Bu hafta: {ilk['a']['ad']} - {ilk['b']['ad']}, {ilk['saat'].day} {AY[ilk['saat'].month]} "
                  f"{ilk['saat']:%H:%M}. Sen ne diyorsun?"]
    s += ['', "Haftanın özeti ve tüm maçlar fextesports.com'da, link profilde.", '',
          '#espor #türkespor ' + _etiketler(sonuc)]
    return [(S_BASLIK, baslik), (S_LISTE, liste), (S_KAPANIS, kapanis)], '\n'.join(s)


# ── Video 2: Fextopus'u yanıltan maçlar ───────────────────────────────────
def surprizler(ekler):
    liste_m = maclar(ekler.get('maclar', []))[:LISTE_MAKS]
    etiket = ekler.get('etiket', '')
    isabet = ekler.get('isabet') or {}
    mac, dogru = isabet.get('mac', 0), isabet.get('dogru', 0)
    oran = round(100 * dogru / mac) if mac else 0

    def baslik(t):
        c = _zemin(ZEMIN_SURPRIZ)
        a1, a2 = _eas(t / 0.3), _eas((t - 0.3) / 0.3)
        with Katman(c, a1) as (im, d):
            fx = YOL('assets', 'fextopus-icon.png')
            if os.path.exists(fx):
                ikon = Image.open(fx).convert('RGBA')
                ikon = ikon.resize((int(ikon.width * 200 / ikon.height), 200), Image.LANCZOS)
                yapistir(im, ikon, (W - ikon.width) / 2, 300 + (1 - a1) * 26)
            ortala(d, 560, "FEXTOPUS'U", inter(900, 130), INK)
            ortala(d, 710, 'YANILTANLAR', inter(900, 130), ELENDI)
        with Katman(c, a2) as (im, d):
            ortala(d, 930, f'Geçen hafta · {etiket}', inter(700, 44), MUTED)
            ortala(d, 1040, 'En emin olduğu maçlarda', inter(600, 38), MUTED)
            ortala(d, 1092, 'yanıldıklarını saklamıyoruz', inter(800, 42), INK)
        _alt_bilgi(c)
        return c.convert('RGB')

    def liste(t):
        c = _zemin(ZEMIN_SURPRIZ)
        _liste(c, f'FEXTOPUS · {etiket.upper()}', 'YANILDIĞI MAÇLAR', ELENDI, liste_m, t, 'surpriz')
        _alt_bilgi(c)
        return c.convert('RGB')

    def kapanis(t):
        c = _zemin(ZEMIN_SURPRIZ)
        a1, a2 = _eas(t / 0.3), _eas((t - 0.4) / 0.3)
        with Katman(c, a1) as (im, d):
            ortala(d, 420, 'HAFTANIN KARNESİ', inter(800, 44), MUTED)
            ortala(d, 500, f'%{int(oran * a1)}', inter(900, 300), MOR)
            ortala(d, 840, f'{mac} maçta {dogru} doğru', inter(700, 44), INK)
        with Katman(c, a2) as (im, d):
            ortala(d, 1010, 'Doğrusu da yanlışı da açık:', inter(600, 36), MUTED)
            ortala(d, 1066, 'fextesports.com/stats', inter(900, 52), INK)
            ortala(d, 1200, 'Sence bu hafta kimi yanıltacak?', inter(800, 40), MOR)
        _alt_bilgi(c)
        return c.convert('RGB')

    s = [f"Fextopus geçen hafta ({etiket}) {mac} maçta {dogru} doğru tahmin yaptı (%{oran}). "
         "En emin olup yanıldıkları:", '']
    for m in liste_m:
        s.append(f"✗ {m['a']['ad']} {m['sa']}-{m['sb']} {m['b']['ad']} "
                 f"(Fextopus: {m['fav']['ad']} %{m['fav_yuzde']})")
    s += ['', "Tüm tahminler ve isabet oranları fextesports.com'da.", '', '#espor ' + _etiketler(liste_m)]
    return [(S_BASLIK, baslik), (S_LISTE, liste), (S_KAPANIS, kapanis)], '\n'.join(s)


if __name__ == '__main__':
    pzt = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else hafta_baslangici()
    hb = haberler(pzt)
    os.makedirs(radar.CIKTI, exist_ok=True)
    if not hb:
        print(f'{pzt}: haftalık haber yok — video üretilmedi.')
    for variant, uretici, ad, renkler in (('turk_haftasi', turk_haftasi, 'turk-haftasi', ZEMIN_TURK),
                                          ('surprizler', surprizler, 'fextopus-yanildi', ZEMIN_SURPRIZ)):
        if variant not in hb:
            continue
        sahneler, aciklama = uretici(hb[variant])
        _yaz(os.path.join(radar.CIKTI, f'{ad}-{pzt:%d-%m}.mp4'), _kareler(sahneler, renkler), aciklama)
