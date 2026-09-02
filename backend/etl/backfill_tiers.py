# -*- coding: utf-8 -*-
"""Tier'i bos kalan turnuvalari PandaScore'dan doldurur (tek seferlik).

Neden gerekli: _normalize_tier onceden yalnizca S/A/B/C kabul ediyordu ve
PandaScore maclarinin ~%73'u D-tier oldugu icin bunlarin hepsi NULL
kaydedilmisti. Normalizer duzeltildi ama GECMIS satirlar bos kaldi.

Kullanim:
    python -m etl.backfill_tiers            # kuru calisma (yazmaz)
    python -m etl.backfill_tiers --uygula   # veritabanina yazar
"""
import os, sys, time
import psycopg, requests
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.environ['PANDASCORE_TOKEN']
BASLIK = {'Authorization': f'Bearer {TOKEN}'}
UYGULA = '--uygula' in sys.argv

# etl.data_cleaner ile AYNI kural kullanilmali; kopyalamak yerine ice aktar.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from etl.data_cleaner import DataCleaner


def panda_tierleri(oyun_slug, sayfa_siniri=40):
    """Bir oyunun tum turnuvalarini gezip {id: tier} dondurur."""
    esleme = {}
    for sayfa in range(1, sayfa_siniri + 1):
        r = requests.get(
            f'https://api.pandascore.co/{oyun_slug}/tournaments',
            headers=BASLIK, params={'per_page': 100, 'page': sayfa}, timeout=30)
        if r.status_code != 200:
            print(f'  ! {oyun_slug} sayfa {sayfa}: HTTP {r.status_code}'); break
        veri = r.json()
        if not veri:
            break
        for t in veri:
            tier = DataCleaner._normalize_tier(t.get('tier'))
            if tier:
                esleme[t['id']] = tier
        time.sleep(0.35)          # ucretsiz katman nezaketi
    return esleme


def main():
    with psycopg.connect(os.environ['DATABASE_URL']) as cn, cn.cursor() as c:
        c.execute("SELECT COUNT(*) FROM tournaments WHERE COALESCE(tier,'')=''")
        bos_once = c.fetchone()[0]
        c.execute("""SELECT g.slug, COUNT(*) FROM tournaments t
                     JOIN games g ON g.id = t.game_id
                     WHERE COALESCE(t.tier,'')='' GROUP BY 1 ORDER BY 2 DESC""")
        dagilim = c.fetchall()

        print(f'Tier bos turnuva: {bos_once}')
        for slug, n in dagilim:
            print(f'   {slug:<22} {n}')
        print()

        toplam_guncel = 0
        for slug, _ in dagilim:
            print(f'{slug}: PandaScore turnuvalari taraniyor...')
            esleme = panda_tierleri(slug)
            print(f'  {len(esleme)} turnuvada tier bulundu')
            if not esleme:
                continue
            c.execute("""SELECT t.id FROM tournaments t
                         JOIN games g ON g.id=t.game_id
                         WHERE COALESCE(t.tier,'')='' AND g.slug=%s""", (slug,))
            bizim = [r[0] for r in c.fetchall()]
            eslesen = [(tid, esleme[tid]) for tid in bizim if tid in esleme]
            print(f'  bizdeki {len(bizim)} bos kayittan {len(eslesen)} tanesi eslesti')
            if UYGULA and eslesen:
                c.executemany("UPDATE tournaments SET tier=%s WHERE id=%s",
                              [(tier, tid) for tid, tier in eslesen])
                cn.commit()
                toplam_guncel += len(eslesen)
            print()

        if UYGULA:
            c.execute("SELECT COUNT(*) FROM tournaments WHERE COALESCE(tier,'')=''")
            print(f'YAZILDI: {toplam_guncel} satir. Kalan bos: {c.fetchone()[0]} (onceki {bos_once})')
        else:
            print('KURU CALISMA - hicbir sey yazilmadi. Yazmak icin: --uygula')


if __name__ == '__main__':
    main()
