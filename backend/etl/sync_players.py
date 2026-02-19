"""
Player & Match Stats Syncer

- Players  : /teams/{id} API endpoint üzerinden oyuncu roster'ı çeker
             (K/D/A game stats PandaScore free tier'da 403, sadece roster)
- match_stats: raw_data JSONB'den harita skoru + detayı çıkarır
               (ekstra API çağrısı gerekmez, çok hızlı)

Her iki işlem de incremental'dır:
  - Oyuncusu zaten yüklü takımlar atlanır
  - match_stats kaydı zaten olan maçlar atlanır
"""
import uuid
import json
import time
import requests

from database import Database
from etl.pandascore_client import PandaScoreClient


# ── Yardımcı ──────────────────────────────────────────────────────────────────

def _player_uuid(pandascore_id: int) -> str:
    """PandaScore integer ID'den deterministik UUID üretir."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ps-player-{pandascore_id}"))


# ── Ana Sınıf ─────────────────────────────────────────────────────────────────

class PlayerStatsSyncer:

    def __init__(self):
        self.client = PandaScoreClient()

    # ── Şema Hazırlığı ─────────────────────────────────────────────────────────

    def ensure_schema(self):
        """
        players ve match_stats tablolarına gerekli ekstra kolonları ve
        unique index'leri ekler (IF NOT EXISTS → idempotent).
        """
        with Database.get_connection() as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                # players: pandascore_id (int) + team_pandascore_id (bigint)
                cur.execute("""
                    ALTER TABLE public.players
                      ADD COLUMN IF NOT EXISTS pandascore_id      bigint,
                      ADD COLUMN IF NOT EXISTS team_pandascore_id bigint
                """)
                # pandascore_id üzerinde unique index (partial: null'ları hariç tut)
                cur.execute("""
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_players_pandascore_id
                    ON public.players(pandascore_id)
                    WHERE pandascore_id IS NOT NULL
                """)
                # match_stats: (match_id, team_id) çifti unique olmalı
                cur.execute("""
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_match_stats_match_team
                    ON public.match_stats(match_id, team_id)
                    WHERE match_id IS NOT NULL AND team_id IS NOT NULL
                """)
        print("✅ Şema hazır")

    # ── Oyuncular ──────────────────────────────────────────────────────────────

    def sync_team_players(self, limit=50):
        """
        DB'deki takımlar için PandaScore /teams/{id} endpoint'ini çağırır.
        Incremental: oyuncusu zaten yüklü takımları atlar.

        Args:
            limit: Bir seferde işlenecek max takım sayısı

        Returns:
            int: Eklenen/güncellenen toplam oyuncu sayısı
        """
        # Oyuncusu henüz yüklenmemiş takımları bul
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT t.id, t.name
                    FROM teams t
                    WHERE NOT EXISTS (
                        SELECT 1 FROM players p
                        WHERE p.team_pandascore_id = t.id
                    )
                    ORDER BY t.id
                    LIMIT %s
                """, (limit,))
                teams = cur.fetchall()

        if not teams:
            print("✅ Tüm takımların oyuncuları zaten yüklü.")
            return 0

        print(f"👤 {len(teams)} takım için oyuncu verisi çekiliyor...")
        total_players = 0
        empty_teams   = 0

        for team_id, team_name in teams:
            try:
                url  = f"{self.client.base_url}/teams/{team_id}"
                resp = requests.get(
                    url,
                    params={'token': self.client.api_token},
                    timeout=15
                )

                if resp.status_code == 404:
                    empty_teams += 1
                    continue
                if resp.status_code != 200:
                    print(f"  ⚠️  {team_name}: API {resp.status_code}")
                    continue

                api_players = resp.json().get('players', [])
                if not api_players:
                    empty_teams += 1
                    continue

                with Database.get_connection() as conn:
                    with conn.cursor() as cur:
                        for p in api_players:
                            parts     = [p.get('first_name', ''), p.get('last_name', '')]
                            real_name = ' '.join(x for x in parts if x).strip() or None

                            cur.execute("""
                                INSERT INTO players
                                  (id, nickname, real_name, role, image_url,
                                   pandascore_id, team_pandascore_id)
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (pandascore_id)
                                  WHERE pandascore_id IS NOT NULL
                                DO UPDATE SET
                                  nickname           = EXCLUDED.nickname,
                                  real_name          = EXCLUDED.real_name,
                                  role               = EXCLUDED.role,
                                  image_url          = EXCLUDED.image_url,
                                  team_pandascore_id = EXCLUDED.team_pandascore_id
                            """, (
                                _player_uuid(p['id']),
                                p.get('name', 'Unknown'),
                                real_name,
                                p.get('role'),
                                p.get('image_url'),
                                p['id'],
                                team_id,
                            ))
                    conn.commit()

                total_players += len(api_players)
                print(f"  ✅ {team_name}: {len(api_players)} oyuncu")
                time.sleep(0.1)   # Rate-limit koruması

            except Exception as e:
                print(f"  ⚠️  {team_name}: {e}")
                continue

        print(f"\n📊 Sonuç: {total_players} oyuncu eklendi/güncellendi"
              f" | {empty_teams} boş takım atlandı")
        return total_players

    # ── Maç İstatistikleri ────────────────────────────────────────────────────

    def sync_match_stats(self, limit=500, batch_size=100):
        """
        raw_data JSONB'den takım bazlı maç istatistiklerini çıkarır.
        Ekstra API çağrısı yoktur — tüm veri zaten DB'de.
        Incremental: match_stats kaydı zaten olan maçları atlar.

        Optimizasyon: tek DB bağlantısı + executemany batch insert
        (döngü başına ayrı connection yerine → 50-100x daha hızlı)

        Args:
            limit:      Bir seferde işlenecek max maç sayısı
            batch_size: Kaç satırda bir commit yapılacağı

        Returns:
            int: İşlenen maç sayısı
        """
        INSERT_SQL = """
            INSERT INTO match_stats (match_id, team_id, stats)
            VALUES (%s, %s, %s)
            ON CONFLICT (match_id, team_id)
              WHERE match_id IS NOT NULL AND team_id IS NOT NULL
            DO NOTHING
        """

        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                # 1) İşlenecek maçları çek
                cur.execute("""
                    SELECT m.id, m.team_a_id, m.team_b_id, m.raw_data
                    FROM matches m
                    WHERE m.status = 'finished'
                      AND m.raw_data IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM match_stats ms
                          WHERE ms.match_id = m.id
                      )
                    ORDER BY m.id DESC
                    LIMIT %s
                """, (limit,))
                matches = cur.fetchall()

                if not matches:
                    print("✅ Tüm maç istatistikleri zaten yüklü.")
                    return 0

                print(f"📊 {len(matches)} maç için istatistik işleniyor...")
                processed = 0
                skipped   = 0
                batch     = []   # (match_id, team_id, stats_json)

                # 2) Python'da parse et, batch biriktir
                for match_id, team_a_id, team_b_id, raw_data in matches:
                    try:
                        results = raw_data.get('results', [])
                        games   = raw_data.get('games',   [])

                        if not results or not (team_a_id or team_b_id):
                            skipped += 1
                            continue

                        score_map = {
                            r['team_id']: r['score']
                            for r in results
                            if r.get('team_id') is not None
                        }

                        games_detail = [
                            {
                                'position':       g.get('position'),
                                'winner_id':      (g.get('winner') or {}).get('id'),
                                'length_seconds': g.get('length'),
                                'status':         g.get('status'),
                            }
                            for g in games
                        ]

                        for tid in [team_a_id, team_b_id]:
                            if not tid:
                                continue
                            batch.append((
                                match_id,
                                tid,
                                json.dumps({
                                    'score':        score_map.get(tid),
                                    'games_detail': games_detail,
                                })
                            ))

                        processed += 1

                        # 3) batch_size dolunca flush et
                        if len(batch) >= batch_size:
                            cur.executemany(INSERT_SQL, batch)
                            conn.commit()
                            batch.clear()

                    except Exception as e:
                        print(f"  ⚠️  match {match_id}: {e}")
                        continue

                # 4) Kalan satırları yaz
                if batch:
                    cur.executemany(INSERT_SQL, batch)
                    conn.commit()

        print(f"\n📊 Sonuç: {processed} maç işlendi | {skipped} atlandı")
        return processed
