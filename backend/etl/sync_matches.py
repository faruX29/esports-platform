"""
Sync match data to Supabase database
"""
from database import Database
from etl.pandascore_client import PandaScoreClient
from etl.data_cleaner       import DataCleaner
import psycopg
import json
from datetime import timezone, datetime


class MatchSyncer:
    """Sync match data from PandaScore to Supabase"""

    def __init__(self):
        self.client  = PandaScoreClient()
        self.cleaner = DataCleaner()

    def sync_game_matches(self, game_slug, limit=50, past=False, page=1):
        """
        Sync matches for a specific game
        
        Args:
            game_slug: Game identifier (valorant, csgo, lol)
            limit: Maximum number of matches to fetch
            past: If True, fetch past matches instead of upcoming
            
        Returns:
            dict: Sync statistics
        """
        print(f"\n🎮 Syncing {game_slug.upper()} {'past' if past else 'upcoming'} matches...")
        
        # Fetch matches from API
        print("📥 Fetching from PandaScore API...")
        if past:
            raw_matches = self.client.get_past_matches(game_slug, limit, page)
        else:
            raw_matches = self.client.get_upcoming_matches(game_slug, limit)
        
        if not raw_matches:
            print("❌ No matches fetched from API")
            return {'fetched': 0, 'cleaned': 0, 'synced': 0}
        
        # Clean data
        print("🧹 Cleaning data...")
        cleaned_matches = self.cleaner.clean_matches(raw_matches)
        
        if not cleaned_matches:
            print("❌ No valid matches after cleaning")
            return {'fetched': len(raw_matches), 'cleaned': 0, 'synced': 0}
        
        # Sync to database
        print("💾 Syncing to database...")
        synced_count = self._upsert_matches(cleaned_matches)
        
        print(f"✅ Synced {synced_count} matches to database")
        
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
                for match in matches:
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
                                print(f"⚠️  Bad scheduled_at for match {match['id']}: {raw_scheduled}")
                        else:
                            scheduled_dt = None

                        # ── Upsert — tüm mutable alanlar güncelleniyor ──
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
                                raw_data,
                                updated_at
                            )
                            VALUES (
                                %s, %s, %s, %s, %s,
                                %s, %s, %s, %s, %s,
                                %s, %s,
                                CURRENT_TIMESTAMP
                            )
                            ON CONFLICT (id) DO UPDATE SET
                                status        = EXCLUDED.status,
                                winner_id     = EXCLUDED.winner_id,
                                team_a_score  = EXCLUDED.team_a_score,
                                team_b_score  = EXCLUDED.team_b_score,
                                scheduled_at  = EXCLUDED.scheduled_at,
                                tournament_id = COALESCE(EXCLUDED.tournament_id,
                                                         matches.tournament_id),
                                raw_data      = EXCLUDED.raw_data,
                                updated_at    = CURRENT_TIMESTAMP
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
                                json.dumps(match['raw_data']),
                            ),
                        )
                        synced_count += 1

                    except psycopg.Error as e:
                        print(f"⚠️  Error syncing match {match.get('id')}: {e}")
                        conn.rollback()   # bu maçı atla, diğerlerine devam et
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
        cur.execute("SELECT id FROM tournaments WHERE id = %s", (tournament_id,))
        result = cur.fetchone()

        if result:
            # Mevcut kayıt: eksik alanları güncelle (NULL override etme)
            cur.execute("""
                UPDATE tournaments SET
                    name     = COALESCE(EXCLUDED.name,     tournaments.name),
                    begin_at = COALESCE(%s, tournaments.begin_at),
                    end_at   = COALESCE(%s, tournaments.end_at),
                    tier     = COALESCE(%s, tournaments.tier),
                    region   = COALESCE(%s, tournaments.region)
                WHERE id = %s
            """, (begin_at, end_at, tier, region, tournament_id))
            return result[0]

        cur.execute("""
            INSERT INTO tournaments (id, name, game_id, begin_at, end_at, tier, region)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name     = EXCLUDED.name,
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
        cutoff  = f"NOW() - INTERVAL '{hours_ago} hours'"
        try:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        UPDATE matches
                        SET    status     = 'finished',
                               updated_at = CURRENT_TIMESTAMP
                        WHERE  status     = 'running'
                          AND  scheduled_at < {cutoff}
                        RETURNING id
                        """,
                    )
                    rows    = cur.fetchall()
                    updated = len(rows)
                    conn.commit()
            if updated:
                print(f"🕒 Marked {updated} stale 'running' matches → 'finished'")
        except psycopg.Error as e:
            print(f"⚠️  mark_stale_matches_finished error: {e}")
        return updated