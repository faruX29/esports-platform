"""
Hybrid Stats Adapter — PandaScore free tier'da NULL kalan harita adı /
tur skoru / oyuncu KDA verisini harici kaynaklardan (öncelik: Liquipedia
Cargo) doldurur.

Mimari (mevcut Adapter Pattern + fallback chain ile uyumlu):

    BaseMatchStatsSource   ← sözleşme (her kaynak bunu uygular)
        └─ LiquipediaStatsSource   ← Cargo API tabanlı kaynak
    HybridStatsBackfiller  ← orkestratör: eksik maçları bulur, kaynakları
                              öncelik sırasıyla dener, sonucu DB'ye yazar

Akış:
    1. find_incomplete_matches() → DB'de finished olup harita/KDA verisi
       eksik maçları döner (PandaScore NULL döndürmüş olanlar).
    2. Her maç için kaynaklar sırayla denenir; ilk dolu sonuç kullanılır.
    3. _persist() → match_stats.games_detail + player_match_stats'e yazar,
       stats.map_source işaretiyle tekrar işlemeyi önler.

⚠️ Liquipedia cargoquery action'ı LIQUIPEDIA_API_KEY gerektirir. Key yoksa
Cargo sorguları fail eder, fetch_map_stats() None döner ve backfiller hiçbir
maçı zenginleştiremez (sessiz fail değil — loglanır). Key set edilince
(GitHub Actions secret) pipeline uçtan uca çalışır. Detection ve persist
katmanları key'den bağımsız çalışır ve test edilebilir.
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from database import Database

logger = logging.getLogger(__name__)


# ── Normalize veri şekilleri ──────────────────────────────────────────────────

@dataclass
class MapStat:
    """Tek bir haritanın normalize edilmiş sonucu."""
    map_name: str
    team_a_id: Optional[int] = None
    team_b_id: Optional[int] = None
    team_a_score: Optional[int] = None
    team_b_score: Optional[int] = None


@dataclass
class PlayerStat:
    """Tek bir oyuncunun bir maçtaki normalize edilmiş KDA'sı."""
    player_name: str
    team_id: Optional[int] = None
    kills: Optional[float] = None
    deaths: Optional[float] = None
    assists: Optional[float] = None
    headshots: Optional[float] = None
    hs_percentage: Optional[float] = None


@dataclass
class MapStatsResult:
    """Bir kaynaktan tek maç için dönen normalize sonuç paketi."""
    source: str
    maps: List[MapStat] = field(default_factory=list)
    players: List[PlayerStat] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not self.maps and not self.players


@dataclass
class MatchContext:
    """Bir maçın kaynak sorgusu için ihtiyaç duyduğu bağlam."""
    match_id: int
    game_slug: str
    team_a_id: Optional[int]
    team_b_id: Optional[int]
    team_a_name: Optional[str]
    team_b_name: Optional[str]
    tournament_name: Optional[str]
    scheduled_at: Any
    # Liquipedia eşleştirmesi için turnuva adı adayları (en iyi → en zayıf).
    # DB'deki tournament.name çoğu zaman "Group Stage" gibi aşama adıdır;
    # raw_data'daki league/serie isimleri çok daha eşleştirilebilir.
    tournament_candidates: List[str] = field(default_factory=list)


# ── Kaynak sözleşmesi ─────────────────────────────────────────────────────────

class BaseMatchStatsSource(ABC):
    """Harita/KDA verisi sağlayan bir kaynağın sözleşmesi."""

    source_name: str = "unknown"

    @abstractmethod
    def supports_game(self, game_slug: str) -> bool:
        """Bu kaynak verilen oyun için veri sağlayabiliyor mu?"""

    @abstractmethod
    def fetch_map_stats(self, ctx: MatchContext) -> Optional[MapStatsResult]:
        """
        Verilen maç için harita/KDA verisini döner.
        Veri bulunamazsa None döner (fallback chain bir sonraki kaynağa geçer).
        """


# ── Liquipedia Cargo kaynağı ──────────────────────────────────────────────────

