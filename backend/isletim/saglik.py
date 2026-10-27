# -*- coding: utf-8 -*-
"""Günlük sağlık raporu: bir şey bozulduysa kurucu 24 saat içinde e-postayla duyar.

Kontroller veritabanından (DATABASE_URL) ve GitHub Actions API'sinden okunur.
Eşik aşılırsa konu "SORUN" olur ve e-posta her gün gider; sorun yoksa e-posta
yalnız Pazartesi (TSİ) gider ("her şey yolunda"), böylece sessizlik de bir sinyaldir.

Repo PUBLIC ve Actions logları herkese açık: rapor gövdesi (sayılar, hata metinleri)
yalnız e-postaya yazılır, stdout'a yalnız kontrol adları ve sorun sayısı basılır.

Kullanım (cd backend):
    python isletim/saglik.py            # gerekirse e-posta gönderir
    python isletim/saglik.py --her-zaman # sorun olmasa da gönderir (elle deneme)
    python isletim/saglik.py --kuru      # göndermez, raporu ekrana basar (yalnız yerelde)
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import psycopg
from dotenv import load_dotenv

load_dotenv()

TSI = timezone(timedelta(hours=3))
ALICI = os.environ.get('SAGLIK_ALICI', 'iletisim@fextesports.com')
REPO = os.environ.get('GITHUB_REPOSITORY', '')
GH_TOKEN = os.environ.get('GITHUB_TOKEN', '')

# ── Eşikler (26 Ekim 2026 ölçümüne göre; olağan değerler yorumda) ───────────
CANLI_SON_BASARI_DK = 10        # pg_cron dakikada bir koşar
CANLI_HATA_24S = 3              # 30 günde 0 hata görüldü
PANDASCORE_HATA_ORANI = 0.2     # son 6 saatteki canlı isteklerde 200 dışı yanıt payı
TAKILI_CANLI_SAAT = 8           # 'running' kalıp bitmeyen maç
GECIKMIS_BASLAMADI = 3          # 12 saati geçip hâlâ 'not_started' olan maç sayısı
YENI_MAC_SAAT = 24              # son yeni maç kaydı (Python ETL ekler)
SYNC_MATCHES_SAAT = 12          # saatlik iş fiilen 3-6 saatte bir koşuyor
TAHMINSIZ_MAC = 5               # 48 saat içindeki tahminsiz maç
HABER_SAAT = 48                 # en uzun olağan boşluk ~47 saat
ISTEMCI_HATA_24S = 25           # CSP hariç
DB_BOYUT_MB = 425               # ücretsiz plan sınırı 500 MB
YEDEK_GUN = 8                   # haftalık yedek
ANONIM_YENI_24S = 500           # 24 saatte açılan anonim oturum (Faz 6, ölçüm yok; bot şüphesi)
BILDIRIM_BASARISIZ_24S = 10     # 3 denemede gidemeyen bildirim


class Rapor:
    def __init__(self):
        self.sorunlar = []
        self.satirlar = []

    def bolum(self, baslik):
        self.satirlar.append(f'\n== {baslik} ==')

    def bilgi(self, metin):
        self.satirlar.append(f'  {metin}')

    def sorun(self, metin):
        self.sorunlar.append(metin)
        self.satirlar.append(f'  !! SORUN: {metin}')


def sure(td):
    if td is None:
        return 'hiç'
    dk = int(td.total_seconds() // 60)
    if dk < 120:
        return f'{dk} dk önce'
    if dk < 48 * 60:
        return f'{dk // 60} sa önce'
    return f'{dk // 1440} gün önce'


def kontrol(rapor, ad, fn, *args):
    """Bir kontrol patlarsa rapor susmaz: hata SORUN olarak yazılır, diğerleri koşar."""
    print(f'kontrol: {ad}')
    rapor.bolum(ad)
    try:
        fn(rapor, *args)
    except Exception as e:
        print(f'::warning::{ad} kontrolü çalışmadı: {type(e).__name__}')
        rapor.sorun(f'{ad} kontrolü çalışmadı: {type(e).__name__}: {e}')
        if args and isinstance(args[0], psycopg.Connection):
            args[0].rollback()


# ── Veritabanı kontrolleri ────────────────────────────────────────────────────

def canli_senkron(rapor, db):
    cur = db.cursor()
    cur.execute("select active from cron.job where jobname = 'canli-senkron'")
    satir = cur.fetchone()
    if not satir:
        rapor.sorun('pg_cron işi canli-senkron yok')
        return
    if not satir[0]:
        rapor.sorun('pg_cron işi canli-senkron kapalı (active = false)')

    cur.execute("""
        select count(*) filter (where d.status = 'succeeded'),
               count(*) filter (where d.status = 'failed'),
               now() - max(d.end_time) filter (where d.status = 'succeeded'),
               (array_agg(d.return_message order by d.start_time desc)
                  filter (where d.status = 'failed'))[1]
        from cron.job_run_details d join cron.job j using (jobid)
        where j.jobname = 'canli-senkron' and d.start_time > now() - interval '24 hours'
    """)
    basarili, hatali, son, son_hata = cur.fetchone()
    rapor.bilgi(f'son 24 saat: {basarili} başarılı, {hatali} hatalı koşu; son başarı {sure(son)}')
    if hatali >= CANLI_HATA_24S:
        rapor.sorun(f'canli-senkron 24 saatte {hatali} kez hata verdi; son hata: {(son_hata or "")[:300]}')
    elif hatali:
        rapor.bilgi(f'son hata: {(son_hata or "")[:300]}')
    if son is None or son > timedelta(minutes=CANLI_SON_BASARI_DK):
        rapor.sorun(f'canli-senkron {CANLI_SON_BASARI_DK} dakikadır başarılı koşmadı (son: {sure(son)})')

    # pg_net yanıtları 6 saat tutar: PandaScore'a giden canlı isteklerin sonucu.
    cur.execute("""
        select count(*), count(*) filter (where r.status_code is distinct from 200)
        from canli.istek i left join net._http_response r on r.id = i.request_id
        where i.olusma > now() - interval '6 hours' and i.islendi
    """)
    toplam, kotu = cur.fetchone()
    rapor.bilgi(f'son 6 saatte PandaScore canlı isteği: {toplam}, 200 dışı: {kotu}')
    if toplam >= 5 and kotu / toplam > PANDASCORE_HATA_ORANI:
        rapor.sorun(f'canlı isteklerin {kotu}/{toplam} tanesi 200 dışı döndü (token, kota ya da PandaScore arızası)')


def mac_verisi(rapor, db):
    cur = db.cursor()
    cur.execute("select now() - max(created_at), now() - max(last_synced_at) from matches")
    yeni, senkron = cur.fetchone()
    rapor.bilgi(f'son yeni maç kaydı {sure(yeni)}, son maç güncellemesi {sure(senkron)}')
    if yeni is None or yeni > timedelta(hours=YENI_MAC_SAAT):
        rapor.sorun(f'{YENI_MAC_SAAT} saattir yeni maç eklenmedi (sync-matches çalışmıyor olabilir)')

    cur.execute("""
        select count(*) filter (where status = 'running'
                                  and coalesce(begin_at, scheduled_at) < now() - make_interval(hours => %s)),
               count(*) filter (where status = 'not_started'
                                  and scheduled_at between now() - interval '7 days' and now() - interval '12 hours'),
               count(*) filter (where status = 'not_started'
                                  and scheduled_at between now() and now() + interval '48 hours'),
               count(*) filter (where status = 'not_started' and prediction_team_a is null
                                  and scheduled_at between now() and now() + interval '48 hours')
        from matches
    """, (TAKILI_CANLI_SAAT,))
    takili, gecikmis, yaklasan, tahminsiz = cur.fetchone()
    rapor.bilgi(f'{TAKILI_CANLI_SAAT} saattir canlı görünen: {takili}; 12 saati geçip başlamadı görünen: {gecikmis}')
    rapor.bilgi(f'48 saat içindeki maç: {yaklasan}, tahminsiz: {tahminsiz}')
    if takili:
        rapor.sorun(f'{takili} maç {TAKILI_CANLI_SAAT} saattir "canlı" görünüyor (--fix-orphans koşmuyor olabilir)')
    if gecikmis > GECIKMIS_BASLAMADI:
        rapor.sorun(f'{gecikmis} maç saati 12 saati geçtiği halde "başlamadı" görünüyor')
    if tahminsiz > TAHMINSIZ_MAC:
        rapor.sorun(f'48 saat içindeki {tahminsiz} maçta Fextopus tahmini yok')


def haberler(rapor, db):
    cur = db.cursor()
    cur.execute("""
        select now() - max(created_at),
               count(*) filter (where created_at > now() - interval '24 hours')
        from news_articles
    """)
    son, gunluk = cur.fetchone()
    rapor.bilgi(f'son haber {sure(son)}, son 24 saatte {gunluk} haber')
    if son is None or son > timedelta(hours=HABER_SAAT):
        rapor.sorun(f'{HABER_SAAT} saattir haber üretilmedi')


def istemci_hatalari(rapor, db):
    cur = db.cursor()
    cur.execute("""
        select tur, count(*) from client_errors
        where created_at > now() - interval '24 hours' group by tur order by tur
    """)
    sayilar = dict(cur.fetchall())
    hata = sum(v for k, v in sayilar.items() if k != 'csp')
    rapor.bilgi('son 24 saat: ' + (', '.join(f'{k} {v}' for k, v in sayilar.items()) or 'hata yok'))
    if hata > ISTEMCI_HATA_24S:
        rapor.sorun(f'tarayıcıda 24 saatte {hata} hata kaydı')

    cur.execute("""
        select tur, left(mesaj, 160), count(*), max(yol), max(surum)
        from client_errors where created_at > now() - interval '24 hours'
        group by tur, left(mesaj, 160) order by count(*) desc limit 8
    """)
    for tur, mesaj, adet, yol, surum in cur.fetchall():
        rapor.bilgi(f'{adet}x [{tur}] {mesaj}  (ör. {yol}, sürüm {surum})')


def hesaplar_bildirimler(rapor, db):
    """Faz 6: hesap silme kalıntısı, anonim oturumlar, push kuyruğu, ilgili pg_cron işleri."""
    cur = db.cursor()
    cur.execute("select public.hesap_kalinti_sayisi()")
    kalinti = cur.fetchone()[0]
    rapor.bilgi(f'silinmiş hesaptan kalan satır/dosya: {kalinti}')
    if kalinti:
        rapor.sorun(f'silinmiş hesaplardan {kalinti} satır/dosya kalmış (hesap silme eksik çalışıyor)')

    cur.execute("""
        select count(*) filter (where is_anonymous),
               count(*) filter (where is_anonymous and created_at > now() - interval '24 hours')
        from auth.users
    """)
    anonim, anonim_yeni = cur.fetchone()
    rapor.bilgi(f'anonim oturum: {anonim} (son 24 saatte {anonim_yeni} yeni)')
    if anonim_yeni > ANONIM_YENI_24S:
        rapor.sorun(f'24 saatte {anonim_yeni} anonim oturum açıldı (bot olabilir; Turnstile ayarına bak)')

    cur.execute("select bekleyen, basarisiz, gonderilen from bildirim.saglik()")
    bekleyen, basarisiz, gonderilen = cur.fetchone()
    rapor.bilgi(f'push (24 saat): {gonderilen} gönderildi, {basarisiz} başarısız, {bekleyen} bekliyor')
    if bekleyen:
        rapor.sorun(f'{bekleyen} bildirim 10 dakikadan uzun süredir bekliyor (send-push ya da FCM ayarı)')
    if basarisiz > BILDIRIM_BASARISIZ_24S:
        rapor.sorun(f'24 saatte {basarisiz} bildirim 3 denemede gönderilemedi')

    cur.execute("""
        select j.jobname, j.active, count(d.*) filter (where d.status = 'failed'),
               max(d.end_time) filter (where d.status = 'succeeded')
        from cron.job j
        left join cron.job_run_details d on d.jobid = j.jobid and d.start_time > now() - interval '25 hours'
        where j.jobname in ('anonim-temizle', 'bildirim-yakinda', 'bildirim-gonder', 'bildirim-temizle')
        group by j.jobname, j.active order by j.jobname
    """)
    satirlar = cur.fetchall()
    eksik = {'anonim-temizle', 'bildirim-yakinda', 'bildirim-gonder', 'bildirim-temizle'} - {r[0] for r in satirlar}
    for ad in sorted(eksik):
        rapor.sorun(f'pg_cron işi {ad} yok')
    for ad, aktif, hatali, son in satirlar:
        rapor.bilgi(f'{ad}: {"açık" if aktif else "KAPALI"}, 24 saatte {hatali} hata, son başarı {son or "yok"}')
        if not aktif:
            rapor.sorun(f'pg_cron işi {ad} kapalı')
        if hatali:
            rapor.sorun(f'pg_cron işi {ad} 24 saatte {hatali} kez hata verdi')


def veritabani(rapor, db):
    cur = db.cursor()
    cur.execute("select pg_database_size(current_database()) / 1048576")
    mb = int(cur.fetchone()[0])
    rapor.bilgi(f'veritabanı boyutu: {mb} MB (ücretsiz plan sınırı 500 MB)')
    if mb > DB_BOYUT_MB:
        rapor.sorun(f'veritabanı {mb} MB; 500 MB sınırına yaklaşıyor (salt okuma moduna düşebilir)')


# ── GitHub Actions kontrolleri ───────────────────────────────────────────────

def gh(yol):
    req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/{yol}', headers={
        'Authorization': f'Bearer {GH_TOKEN}',
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'feXt-Saglik/1.0',
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def is_akislari(rapor):
    if not (REPO and GH_TOKEN):
        rapor.bilgi('GITHUB_TOKEN yok, atlandı (yalnız Actions içinde çalışır)')
        return
    simdi = datetime.now(timezone.utc)

    def son_basari(dosya):
        try:
            runs = gh(f'actions/workflows/{dosya}/runs?status=success&per_page=1')['workflow_runs']
        except urllib.error.HTTPError as e:
            if e.code == 404:       # iş akışı dosyası yok
                return None
            raise
        if not runs:
            return None
        return simdi - datetime.fromisoformat(runs[0]['updated_at'].replace('Z', '+00:00'))

    sync = son_basari('sync-matches.yml')
    rapor.bilgi(f'sync-matches son başarılı koşu: {sure(sync)}')
    if sync is None or sync > timedelta(hours=SYNC_MATCHES_SAAT):
        rapor.sorun(f'sync-matches {SYNC_MATCHES_SAAT} saattir başarılı koşmadı (son: {sure(sync)})')

    yedek = son_basari('yedek.yml')
    rapor.bilgi(f'haftalık yedek son başarılı koşu: {sure(yedek)}')
    if yedek is None or yedek > timedelta(days=YEDEK_GUN):
        rapor.sorun(f'{YEDEK_GUN} gündür başarılı yedek alınmadı (son: {sure(yedek)})')

    dun = (simdi - timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ')
    runs = gh(f'actions/runs?created=%3E%3D{dun}&per_page=100')['workflow_runs']
    kotu = {}
    for r in runs:
        if r.get('conclusion') in ('failure', 'timed_out', 'startup_failure'):
            kotu[r['name']] = kotu.get(r['name'], 0) + 1
    rapor.bilgi(f'son 24 saatte {len(runs)} koşu, başarısız: '
                + (', '.join(f'{k} ({v})' for k, v in kotu.items()) or 'yok'))


# ── E-posta ────────────────────────────────────────────────────────────────

def gonder(konu, govde):
    anahtar = os.environ.get('RESEND_API_KEY')
    if not anahtar:
        print('::error::RESEND_API_KEY yok, sağlık e-postası gönderilemedi')
        return 1
    veri = json.dumps({
        'from': 'feXt Sağlık <noreply@fextesports.com>',
        'to': [ALICI],
        'subject': konu,
        'text': govde,
    }).encode()
    # User-Agent zorunlu: Resend'in önündeki Cloudflare urllib'in varsayılanını engelliyor (social/gonder.py).
    req = urllib.request.Request('https://api.resend.com/emails', data=veri, method='POST', headers={
        'Authorization': f'Bearer {anahtar}',
        'Content-Type': 'application/json',
        'User-Agent': 'feXt-Saglik/1.0 (+https://fextesports.com)',
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print('sağlık e-postası gönderildi:', r.status)
            return 0
    except Exception as e:
        detay = getattr(e, 'read', lambda: b'')()[:300]
        print(f'::error::sağlık e-postası gönderilemedi: {e} {detay!r}')
        return 1


def main():
    p = argparse.ArgumentParser(description='Günlük sağlık raporu')
    p.add_argument('--her-zaman', action='store_true', help='sorun olmasa da e-posta gönder')
    p.add_argument('--kuru', action='store_true', help='gönderme, raporu ekrana bas (yalnız yerelde)')
    args = p.parse_args()

    rapor = Rapor()
    with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=20) as db:
        kontrol(rapor, 'Canlı skor (pg_cron)', canli_senkron, db)
        kontrol(rapor, 'Maç verisi ve tahminler', mac_verisi, db)
        kontrol(rapor, 'Haberler', haberler, db)
        kontrol(rapor, 'Tarayıcı hataları', istemci_hatalari, db)
        kontrol(rapor, 'Hesaplar ve bildirimler', hesaplar_bildirimler, db)
        kontrol(rapor, 'Veritabanı', veritabani, db)
    kontrol(rapor, 'GitHub Actions', is_akislari)

    simdi = datetime.now(TSI)
    if rapor.sorunlar:
        ilk = rapor.sorunlar[0][:80]
        ek = f' (+{len(rapor.sorunlar) - 1})' if len(rapor.sorunlar) > 1 else ''
        konu = f'[feXt Sağlık] SORUN: {ilk}{ek}'
        ozet = 'Sorunlar:\n' + '\n'.join(f'- {s}' for s in rapor.sorunlar) + '\n'
    else:
        konu = f'[feXt Sağlık] Her şey yolunda ({simdi:%d.%m.%Y})'
        ozet = 'Eşik aşan bir şey yok.\n'
    govde = (f'{ozet}\nRapor zamanı: {simdi:%d.%m.%Y %H:%M} TSİ\n'
             + '\n'.join(rapor.satirlar)
             + '\n\nEşikler: backend/isletim/saglik.py başındaki sabitler.\n')

    print(f'{len(rapor.sorunlar)} sorun')
    if args.kuru:
        print(konu, govde, sep='\n')
        return 0
    if rapor.sorunlar or args.her_zaman or simdi.weekday() == 0:
        return gonder(konu, govde)
    print('sorun yok, bugün e-posta günü değil')
    return 0


if __name__ == '__main__':
    sys.exit(main())
