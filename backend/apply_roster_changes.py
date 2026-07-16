"""
apply_roster_changes.py — Liquipedia transfer verisini (roster_changes) players
tablosuna uygular. PandaScore kadro verisi alt-tier takımlarda haftalarca geride
kalabiliyor; bu script bizim daha güncel transfer kayıtlarımızı PandaScore'un ÜSTÜNE
uygular (kurucu kararı 2026-07-16).

Mantık (regresyon-güvenli):
  - Her oyuncunun EN SON transfer kaydını al (transfer_date, created_at DESC).
  - source_team_id null ise atla (nereden çıktığı belirsiz → doğrulanamaz).
  - SADECE oyuncu HÂLÂ 'çıktığı' takımda görünüyorsa düzelt
    (players.team_pandascore_id == source_team_id):
      * target_team_id null  → release  → team_pandascore_id = NULL
      * target_team_id dolu   → transfer → team_pandascore_id = target_team_id
    Bu guard, PandaScore'un zaten ileri taşıdığı bir oyuncuyu geri almaz.

Kullanım:
    python apply_roster_changes.py            # DRY-RUN (sadece rapor)
    python apply_roster_changes.py --apply     # gerçekten yaz
"""
import argparse
import logging
from database import Database
from utils.logger import setup_logging

logger = logging.getLogger(__name__)

LATEST_PER_PLAYER = """
    SELECT DISTINCT ON (rc.player_id)
        rc.player_id, rc.source_team_id, rc.target_team_id,
        rc.transfer_date, rc.transfer_type,
        p.team_pandascore_id AS current_team,
        p.nickname
    FROM roster_changes rc
    JOIN players p ON p.id = rc.player_id
    WHERE rc.player_id IS NOT NULL AND rc.source_team_id IS NOT NULL
    ORDER BY rc.player_id, rc.transfer_date DESC NULLS LAST, rc.created_at DESC
"""


def main():
    setup_logging()
    parser = argparse.ArgumentParser(description="Liquipedia roster_changes → players")
    parser.add_argument('--apply', action='store_true', help='Gerçekten yaz (yoksa dry-run)')
    args = parser.parse_args()

    with Database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(LATEST_PER_PLAYER)
            rows = cur.fetchall()

            to_release = []   # (player_id, nickname, source)
            to_move = []      # (player_id, nickname, source, target)
            for player_id, source_id, target_id, tdate, ttype, current_team, nick in rows:
                # Guard: oyuncu hâlâ çıktığı takımda mı?
                if current_team is None or int(current_team) != int(source_id):
                    continue
                if target_id is None:
                    to_release.append((player_id, nick, source_id))
                else:
                    to_move.append((player_id, nick, source_id, target_id))

            logger.info("=" * 60)
            logger.info("Liquipedia roster_changes -> players")
            logger.info("=" * 60)
            logger.info(f"Incelenen en-son transfer: {len(rows)} oyuncu")
            logger.info(f"Duzeltilecek RELEASE (takimdan cikar): {len(to_release)}")
            logger.info(f"Duzeltilecek TRANSFER (yeni takim):     {len(to_move)}")
            for _, nick, src in to_release[:15]:
                logger.info(f"  RELEASE  {nick}  (team {src} -> NULL)")
            for _, nick, src, tgt in to_move[:15]:
                logger.info(f"  TRANSFER {nick}  (team {src} -> {tgt})")

            if not args.apply:
                logger.info("\nDRY-RUN — hicbir sey yazilmadi. Uygulamak icin: --apply")
                return

            released = moved = 0
            for player_id, _, source_id in to_release:
                cur.execute(
                    "UPDATE players SET team_pandascore_id = NULL "
                    "WHERE id = %s AND team_pandascore_id = %s",
                    (player_id, source_id),
                )
                released += cur.rowcount
            for player_id, _, source_id, target_id in to_move:
                cur.execute(
                    "UPDATE players SET team_pandascore_id = %s "
                    "WHERE id = %s AND team_pandascore_id = %s",
                    (target_id, player_id, source_id),
                )
                moved += cur.rowcount

            logger.info(f"\nUYGULANDI: released={released}, moved={moved}")
    logger.info("Bitti.")


if __name__ == "__main__":
    main()