class LiquipediaStatsSource(BaseMatchStatsSource):
    """
    Liquipedia MediaWiki Cargo API üzerinden harita/KDA verisi sağlar.

    Mevcut LiquipediaService altyapısını (rate-limit, pacing, cache) yeniden
    kullanır. Cargo tabloları:
      - Match2      : maçı bul (Tournament + Team1/Team2)
      - Match2Games : harita adı + tur skorları (OpponentScores)

    ⚠️ AKTİVASYON: Liquipedia cargoquery action'ı LIQUIPEDIA_API_KEY gerektirir.
    Key yoksa Cargo sorguları fail eder ve fetch_map_stats() None döner (fallback
    chain devam eder). Key bir GitHub Actions secret'ı olarak set edilince
    uçtan uca çalışır. Ücretsiz key: https://liquipedia.net/api-access

    Oyuncu KDA: Cargo'da harita-bazlı oyuncu KDA tablosu oyuna göre çok değişken
    ve güvenilmez; bu sürüm harita adı + skorlara odaklanır (yüksek güven),
    players boş döner. KDA ileride ayrı bir candidate ile eklenebilir.
    """

    source_name = "liquipedia"

    # Cargo veri kalitesi oyuna göre değişir; harita adı/skor her oyunda güçlü.
    SUPPORTED_GAMES = {"valorant", "csgo", "cs2", "lol"}

    def __init__(self) -> None:
        # game_slug başına LiquipediaService cache'le (her oyun farklı wiki).
        self._services: Dict[str, Any] = {}

    def supports_game(self, game_slug: str) -> bool:
        return str(game_slug or "").strip().lower() in self.SUPPORTED_GAMES

    def _service(self, game_slug: str):
        from etl.liquipedia_service import LiquipediaService
        slug = str(game_slug or "").strip().lower()
        if slug not in self._services:
            self._services[slug] = LiquipediaService(game_slug=slug)
        return self._services[slug]

    # Maç başına denenecek max turnuva-adı adayı (rate-limit koruması).
    MAX_TOURNAMENT_CANDIDATES = 2

    def fetch_map_stats(self, ctx: MatchContext) -> Optional[MapStatsResult]:
        if not (ctx.team_a_name and ctx.team_b_name):
            return None  # eşleştirme için takım adları şart

        tournament_names = ctx.tournament_candidates or (
            [ctx.tournament_name] if ctx.tournament_name else []
        )
        if not tournament_names:
            return None

        rows = []
        service = self._service(ctx.game_slug)
        for tour_name in tournament_names[:self.MAX_TOURNAMENT_CANDIDATES]:
            try:
                rows = service.get_match_maps(
                    tournament_name=tour_name,
                    team_a=ctx.team_a_name,
                    team_b=ctx.team_b_name,
                )
            except Exception as err:
                logger.warning(
                    "⚠️  Liquipedia get_match_maps hata (match %s, tour='%s'): %s",
                    ctx.match_id, tour_name, err,
                )
                continue
            if rows:
                break

        if not rows:
            return None

        maps: List[MapStat] = []
        for row in rows:
            map_name = str(row.get("Map") or "").strip()
            if not map_name:
                continue
            scores = _parse_opponent_scores(row.get("OpponentScores") or row.get("Scores"))
            maps.append(MapStat(
                map_name=map_name,
                team_a_id=ctx.team_a_id,
                team_b_id=ctx.team_b_id,
                team_a_score=scores[0] if len(scores) > 0 else None,
                team_b_score=scores[1] if len(scores) > 1 else None,
            ))

        if not maps:
            return None
        return MapStatsResult(source=self.source_name, maps=maps, players=[])


# ── Orkestratör ───────────────────────────────────────────────────────────────

