"""
Main entry point for Esports Data Platform ETL
Usage: python run.py [options]
"""
import argparse
from datetime import datetime
from etl.sync_matches import MatchSyncer
from etl.predict import MatchPredictor
from etl.sync_players import PlayerStatsSyncer
from etl.adapters import LiquipediaAdapter

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

    parser.add_argument(
        '--predict',
        action='store_true',
        help='Run AI predictions on upcoming matches'
    )

    parser.add_argument(
        '--stats',
        action='store_true',
        help='Extract match stats from raw_data into match_stats table (fast, no API call)'
    )

    parser.add_argument(
        '--players',
        action='store_true',
        help='Sync player rosters from PandaScore /teams/{id} endpoint'
    )

    parser.add_argument(
        '--roster-days',
        type=int,
        default=90,
        help='sync_all_active_rosters için kaç günlük geçmişe bakılsın (varsayılan: 90)'
    )

    parser.add_argument(
        '--roster-force',
        action='store_true',
        help='Zaten yüklü kadroları da yeniden çek (güncellik için)'
    )

    parser.add_argument(
        '--missing-rosters',
        action='store_true',
        help='teams tablosunda olup players tablosunda olmayan TÜM takımları sync et'
    )

    parser.add_argument(
        '--league-sync',
        action='store_true',
        help='Ana liglerdeki (VCT/ESL/LEC vb.) tüm takım kadrolarını çek'
    )

    parser.add_argument(
        '--league-games',
        nargs='+',
        choices=['valorant', 'csgo', 'lol'],
        default=None,
        help='--league-sync için hangi oyunlar (varsayılan: hepsi)'
    )

    parser.add_argument(
        '--fix-stale',
        action='store_true',
        help='X saat önce başlamış ama hâlâ running olan maçları finished yap',
    )
    parser.add_argument(
        '--stale-hours',
        type=int,
        default=6,
        help='--fix-stale için eşik (saat, varsayılan: 6)',
    )

    parser.add_argument(
        '--liquipedia-enrich',
        action='store_true',
        help='Liquipedia MediaWiki API ile Data Enrichment çalıştır',
    )
    parser.add_argument(
        '--liquipedia-limit',
        type=int,
        default=50,
        help='Liquipedia enrichment için her bölümde işlenecek max kayıt (varsayılan: 50)',
    )
    parser.add_argument(
        '--liquipedia-sections',
        nargs='+',
        choices=['all', 'tournaments', 'teams', 'players'],
        default=['all'],
        help='Liquipedia enrichment bölümleri (varsayılan: all)',
    )

    args = parser.parse_args()

    print("=" * 60)
    print("🚀 ESPORTS DATA PLATFORM - ETL")
    print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    syncer = MatchSyncer()
    total_stats = {'fetched': 0, 'cleaned': 0, 'synced': 0}

    has_non_enrichment_work = any([
        args.predict,
        args.stats,
        args.players,
        args.missing_rosters,
        args.league_sync,
        args.fix_stale,
        args.past,
        args.all_games,
    ])
    should_sync_matches = not args.liquipedia_enrich or has_non_enrichment_work

    if should_sync_matches:
        if args.all_games:
            games = ['valorant', 'csgo', 'lol']
        else:
            games = [args.game]

        for game in games:
            # limit'i artır: 50 → 200, past modda daha fazla sayfa tara
            stats = syncer.sync_game_matches(
                game,
                limit=args.limit,
                past=args.past,
                page=args.page if args.past else 1,
            )

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
    else:
        print("\nℹ️ Skipping PandaScore match sync (Liquipedia-only run).")

    # AI Predictions
    if args.predict:
        print("\n" + "=" * 60)
        print("🧠 AI MATCH PREDICTIONS")
        print("=" * 60)

        predictor = MatchPredictor()

        # Past mode ise finished maçlara tahmin yap
        if args.past:
            predictions = predictor.predict_finished_matches(limit=args.limit or 150)
        else:
            predictions = predictor.predict_upcoming_matches(limit=150)

        print(f"\n✅ Generated {len(predictions)} predictions")
        print("=" * 60)

    # Match Stats (raw_data → match_stats tablosu, API çağrısı yok)
    if args.stats:
        print("\n" + "=" * 60)
        print("📊 MATCH STATS SYNC")
        print("=" * 60)
        ps = PlayerStatsSyncer()
        ps.ensure_schema()
        # limit'i 200 → 2000 yap: daha fazla geçmiş maç işle
        stats_limit = max(args.limit * len(games) * 10, 2000)
        count = ps.sync_match_stats(limit=stats_limit)
        print(f"✅ {count} maç işlendi")
        print("=" * 60)

    # Player Rosters ── eski davranış: sadece DB'deki yeni takımlar
    if args.players:
        print("\n" + "=" * 60)
        print(f"👤 ACTIVE ROSTER SYNC (son {args.roster_days} gün, "
              f"force={args.roster_force})")
        print("=" * 60)
        ps = PlayerStatsSyncer()
        result = ps.sync_all_active_rosters(
            days=args.roster_days,
            force=args.roster_force,
        )
        print(f"✅ {result['players_upserted']} oyuncu | "
              f"{result['teams_processed']} takım")
        print("=" * 60)

    # ── --missing-rosters: DB'deki tüm eksik kadrolar ─────────────────────────
    if args.missing_rosters:
        print("\n" + "=" * 60)
        print("🔍 MISSING ROSTER SYNC (teams tablosundaki tüm eksikler)")
        print("=" * 60)
        ps = PlayerStatsSyncer()
        result = ps.sync_missing_rosters()
        print(f"✅ {result['players_upserted']} oyuncu | "
              f"{result['teams_processed']} takım işlendi | "
              f"{result['errors']} hata")
        print("=" * 60)

    # ── --league-sync: lig bazlı tam tarama ───────────────────────────────────
    if args.league_sync:
        print("\n" + "=" * 60)
        games_label = ', '.join(args.league_games or ['valorant', 'csgo', 'lol'])
        print(f"🏆 LEAGUE ROSTER SYNC ({games_label}, force={args.roster_force})")
        print("=" * 60)
        ps = PlayerStatsSyncer()
        result = ps.sync_league_rosters(
            game_slugs=args.league_games,
            force=args.roster_force,
        )
        print(f"✅ {result['players_upserted']} oyuncu | "
              f"{result['teams_found']} takım bulundu | "
              f"{result['leagues_scanned']} lig tarandı | "
              f"{result['errors']} hata")
        print("=" * 60)

    if args.fix_stale:
        print("\n🕒 Stale match cleanup...")
        syncer.mark_stale_matches_finished(hours_ago=args.stale_hours)

    if args.liquipedia_enrich:
        print("\n" + "=" * 60)
        print("🌐 LIQUIPEDIA DATA ENRICHMENT")
        print("=" * 60)
        adapter = LiquipediaAdapter()
        result = adapter.run(
            limit=args.liquipedia_limit,
            sections=tuple(args.liquipedia_sections),
        )
        for section, stats in result.items():
            print(
                f"  - {section}: processed={stats.get('processed', 0)} | "
                f"updated={stats.get('updated', 0)} | skipped={stats.get('skipped', 0)} | "
                f"diagnostics={stats.get('diagnostic_count', 0)}"
            )
        print("=" * 60)

if __name__ == "__main__":
    main()