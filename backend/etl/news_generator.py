"""
LLM-powered news article generator.

Pipeline:
  1. Query Supabase for finished matches without a news_articles entry.
  2. Build a compact Fact Sheet per match (token-optimised, no raw JSON).
  3. Send fact sheet to the LLM adapter with the editor system prompt.
  4. Parse the JSON response and persist to news_articles.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from pydantic import BaseModel

from database import Database
from etl.adapters.llm_adapter import BaseLLMAdapter


class NewsArticleSchema(BaseModel):
    title: str
    summary: str
    paragraphs: list[str]

logger = logging.getLogger(__name__)

# ── Editor persona injected as system prompt ──────────────────────────────────
SYSTEM_PROMPT = (
    "Sen profesyonel bir espor editörüsün. Gelen maç verilerini ve istatistik "
    "özetlerini kullanarak, espor jargonuna (ACS, clutch, eco round, anti-eco, "
    "pistol round, veto, map draft, opening duel vb.) tamamen hakim, sürükleyici "
    "ve tarafsız Türkçe haber bültenleri yazıyorsun.\n\n"
    "Kurallar:\n"
    "- Haber dili doğal, akıcı ve kısa cümlelerden oluşsun.\n"
    "- Kesinlikle icat edilmiş bilgi veya oyuncu ismi ekleme; yalnızca fact "
    "sheet'teki verileri kullan.\n"
    "- Başlık (title) en fazla 12 kelime, özet (summary) 2-3 cümle olsun.\n"
    "- Makale gövdesi 3-5 ayrı paragraf string'i içeren 'paragraphs' dizisi olarak gelsin.\n"
    "- JSON string değerlerinin içinde KESİNLİKLE çift tırnak (\") kullanma; "
    "terimleri vurgulamak için yalnızca tek tırnak (') kullan.\n"
    "- Yanıtı yalnızca aşağıdaki JSON şemasında ver; başka hiçbir şey yazma:\n"
    '{"title": "...", "summary": "...", "paragraphs": ["1. paragraf", "2. paragraf", "3. paragraf"]}'
)

# ── Önizleme (upcoming) editör persona'sı ─────────────────────────────────────
PREVIEW_SYSTEM_PROMPT = (
    "Sen profesyonel bir espor editörüsün. Gelen YAKLAŞAN maç verilerini kullanarak "
    "espor jargonuna hakim, merak uyandıran, tarafsız Türkçe maç ÖNİZLEMESİ yazıyorsun.\n\n"
    "Kurallar:\n"
    "- Maç henüz OYNANMADI; sonuç/skor uydurma. Beklenti, form ve favori analizi yaz.\n"
    "- Model favorisi verildiyse ona değin ama kesin sonuç verme; 'kağıt üstünde favori' tonu kullan.\n"
    "- Kesinlikle icat edilmiş istatistik veya oyuncu ismi ekleme; yalnızca fact sheet verisi.\n"
    "- Başlık (title) en fazla 12 kelime, özet (summary) 2-3 cümle.\n"
    "- Gövde 3-4 paragraf string'i içeren 'paragraphs' dizisi olsun.\n"
    "- JSON string içinde çift tırnak (\") kullanma; vurgu için tek tırnak (').\n"
    "- Yanıtı yalnızca şu JSON şemasında ver:\n"
    '{"title": "...", "summary": "...", "paragraphs": ["1. paragraf", "2. paragraf"]}'
)

# ── Transfer haberi editör persona'sı ─────────────────────────────────────────
TRANSFER_SYSTEM_PROMPT = (
    "Sen profesyonel bir espor transfer muhabirisin. Gelen roster değişikliği "
    "verisini kullanarak espor jargonuna hakim, net ve tarafsız Türkçe transfer "
    "haberi yazıyorsun.\n\n"
    "Kurallar:\n"
    "- Yalnızca fact sheet'teki veriyi kullan; oyuncu/takım/istatistik UYDURMA.\n"
    "- Oyuncunun performans metriği (KDA/Impact) verildiyse habere doğal şekilde "
    "işle (örn. 'son dönemde X K/D ile öne çıkan oyuncu').\n"
    "- Başlık (title) en fazla 12 kelime, özet (summary) 2-3 cümle.\n"
    "- Gövde 2-4 paragraf string'i içeren 'paragraphs' dizisi olsun.\n"
    "- JSON string içinde çift tırnak (\") kullanma; vurgu için tek tırnak (').\n"
    "- Yanıtı yalnızca şu JSON şemasında ver:\n"
    '{"title": "...", "summary": "...", "paragraphs": ["1. paragraf", "2. paragraf"]}'
)

# ── Tier display labels ───────────────────────────────────────────────────────
_TIER_LABELS = {
    "S": "S-Tier (Premier)",
    "A": "A-Tier (Major)",
    "B": "B-Tier",
    "C": "C-Tier",
}


class FactSheetBuilder:
    """
    Extracts structured match context for LLM input.

    Deliberately excludes raw PandaScore JSON blobs to keep token count low
    (target: ~200-350 tokens per fact sheet).
    """

    @staticmethod
    def _fmt_seconds(seconds: Optional[float]) -> Optional[str]:
        if not seconds:
            return None
        return f"{int(seconds // 60)} dk"

    @staticmethod
    def _fmt_form(name: str, form: Optional[dict]) -> Optional[str]:
        """Takım form dict'ini tek satır metne çevirir. Veri yoksa None."""
        if not form or not form.get("n"):
            return None
        return f"{name} son {form['n']} maç: {form['wins']}G-{form['losses']}M ({form['form']})"

    @staticmethod
    def build_preview(match: dict, form_a: Optional[dict] = None, form_b: Optional[dict] = None) -> str:
        """
        Yaklaşan (upcoming) maç için önizleme fact sheet'i — final skor yok;
        tahmin, tier, takım, zaman ve (varsa) son maç formu kullanılır.
        """
        team_a = match.get("team_a") or {}
        team_b = match.get("team_b") or {}
        tournament = match.get("tournament") or {}
        a_name = team_a.get("name") or "Team A"
        b_name = team_b.get("name") or "Team B"

        tier = str(tournament.get("tier") or match.get("tier") or "C").upper()
        tier_label = _TIER_LABELS.get(tier, "Bilinmeyen Tier")
        t_name = tournament.get("name") or match.get("tournament_name") or "Ana Sahne"
        game = str((match.get("game") or {}).get("slug") or match.get("game_slug") or "esports").upper()
        when = match.get("scheduled_at") or "yakında"

        lines = [
            "MAÇ ÖNİZLEME RAPORU",
            f"Turnuva: {t_name} [{tier_label}]",
            f"Oyun: {game}",
            f"Eşleşme: {a_name} vs {b_name}",
            f"Tarih: {when}",
        ]
        # Hibrit veri derinliği: son maç formu (varsa)
        for line in (FactSheetBuilder._fmt_form(a_name, form_a), FactSheetBuilder._fmt_form(b_name, form_b)):
            if line:
                lines.append(f"Form: {line}")

        pred_a = match.get("prediction_team_a")
        pred_b = match.get("prediction_team_b")
        if pred_a is not None and pred_b is not None:
            fav = a_name if float(pred_a) >= float(pred_b) else b_name
            lines.append(f"Model favorisi: {fav} (tahmin {float(pred_a):.2f} / {float(pred_b):.2f})")
        else:
            lines.append("Model tahmini: henüz yok (dengeli beklenti)")
        return "\n".join(lines)

    @staticmethod
    def build_transfer(transfer: dict, player_form: Optional[str] = None) -> str:
        """
        Roster değişikliği için transfer haberi fact sheet'i.
        transfer: {player, old_team, new_team, role, transfer_date, transfer_type, game}
        player_form: opsiyonel performans özeti (KDA/Impact) — varsa derinlik katar.
        """
        player = transfer.get("player") or "Bilinmeyen Oyuncu"
        old_team = transfer.get("old_team")
        new_team = transfer.get("new_team")
        role = transfer.get("role")
        ttype = (transfer.get("transfer_type") or "permanent").lower()
        game = str(transfer.get("game") or "esports").upper()

        if new_team and not old_team:
            hareket = f"{new_team} kadrosuna KATILDI"
        elif old_team and not new_team:
            hareket = f"{old_team} kadrosundan AYRILDI (serbest oyuncu)"
        else:
            hareket = f"{old_team} → {new_team} TRANSFER oldu"

        lines = [
            "TRANSFER RAPORU",
            f"Oyuncu: {player}",
            f"Oyun: {game}",
            f"Hareket: {hareket}",
            f"Tarih: {transfer.get('transfer_date')}",
        ]
        if role:
            lines.append(f"Rol: {role}")
        if ttype in ("loan", "trial", "release"):
            lines.append(f"Transfer tipi: {ttype}")
        if player_form:
            lines.append(f"Oyuncu son dönem performansı: {player_form}")
        return "\n".join(lines)

    @staticmethod
    def _dominant_agent(stats: Optional[dict]) -> Optional[str]:
        """player_match_stats.stats jsonb'sindeki maps[].agent'lardan en çok oynananı."""
        maps = (stats or {}).get("maps") if isinstance(stats, dict) else None
        if not isinstance(maps, list):
            return None
        agents = [m.get("agent") for m in maps if isinstance(m, dict) and m.get("agent")]
        if not agents:
            return None
        return Counter(agents).most_common(1)[0][0]

    @staticmethod
    def _format_top_players(player_rows: list[dict]) -> Optional[str]:
        """
        En yüksek KDA'ya sahip oyuncuları tek satırlık öne-çıkanlar metni yapar.
        Hibrit veri derinliği: mevcutsa agent (Valorant) ve HS% de eklenir.
        player_rows: [{nickname, team_name, kills, deaths, assists, hs_percentage, stats}, ...]
        """
        if not player_rows:
            return None
        parts = []
        for p in player_rows[:3]:
            nick = p.get("nickname")
            if not nick:
                continue
            k = int(p.get("kills") or 0)
            d = int(p.get("deaths") or 0)
            a = int(p.get("assists") or 0)
            team = p.get("team_name")
            team_tag = f" ({team})" if team else ""
            agent = FactSheetBuilder._dominant_agent(p.get("stats"))
            agent_tag = f" [{agent}]" if agent else ""
            hs = p.get("hs_percentage")
            hs_tag = f" HS%{int(hs)}" if hs not in (None, 0) else ""
            parts.append(f"{nick}{team_tag}{agent_tag} {k}/{d}/{a}{hs_tag}")
        return " | ".join(parts) if parts else None

    @staticmethod
    def build(match: dict, stats_rows: list[dict], player_rows: Optional[list[dict]] = None) -> str:
        team_a = match.get("team_a") or {}
        team_b = match.get("team_b") or {}
        tournament = match.get("tournament") or {}

        a_name = team_a.get("name") or match.get("team_a_name") or "Team A"
        b_name = team_b.get("name") or match.get("team_b_name") or "Team B"
        a_score = int(match.get("team_a_score") or 0)
        b_score = int(match.get("team_b_score") or 0)
        winner_id = str(match.get("winner_id") or "")
        a_id = str(team_a.get("id") or match.get("team_a_id") or "")
        b_id = str(team_b.get("id") or match.get("team_b_id") or "")

        winner_name = a_name if winner_id == a_id else b_name if winner_id == b_id else "Bilinmiyor"
        loser_name = b_name if winner_name == a_name else a_name
        margin = abs(a_score - b_score)

        # Prediction signals
        pred_a = match.get("prediction_team_a")
        pred_b = match.get("prediction_team_b")
        predicted_winner: Optional[str] = None
        upset = False
        if pred_a is not None and pred_b is not None:
            predicted_winner = a_name if float(pred_a) >= float(pred_b) else b_name
            upset = predicted_winner != winner_name and winner_name != "Bilinmiyor"

        # Map & tempo signals from match_stats rows
        map_lengths: list[float] = []
        map_count = max(a_score, b_score, 0)
        impact_team: Optional[str] = None
        impact_score: Optional[float] = None

        for row in stats_rows:
            stats = row.get("stats") or {}
            details = stats.get("games_detail") or stats.get("maps") or []
            if isinstance(details, list):
                if len(details) > map_count:
                    map_count = len(details)
                for detail in details:
                    secs = (
                        detail.get("duration_seconds")
                        or detail.get("duration")
                        or detail.get("round_time")
                        or 0
                    )
                    if isinstance(secs, (int, float)) and secs > 0:
                        map_lengths.append(float(secs))
            score_val = float(stats.get("score") or 0)
            if impact_score is None or score_val > impact_score:
                t_id = str(row.get("team_id") or "")
                if t_id in (a_id, b_id):
                    impact_score = score_val
                    impact_team = a_name if t_id == a_id else b_name

        avg_secs = sum(map_lengths) / len(map_lengths) if map_lengths else None
        longest_secs = max(map_lengths) if map_lengths else None
        tempo = "dengeli tempo"
        if avg_secs is not None:
            if avg_secs <= 1500:
                tempo = "hızlı tempo"
            elif avg_secs >= 2200:
                tempo = "uzun round temposu"

        tier = str(tournament.get("tier") or match.get("tier") or "C").upper()
        tier_label = _TIER_LABELS.get(tier, "Bilinmeyen Tier")
        t_name = tournament.get("name") or match.get("tournament_name") or "Ana Sahne"
        game = str((match.get("game") or {}).get("slug") or match.get("game_slug") or "esports").upper()

        lines = [
            "MAÇ ÖZET RAPORU",
            f"Turnuva: {t_name} [{tier_label}]",
            f"Oyun: {game}",
            f"Galip: {winner_name} | Mağlup: {loser_name} | Skor: {a_score}:{b_score}",
            f"Harita sayısı: {map_count or 1} | Tempo: {tempo}",
        ]
        if FactSheetBuilder._fmt_seconds(avg_secs):
            lines.append(f"Ort. harita süresi: {FactSheetBuilder._fmt_seconds(avg_secs)}")
        if FactSheetBuilder._fmt_seconds(longest_secs):
            lines.append(f"En uzun harita: {FactSheetBuilder._fmt_seconds(longest_secs)}")
        if impact_team and impact_score:
            lines.append(f"MVP tarafı: {impact_team} ({int(impact_score)} impact puanı)")
        top_players = FactSheetBuilder._format_top_players(player_rows or [])
        if top_players:
            lines.append(f"Öne çıkan oyuncular (K/D/A): {top_players}")
        if pred_a is not None and pred_b is not None:
            lines.append(
                f"Model tahmini: {a_name}={float(pred_a):.2f} / {b_name}={float(pred_b):.2f}"
            )
        if upset:
            lines.append(
                f"⚠️ SÜRPRİZ: Tahmin edilen galip {predicted_winner} iken {winner_name} kazandı"
            )
        elif margin >= 2:
            lines.append(f"Maç tipi: Dominant galibiyet (fark {margin})")
        else:
            lines.append(f"Maç tipi: Dar seri (fark {margin})")

        return "\n".join(lines)