class HybridStatsBackfiller:
    """
    Harita/KDA verisi eksik maçları bulur, kaynakları öncelik sırasıyla
    deneyerek doldurur ve sonucu match_stats + player_match_stats'e yazar.
    """

    def __init__(self, sources: Optional[List[BaseMatchStatsSource]] = None) -> None:
        # Öncelik sırası listedeki sıradır (ilk dolu sonuç kazanır).
        self.sources: List[BaseMatchStatsSource] = sources or [LiquipediaStatsSource()]

    # ── 1) Eksik maç tespiti ──────────────────────────────────────────────────

    @staticmethod
    def _match_needs_enrichment(raw_data: Dict[str, Any]) -> bool:
        """
        Bir maçın harita/KDA verisi eksik mi? (PandaScore NULL döndürmüş mü?)

        Eksik sayılır eğer:
          - games listesi boşsa, VEYA
          - hiçbir game'de geçerli harita adı YOK ve hiçbir oyuncu kill'i YOK.

        Daha önce hibrit ile doldurulmuş maçlar (map_source işaretli) tekrar
        işlenmez.
        """
        if not isinstance(raw_data, dict):
            return False
        if raw_data.get('map_source'):
            return False  # zaten bir kaynaktan dolduruldu

        games = raw_data.get('games') or []
        if not games:
            return True

        for g in games:
            if not isinstance(g, dict):
                continue
            map_obj = g.get('map')
            map_name = (map_obj.get('name') if isinstance(map_obj, dict) else map_obj)
            if map_name and str(map_name).strip().lower() not in ('', 'unknown'):
                return False  # en az bir geçerli harita adı var → eksik değil
            for team_entry in (g.get('teams') or []):
                for p_entry in (team_entry.get('players') or []):
                    if p_entry.get('kills') is not None:
                        return False  # en az bir KDA var → eksik değil
        return True

    def find_incomplete_matches(self, limit: int = 50) -> List[MatchContext]:
        """Harita/KDA verisi eksik, finished maçları bağlamlarıyla döner."""
        candidates: List[MatchContext] = []
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT m.id, m.team_a_id, m.team_b_id, m.scheduled_at, m.raw_data,
                           g.slug,
                           ta.name AS team_a_name, tb.name AS team_b_name,
                           t.name  AS tournament_name
                    FROM matches m
                    JOIN games g       ON m.game_id = g.id
                    LEFT JOIN teams ta ON m.team_a_id = ta.id
                    LEFT JOIN teams tb ON m.team_b_id = tb.id
                    LEFT JOIN tournaments t ON m.tournament_id = t.id
                    WHERE m.status = 'finished'
                      AND m.raw_data IS NOT NULL
                    ORDER BY m.scheduled_at DESC NULLS LAST
                    LIMIT %s
                    """,
                    (limit * 4,),  # filtre Python'da; aday havuzunu geniş tut
                )
                rows = cur.fetchall()

        for (mid, a_id, b_id, sched, raw, slug,
             a_name, b_name, t_name) in rows:
            raw = raw or {}
            if not self._match_needs_enrichment(raw):
                continue
            candidates.append(MatchContext(
                match_id=mid,
                game_slug=slug,
                team_a_id=a_id,
                team_b_id=b_id,
                team_a_name=a_name,
                team_b_name=b_name,
                tournament_name=t_name,
                scheduled_at=sched,
                tournament_candidates=_tournament_name_candidates(raw, t_name),
            ))
            if len(candidates) >= limit:
                break
        return candidates

    # ── 2) Kaynak deneme (fallback chain) ─────────────────────────────────────

    def _resolve(self, ctx: MatchContext) -> Optional[MapStatsResult]:
        """Kaynakları öncelik sırasıyla dener; ilk dolu sonucu döner."""
        for source in self.sources:
            if not source.supports_game(ctx.game_slug):
                continue
            try:
                result = source.fetch_map_stats(ctx)
            except Exception as err:
                logger.warning(
                    "⚠️  %s kaynağı match %s için hata verdi: %s",
                    source.source_name, ctx.match_id, err,
                )
                continue
            if result and not result.is_empty():
                return result
        return None

    # ── 3) DB'ye yazma ────────────────────────────────────────────────────────

    def _persist(self, ctx: MatchContext, result: MapStatsResult) -> None:
        """
        Normalize sonucu match_stats.games_detail + player_match_stats'e yazar.
        Oyuncu eşlemesi nickname üzerinden yapılır (Cargo PandaScore id vermez).
        map_source işareti raw_data'ya yazılır → tekrar işlenmez.
        """
        games_detail = [
            {
                'map_name':     mp.map_name,
                'team_a_id':    mp.team_a_id if mp.team_a_id is not None else ctx.team_a_id,
                'team_b_id':    mp.team_b_id if mp.team_b_id is not None else ctx.team_b_id,
                'team_a_score': mp.team_a_score,
                'team_b_score': mp.team_b_score,
                'source':       result.source,
            }
            for mp in result.maps
        ]

        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                # match_stats: takım bazlı stats jsonb (games_detail taşır)
                for team_id in (ctx.team_a_id, ctx.team_b_id):
                    if team_id is None:
                        continue
                    cur.execute(
                        """
                        INSERT INTO match_stats (match_id, team_id, stats)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (match_id, team_id)
                          WHERE match_id IS NOT NULL AND team_id IS NOT NULL
                        DO UPDATE SET stats = match_stats.stats || EXCLUDED.stats
                        """,
                        (
                            ctx.match_id,
                            team_id,
                            _json({'games_detail': games_detail, 'map_source': result.source}),
                        ),
                    )

                # player_match_stats: nickname eşlemeli oyuncu KDA
                if result.players:
                    players_by_name = self._load_players_by_name(cur)
                    for ps in result.players:
                        pid = players_by_name.get(_normalize_name(ps.player_name))
                        if pid is None:
                            continue  # DB'de olmayan oyuncuyu atla (sessizce)
                        cur.execute(
                            """
                            INSERT INTO player_match_stats (
                                player_id, match_id, team_id,
                                kills, deaths, assists, headshots, hs_percentage,
                                stats, played_at, updated_at
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                            ON CONFLICT (player_id, match_id)
                            DO UPDATE SET
                                team_id       = EXCLUDED.team_id,
                                kills         = COALESCE(EXCLUDED.kills, player_match_stats.kills),
                                deaths        = COALESCE(EXCLUDED.deaths, player_match_stats.deaths),
                                assists       = COALESCE(EXCLUDED.assists, player_match_stats.assists),
                                headshots     = COALESCE(EXCLUDED.headshots, player_match_stats.headshots),
                                hs_percentage = COALESCE(EXCLUDED.hs_percentage, player_match_stats.hs_percentage),
                                stats         = player_match_stats.stats || EXCLUDED.stats,
                                updated_at    = now()
                            """,
                            (
                                pid, ctx.match_id, ps.team_id,
                                ps.kills, ps.deaths, ps.assists,
                                ps.headshots, ps.hs_percentage,
                                _json({'map_source': result.source}),
                                ctx.scheduled_at,
                            ),
                        )

                # raw_data'ya map_source işareti koy → tekrar işlenmez
                cur.execute(
                    """
                    UPDATE matches
                    SET raw_data = raw_data || %s::jsonb,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                    """,
                    (_json({'map_source': result.source}), ctx.match_id),
                )
                conn.commit()

    @staticmethod
    def _load_players_by_name(cur) -> Dict[str, Any]:
        cur.execute("SELECT id, nickname FROM players WHERE nickname IS NOT NULL")
        mapping: Dict[str, Any] = {}
        for pid, nickname in cur.fetchall():
            key = _normalize_name(nickname)
            if key and key not in mapping:
                mapping[key] = pid
        return mapping

    # ── Orkestrasyon girişi ───────────────────────────────────────────────────

    def backfill(self, limit: int = 50) -> Dict[str, int]:
        """
        Eksik maçları bulur, kaynaklardan doldurmaya çalışır, DB'ye yazar.

        Returns:
            dict: {'candidates', 'enriched', 'skipped'}
        """
        candidates = self.find_incomplete_matches(limit=limit)
        logger.info(
            "🔍 Harita/KDA verisi eksik %d maç bulundu (limit=%d)",
            len(candidates), limit,
        )
        enriched = 0
        for ctx in candidates:
            result = self._resolve(ctx)
            if result is None:
                continue
            try:
                self._persist(ctx, result)
                enriched += 1
            except Exception as err:
                logger.warning("⚠️  match %s yazılamadı: %s", ctx.match_id, err)

        skipped = len(candidates) - enriched
        logger.info(
            "✅ Hybrid stats backfill: %d zenginleştirildi, %d kaynaktan veri yok",
            enriched, skipped,
        )
        return {'candidates': len(candidates), 'enriched': enriched, 'skipped': skipped}


# ── Yardımcılar ───────────────────────────────────────────────────────────────

def _normalize_name(name: Any) -> str:
    """Oyuncu nickname'ini eşleme için normalize eder."""
    return str(name or "").strip().lower()


def _tournament_name_candidates(raw_data: Dict[str, Any], db_name: Optional[str]) -> List[str]:
    """
    raw_data'dan Liquipedia eşleştirmesi için turnuva adı adaylarını üretir
    (en eşleştirilebilir → en zayıf). DB'deki tournament.name çoğu zaman
    "Group Stage" gibi aşama adıdır; league/serie isimleri daha güçlüdür.

    Örnek PandaScore: league.name="VCL", serie.full_name="North America: Stage 3 2026"
    """
    out: List[str] = []

    def _add(value: Any) -> None:
        text = str(value or "").strip()
        if text and text not in out and text.lower() not in ("group stage", "play-in", "playoffs", "unknown"):
            out.append(text)

    league = raw_data.get("league") if isinstance(raw_data, dict) else None
    serie = raw_data.get("serie") if isinstance(raw_data, dict) else None
    league_name = (league or {}).get("name") if isinstance(league, dict) else None
    serie_name = (serie or {}).get("name") if isinstance(serie, dict) else None
    serie_full = (serie or {}).get("full_name") if isinstance(serie, dict) else None

    # En güçlü: league + serie full ("VCL North America: Stage 3 2026")
    if league_name and serie_full:
        _add(f"{league_name} {serie_full}")
    _add(serie_full)
    if league_name and serie_name:
        _add(f"{league_name} {serie_name}")
    _add(league_name)
    _add(db_name)
    return out


def _parse_opponent_scores(raw: Any) -> List[int]:
    """
    Liquipedia OpponentScores alanını int listesine çevirir.
    Format değişken olabilir: "13,11" | [13, 11] | "13 : 11".
    Parse edilemeyen değerler atlanır.
    """
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        parts = raw
    else:
        parts = re.split(r"[,:;\s]+", str(raw).strip())
    scores: List[int] = []
    for p in parts:
        try:
            scores.append(int(str(p).strip()))
        except (TypeError, ValueError):
            continue
    return scores


def _json(obj: Any) -> str:
    import json
    return json.dumps(obj)
