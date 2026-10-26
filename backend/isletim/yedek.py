# -*- coding: utf-8 -*-
"""Haftalık yedeğin Python tarafı (.github/workflows/yedek.yml).

Asıl döküm pg_dump ile alınır (public şeması, şema + veri). Bu betik iki işi yapar:

  disa-aktar <klasor>   auth.users'tan hesap kimliklerini (id, e-posta, onay ve
                        oluşturma zamanı, sağlayıcı) auth_users.csv'ye yazar; şifre
                        hash'i ve oturum bilgisi ALINMAZ. pg_cron işlerini cron_isler.csv'ye,
                        canlı tabloların satır sayılarını sayim.json'a yazar (geri yükleme
                        kontrolü için).
  dogrula <klasor>      Boş bir Postgres'e geri yüklenmiş dökümü sayim.json ile
                        karşılaştırır (HEDEF_DB_URL). Sapma varsa çıkış kodu 1.

Repo PUBLIC ve Actions logları herkese açık: satır sayıları loga basılmaz,
yalnız tablo adı ve tamam/sapma yazılır. Sayılar şifreli arşivin içinde kalır.
"""
import csv
import json
import os
import sys

import psycopg
from dotenv import load_dotenv

load_dotenv()

# pg_dump'ta verisi alınmayan tablolar (yalnız şeması): kısa ömürlü, IP içerir.
VERISIZ = {'login_rpc_attempts', 'client_errors'}
# Döküm ile sayım arasında ETL yazabilir: canlı tablolarda küçük fark olağan.
TOLERANS = 0.01

AUTH_SORGU = """
    select id, email, email_confirmed_at, created_at,
           raw_app_meta_data->>'provider' as provider,
           raw_app_meta_data->'providers'  as providers
    from auth.users order by created_at
"""


CRON_SORGU = 'select jobname, schedule, command, active from cron.job order by jobid'


def csv_yaz(yol, cur):
    """Son sorgunun sonucunu başlıklı CSV'ye yazar; satır sayısını döner."""
    kolonlar = [d.name for d in cur.description]
    satirlar = cur.fetchall()
    with open(yol, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(kolonlar)
        for r in satirlar:
            w.writerow(json.dumps(v) if isinstance(v, (list, dict)) else v for v in r)
    return len(satirlar)


def tablolar(cur):
    cur.execute("""
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by 1
    """)
    return [r[0] for r in cur.fetchall()]


def disa_aktar(klasor):
    os.makedirs(klasor, exist_ok=True)
    with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=20) as db:
        cur = db.cursor()
        cur.execute('set transaction isolation level repeatable read, read only')

        sayim = {}
        for t in tablolar(cur):
            if t in VERISIZ:
                continue
            cur.execute(f'select count(*) from public."{t}"')
            sayim[t] = cur.fetchone()[0]

        cur.execute(AUTH_SORGU)
        sayim['__auth_users'] = csv_yaz(os.path.join(klasor, 'auth_users.csv'), cur)
        cur.execute(CRON_SORGU)
        csv_yaz(os.path.join(klasor, 'cron_isler.csv'), cur)

    with open(os.path.join(klasor, 'sayim.json'), 'w', encoding='utf-8') as f:
        json.dump(sayim, f, indent=1, ensure_ascii=False)
    print(f'disa-aktar: {len(sayim) - 1} tablo sayıldı, auth_users.csv ve cron_isler.csv yazıldı')
    return 0


def dogrula(klasor):
    with open(os.path.join(klasor, 'sayim.json'), encoding='utf-8') as f:
        sayim = json.load(f)
    beklenen_auth = sayim.pop('__auth_users')

    sapma = 0
    with psycopg.connect(os.environ['HEDEF_DB_URL'], connect_timeout=20) as db:
        cur = db.cursor()
        mevcut = set(tablolar(cur))
        for t, canli in sayim.items():
            if t not in mevcut:
                print(f'::error::{t}: geri yüklenen dökümde tablo yok')
                sapma += 1
                continue
            cur.execute(f'select count(*) from public."{t}"')
            yuklenen = cur.fetchone()[0]
            if canli == yuklenen or (canli and abs(yuklenen - canli) / canli <= TOLERANS):
                print(f'{t}: tamam')
            else:
                oran = f'%{100 * yuklenen / canli:.1f}' if canli else 'canlı tablo boş'
                print(f'::error::{t}: satır sayısı tutmuyor (geri yüklenen/canlı = {oran})')
                sapma += 1

        # auth_users.csv açılıyor mu, satır sayısı tutuyor mu
        cur.execute('create temp table auth_users_deneme (id uuid, email text, email_confirmed_at timestamptz,'
                    ' created_at timestamptz, provider text, providers jsonb)')
        with open(os.path.join(klasor, 'auth_users.csv'), encoding='utf-8') as f, \
                cur.copy('copy auth_users_deneme from stdin with (format csv, header true)') as cp:
            cp.write(f.read())
        cur.execute('select count(*) from auth_users_deneme')
        if cur.fetchone()[0] == beklenen_auth:
            print('auth_users.csv: tamam')
        else:
            print('::error::auth_users.csv: satır sayısı tutmuyor')
            sapma += 1

    print(f'dogrula: {len(sayim)} tablo, {sapma} sapma')
    return 1 if sapma else 0


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('disa-aktar', 'dogrula'):
        print(__doc__)
        sys.exit(2)
    sys.exit(disa_aktar(sys.argv[2]) if sys.argv[1] == 'disa-aktar' else dogrula(sys.argv[2]))
