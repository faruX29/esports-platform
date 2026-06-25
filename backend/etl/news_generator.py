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
    def build(match: dict, stats_rows: list[dict]) -> str:
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
                          SELECT 1 FROM news_articles na WHERE na.match_id = m.id
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
                    ON CONFLICT (match_id) DO NOTHING
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

            fact_sheet = FactSheetBuilder.build(match, stats_rows)
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

    def _generate_with_backoff(self, user_prompt: str, match_id) -> Optional[str]:
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
                    system_prompt=SYSTEM_PROMPT,
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
