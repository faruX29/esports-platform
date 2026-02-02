"""
Sync match data to Supabase database
"""
from database import Database
from etl.pandascore_client import PandaScoreClient
from etl.data_cleaner import DataCleaner
import psycopg
import json


class MatchSyncer:
    """Sync match data from PandaScore to Supabase"""
    
    def __init__(self):
        self.client = PandaScoreClient()
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
        Upsert matches to database
        
        Args:
            matches: List of cleaned match data
            
        Returns:
            int: Number of matches synced
        """
        synced_count = 0
        
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                for match in matches:
                    try:
                        # Get or create game
                        game_id = self._get_or_create_game(cur, match['game_slug'])
                        
                        # Get or create teams
                        team_a_id = self._get_or_create_team(
                            cur, 
                            match['team_a_id'], 
                            match['team_a_name'],
                            match.get('team_a_acronym'),
                            match.get('team_a_logo')
                        )
                        
                        team_b_id = self._get_or_create_team(
                            cur, 
                            match['team_b_id'], 
                            match['team_b_name'],
                            match.get('team_b_acronym'),
                            match.get('team_b_logo')
                        )
                        
                        # Get or create tournament
                        tournament_id = None
                        if match.get('tournament_id') and match.get('tournament_name'):
                            tournament_id = self._get_or_create_tournament(
                                cur,
                                match['tournament_id'],
                                match['tournament_name'],
                                game_id
                            )
                        
                        # Upsert match with scores
                        cur.execute("""
                            INSERT INTO matches (
                                id, game_id, team_a_id, team_b_id, tournament_id,
                                scheduled_at, status, serie_id, winner_id,
                                team_a_score, team_b_score, raw_data
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (id) DO UPDATE SET
                                status = EXCLUDED.status,
                                winner_id = EXCLUDED.winner_id,
                                team_a_score = EXCLUDED.team_a_score,
                                team_b_score = EXCLUDED.team_b_score,
                                raw_data = EXCLUDED.raw_data,
                                updated_at = CURRENT_TIMESTAMP
                        """, (
                            match['id'],
                            game_id,
                            team_a_id,
                            team_b_id,
                            tournament_id,
                            match['scheduled_at'],
                            match['status'],
                            match.get('serie_id'),
                            match.get('winner_id'),
                            match.get('team_a_score'),
                            match.get('team_b_score'),
                            json.dumps(match['raw_data'])
                        ))
                        
                        synced_count += 1
                        
                    except psycopg.Error as e:
                        print(f"⚠️  Error syncing match {match['id']}: {e}")
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
    
    def _get_or_create_tournament(self, cur, tournament_id, name, game_id):
        """Get or create tournament in database"""
        cur.execute("SELECT id FROM tournaments WHERE id = %s", (tournament_id,))
        result = cur.fetchone()
        
        if result:
            return result[0]
        
        cur.execute("""
            INSERT INTO tournaments (id, name, game_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name
            RETURNING id
        """, (tournament_id, name, game_id))
        
        result = cur.fetchone()
        return result[0]