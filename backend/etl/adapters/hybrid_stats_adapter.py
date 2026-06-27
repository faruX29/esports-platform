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

Not: LiquipediaStatsSource.fetch_map_stats() şu an STUB'dur (None döner).
Cargo sorgusu implemente edilince backfiller uçtan uca çalışır — detection
ve persist katmanları tamamdır ve test edilebilir.
"""

from __future__ import annotations

import logging
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
    kullanır. Liquipedia Cargo'da ilgili tablolar:
      - MatchMaps / Matches : harita adı + tur skorları
      - GameTables          : oyuncu bazlı KDA (oyuna göre değişir)

    DURUM: fetch_map_stats() henüz STUB'dur. Cargo sorgu tasarımı yapılınca
    burada LiquipediaService.cargo_query(...) çağrısı + normalize mantığı yer
    alacaktır.
    """

    source_name = "liquipedia"

    # Cargo veri kalitesi oyuna göre değişir; harita adı/skor her oyunda
    # güçlü, oyuncu KDA özellikle Valorant/CS2'de kısmi.
    SUPPORTED_GAMES = {"valorant", "csgo", "cs2", "lol"}

    def supports_game(self, game_slug: str) -> bool:
        return str(game_slug or "").strip().lower() in self.SUPPORTED_GAMES

    def fetch_map_stats(self, ctx: MatchContext) -> Optional[MapStatsResult]:
        # TODO(hybrid-stats): LiquipediaService(game_slug=ctx.game_slug) ile
        # Cargo sorgusu yazılacak:
        #   1. Maçı bul (tournament_name + takım adları + tarih ile eşleştir)
        #   2. MatchMaps'ten harita adı + tur skorlarını çek → MapStat listesi
        #   3. GameTables'tan oyuncu KDA'larını çek → PlayerStat listesi
        #   4. MapStatsResult(source=self.source_name, ...) döndür
        # Eşleşme bulunamazsa None döndür (fallback chain devam etsin).
        logger.debug(
            "LiquipediaStatsSource.fetch_map_stats stub — match %s (%s) atlandı",
            ctx.match_id, ctx.game_slug,
        )
        return None


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
            if not self._match_needs_enrichment(raw or {}):
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


def _json(obj: Any) -> str:
    import json
    return json.dumps(obj)
