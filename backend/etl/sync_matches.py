"""
Main ETL script: Sync matches from PandaScore to Supabase
"""
from datetime import datetime
from typing import List, Dict
import psycopg
from database import Database
from etl.pandascore_client import PandaScoreClient
from etl.data_cleaner import DataCleaner

class MatchSyncer:
    """Sync matches from PandaScore to database"""
    
    def __init__(self):
        self.client = PandaScoreClient()
    
    def sync_team(self, conn: psycopg.Connection, team_data: Dict, game_id: int):
        """
        Upsert a single team to database
        
        Args:
            conn: Database connection
            team_data: Cleaned team dict
            game_id: Game ID from games table
        """
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO teams (id, name, slug, acronym, logo_url, game_id, pandascore_data, last_synced_at)
                VALUES (%(id)s, %(name)s, %(slug)s, %(acronym)s, %(logo_url)s, %(game_id)s, %(pandascore_data)s, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    slug = EXCLUDED.slug,
                    acronym = EXCLUDED.acronym,
                    logo_url = EXCLUDED.logo_url,
                    last_synced_at = NOW(),
                    updated_at = NOW()
            """, {
                'id': team_data['id'],
                'name': team_data['name'],
                'slug': team_data.get('slug'),
                'acronym': team_data.get('acronym', ''),
                'logo_url': team_data.get('logo_url'),
                'game_id': game_id,
                'pandascore_data': psycopg.types.json.Jsonb(team_data)
            })
    
    def sync_tournament(self, conn: psycopg.Connection, tournament_data: Dict, game_id: int) -> int:
        """
        Upsert tournament and return its ID
        
        Args:
            conn: Database connection
            tournament_data: Cleaned tournament dict
            game_id: Game ID from games table
        
        Returns:
            Tournament ID
        """
        if not tournament_data.get('id'):
            return None
        
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO tournaments (id, name, slug, game_id, tier, pandascore_data, last_synced_at)
                VALUES (%(id)s, %(name)s, %(slug)s, %(game_id)s, %(tier)s, %(pandascore_data)s, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    slug = EXCLUDED.slug,
                    tier = EXCLUDED.tier,
                    last_synced_at = NOW(),
                    updated_at = NOW()
                RETURNING id
            """, {
                'id': tournament_data['id'],
                'name': tournament_data['name'],
                'slug': tournament_data.get('slug'),
                'game_id': game_id,
                'tier': tournament_data.get('tier'),
                'pandascore_data': psycopg.types.json.Jsonb(tournament_data)
            })
            
            result = cur.fetchone()
            return result[0] if result else tournament_data['id']
    
    def sync_match(self, conn: psycopg.Connection, match_data: Dict, game_id: int):
        """
        Upsert a single match to database
        
        Args:
            conn: Database connection
            match_data: Cleaned match dict
            game_id: Game ID from games table
        """
        # First, sync both teams
        self.sync_team(conn, match_data['teams']['team_a'], game_id)
        self.sync_team(conn, match_data['teams']['team_b'], game_id)
        
        # Sync tournament
        tournament_id = self.sync_tournament(conn, match_data['tournament'], game_id)
        
        # Then sync the match
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO matches (
                    id, game_id, tournament_id,
                    team_a_id, team_b_id,
                    status, scheduled_at,
                    match_type, number_of_games, winner_id,
                    pandascore_data, last_synced_at
                )
                VALUES (
                    %(id)s, %(game_id)s, %(tournament_id)s,
                    %(team_a_id)s, %(team_b_id)s,
                    %(status)s, %(scheduled_at)s,
                    %(match_type)s, %(number_of_games)s, %(winner_id)s,
                    %(pandascore_data)s, NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    scheduled_at = EXCLUDED.scheduled_at,
                    winner_id = EXCLUDED.winner_id,
                    last_synced_at = NOW(),
                    updated_at = NOW()
            """, {
                'id': match_data['id'],
                'game_id': game_id,
                'tournament_id': tournament_id,
                'team_a_id': match_data['teams']['team_a']['id'],
                'team_b_id': match_data['teams']['team_b']['id'],
                'status': match_data['status'],
                'scheduled_at': match_data['scheduled_at'],
                'match_type': match_data.get('match_type'),
                'number_of_games': match_data.get('number_of_games'),
                'winner_id': match_data.get('winner_id'),
                'pandascore_data': psycopg.types.json.Jsonb(match_data['raw_data'])
            })
    
    def sync_game_matches(self, game_slug: str, limit: int = 50) -> Dict:
        """
        Sync matches for a specific game
        
        Args:
            game_slug: Game identifier ('valorant', 'cs-go', 'lol')
            limit: Maximum number of matches to fetch
        
        Returns:
            Stats dict with counts
        """
        print(f"\n🎮 Syncing {game_slug.upper()} matches...")
        
        # Get game_id from database
        game_id = Database.get_game_id(game_slug)
        if not game_id:
            print(f"❌ Game '{game_slug}' not found in database")
            return {'error': 'Game not found'}
        
        # Fetch matches from PandaScore
        print(f"📥 Fetching from PandaScore API...")
        raw_matches = self.client.get_upcoming_matches(game_slug, per_page=limit)
        
        if not raw_matches:
            print("❌ No matches fetched from API")
            return {'fetched': 0, 'cleaned': 0, 'synced': 0}
        
        print(f"✅ Fetched {len(raw_matches)} matches")
        
        # Clean matches
        print(f"🧹 Cleaning data...")
        cleaned_matches = DataCleaner.clean_matches(raw_matches)
        print(f"✅ Cleaned {len(cleaned_matches)} valid matches")
        
        # Sync to database
        print(f"💾 Syncing to database...")
        synced_count = 0
        
        with Database.get_connection() as conn:
            for match in cleaned_matches:
                try:
                    self.sync_match(conn, match, game_id)
                    synced_count += 1
                except Exception as e:
                    print(f"❌ Failed to sync match {match['id']}: {e}")
        
        print(f"✅ Synced {synced_count} matches to database")
        
        return {
            'fetched': len(raw_matches),
            'cleaned': len(cleaned_matches),
            'synced': synced_count
        }

def main():
    """Main entry point"""
    print("=" * 60)
    print("🚀 ESPORTS DATA SYNC")
    print(f"⏰ Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    syncer = MatchSyncer()
    
    # Sync Valorant matches
    stats = syncer.sync_game_matches('valorant', limit=50)
    
    print("\n" + "=" * 60)
    print("📊 SYNC COMPLETE")
    print(f"   Fetched: {stats.get('fetched', 0)} matches")
    print(f"   Cleaned: {stats.get('cleaned', 0)} matches")
    print(f"   Synced:  {stats.get('synced', 0)} matches")
    print("=" * 60)

if __name__ == "__main__":
    main()