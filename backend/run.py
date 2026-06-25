"""
Main entry point for Esports Data Platform ETL
Usage: python run.py [options]
"""
import argparse
import logging
from datetime import datetime
from utils.logger import setup_logging
from etl.sync_matches import MatchSyncer
from etl.predict import MatchPredictor
from etl.sync_players import PlayerStatsSyncer
from etl.adapters import LiquipediaAdapter, GeminiAdapter
from etl.news_generator import NewsGenerator

logger = logging.getLogger(__name__)


def main():
    """Main entry point with command-line arguments"""
    setup_logging()
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
        '--upcoming-days',
        type=int,
        default=7,
        help='Upcoming match sync date window in days (default: 7)'
    )

    parser.add_argument(
        '--sync-matches',
        action='store_true',
        help='Backward-compatible no-op flag. Match sync is already default behavior.'
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
        '--live',
        action='store_true',
        help='Sadece live (running) maçları senkronize et — sık polling için tasarlandı',
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
        '--roster-flush',
        action='store_true',
        help='Roster Integrity Flush: kadroda olmayan oyuncuların team_id\'sini NULL yap',
    )

    parser.add_argument(
        '--accuracy-check',
        action='store_true',
        help='AI tahmin başarı oranını hesapla (prediction_team_a vs winner_id)',
    )
    parser.add_argument(
        '--accuracy-days',
        type=int,
        default=30,
        help='--accuracy-check için kaç günlük geçmişe bakılsın (0 = tüm zamanlar, varsayılan: 30)',
    )

    parser.add_argument(
        '--generate-news',
        action='store_true',
        help='Son 24 saatte biten maçlar için LLM (Gemini) ile Türkçe haber makalesi üret',
    )
    parser.add_argument(
        '--news-hours',
        type=int,
        default=24,
        help='--generate-news için kaç saate kadar geriye bakılsın (varsayılan: 24)',
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

    logger.info("=" * 60)
    logger.info("🚀 ESPORTS DATA PLATFORM - ETL")
    logger.info(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 60)

    syncer = MatchSyncer()
    total_stats = {'fetched': 0, 'cleaned': 0, 'synced': 0}

    # ── Live-only sync (--live flag) ──────────────────────────────────────────
    if args.live:
        games = ['valorant', 'csgo', 'lol'] if args.all_games else [args.game]
        total_live = {'fetched': 0, 'cleaned': 0, 'synced': 0}
        for game in games:
            r = syncer.sync_running_matches(game, limit=args.limit)
            for k in total_live:
                total_live[k] += r.get(k, 0)
        logger.info(f"📡 Live sync done — synced {total_live['synced']} running matches")
        return   # live sync sonrası dur, diğer adımları çalıştırma

    has_non_enrichment_work = any([
        args.predict,
        args.stats,
        args.players,
        args.missing_rosters,
        args.league_sync,
        args.roster_flush,
        args.fix_stale,
        args.past,
        args.all_games,
        args.accuracy_check,
        args.generate_news,
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
                upcoming_days=args.upcoming_days,
            )

            total_stats['fetched'] += stats.get('fetched', 0)
            total_stats['cleaned'] += stats.get('cleaned', 0)
            total_stats['synced'] += stats.get('synced', 0)

        logger.info("\n" + "=" * 60)
        logger.info("📊 TOTAL SYNC RESULTS")
        logger.info(f"   Games synced: {len(games)}")
        logger.info(f"   Fetched: {total_stats['fetched']} matches")
        logger.info(f"   Cleaned: {total_stats['cleaned']} matches")
        logger.info(f"   Synced:  {total_stats['synced']} matches")
        logger.info("=" * 60)
    else:
        logger.info("\nℹ️ Skipping PandaScore match sync (Liquipedia-only run).")

    # AI Predictions
    if args.predict:
        logger.info("\n" + "=" * 60)
        logger.info("🧠 AI MATCH PREDICTIONS")
        logger.info("=" * 60)

        predictor = MatchPredictor()

        # Past mode ise finished maçlara tahmin yap
        if args.past:
            predictions = predictor.predict_finished_matches(limit=args.limit or 150)
        else:
            predictions = predictor.predict_upcoming_matches(limit=150)

        logger.info(f"\n✅ Generated {len(predictions)} predictions")
        logger.info("=" * 60)

    # Match Stats (raw_data → match_stats tablosu, API çağrısı yok)
    if args.stats:
        logger.info("\n" + "=" * 60)
        logger.info("📊 MATCH STATS SYNC")
        logger.info("=" * 60)
        ps = PlayerStatsSyncer()
        ps.ensure_schema()
        # limit'i 200 → 2000 yap: daha fazla geçmiş maç işle
        stats_limit = max(args.limit * len(games) * 10, 2000)
        count = ps.sync_match_stats(limit=stats_limit)
        logger.info(f"✅ {count} maç işlendi")
        logger.info("=" * 60)

    # Player Rosters ── eski davranış: sadece DB'deki yeni takımlar
    if args.players:
        logger.info("\n" + "=" * 60)
        logger.info(f"👤 ACTIVE ROSTER SYNC (son {args.roster_days} gün, "
              f"force={args.roster_force})")
        logger.info("=" * 60)
        ps = PlayerStatsSyncer()
        result = ps.sync_all_active_rosters(
            days=args.roster_days,
            force=args.roster_force,
        )
        logger.info(f"✅ {result['players_upserted']} oyuncu | "
              f"{result['teams_processed']} takım")
        logger.info("=" * 60)

    # ── --missing-rosters: DB'deki tüm eksik kadrolar ─────────────────────────
    if args.missing_rosters:
        logger.info("\n" + "=" * 60)
        logger.info("🔍 MISSING ROSTER SYNC (teams tablosundaki tüm eksikler)")
        logger.info("=" * 60)
        ps = PlayerStatsSyncer()
        result = ps.sync_missing_rosters()
        logger.info(f"✅ {result['players_upserted']} oyuncu | "
              f"{result['teams_processed']} takım işlendi | "
              f"{result['errors']} hata")
        logger.info("=" * 60)

    # ── --league-sync: lig bazlı tam tarama ───────────────────────────────────
    if args.league_sync:
        logger.info("\n" + "=" * 60)
        games_label = ', '.join(args.league_games or ['valorant', 'csgo', 'lol'])
        logger.info(f"🏆 LEAGUE ROSTER SYNC ({games_label}, force={args.roster_force})")
        logger.info("=" * 60)
        ps = PlayerStatsSyncer()
        result = ps.sync_league_rosters(
            game_slugs=args.league_games,
            force=args.roster_force,
        )
        logger.info(f"✅ {result['players_upserted']} oyuncu | "
              f"{result['teams_found']} takım bulundu | "
              f"{result['leagues_scanned']} lig tarandı | "
              f"{result['errors']} hata")
        logger.info("=" * 60)

    # ── --roster-flush: Kadro bütünlüğü temizliği ────────────────────────────
    if args.roster_flush:
        logger.info("\n" + "=" * 60)
        logger.info(f"🧹 ROSTER INTEGRITY FLUSH (son {args.roster_days} gün)")
        logger.info("=" * 60)
        ps = PlayerStatsSyncer()
        result = ps.flush_all_stale_rosters(days=args.roster_days)
        logger.info(f"✅ {result['players_flushed']} oyuncu serbest bırakıldı | "
              f"{result['players_upserted']} upsert | "
              f"{result['teams_checked']} takım | "
              f"{result['errors']} hata")
        logger.info("=" * 60)

    if args.fix_stale:
        logger.info("\n🕒 Stale match cleanup...")
        syncer.mark_stale_matches_finished(hours_ago=args.stale_hours)

    if args.accuracy_check:
        logger.info("\n" + "=" * 60)
        logger.info("🎯 AI PREDICTION ACCURACY CHECK")
        logger.info("=" * 60)
        predictor = MatchPredictor()
        result = predictor.calculate_prediction_accuracy(days=args.accuracy_days)
        logger.info(
            f"📊 Accuracy sonucu: {result['correct']}/{result['total']} "
            f"doğru → %{result['accuracy_pct']}"
        )

    if args.generate_news:
        logger.info("\n" + "=" * 60)
        logger.info("📰 LLM NEWS GENERATION (Gemini)")
        logger.info("=" * 60)
        try:
            llm = GeminiAdapter()
            generator = NewsGenerator(llm)
            result = generator.generate_pending(hours_back=args.news_hours)
            logger.info(
                f"✅ Haber üretimi tamamlandı — "
                f"deneme: {result['attempted']} | "
                f"yazıldı: {result['generated']} | "
                f"hata: {result['failed']}"
            )
        except Exception as news_err:
            logger.error(f"❌ Haber üretimi başlatılamadı: {news_err}")
        logger.info("=" * 60)

    if args.liquipedia_enrich:
        logger.info("\n" + "=" * 60)
        logger.info("🌐 LIQUIPEDIA DATA ENRICHMENT")
        logger.info("=" * 60)
        adapter = LiquipediaAdapter()
        result = adapter.run(
            limit=args.liquipedia_limit,
            sections=tuple(args.liquipedia_sections),
        )
        for section, stats in result.items():
            logger.info(
                f"  - {section}: processed={stats.get('processed', 0)} | "
                f"updated={stats.get('updated', 0)} | skipped={stats.get('skipped', 0)} | "
                f"diagnostics={stats.get('diagnostic_count', 0)}"
            )
        logger.info("=" * 60)

if __name__ == "__main__":
    main()