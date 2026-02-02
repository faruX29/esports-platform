"""
Main entry point for Esports Data Platform ETL
Usage: python run.py [options]
"""
import argparse
from datetime import datetime
from etl.sync_matches import MatchSyncer

def main():
    """Main entry point with command-line arguments"""
    parser = argparse.ArgumentParser(
        description='Sync esports data from PandaScore to Supabase'
    )
    
    parser.add_argument(
        '--game',
        type=str,
        default='valorant',
        choices=['valorant', 'csgo', 'lol'],
        help='Game to sync (default: valorant)'
    )
    
    parser.add_argument(
        '--limit',
        type=int,
        default=50,
        help='Maximum number of matches to fetch (default: 50)'
    )
    
    parser.add_argument(
        '--all-games',
        action='store_true',
        help='Sync all games (valorant, csgo, lol)'
    )
    
    parser.add_argument(
        '--past',
        action='store_true',
        help='Sync past (finished) matches instead of upcoming'
    )
    parser.add_argument(
        '--page',
        type=int,
        default=1,
        help='Page number for past matches (default: 1)'
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("🚀 ESPORTS DATA PLATFORM - ETL")
    print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    syncer = MatchSyncer()
    total_stats = {'fetched': 0, 'cleaned': 0, 'synced': 0}
    
    if args.all_games:
        games = ['valorant', 'csgo', 'lol']
    else:
        games = [args.game]
    
    for game in games:
        stats = syncer.sync_game_matches(game, limit=args.limit, past=args.past, page=args.page if args.past else 1)
        
        total_stats['fetched'] += stats.get('fetched', 0)
        total_stats['cleaned'] += stats.get('cleaned', 0)
        total_stats['synced'] += stats.get('synced', 0)
    
    print("\n" + "=" * 60)
    print("📊 TOTAL SYNC RESULTS")
    print(f"   Games synced: {len(games)}")
    print(f"   Fetched: {total_stats['fetched']} matches")
    print(f"   Cleaned: {total_stats['cleaned']} matches")
    print(f"   Synced:  {total_stats['synced']} matches")
    print("=" * 60)

if __name__ == "__main__":
    main()