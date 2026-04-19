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
import re

from database import Database
from etl.pandascore_client import PandaScoreClient


# ── Yardımcı ──────────────────────────────────────────────────────────────────

def _player_uuid(pandascore_id: int) -> str:
    """PandaScore integer ID'den deterministik UUID üretir."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ps-player-{pandascore_id}"))


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_nickname(name):
    raw = str(name or '').strip().lower()
    if not raw:
        return ''
    return re.sub(r'[^a-z0-9]+', '', raw)


# ── Ana Ligler ─────────────────────────────────────────────────────────────────

# https://developers.pandascore.co/reference/leagues
MAJOR_LEAGUES = {
    # ── Valorant ──────────────────────────────────────────────────────
    'valorant': [
        4663,   # VCT Americas
        4664,   # VCT EMEA
        4665,   # VCT Pacific
        4666,   # VCT CN
        4408,   # VCT Game Changers
        293,    # Valorant Champions Tour
    ],
    # ── CS2 / CSGO ────────────────────────────────────────────────────
    'csgo': [
        3,      # ESL Pro League
        4,      # BLAST Premier
        7,      # IEM (Intel Extreme Masters)
        46,     # PGL Major
        367,    # ESL Challenger
        260,    # BLAST.tv Paris Major
    ],
    # ── League of Legends ─────────────────────────────────────────────
    'lol': [
        293,    # LEC
        294,    # LCS
        295,    # LCK
        296,    # LPL
        298,    # CBLOL
        300,    # LLA
        301,    # VCS
        293,    # Worlds
    ],
}

# Oyun slug → PandaScore endpoint prefix eşlemesi
GAME_SLUGS = {
    'valorant': 'valorant',
    'csgo':     'csgo',
    'lol':      'lol',
}


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
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS public.player_match_stats (
                        id            bigserial PRIMARY KEY,
                        player_id     uuid NOT NULL,
                        match_id      bigint NOT NULL,
                        team_id       bigint,
                        kills         numeric,
                        deaths        numeric,
                        assists       numeric,
                        headshots     numeric,
                        hs_percentage numeric,
                        is_win        boolean,
                        stats         jsonb DEFAULT '{}'::jsonb,
                        played_at     timestamptz,
                        created_at    timestamptz DEFAULT now(),
                        updated_at    timestamptz DEFAULT now()
                    )
                """)
                cur.execute("""
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_player_match_stats_player_match
                    ON public.player_match_stats(player_id, match_id)
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_player_match_stats_player_id
                    ON public.player_match_stats(player_id)
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

        INSERT_PLAYER_STATS_SQL = """
            INSERT INTO player_match_stats (
                player_id,
                match_id,
                team_id,
                kills,
                deaths,
                assists,
                headshots,
                hs_percentage,
                is_win,
                stats,
                played_at,
                updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (player_id, match_id)
            DO UPDATE SET
                team_id       = EXCLUDED.team_id,
                kills         = EXCLUDED.kills,
                deaths        = EXCLUDED.deaths,
                assists       = EXCLUDED.assists,
                headshots     = EXCLUDED.headshots,
                hs_percentage = EXCLUDED.hs_percentage,
                is_win        = EXCLUDED.is_win,
                stats         = EXCLUDED.stats,
                played_at     = COALESCE(EXCLUDED.played_at, player_match_stats.played_at),
                updated_at    = now()
        """

        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                # 1) İşlenecek maçları çek
                cur.execute("""
                                        SELECT m.id, m.team_a_id, m.team_b_id, m.winner_id, m.scheduled_at, m.raw_data
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
                player_batch = []

                cur.execute("SELECT id, pandascore_id, nickname FROM players")
                player_rows = cur.fetchall()
                players_by_psid = {}
                players_by_name = {}
                for p_id, pandascore_id, nickname in player_rows:
                    if pandascore_id is not None:
                        players_by_psid[int(pandascore_id)] = p_id
                    normalized_name = _normalize_nickname(nickname)
                    if normalized_name and normalized_name not in players_by_name:
                        players_by_name[normalized_name] = p_id

                # 2) Python'da parse et, batch biriktir
                for match_id, team_a_id, team_b_id, winner_id, scheduled_at, raw_data in matches:
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

                        player_rows_for_match = self._extract_player_stat_rows(raw_data)
                        for stat_row in player_rows_for_match:
                            player_uuid = None
                            player_psid = stat_row.get('player_id')
                            if player_psid is not None:
                                try:
                                    player_uuid = players_by_psid.get(int(player_psid))
                                except (TypeError, ValueError):
                                    player_uuid = None

                            if not player_uuid:
                                normalized_name = _normalize_nickname(stat_row.get('player_name'))
                                if normalized_name:
                                    player_uuid = players_by_name.get(normalized_name)

                            if not player_uuid:
                                continue

                            kills = _to_float(stat_row.get('kills'))
                            deaths = _to_float(stat_row.get('deaths'))
                            assists = _to_float(stat_row.get('assists'))
                            headshots = _to_float(stat_row.get('headshots'))
                            hs_pct = _to_float(stat_row.get('hs_pct') or stat_row.get('hs_percentage'))

                            if hs_pct is None and kills and headshots is not None and kills > 0:
                                hs_pct = (headshots / kills) * 100

                            row_team_id = stat_row.get('team_id')
                            if row_team_id is not None:
                                try:
                                    row_team_id = int(row_team_id)
                                except (TypeError, ValueError):
                                    row_team_id = None

                            is_win = None
                            if winner_id is not None and row_team_id is not None:
                                is_win = int(winner_id) == int(row_team_id)

                            payload_stats = {
                                'source': stat_row.get('source') or 'raw_data',
                                'kda': _to_float(stat_row.get('kda')),
                                'win_rate': _to_float(stat_row.get('win_rate')),
                                'samples': stat_row.get('samples'),
                            }

                            player_batch.append((
                                player_uuid,
                                match_id,
                                row_team_id,
                                kills,
                                deaths,
                                assists,
                                headshots,
                                hs_pct,
                                is_win,
                                json.dumps(payload_stats),
                                scheduled_at,
                            ))

                        processed += 1

                        # 3) batch_size dolunca flush et
                        if len(batch) >= batch_size:
                            cur.executemany(INSERT_SQL, batch)
                            if player_batch:
                                cur.executemany(INSERT_PLAYER_STATS_SQL, player_batch)
                            conn.commit()
                            batch.clear()
                            player_batch.clear()

                    except Exception as e:
                        print(f"  ⚠️  match {match_id}: {e}")
                        continue

                # 4) Kalan satırları yaz
                if batch:
                    cur.executemany(INSERT_SQL, batch)
                if player_batch:
                    cur.executemany(INSERT_PLAYER_STATS_SQL, player_batch)
                if batch or player_batch:
                    conn.commit()

        print(f"\n📊 Sonuç: {processed} maç işlendi | {skipped} atlandı")
        return processed

    def _extract_player_stat_rows(self, raw_data):
        """Raw match payload içindeki player-level metrik satırlarını normalize eder."""
        source_enrichment = raw_data.get('source_enrichment') if isinstance(raw_data, dict) else {}
        rows = []

        if isinstance(source_enrichment, dict):
            for source_name, source_payload in source_enrichment.items():
                if not isinstance(source_payload, dict):
                    continue

                history = source_payload.get('match_history')
                if isinstance(history, list):
                    rows.extend(self._normalize_player_rows(history, source_name))

                detail = source_payload.get('match_detail')
                if isinstance(detail, dict):
                    detail_rows = detail.get('player_metrics')
                    if isinstance(detail_rows, list):
                        rows.extend(self._normalize_player_rows(detail_rows, source_name))

                direct_rows = source_payload.get('player_metrics')
                if isinstance(direct_rows, list):
                    rows.extend(self._normalize_player_rows(direct_rows, source_name))

        pandascore_rows = raw_data.get('pandascore_player_summaries') if isinstance(raw_data, dict) else None
        if isinstance(pandascore_rows, list):
            rows.extend(self._normalize_player_rows(pandascore_rows, 'pandascore'))

        return rows

    def _normalize_player_rows(self, items, source):
        normalized = []
        for item in items:
            if not isinstance(item, dict):
                continue

            player_obj = item.get('player') if isinstance(item.get('player'), dict) else {}
            normalized.append({
                'player_id': item.get('player_id') or item.get('id') or item.get('pandascore_id') or player_obj.get('id'),
                'player_name': item.get('player_name') or item.get('name') or item.get('nickname') or player_obj.get('name') or player_obj.get('nickname'),
                'team_id': item.get('team_id') or (item.get('team') or {}).get('id') if isinstance(item.get('team'), dict) else item.get('team_id'),
                'kills': item.get('kills') or item.get('total_kills') or item.get('frags'),
                'deaths': item.get('deaths') or item.get('total_deaths'),
                'assists': item.get('assists') or item.get('total_assists'),
                'headshots': item.get('headshots') or item.get('headshot_kills') or item.get('hs_kills'),
                'kda': item.get('kda'),
                'hs_pct': item.get('hs_pct') or item.get('hs_percentage') or item.get('headshot_percentage'),
                'win_rate': item.get('win_rate') or item.get('wr'),
                'samples': item.get('samples'),
                'source': source,
            })
        return normalized

    # ── Aktif Kadro Sync ───────────────────────────────────────────────────────

    def sync_all_active_rosters(self, days=90, batch_size=50, force=False):
        """
        Son `days` gün içinde maçı olan tüm takımların kadrolarını PandaScore'dan çeker.
        
        - force=False (varsayılan): oyuncusu zaten yüklü takımları atlar
        - force=True              : tüm takımları yeniden çeker (güncellik için)

        Args:
            days:       Kaç günlük geçmişe bakılacağı
            batch_size: Kaç takım sonra kısa bekleme yapılacağı (rate-limit)
            force:      True ise zaten yüklü kadroları da yenile

        Returns:
            dict: { teams_processed, players_upserted, teams_skipped, errors }
        """
        self.ensure_schema()

        # 1) Aktif takımları bul
        with Database.get_connection() as conn:
            with conn.cursor() as cur:
                if force:
                    cur.execute("""
                        SELECT DISTINCT t.id, t.name
                        FROM teams t
                        JOIN matches m
                          ON m.team_a_id = t.id OR m.team_b_id = t.id
                        WHERE m.scheduled_at >= NOW() - INTERVAL '%s days'
                        ORDER BY t.id
                    """, (days,))
                else:
                    cur.execute("""
                        SELECT DISTINCT t.id, t.name
                        FROM teams t
                        JOIN matches m
                          ON m.team_a_id = t.id OR m.team_b_id = t.id
                        WHERE m.scheduled_at >= NOW() - INTERVAL '%s days'
                          AND NOT EXISTS (
                              SELECT 1 FROM players p
                              WHERE p.team_pandascore_id = t.id
                          )
                        ORDER BY t.id
                    """, (days,))
                teams = cur.fetchall()

        if not teams:
            print("✅ Tüm aktif takım kadroları zaten yüklü.")
            return {'teams_processed': 0, 'players_upserted': 0,
                    'teams_skipped': 0, 'errors': 0}

        print(f"👤 {len(teams)} aktif takım için kadro çekiliyor "
              f"(son {days} gün, force={force})...")

        teams_processed = 0
        players_upserted = 0
        teams_skipped = 0
        errors = 0

        with Database.get_connection() as conn:
            for idx, (team_id, team_name) in enumerate(teams, 1):
                count = self._fetch_and_upsert_team_players(team_id, team_name, conn)

                if count is None:
                    errors += 1
                elif count > 0:
                    players_upserted += count
                    teams_processed  += 1
                    print(f"  [{idx}/{len(teams)}] ✅ {team_name}: "
                      f"{count} oyuncu")

                # Rate-limit koruması: her batch_size takımda bir kısa bekleme
                if idx % batch_size == 0:
                    print(f"  ⏸  {batch_size} takım işlendi, 2s bekleniyor...")
                    time.sleep(2)
                else:
                    time.sleep(0.15)

        print(f"\n📊 Kadro sync sonucu:")
        print(f"   Takım işlendi  : {teams_processed}")
        print(f"   Oyuncu upsert  : {players_upserted}")
        print(f"   Atlanan takım  : {teams_skipped}")
        print(f"   Hata           : {errors}")
        return {
            'teams_processed': teams_processed,
            'players_upserted': players_upserted,
            'teams_skipped': teams_skipped,
            'errors': errors,
        }

    # ── Ortak Yardımcı: Tek Takım İçin Oyuncu Çek+Upsert ──────────────────────

    def _fetch_and_upsert_team_players(self, team_id, team_name, conn):
        """
        PandaScore /teams/{team_id} endpoint'ini çağırır, oyuncuları players
        tablosuna upsert eder.

        Exponential backoff: 429 → 10s, 20s, 40s (max 3 deneme)
        image_url dahil tüm alanlar güncellenir.

        Args:
            team_id  : PandaScore takım ID'si (int)
            team_name: Log için takım adı (str)
            conn     : Aktif DB bağlantısı

        Returns:
            int | None  →  kaydedilen oyuncu sayısı; hata/boş ise None
        """
        url = f"{self.client.base_url}/teams/{team_id}"
        max_retries = 3

        for attempt in range(max_retries):
            try:
                resp = requests.get(
                    url,
                    params={'token': self.client.api_token},
                    timeout=20,
                )
            except requests.exceptions.RequestException as exc:
                print(f"    ⚠️  {team_name} (attempt {attempt+1}): {exc}")
                time.sleep(5 * (attempt + 1))
                continue

            if resp.status_code == 404:
                return None        # Takım artık mevcut değil

            if resp.status_code == 429:
                wait = 10 * (2 ** attempt)   # 10s → 20s → 40s
                print(f"    ⏳ Rate-limit — {wait}s bekleniyor "
                      f"(attempt {attempt+1}/{max_retries})...")
                time.sleep(wait)
                continue           # Tekrar dene

            if resp.status_code == 503:        # PandaScore bazen geçici kapanır
                wait = 15 * (attempt + 1)
                print(f"    ⚠️  503 Service Unavailable — {wait}s bekleniyor...")
                time.sleep(wait)
                continue

            if resp.status_code != 200:
                print(f"    ⚠️  {team_name}: API {resp.status_code}")
                return None

            # ── Başarılı yanıt ──────────────────────────────────────────────
            api_players = resp.json().get('players', [])
            if not api_players:
                return 0   # Boş kadro (bant dışı takım vb.)

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
                        p.get('name') or 'Unknown',
                        real_name,
                        p.get('role'),
                        p.get('image_url'),   # ← mutlaka çekiliyor
                        p['id'],
                        team_id,
                    ))
            conn.commit()
            return len(api_players)

        # Tüm denemeler başarısız
        print(f"    ❌ {team_name}: {max_retries} denemede başarılı olunamadı")
        return None

    # ── 1) Eksik Kadroları Tara (teams → players JOIN) ─────────────────────────

    def sync_missing_rosters(self, batch_size=50):
        """
        teams tablosunda olup players tablosunda HİÇ oyuncusu olmayan
        takımların tamamını işler — limit yok.

        Kullanım:
            python run.py --missing-rosters

        Returns:
            dict: teams_found, teams_processed, players_upserted, errors
        """
        self.ensure_schema()

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
                """)
                teams = cur.fetchall()

        if not teams:
            print("✅ Tüm takımların kadroları mevcut.")
            return {'teams_found': 0, 'teams_processed': 0,
                    'players_upserted': 0, 'errors': 0}

        print(f"🔍 Eksik kadro bulunan {len(teams)} takım işlenecek...")
        processed = 0
        upserted  = 0
        errors    = 0

        with Database.get_connection() as conn:
            for idx, (team_id, team_name) in enumerate(teams, 1):
                count = self._fetch_and_upsert_team_players(team_id, team_name, conn)

                if count is None:
                    errors += 1
                elif count > 0:
                    upserted  += count
                    processed += 1
                    print(f"  [{idx}/{len(teams)}] ✅ {team_name}: {count} oyuncu")
                else:
                    print(f"  [{idx}/{len(teams)}] ➖ {team_name}: boş kadro")

                # Batch arası kısa bekleme (rate-limit koruması)
                delay = 0.2 if (idx % batch_size != 0) else 2.0
                time.sleep(delay)

        print(f"\n📊 Eksik kadro sync:")
        print(f"   İşlenen takım  : {processed}")
        print(f"   Upsert oyuncu  : {upserted}")
        print(f"   Hata           : {errors}")
        return {
            'teams_found':     len(teams),
            'teams_processed': processed,
            'players_upserted': upserted,
            'errors':          errors,
        }

    # ── 2) Lig Bazlı Kadro Senkronizasyonu ────────────────────────────────────

    def sync_league_rosters(self, game_slugs=None, force=False):
        """
        Belirtilen oyunların ana liglerindeki TÜM takımları PandaScore'dan çeker
        ve players tablosuna upsert eder.

        PandaScore endpoint: GET /{game}/leagues/{league_id}/teams

        Args:
            game_slugs: ['valorant','csgo','lol'] veya None → hepsi
            force:      True → mevcut kayıtları da güncelle (transfer sonrası cadde)

        Returns:
            dict: leagues_scanned, teams_found, players_upserted, errors
        """
        self.ensure_schema()
        if game_slugs is None:
            game_slugs = list(MAJOR_LEAGUES.keys())

        leagues_scanned = 0
        teams_found     = 0
        players_upserted = 0
        errors          = 0

        # Her ligin takımlarını topla, de-duplicate et
        all_teams: dict[int, str] = {}   # team_id → team_name

        for slug in game_slugs:
            league_ids = MAJOR_LEAGUES.get(slug, [])
            print(f"\n🎮 {slug.upper()} — {len(league_ids)} lig taranıyor...")

            for lid in league_ids:
                page = 1
                while True:
                    url = f"{self.client.base_url}/{GAME_SLUGS[slug]}/leagues/{lid}/teams"
                    try:
                        resp = requests.get(
                            url,
                            params={
                                'token':    self.client.api_token,
                                'per_page': 50,
                                'page':     page,
                            },
                            timeout=20,
                        )
                    except requests.exceptions.RequestException as exc:
                        print(f"  ⚠️  lig {lid} p{page}: {exc}")
                        break

                    if resp.status_code == 404:
                        break   # Bu lig artık yok
                    if resp.status_code == 429:
                        print("  ⏳ Rate-limit — 15s bekleniyor...")
                        time.sleep(15)
                        continue
                    if resp.status_code != 200:
                        print(f"  ⚠️  lig {lid}: API {resp.status_code}")
                        break

                    data = resp.json()
                    if not data:
                        break   # Son sayfa

                    for team in data:
                        tid = team.get('id')
                        if tid:
                            all_teams[tid] = team.get('name', f'Team {tid}')

                    leagues_scanned += 1
                    if len(data) < 50:
                        break   # Son sayfa
                    page += 1
                    time.sleep(0.3)

        teams_found = len(all_teams)
        print(f"\n✅ {leagues_scanned} lig tarandı → {teams_found} benzersiz takım bulundu")

        if not all_teams:
            return {
                'leagues_scanned': leagues_scanned, 'teams_found': 0,
                'players_upserted': 0, 'errors': 0,
            }

        # force=False → zaten oyuncuları olan takımları atla
        if not force:
            with Database.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT DISTINCT team_pandascore_id
                        FROM players
                        WHERE team_pandascore_id IS NOT NULL
                    """)
                    loaded = {row[0] for row in cur.fetchall()}
            before = len(all_teams)
            all_teams = {k: v for k, v in all_teams.items() if k not in loaded}
            print(f"⏭  {before - len(all_teams)} takım atlandı (zaten yüklü), "
                  f"{len(all_teams)} takım işlenecek")

        print(f"\n👤 {len(all_teams)} takım için kadro çekiliyor...")
        with Database.get_connection() as conn:
            for idx, (team_id, team_name) in enumerate(all_teams.items(), 1):
                count = self._fetch_and_upsert_team_players(team_id, team_name, conn)

                if count is None:
                    errors += 1
                elif count > 0:
                    players_upserted += count
                    print(f"  [{idx}/{len(all_teams)}] ✅ {team_name}: {count} oyuncu")
                else:
                    print(f"  [{idx}/{len(all_teams)}] ➖ {team_name}: boş kadro")

                delay = 0.25 if (idx % 50 != 0) else 3.0
                time.sleep(delay)

        print(f"\n📊 Lig bazlı kadro sync:")
        print(f"   Lig tarandı    : {leagues_scanned}")
        print(f"   Takım bulundu  : {teams_found}")
        print(f"   Oyuncu upsert  : {players_upserted}")
        print(f"   Hata           : {errors}")
        return {
            'leagues_scanned':  leagues_scanned,
            'teams_found':      teams_found,
            'players_upserted': players_upserted,
            'errors':           errors,
        }
