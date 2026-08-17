"""
Turnuva tam-adları backfill: PandaScore'dan S/A turnuvaların league.name +
serie.full_name'ini çekip mevcut tournaments satırlarına yazar.

tournaments.name = aşama ("Play-In"); league_name = "VCT"; event_name =
"Americas Stage 2 2026". Frontend bunları compose eder. display_name override'a
DOKUNULMAZ.

Kullanım: python backfill_tournament_names.py [--tiers s,a]
"""
import argparse
import logging

from dotenv import load_dotenv
load_dotenv()

from database import Database
from etl.pandascore_client import PandaScoreClient
from utils.logger import setup_logging

logger = logging.getLogger(__name__)

# PandaScore endpoint slug'ları (bizim kanonik oyunlarımıza karşılık)
GAME_SLUGS = ['valorant', 'csgo', 'lol']


def backfill(tiers='s,a'):
    client = PandaScoreClient()
    seen, updated, skipped_missing = 0, 0, 0

    with Database.get_connection() as conn:
        with conn.cursor() as cur:
            for game_slug in GAME_SLUGS:
                page = 1
                while page <= 40:  # güvenlik tavanı
                    tours = client.get_tournaments_by_tier(game_slug, tiers=tiers, page=page, per_page=100)
                    if not tours:
                        break
                    for t in tours:
                        seen += 1
                        tid = t.get('id')
                        if not tid:
                            continue
                        league = t.get('league') or {}
                        serie = t.get('serie') or {}
                        league_name = (league.get('name') or '').strip() or None
                        event_name = (serie.get('full_name') or serie.get('name') or '').strip() or None
                        if not league_name and not event_name:
                            continue
                        # Yalnız MEVCUT turnuvaları güncelle (yoksa maç-sync yaratır).
                        cur.execute(
                            """
                            UPDATE tournaments
                               SET league_name = COALESCE(%s, league_name),
                                   event_name  = COALESCE(%s, event_name)
                             WHERE id = %s
                            """,
                            (league_name, event_name, tid),
                        )
                        if cur.rowcount > 0:
                            updated += 1
                        else:
                            skipped_missing += 1
                    logger.info(f"  {game_slug} sayfa {page}: {len(tours)} turnuva işlendi (toplam güncellenen {updated})")
                    if len(tours) < 100:
                        break
                    page += 1
        # get_connection commit'i otomatik yapar

    logger.info(f"BITTI — görülen {seen}, güncellenen {updated}, DB'de olmayan {skipped_missing}")
    return updated


if __name__ == '__main__':
    setup_logging()
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiers', default='s,a')
    args = ap.parse_args()
    backfill(tiers=args.tiers)
