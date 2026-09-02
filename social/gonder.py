# -*- coding: utf-8 -*-
"""Üretilen videoları Resend ile e-posta ekinde gönderir.

Neden e-posta: kurucu paylaşımı telefondan yapıyor. GitHub artifact'i
telefonda indirmek zahmetli; mail eki galeriye tek dokunuşla kaydediliyor.
Artifact yine de yükleniyor (yedek).
"""
import base64, json, os, sys, urllib.request

ANAHTAR = os.environ.get('RESEND_API_KEY')
ALICI   = os.environ.get('RADAR_ALICI', 'iletisim@fextesports.com')
KLASOR  = sys.argv[1] if len(sys.argv) > 1 else 'cikti'
GUN     = sys.argv[2] if len(sys.argv) > 2 else ''

MB = 1024 * 1024
EK_SINIRI = 20 * MB          # Resend toplam ek sınırı ~40MB; yarısında duruyoruz

def main():
    if not os.path.isdir(KLASOR):
        print('cikti klasoru yok, gonderilecek video bulunamadi'); return 0
    dosyalar = sorted(f for f in os.listdir(KLASOR) if f.endswith('.mp4'))
    if not dosyalar:
        print('video yok - bugun S/A mac olmamis olabilir, mail gonderilmedi'); return 0
    if not ANAHTAR:
        print('::warning::RESEND_API_KEY yok - videolar yalnizca artifact olarak kaldi'); return 0

    ekler, toplam, atlanan = [], 0, []
    for ad in dosyalar:
        p = os.path.join(KLASOR, ad)
        b = os.path.getsize(p)
        if toplam + b > EK_SINIRI:
            atlanan.append(ad); continue
        with open(p, 'rb') as f:
            ekler.append({'filename': ad, 'content': base64.b64encode(f.read()).decode()})
        toplam += b

    satirlar = [f'{GUN} icin {len(dosyalar)} video uretildi.', '']
    for ad in dosyalar:
        kb = os.path.getsize(os.path.join(KLASOR, ad)) // 1024
        isaret = ' (ekte degil - boyut)' if ad in atlanan else ''
        satirlar.append(f'  - {ad}  {kb} KB{isaret}')
    satirlar += ['',
        'Paylasmadan once: videoyu galeriye kaydet, Instagram/TikTok\'a yukle,',
        'muzigi UYGULAMA ICINDEN sec (lisansli + erisimi artiriyor).', '']

    # Hazir aciklama metni: her gun ayni metni elle yazmak paylasimi oldurur.
    # Kanca GUNUN VERISINDEN uretiliyor (radar.py -> paylasim_metni):
    # once Turk takimi, sonra en emin tahmin, sonra en dengeli mac.
    for ad in dosyalar:
        metin_yolu = os.path.join(KLASOR, os.path.splitext(ad)[0] + '.txt')
        if not os.path.exists(metin_yolu):
            continue
        with open(metin_yolu, encoding='utf-8') as f:
            satirlar += ['-' * 52, f'ACIKLAMA - {ad}', '-' * 52, '', f.read().rstrip(), '']

    if atlanan:
        satirlar.append('Eke sigmayanlar Actions artifact\'inden indirilebilir.')

    veri = json.dumps({
        'from': 'feXt Radar <noreply@fextesports.com>',
        'to': [ALICI],
        'subject': f'[feXt] {GUN} mac radari - {len(dosyalar)} video',
        'text': '\n'.join(satirlar),
        'attachments': ekler,
    }).encode()

    # DIKKAT - User-Agent zorunlu: Resend API'sinin onunde Cloudflare var ve
    # urllib'in varsayilan "Python-urllib/3.13" imzasini engelliyor
    # (2026-09-02: HTTP 403, "error code: 1010"). ETL alarmlari curl ile
    # gittigi icin bu sorunu yasamiyordu.
    req = urllib.request.Request('https://api.resend.com/emails', data=veri, method='POST',
        headers={'Authorization': f'Bearer {ANAHTAR}',
                 'Content-Type': 'application/json',
                 'User-Agent': 'feXt-Radar/1.0 (+https://fextesports.com)'})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            print('mail gonderildi:', r.read().decode()[:160])
            return 0
    except Exception as e:
        detay = getattr(e, 'read', lambda: b'')()[:300]
        # Sessiz uyari DEGIL, gercek hata: mail gitmezse kurucu videoyu
        # gormez. Artifact yedegi zaten bu adimdan ONCE yuklendi.
        print(f'::error::mail gonderilemedi: {e} {detay!r}')
        return 1

sys.exit(main())