class NewsGenerator:
    """Fetches unprocessed finished matches and writes LLM-generated articles."""

    def __init__(self, llm_adapter: BaseLLMAdapter) -> None:
        self._llm = llm_adapter

    # ── DB helpers ────────────────────────────────────────────────────────────

    def _fetch_unprocessed(self, hours_back: int = 24) -> list[dict]:
        since = (datetime.now(timezone.utc) - timedelta(hours=hours_back)).isoformat()
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        m.id, m.scheduled_at, m.winner_id,
                        m.team_a_id, m.team_b_id,
                        m.team_a_score, m.team_b_score,
                        m.prediction_team_a, m.prediction_team_b,
                        t_a.id       AS ta_id,
                        t_a.name     AS ta_name,
                        t_a.logo_url AS ta_logo,
                        t_b.id       AS tb_id,
                        t_b.name     AS tb_name,
                        t_b.logo_url AS tb_logo,
                        tn.id        AS tn_id,
                        tn.name      AS tn_name,
                        tn.tier      AS tn_tier,
                        g.slug       AS game_slug
                    FROM matches m
                    LEFT JOIN teams       t_a ON t_a.id = m.team_a_id
                    LEFT JOIN teams       t_b ON t_b.id = m.team_b_id
                    LEFT JOIN tournaments tn  ON tn.id  = m.tournament_id
                    LEFT JOIN games       g   ON g.id   = m.game_id
                    WHERE m.status = 'finished'
                      AND m.scheduled_at >= %s
                      AND NOT EXISTS (
                          SELECT 1 FROM news_articles na
                          WHERE na.match_id = m.id AND na.variant <> 'preview'
                      )
                    ORDER BY m.scheduled_at DESC
                    LIMIT 20
                    """,
                    (since,),
                )
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]

    def _fetch_stats(self, match_id) -> list[dict]:
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT team_id, stats FROM match_stats WHERE match_id = %s",
                    (match_id,),
                )
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]

    def _fetch_player_stats(self, match_id) -> list[dict]:
        """
        Maçın en yüksek kill'e sahip oyuncularını döner (Hibrit Adapter ile
        player_match_stats dolduğunda makaleleri zenginleştirir). Veri yoksa [].

        OPSİYONEL zenginleştirme: şema/veri sorununda [] döner — haber üretimini
        ASLA çökertmez (no silent fail: hata loglanır).
        """
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT p.nickname, t.name AS team_name,
                               pms.kills, pms.deaths, pms.assists,
                               pms.hs_percentage, pms.impact_score, pms.stats
                        FROM player_match_stats pms
                        JOIN players p ON p.id = pms.player_id
                        LEFT JOIN teams t ON t.id = pms.team_id
                        WHERE pms.match_id = %s AND pms.kills IS NOT NULL
                        ORDER BY pms.kills DESC NULLS LAST
                        LIMIT 5
                        """,
                        (match_id,),
                    )
                    cols = [d[0] for d in cur.description]
                    return [dict(zip(cols, row)) for row in cur.fetchall()]
        except Exception as exc:
            logger.warning("⚠️  player_match_stats okunamadı (atlanıyor) match %s: %s", match_id, exc)
            return []

    def _fetch_team_form(self, team_id, limit: int = 5) -> Optional[dict]:
        """
        Takımın son N bitmiş maçının W/L formu (önizleme fact sheet'ini derinleştirir).
        Veri yoksa None döner — önizleme üretimini ASLA çökertmez.
        Dönüş: {"n": int, "wins": int, "losses": int, "form": "WWLWL"}  (yeni→eski)
        """
        if not team_id:
            return None
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT winner_id
                        FROM matches
                        WHERE status = 'finished'
                          AND (team_a_id = %s OR team_b_id = %s)
                        ORDER BY scheduled_at DESC
                        LIMIT %s
                        """,
                        (team_id, team_id, limit),
                    )
                    rows = cur.fetchall()
        except Exception as exc:
            logger.warning("⚠️  takım formu okunamadı (atlanıyor) team %s: %s", team_id, exc)
            return None
        if not rows:
            return None
        tid = str(team_id)
        results = ["W" if str(w[0] or "") == tid else "L" for w in rows]
        wins = results.count("W")
        return {"n": len(results), "wins": wins, "losses": len(results) - wins, "form": "".join(results)}

    def _denormalize(self, row: dict) -> dict:
        """Map the flat JOIN row into the nested structure FactSheetBuilder expects."""
        return {
            **row,
            "team_a": {"id": row["ta_id"], "name": row["ta_name"], "logo_url": row["ta_logo"]},
            "team_b": {"id": row["tb_id"], "name": row["tb_name"], "logo_url": row["tb_logo"]},
            "tournament": {"id": row["tn_id"], "name": row["tn_name"], "tier": row["tn_tier"]},
            "game": {"slug": row["game_slug"]},
        }

    def _parse_llm_json(self, raw: str) -> Optional[dict]:
        """
        Parse Gemini structured-output JSON.

        Gemini's native response_schema guarantees a valid, schema-conformant
        JSON object — so a single json.loads() call is sufficient.
        The fence-cleanup fallback is kept as a last resort against SDK regressions.
        """
        text = raw.strip()

        try:
            data = json.loads(text, strict=False)
            if isinstance(data, dict) and "title" in data:
                return data
            logger.warning("❌ Beklenmeyen şema. Gelen anahtarlar: %s", list(data.keys()) if isinstance(data, dict) else type(data))
        except json.JSONDecodeError as exc:
            logger.warning("❌ JSON Decode Hatası: %s", exc)

        # Last-resort fence cleanup (should never trigger with response_schema)
        cleaned = text.replace("```json", "").replace("```", "").strip()
        if cleaned != text:
            try:
                data = json.loads(cleaned, strict=False)
                if isinstance(data, dict) and "title" in data:
                    logger.debug("JSON parsed after fence cleanup")
                    return data
            except json.JSONDecodeError:
                pass

        logger.warning("❌ LLM JSON parse tamamen başarısız. Ham metin:\n%s", raw)
        return None

    def _save_article(self, match: dict, article: dict) -> None:
        team_a = match["team_a"]
        team_b = match["team_b"]
        tournament = match["tournament"]
        a_score = int(match.get("team_a_score") or 0)
        b_score = int(match.get("team_b_score") or 0)
        a_name = team_a.get("name") or "Team A"
        b_name = team_b.get("name") or "Team B"

        winner_id = str(match.get("winner_id") or "")
        a_id = str(team_a.get("id") or "")
        b_id = str(team_b.get("id") or "")
        winner_name = a_name if winner_id == a_id else b_name if winner_id == b_id else "?"

        pred_a = match.get("prediction_team_a")
        pred_b = match.get("prediction_team_b")
        upset = False
        if pred_a is not None and pred_b is not None:
            predicted = a_name if float(pred_a) >= float(pred_b) else b_name
            upset = predicted != winner_name and winner_name != "?"
        margin = abs(a_score - b_score)
        variant = "upset" if upset else ("stomp" if margin >= 2 else "close")

        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO news_articles (
                        match_id, title, summary, content, variant,
                        game_slug, tier, tournament_name, tournament_id,
                        team_a_name, team_b_name, team_a_logo, team_b_logo, hero_score
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (match_id) DO UPDATE SET
                        title = EXCLUDED.title, summary = EXCLUDED.summary,
                        content = EXCLUDED.content, variant = EXCLUDED.variant,
                        hero_score = EXCLUDED.hero_score, created_at = now()
                    WHERE news_articles.variant = 'preview'
                    """,
                    (
                        match["id"],
                        article.get("title", ""),
                        article.get("summary", ""),
                        "\n\n".join(article["paragraphs"]) if isinstance(article.get("paragraphs"), list) else article.get("content", ""),
                        variant,
                        match.get("game_slug"),
                        str(tournament.get("tier") or "C").upper(),
                        tournament.get("name") or "Ana Sahne",
                        tournament.get("id"),
                        a_name,
                        b_name,
                        team_a.get("logo_url"),
                        team_b.get("logo_url"),
                        f"{a_name} {a_score} - {b_score} {b_name}",
                    ),
                )
            conn.commit()

    # ── Public entry point ────────────────────────────────────────────────────

    def generate_pending(self, hours_back: int = 24) -> dict:
        """
        Find finished matches without an article and generate one for each.

        Returns stats: {attempted, generated, failed}.
        """
        rows = self._fetch_unprocessed(hours_back=hours_back)
        logger.info("📰 Haber üretilecek maç: %d", len(rows))
        stats = {"attempted": len(rows), "generated": 0, "failed": 0}

        for row in rows:
            match = self._denormalize(row)
            stats_rows = self._fetch_stats(match["id"])
            player_rows = self._fetch_player_stats(match["id"])

            fact_sheet = FactSheetBuilder.build(match, stats_rows, player_rows)
            user_prompt = (
                "Aşağıdaki maç özet raporunu kullanarak Türkçe haber bülteni üret:\n\n"
                + fact_sheet
            )

            raw = self._generate_with_backoff(user_prompt, match["id"])
            if raw is None:
                stats["failed"] += 1
                continue

            article = self._parse_llm_json(raw)
            if article is None:
                stats["failed"] += 1
                continue

            try:
                self._save_article(match, article)
                stats["generated"] += 1
                logger.info(
                    "✅ Haber yazıldı  match_id=%-10s  %s",
                    match["id"],
                    article.get("title", "")[:60],
                )
            except Exception as exc:
                logger.warning("⚠️  DB kayıt hatası match %s: %s", match["id"], exc)
                stats["failed"] += 1

            time.sleep(4)

        return stats

    # ── Önizleme (upcoming) üretimi ───────────────────────────────────────────

    def _fetch_upcoming_for_preview(self, hours_ahead: int = 48) -> list[dict]:
        """Önümüzdeki X saatteki, makalesi olmayan yüksek tier (S/A) upcoming maçlar."""
        until = (datetime.now(timezone.utc) + timedelta(hours=hours_ahead)).isoformat()
        now = datetime.now(timezone.utc).isoformat()
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        m.id, m.scheduled_at,
                        m.team_a_id, m.team_b_id,
                        m.prediction_team_a, m.prediction_team_b,
                        t_a.id AS ta_id, t_a.name AS ta_name, t_a.logo_url AS ta_logo,
                        t_b.id AS tb_id, t_b.name AS tb_name, t_b.logo_url AS tb_logo,
                        tn.id AS tn_id, tn.name AS tn_name, tn.tier AS tn_tier,
                        g.slug AS game_slug
                    FROM matches m
                    LEFT JOIN teams       t_a ON t_a.id = m.team_a_id
                    LEFT JOIN teams       t_b ON t_b.id = m.team_b_id
                    LEFT JOIN tournaments tn  ON tn.id  = m.tournament_id
                    LEFT JOIN games       g   ON g.id   = m.game_id
                    WHERE m.status IN ('not_started', 'upcoming')
                      AND m.scheduled_at BETWEEN %s AND %s
                      AND UPPER(COALESCE(tn.tier, 'C')) IN ('S', 'A')
                      AND t_a.name IS NOT NULL AND t_b.name IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM news_articles na WHERE na.match_id = m.id
                      )
                    ORDER BY m.scheduled_at ASC
                    LIMIT 10
                    """,
                    (now, until),
                )
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]

    def _save_preview(self, match: dict, article: dict) -> None:
        """Önizleme makalesini variant='preview' ile kaydeder (skor yok, conflict'te dokunma)."""
        team_a = match["team_a"]; team_b = match["team_b"]; tournament = match["tournament"]
        a_name = team_a.get("name") or "Team A"
        b_name = team_b.get("name") or "Team B"
        content = "\n\n".join(article["paragraphs"]) if isinstance(article.get("paragraphs"), list) else article.get("content", "")
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO news_articles (
                        match_id, title, summary, content, variant,
                        game_slug, tier, tournament_name, tournament_id,
                        team_a_name, team_b_name, team_a_logo, team_b_logo, hero_score
                    )
                    VALUES (%s, %s, %s, %s, 'preview', %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (match_id) DO NOTHING
                    """,
                    (
                        match["id"], article.get("title", ""), article.get("summary", ""), content,
                        match.get("game_slug"), str(tournament.get("tier") or "C").upper(),
                        tournament.get("name") or "Ana Sahne", tournament.get("id"),
                        a_name, b_name, team_a.get("logo_url"), team_b.get("logo_url"),
                        f"{a_name} vs {b_name}",
                    ),
                )
            conn.commit()

    def generate_previews(self, hours_ahead: int = 48) -> dict:
        """Yaklaşan yüksek-tier maçlar için LLM önizleme makaleleri üret."""
        rows = self._fetch_upcoming_for_preview(hours_ahead=hours_ahead)
        logger.info("🔮 Önizleme üretilecek maç: %d", len(rows))
        stats = {"attempted": len(rows), "generated": 0, "failed": 0}

        for row in rows:
            match = self._denormalize(row)
            form_a = self._fetch_team_form(match["team_a"].get("id"))
            form_b = self._fetch_team_form(match["team_b"].get("id"))
            fact_sheet = FactSheetBuilder.build_preview(match, form_a=form_a, form_b=form_b)
            user_prompt = (
                "Aşağıdaki yaklaşan maç önizleme raporunu kullanarak Türkçe maç önizlemesi üret:\n\n"
                + fact_sheet
            )

            raw = self._generate_with_backoff(user_prompt, match["id"], system_prompt=PREVIEW_SYSTEM_PROMPT)
            if raw is None:
                stats["failed"] += 1
                continue
            article = self._parse_llm_json(raw)
            if article is None:
                stats["failed"] += 1
                continue
            try:
                self._save_preview(match, article)
                stats["generated"] += 1
                logger.info("✅ Önizleme yazıldı  match_id=%-10s  %s", match["id"], article.get("title", "")[:60])
            except Exception as exc:
                logger.warning("⚠️  Önizleme kayıt hatası match %s: %s", match["id"], exc)
                stats["failed"] += 1
            time.sleep(4)

        return stats

    # ── Transfer haberi üretimi ───────────────────────────────────────────────

    def _fetch_pending_transfers(self, limit: int = 15) -> list[dict]:
        """news_generated=false, oyuncusu DB'de çözülmüş roster değişiklikleri."""
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT rc.id AS rc_id, p.id AS player_id, p.nickname AS player,
                           COALESCE(st.name, rc.raw_payload->>'old_team') AS old_team,
                           COALESCE(tt.name, rc.raw_payload->>'new_team') AS new_team,
                           rc.raw_payload->>'role' AS role,
                           rc.raw_payload->>'game' AS game,
                           rc.transfer_date, rc.transfer_type
                    FROM roster_changes rc
                    JOIN players p ON p.id = rc.player_id
                    LEFT JOIN teams st ON st.id = rc.source_team_id
                    LEFT JOIN teams tt ON tt.id = rc.target_team_id
                    WHERE rc.news_generated = false
                      AND rc.player_id IS NOT NULL
                    ORDER BY rc.transfer_date DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]

    def _player_form_summary(self, player_id) -> Optional[str]:
        """
        Oyuncunun son maç formu (player_match_stats varsa): ort. K/D/A, galibiyet
        oranı ve (Valorant'ta) ağırlıklı oynanan agent. Yoksa None.
        """
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT kills, deaths, assists, is_win, stats
                        FROM player_match_stats
                        WHERE player_id = %s AND kills IS NOT NULL
                        ORDER BY COALESCE(played_at, created_at) DESC
                        LIMIT 10
                        """,
                        (player_id,),
                    )
                    rows = cur.fetchall()
        except Exception:
            return None
        if not rows:
            return None
        n = len(rows)
        k = sum(r[0] or 0 for r in rows) / n
        d = sum(r[1] or 0 for r in rows) / n
        a = sum(r[2] or 0 for r in rows) / n
        wr = round(100 * sum(1 for r in rows if r[3]) / n)
        agents = [ag for r in rows if (ag := FactSheetBuilder._dominant_agent(r[4]))]
        agent_txt = f", ağırlıklı {Counter(agents).most_common(1)[0][0]}" if agents else ""
        return f"son {n} maçta ort. {k:.1f}/{d:.1f}/{a:.1f} (K/D/A), %{wr} galibiyet{agent_txt}"

    def _save_transfer(self, transfer: dict, article: dict) -> None:
        """Transfer makalesini news_articles'a yazar (content_type='transfer', match_id NULL)."""
        content = "\n\n".join(article["paragraphs"]) if isinstance(article.get("paragraphs"), list) else article.get("content", "")
        old_team = transfer.get("old_team") or "Serbest"
        new_team = transfer.get("new_team") or "Serbest"
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO news_articles (
                        match_id, content_type, title, summary, content, variant,
                        game_slug, tier, tournament_name, team_a_name, team_b_name, hero_score
                    )
                    VALUES (NULL, 'transfer', %s, %s, %s, 'transfer', %s, 'C', %s, %s, %s, %s)
                    """,
                    (
                        article.get("title", ""), article.get("summary", ""), content,
                        transfer.get("game"),
                        "Transfer Haberi",
                        old_team, new_team,
                        transfer.get("player") or "",
                    ),
                )
                cur.execute(
                    "UPDATE roster_changes SET news_generated = true WHERE id = %s",
                    (transfer["rc_id"],),
                )
            conn.commit()

    def generate_transfers(self, limit: int = 15) -> dict:
        """Bekleyen roster değişiklikleri için LLM transfer haberi üret."""
        rows = self._fetch_pending_transfers(limit=limit)
        logger.info("🔁 Transfer haberi üretilecek: %d", len(rows))
        stats = {"attempted": len(rows), "generated": 0, "failed": 0}

        for tr in rows:
            form = self._player_form_summary(tr["player_id"])
            fact_sheet = FactSheetBuilder.build_transfer(tr, player_form=form)
            user_prompt = (
                "Aşağıdaki transfer raporunu kullanarak Türkçe transfer haberi üret:\n\n"
                + fact_sheet
            )
            raw = self._generate_with_backoff(user_prompt, tr["rc_id"], system_prompt=TRANSFER_SYSTEM_PROMPT)
            if raw is None:
                stats["failed"] += 1
                continue
            article = self._parse_llm_json(raw)
            if article is None:
                stats["failed"] += 1
                continue
            try:
                self._save_transfer(tr, article)
                stats["generated"] += 1
                logger.info("✅ Transfer haberi  %s  %s", tr.get("player"), article.get("title", "")[:50])
            except Exception as exc:
                logger.warning("⚠️  Transfer kayıt hatası rc=%s: %s", tr["rc_id"], exc)
                stats["failed"] += 1
            time.sleep(4)

        return stats

    # "Please retry in 47 seconds." veya "retry in 47.3s" gibi API mesajlarını yakalar
    _RETRY_AFTER_RE = re.compile(r"retry\s+in\s+([\d.]+)\s*s", re.IGNORECASE)

    # Free tier varsayılan bekleme adımları (Google'ın 30-60s cooldown'ını absorbe eder)
    _DEFAULT_WAITS = [35, 65]

    def _parse_retry_after(self, exc_str: str) -> Optional[int]:
        """Hata metninden 'Please retry in X seconds' süresini saniye cinsinden çıkarır."""
        m = self._RETRY_AFTER_RE.search(exc_str)
        if m:
            return int(float(m.group(1))) + 2  # +2s güvenlik tamponu
        return None

    def _generate_with_backoff(self, user_prompt: str, match_id, system_prompt: str = SYSTEM_PROMPT) -> Optional[str]:
        """
        LLM çağrısını 3 denemeye kadar yeniden dener.

        Bekleme süresi önceliği:
          1. API hata mesajından dinamik olarak çekilen "retry in Xs" süresi (+2s tampon)
          2. Sabit varsayılanlar: 1. hata → 35s, 2. hata → 65s
        """
        from etl.adapters.llm_adapter import LLMAdapterError

        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                raw = self._llm.generate(
                    user_prompt=user_prompt,
                    system_prompt=system_prompt,
                    response_schema=NewsArticleSchema,
                )
                return raw
            except LLMAdapterError as exc:
                exc_str = str(exc)
                if attempt >= max_retries:
                    break

                dynamic = self._parse_retry_after(exc_str)
                wait = dynamic if dynamic is not None else self._DEFAULT_WAITS[attempt - 1]

                source = f"API direktifi ({dynamic}s + 2s tampon)" if dynamic else "varsayılan"
                logger.warning(
                    "⚠️  match %s — LLM hatası (deneme %d/%d): %s | "
                    "%ds bekleniyor [%s]…",
                    match_id, attempt, max_retries, exc_str[:120], wait, source,
                )
                time.sleep(wait)

        logger.warning("❌ match %s — %d denemede yanıt alınamadı, atlanıyor.", match_id, max_retries)
        return None
