"""
Roster Integrity Fix — HTTPS üzerinden çalışır (IPv6 gerektirmez)

psycopg (direct TCP) yerine supabase-py kullanır. Aynı mantık:
1. Son 90 günde maçı olan tüm aktif takımları bul
2. Her takım için PandaScore'dan güncel kadroyu çek
3. Kadrodaki oyuncuları upsert et
4. Artık kadroda olmayan oyuncuların team_pandascore_id'sini NULL'a çek

Kullanım:
    python roster_fix.py
    python roster_fix.py --days 30
    python roster_fix.py --limit 20  (ilk 20 takım)
"""
import argparse
import logging
import time
import uuid
import os
import requests
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger(__name__)

SUPABASE_URL       = os.getenv('SUPABASE_URL')
SUPABASE_KEY       = os.getenv('SUPABASE_SERVICE_KEY')
PANDASCORE_TOKEN   = os.getenv('PANDASCORE_TOKEN')
PANDASCORE_BASE    = 'https://api.pandascore.co'


def _player_uuid(pandascore_id: int) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ps-player-{pandascore_id}"))


def fetch_active_teams(sb, days: int) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    resp = sb.table('matches').select('team_a_id,team_b_id').gte('scheduled_at', since).execute()
    rows = resp.data or []

    seen = {}
    for row in rows:
        for col in ('team_a_id', 'team_b_id'):
            tid = row.get(col)
            if tid:
                seen[tid] = tid

    team_ids = list(seen.keys())
    if not team_ids:
        return []

    # Takım adlarını al
    teams_resp = sb.table('teams').select('id,name').in_('id', team_ids).execute()
    return teams_resp.data or []


def fetch_pandascore_roster(team_id: int) -> list[dict] | None:
    url = f"{PANDASCORE_BASE}/teams/{team_id}"
    for attempt in range(3):
        try:
            resp = requests.get(url, params={'token': PANDASCORE_TOKEN}, timeout=20)
        except requests.RequestException as e:
            log.warning(f"    ağ hatası (deneme {attempt+1}): {e}")
            time.sleep(5 * (attempt + 1))
            continue

        if resp.status_code == 404:
            return None
        if resp.status_code == 429:
            wait = 10 * (2 ** attempt)
            log.info(f"    rate-limit — {wait}s bekleniyor...")
            time.sleep(wait)
            continue
        if resp.status_code != 200:
            log.warning(f"    PandaScore {resp.status_code}")
            return None

        return resp.json().get('players', [])

    return None


def process_team(sb, team_id: int, team_name: str) -> dict:
    players = fetch_pandascore_roster(team_id)

    if players is None:
        return {'status': 'skip', 'upserted': 0, 'flushed': 0}
    if not players:
        return {'status': 'empty', 'upserted': 0, 'flushed': 0}

    current_ps_ids = [p['id'] for p in players]

    # Upsert: pandascore_id conflict → güncelle
    rows = []
    for p in players:
        parts     = [p.get('first_name', ''), p.get('last_name', '')]
        real_name = ' '.join(x for x in parts if x).strip() or None
        rows.append({
            'id':                 _player_uuid(p['id']),
            'nickname':           p.get('name') or 'Unknown',
            'real_name':          real_name,
            'role':               p.get('role'),
            'image_url':          p.get('image_url'),
            'pandascore_id':      p['id'],
            'team_pandascore_id': team_id,
        })

    # id = UUID5(pandascore_id) → deterministik, primary key üzerinden conflict
    sb.table('players').upsert(rows, on_conflict='id').execute()

    # Flush: Bu takımda kayıtlı ama güncel kadroda olmayan oyuncuları serbest bırak
    flush_resp = (
        sb.table('players')
          .update({'team_pandascore_id': None})
          .eq('team_pandascore_id', team_id)
          .not_.in_('pandascore_id', current_ps_ids)
          .execute()
    )
    flushed = len(flush_resp.data) if flush_resp.data else 0

    return {'status': 'ok', 'upserted': len(rows), 'flushed': flushed}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--days',  type=int, default=90, help='Kaç günlük maç geçmişi')
    parser.add_argument('--limit', type=int, default=0,  help='Max takım sayısı (0=tümü)')
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL veya SUPABASE_SERVICE_KEY eksik (.env kontrol et)")
    if not PANDASCORE_TOKEN:
        raise RuntimeError("PANDASCORE_TOKEN eksik (.env kontrol et)")

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    log.info(f"Supabase bağlandı: {SUPABASE_URL}")

    log.info(f"Son {args.days} günde aktif takımlar alınıyor...")
    teams = fetch_active_teams(sb, args.days)
    if not teams:
        log.info("Aktif takım bulunamadı.")
        return

    if args.limit > 0:
        teams = teams[:args.limit]

    log.info(f"{len(teams)} takım işlenecek\n")

    total_upserted = 0
    total_flushed  = 0
    total_errors   = 0

    for idx, team in enumerate(teams, 1):
        team_id   = team['id']
        team_name = team.get('name', f'Team {team_id}')

        try:
            result = process_team(sb, team_id, team_name)
            if result['status'] == 'ok':
                total_upserted += result['upserted']
                total_flushed  += result['flushed']
                flush_note = f" | {result['flushed']} serbest bırakıldı" if result['flushed'] > 0 else ""
                log.info(f"[{idx}/{len(teams)}] ✅ {team_name}: {result['upserted']} oyuncu{flush_note}")
            elif result['status'] == 'empty':
                log.info(f"[{idx}/{len(teams)}] ➖ {team_name}: boş kadro")
            else:
                log.info(f"[{idx}/{len(teams)}] ⏭  {team_name}: atlandı (404)")
        except Exception as e:
            log.warning(f"[{idx}/{len(teams)}] ❌ {team_name}: {e}")
            total_errors += 1

        time.sleep(0.15)

    log.info(f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Roster Fix Tamamlandı
 Takım işlendi  : {len(teams) - total_errors}
 Oyuncu upsert  : {total_upserted}
 Serbest bırakılan: {total_flushed}
 Hata           : {total_errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━""")


if __name__ == '__main__':
    main()
