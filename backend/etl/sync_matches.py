"""
Sync match data to Supabase database
"""
from database import Database
from etl.pandascore_client import PandaScoreClient
from etl.data_cleaner       import DataCleaner
from etl.adapters import MultiSourceDataAggregator, RiotAdapter, SteamAdapter
import psycopg
import json
from datetime import timezone, datetime
import logging

logger = logging.getLogger(__name__)


def _extract_stream_url(streams_list):
    """Pick best stream URL from PandaScore streams_list (official → main → any)."""
    if not streams_list:
        return None
    for priority in ('official', 'main', None):
        for s in streams_list:
            if not isinstance(s, dict):
                continue
            url = (s.get('raw_url') or '').strip()
            if not url:
                continue
            if priority is None or s.get(priority):
                return url
    return None


class MatchSyncer:
    """Sync match data from PandaScore to Supabase"""

    def __init__(self):
        self.client  = PandaScoreClient()
        self.cleaner = DataCleaner()
        self.aggregator = MultiSourceDataAggregator([
            RiotAdapter(),
            SteamAdapter(),
        ])

    def sync_running_matches(self, game_slug, limit=50):
        """Fetch /running endpoint and upsert. Orphan resolution caller tarafından
        tüm oyunların live_id birleşimiyle ayrıca yapılır (bkz. resolve_orphans)."""
        logger.info(f"\n📡 Syncing LIVE matches for {game_slug.upper()}...")
        raw_matches = self.client.get_running_matches(game_slug, limit)

        live_ids = {m['id'] for m in (raw_matches or [])}
        fetched = len(raw_matches or [])
        cleaned_count = 0
        synced = 0

        if raw_matches:
            cleaned = self.cleaner.clean_matches(raw_matches)
            cleaned_count = len(cleaned)
            if cleaned:
                synced = self._upsert_matches(cleaned)
                logger.info(f"✅ Live sync: {synced}/{cleaned_count} upserted for {game_slug}")
        else:
            logger.info(f"   No running matches for {game_slug}")

        return {'fetched': fetched, 'cleaned': cleaned_count, 'synced': synced, 'live_ids': live_ids}

    def resolve_orphans(self, live_ids: set, cap: int = 40) -> int:
        """
        DB'de 'running' olup PandaScore /running'de artık görünmeyen maçları
        (orphan) tespit edip /matches/{id} ile final skor+status'ü günceller.

        ÖNEMLİ: Oyun-slug'ından BAĞIMSIZ çalışır — DB'deki slug'lar ('cs-go',
        'league-of-legends') ile PandaScore endpoint slug'ları ('csgo','lol')
        tutarsız olabildiği için global karşılaştırma yapılır.

        live_ids: tüm oyunların /running'inden gelen ID birleşimi (boş set =
        tüm running maçları PandaScore'a karşı yeniden doğrula). get_match_by_id
        gerçek status döndürdüğü için boş set bile güvenlidir (gerçekten canlı
        maçlar 'running' kalır).

        cap: tek çağrıda max API isteği (rate-limit koruması).
        """
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    # En eski başlamış maçlar önce (en olası bitmiş olanlar)
                    cur.execute(
                        "SELECT id FROM matches WHERE status = 'running' "
                        "ORDER BY scheduled_at ASC NULLS FIRST"
                    )
                    db_running_ids = [row[0] for row in cur.fetchall()]
        except Exception as e:
            logger.warning(f"⚠️  Could not query running matches: {e}")
            return 0

        orphaned = [mid for mid in db_running_ids if mid not in live_ids]
        if not orphaned:
            return 0

        logger.info(f"🔍 {len(orphaned)} orphan running match — fetching final status (cap={cap})...")

        resolved = []
        for match_id in orphaned[:cap]:
            raw = self.client.get_match_by_id(match_id)
            if raw and isinstance(raw, dict):
                cleaned = self.cleaner.clean_matches([raw])
                if cleaned:
                    resolved.extend(cleaned)
                    continue
            self._force_finish_match(match_id)

        count = self._upsert_matches(resolved) if resolved else 0
        logger.info(f"✅ Resolved {count} finished match(es) — status+score updated from PandaScore")
        return count

    def resolve_stale_upcoming(self, hours_ago: int = 6, cap: int = 40, bulk: bool = False) -> int:
        """
        scheduled_at geçmiş ama hâlâ 'not_started' olan maçları PandaScore'dan
        gerçek status'leriyle günceller (bitmiş/canceled/postponed). Turnuva
        sayfalarındaki 'oynanmamış hayalet' maçları temizler.

        get_match_by_id gerçek status döndürür — hâlâ planlıysa not_started kalır
        (güvenli), bittiyse finished+skor, iptal/ertelendiyse ilgili status.

        bulk=True: TÜM stale maçları tek geçişte (her biri bir kez) işler; aksi
        halde en eski `cap` maçı işler (cron için).
        """
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    if bulk:
                        cur.execute(
                            "SELECT id FROM matches WHERE status = 'not_started' "
                            "AND scheduled_at < NOW() - (%s * INTERVAL '1 hour') "
                            "ORDER BY scheduled_at ASC",
                            (hours_ago,),
                        )
                    else:
                        cur.execute(
                            "SELECT id FROM matches WHERE status = 'not_started' "
                            "AND scheduled_at < NOW() - (%s * INTERVAL '1 hour') "
                            "ORDER BY scheduled_at ASC LIMIT %s",
                            (hours_ago, cap),
                        )
                    ids = [r[0] for r in cur.fetchall()]
        except Exception as e:
            logger.warning(f"⚠️  Could not query stale upcoming matches: {e}")
            return 0

        if not ids:
            return 0

        logger.info(f"🔍 {len(ids)} stale not_started match — fetching real status...")
        count = 0
        # Her maç TEK kez işlenir; 40'lık batch'lerle upsert (bellek + ilerleme)
        for i in range(0, len(ids), 40):
            batch = ids[i:i + 40]
            resolved = []
            for match_id in batch:
                raw = self.client.get_match_by_id(match_id)
                if raw and isinstance(raw, dict):
                    cleaned = self.cleaner.clean_matches([raw])
                    if cleaned:
                        resolved.extend(cleaned)
            if resolved:
                count += self._upsert_matches(resolved)
        logger.info(f"✅ Resolved {count} stale not_started match(es) from PandaScore")
        return count

    def _force_finish_match(self, match_id: int):
        """PandaScore'dan alınamayan maçı 'finished' olarak işaretle (score değişmez)."""
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE matches SET status = 'finished', updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s AND status = 'running'
                        """,
                        (match_id,),
                    )
                    conn.commit()
            logger.info(f"   ⚠️  Match {match_id} force-finished (no PandaScore data available)")
        except Exception as e:
            logger.warning(f"⚠️  _force_finish_match({match_id}) error: {e}")

    def sync_game_matches(self, game_slug, limit=50, past=False, page=1, upcoming_days=7):
        """
        Sync matches for a specific game
        
        Args:
            game_slug: Game identifier (valorant, csgo, lol)
            limit: Maximum number of matches to fetch
            past: If True, fetch past matches instead of upcoming
            
        Returns:
            dict: Sync statistics
        """
        logger.info(f"\n🎮 Syncing {game_slug.upper()} {'past' if past else 'upcoming'} matches...")
        
        # Fetch matches from API
        logger.info("📥 Fetching from PandaScore API...")
        if past:
            raw_matches = self.client.get_past_matches(game_slug, limit, page)
        else:
            raw_matches = self.client.get_upcoming_matches(game_slug, limit, days_ahead=upcoming_days)
        
        if not raw_matches:
            logger.error("❌ No matches fetched from API")
            return {'fetched': 0, 'cleaned': 0, 'synced': 0}

        # Enrich PandaScore raw rows with optional Riot/Steam foundations.
        try:
            raw_matches = self.aggregator.enrich_matches(raw_matches, game_slug=game_slug)
        except Exception as agg_err:
            logger.warning(f"⚠️  Multi-source enrichment skipped due to error: {agg_err}")
        
        # Clean data
        logger.info("🧹 Cleaning data...")
        cleaned_matches = self.cleaner.clean_matches(raw_matches)
        
        if not cleaned_matches:
            logger.error("❌ No valid matches after cleaning")
            return {'fetched': len(raw_matches), 'cleaned': 0, 'synced': 0}
        
        # Sync to database
        logger.info("💾 Syncing to database...")
        synced_count = self._upsert_matches(cleaned_matches)
        
        logger.info(f"✅ Synced {synced_count} matches to database")
        
        return {
            'fetched': len(raw_matches),
            'cleaned': len(cleaned_matches),
            'synced': synced_count
        }
    
    def _upsert_matches(self, matches):
        """
        Upsert matches to database.

        Değişiklikler:
        - scheduled_at artık timezone-aware UTC olarak kaydediliyor
        - status + winner_id her zaman güncelleniyor (stale data fix)
        - score sütunları güncelleniyor
        - raw_data her upsert'te yenileniyor (canlı veri için)
        - updated_at her zaman CURRENT_TIMESTAMP
        """
        synced_count = 0

        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                for i, match in enumerate(matches):
                    savepoint_name = f"sp_match_{i}"
                    cur.execute(f'SAVEPOINT "{savepoint_name}"')
                    try:
                        game_id = self._get_or_create_game(cur, match['game_slug'])

                        team_a_id = self._get_or_create_team(
                            cur,
                            match['team_a_id'],
                            match['team_a_name'],
                            match.get('team_a_acronym'),
                            match.get('team_a_logo'),
                        )
                        team_b_id = self._get_or_create_team(
                            cur,
                            match['team_b_id'],
                            match['team_b_name'],
                            match.get('team_b_acronym'),
                            match.get('team_b_logo'),
                        )

                        tournament_id = None
                        if match.get('tournament_id') and match.get('tournament_name'):
                            tournament_id = self._get_or_create_tournament(
                                cur,
                                match['tournament_id'],
                                match['tournament_name'],
                                game_id,
                                begin_at = match.get('tournament_begin_at'),
                                end_at   = match.get('tournament_end_at'),
                                tier     = match.get('tournament_tier'),
                                region   = match.get('tournament_region'),
                            )

                        # ── Timezone-aware scheduled_at ──────────────
                        # PandaScore UTC ISO string gelir: "2025-03-15T14:00:00Z"
                        # psycopg3 datetime nesnesi kabul eder; Z suffix'ini
                        # +00:00'a dönüştürüyoruz.
                        raw_scheduled = match.get('scheduled_at', '')
                        if raw_scheduled:
                            # Z → +00:00 normalize
                            normalized = raw_scheduled.replace('Z', '+00:00')
                            try:
                                scheduled_dt = datetime.fromisoformat(normalized)
                                # tzinfo yoksa UTC varsay
                                if scheduled_dt.tzinfo is None:
                                    scheduled_dt = scheduled_dt.replace(
                                        tzinfo=timezone.utc
                                    )
                            except ValueError:
                                scheduled_dt = None
                                logger.warning(f"⚠️  Bad scheduled_at for match {match['id']}: {raw_scheduled}")
                        else:
                            scheduled_dt = None

                        # ── Upsert — tüm mutable alanlar güncelleniyor ──
                        raw = match.get('raw_data') or {}
                        stream_url = _extract_stream_url(raw.get('streams_list') or [])
                        cur.execute(
                            """
                            INSERT INTO matches (
                                id,
                                game_id,
                                team_a_id,
                                team_b_id,
                                tournament_id,
                                scheduled_at,
                                status,
                                serie_id,
                                winner_id,
                                team_a_score,
                                team_b_score,
                                round_info,
                                number_of_games,
                                stream_url,
                                raw_data,
                                updated_at
                            )
                            VALUES (
                                %s, %s, %s, %s, %s,
                                %s, %s, %s, %s, %s,
                                %s, %s, %s, %s, %s,
                                CURRENT_TIMESTAMP
                            )
                            ON CONFLICT (id) DO UPDATE SET
                                status          = EXCLUDED.status,
                                winner_id       = EXCLUDED.winner_id,
                                team_a_score    = EXCLUDED.team_a_score,
                                team_b_score    = EXCLUDED.team_b_score,
                                scheduled_at    = EXCLUDED.scheduled_at,
                                tournament_id   = COALESCE(EXCLUDED.tournament_id,
                                                           matches.tournament_id),
                                round_info      = COALESCE(EXCLUDED.round_info,
                                                           matches.round_info),
                                number_of_games = COALESCE(EXCLUDED.number_of_games,
                                                           matches.number_of_games),
                                stream_url      = COALESCE(EXCLUDED.stream_url,
                                                           matches.stream_url),
                                raw_data        = EXCLUDED.raw_data,
                                updated_at      = CURRENT_TIMESTAMP
                            """,
                            (
                                match['id'],
                                game_id,
                                team_a_id,
                                team_b_id,
                                tournament_id,
                                scheduled_dt,
                                match['status'],
                                match.get('serie_id'),
                                match.get('winner_id'),
                                match.get('team_a_score'),
                                match.get('team_b_score'),
                                match.get('round_info'),
                                raw.get('number_of_games'),
                                stream_url,
                                json.dumps(raw),
                            ),
                        )
                        cur.execute(f'RELEASE SAVEPOINT "{savepoint_name}"')
                        synced_count += 1

                    except Exception as e:
                        logger.warning(f"⚠️  Error syncing match {match.get('id')}: {e}")
                        # Sadece hatalı satırı geri al, başarılı satırları koru.
                        try:
                            cur.execute(f'ROLLBACK TO SAVEPOINT "{savepoint_name}"')
                            cur.execute(f'RELEASE SAVEPOINT "{savepoint_name}"')
                        except psycopg.Error:
                            # Savepoint geri alınamazsa transaction'ı temizle.
                            conn.rollback()
                        continue

                conn.commit()

        return synced_count
    
    def _get_or_create_game(self, cur, game_slug):
        """Get or create game in database"""
        if not game_slug:
            return None
        
        game_names = {
            'valorant': 'Valorant',
            'csgo': 'Counter-Strike 2',
            'lol': 'League of Legends'
        }
        
        cur.execute("SELECT id FROM games WHERE slug = %s", (game_slug,))
        result = cur.fetchone()
        
        if result:
            return result[0]
        
        game_name = game_names.get(game_slug, game_slug.title())
        cur.execute(
            "INSERT INTO games (slug, name) VALUES (%s, %s) ON CONFLICT (slug) DO NOTHING RETURNING id",
            (game_slug, game_name)
        )
        result = cur.fetchone()
        return result[0] if result else None
    
    def _get_or_create_team(self, cur, team_id, name, acronym=None, logo_url=None):
        """Get or create team in database"""
        cur.execute("SELECT id FROM teams WHERE id = %s", (team_id,))
        result = cur.fetchone()
        
        if result:
            return result[0]
        
        cur.execute("""
            INSERT INTO teams (id, name, acronym, logo_url)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                acronym = EXCLUDED.acronym,
                logo_url = EXCLUDED.logo_url
            RETURNING id
        """, (team_id, name, acronym, logo_url))
        
        result = cur.fetchone()
        return result[0]
    
    def _get_or_create_tournament(self, cur, tournament_id, name, game_id,
                                   begin_at=None, end_at=None,
                                   tier=None, region=None):
        """
        Get or create tournament in database.
        Artık begin_at, end_at, tier ve region alanlarını da yazıyor.
        """
        cur.execute("""
            INSERT INTO tournaments (id, name, game_id, begin_at, end_at, tier, region)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name     = COALESCE(EXCLUDED.name, tournaments.name),
                game_id  = COALESCE(EXCLUDED.game_id, tournaments.game_id),
                begin_at = COALESCE(EXCLUDED.begin_at, tournaments.begin_at),
                end_at   = COALESCE(EXCLUDED.end_at,   tournaments.end_at),
                tier     = COALESCE(EXCLUDED.tier,     tournaments.tier),
                region   = COALESCE(EXCLUDED.region,   tournaments.region)
            RETURNING id
        """, (tournament_id, name, game_id, begin_at, end_at, tier, region))

        result = cur.fetchone()
        return result[0] if result else None

    def mark_stale_matches_finished(self, hours_ago: int = 6) -> int:
        """
        PandaScore'dan gelmesi geciken 'running' → 'finished' geçişlerini
        düzelt: X saat önce başlamış ama hâlâ 'running' olan maçları
        'finished' olarak işaretle.

        Gerçek winner_id bilinmiyor; sadece status düzeltilir.
        Bir sonraki full sync bu maçları doğru winner ile güncelleyecek.
        """
        updated = 0
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE matches
                        SET    status     = 'finished',
                               updated_at = CURRENT_TIMESTAMP
                        WHERE  status     = 'running'
                          AND  scheduled_at < NOW() - (%s * INTERVAL '1 hour')
                        RETURNING id
                        """,
                        (hours_ago,),
                    )
                    rows    = cur.fetchall()
                    updated = len(rows)
                    conn.commit()
            if updated:
                logger.info(f"🕒 Marked {updated} stale 'running' matches → 'finished'")
        except psycopg.Error as e:
            logger.warning(f"⚠️  mark_stale_matches_finished error: {e}")
        return updated