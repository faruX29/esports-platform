# -*- coding: utf-8 -*-
"""VCT Champions 2026 — "Fextopus grupları hesapladı" videosu (1080x1920, ~20 sn).

Kullanım:  python champions.py            → cikti/champions-2026-gruplar.mp4 (+ .txt)

Radar videosundan BİLEREK farklı (kurucu isteği, 22 Eyl): tek tek maç değil,
grubun tamamı. Sahneler:
  1. Açılış   — "Fextopus 16 takımın playoff ihtimalini hesapladı"
  2-5. Gruplar — GSL ağacı (açılış maçları + Fextopus oranları → kazananlar /
                 elenme / belirleyici maç) ve 4 takımın playoff'a çıkma ihtimali,
                 "playoff çizgisi" ile
  6. Kapanış  — Türk takımının (FUT) playoff ihtimali + site adresi

Olasılıklar gsl.py'de TAM hesaplanır (32 sonuç), maç olasılıkları Fextopus Elo'su.
Radarın yardımcıları (logo, yazı tipleri, alt bilgi) yeniden kullanılır.
"""
import os, sys, subprocess, logging
from datetime import timedelta
from PIL import Image, ImageDraw, ImageFilter
import psycopg

import radar
from radar import (W, H, FPS, BG, INK, MUTED, FAINT, MOR, GRI, YOL, AY,
                   _f, sol, ort, logo, f_tag, f_site, MARKA, ffmpeg_yolu, _turk_mu)
from gsl import gsl_olasiliklari

ETKINLIK = 'Champions 2026'
KIRMIZI = (255, 70, 85)
KOYU_K = (58, 18, 28)
KUTU = (22, 27, 40)
CIZGI = (70, 78, 98)

# Sahne süreleri (sn)
S_GIRIS, S_GRUP, S_KAPANIS = 2.6, 3.8, 3.0

def _elo():
    """Fextopus Elo'su (backend/etl/predict.py) — her iki takım için olasılık verir."""
    arka = os.path.join(radar.BASE, '..', 'backend')
    sys.path.insert(0, arka)
    logging.disable(logging.INFO)
    from etl.predict import MatchPredictor
    mp = MatchPredictor()
    mp.build_elo_ratings()
    logging.disable(logging.NOTSET)
    return mp.win_probability

def veri():
    sql = """
      SELECT t.name, m.scheduled_at, ta.id, ta.name, ta.acronym, ta.logo_url,
             tb.id, tb.name, tb.acronym, tb.logo_url
      FROM matches m
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN teams ta ON ta.id = m.team_a_id
      JOIN teams tb ON tb.id = m.team_b_id
      WHERE t.event_name = %s AND t.name ILIKE 'Group%%'
      ORDER BY m.scheduled_at
    """
    with psycopg.connect(os.environ['DATABASE_URL']) as cn, cn.cursor() as c:
        c.execute(sql, (ETKINLIK,))
        satir = c.fetchall()
    ham = {}
    for r in satir:
        g = ham.setdefault(r[0], [])
        if len(g) < 2:
            g.append({'saat': r[1],
                      'a': {'id': r[2], 'ad': r[3], 'ac': r[4], 'logo': r[5]},
                      'b': {'id': r[6], 'ad': r[7], 'ac': r[8], 'logo': r[9]}})
    p = _elo()
    gruplar = []
    for ad, (m1, m2) in sorted(ham.items(), key=lambda kv: kv[1][0]['saat']):
        for m in (m1, m2):
            m['pa'] = p(m['a']['id'], m['b']['id'])
        olas = gsl_olasiliklari((m1['a']['id'], m1['b']['id']), (m2['a']['id'], m2['b']['id']), p)
        takimlar = [m1['a'], m1['b'], m2['a'], m2['b']]
        for t in takimlar:
            t.update(olas[t['id']])
        takimlar.sort(key=lambda t: -t['cikar'])
        gruplar.append({'ad': ad.replace('Group', 'GRUP').upper(), 'maclar': [m1, m2],
                        'takimlar': takimlar, 'gun': m1['saat'] + timedelta(hours=3)})
    assert len(gruplar) == 4, f'4 grup bekleniyordu: {[g["ad"] for g in gruplar]}'
    return gruplar

# ── Çizim yardımcıları ────────────────────────────────────────────────────
def _zemin():
    c = Image.new('RGB', (W, H), BG)
    g = Image.new('RGB', (W, H), BG)
    gd = ImageDraw.Draw(g)
    gd.ellipse([-300, -200, 700, 700], fill=(120, 24, 40))
    gd.ellipse([500, 1200, 1500, 2100], fill=(70, 30, 110))
    return Image.blend(c, g.filter(ImageFilter.GaussianBlur(260)), 0.22)

def _alt_bilgi(c, d):
    d.line([(110, 1710), (W - 110, 1710)], fill=(30, 37, 52), width=2)
    c.paste(MARKA, (110, 1748), MARKA)
    site, hesap = 'fextesports.com', '@fextesports'
    d.text((W - 110 - d.textlength(site, font=f_site), 1744), site, font=f_site, fill=sol(INK, .92))
    d.text((W - 110 - d.textlength(hesap, font=f_tag), 1790), hesap, font=f_tag, fill=FAINT)

def _kisa(t, d, font, maks):
    s = t['ad']
    if d.textlength(s, font=font) > maks:
        s = t['ac'] if t.get('ac') and len(t['ac']) <= 6 else s[:10].rstrip() + '…'
    return s

def _yapistir(c, im, x, y, a):
    t = im.copy(); t.putalpha(t.split()[-1].point(lambda v: int(v * a)))
    c.paste(t, (int(x), int(y)), t)

def _eas(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3

# ── Sahne 1: giriş ────────────────────────────────────────────────────────
def sahne_giris(t):
    c = _zemin(); d = ImageDraw.Draw(c)
    a1, a2, a3 = _eas(t / 0.35), _eas((t - 0.25) / 0.35), _eas((t - 0.5) / 0.35)
    ik = YOL('assets', 'oyun', 'valorant.png')
    if os.path.exists(ik):
        gi = Image.open(ik).convert('RGBA'); gi = gi.resize((int(gi.width * 110 / gi.height), 110), Image.LANCZOS)
        _yapistir(c, gi, (W - gi.width) / 2, 520 - (1 - a1) * 30, a1)
    ort(d, 680 - (1 - a1) * 30, 'VCT CHAMPIONS', _f('Inter-Bold.ttf', 96), sol(INK, a1))
    ort(d, 800 - (1 - a1) * 30, '2026 · ŞANGHAY', _f('Inter-Bold.ttf', 64), sol(KIRMIZI, a1))
    fx = YOL('assets', 'fextopus-icon.png')
    if os.path.exists(fx):
        im = Image.open(fx).convert('RGBA'); im = im.resize((int(im.width * 150 / im.height), 150), Image.LANCZOS)
        _yapistir(c, im, (W - im.width) / 2, 1000, a2)
    f = _f('Inter-SemiBold.ttf', 44)
    ort(d, 1190, "Fextopus 16 takımın", f, sol(INK, a2))
    ort(d, 1250, "playoff ihtimalini hesapladı", f, sol(INK, a2))
    ort(d, 1350, '4 grup · GSL formatı · her gruptan 2 takım çıkar', _f('Inter-Regular.ttf', 32), sol(MUTED, a3))
    _alt_bilgi(c, d)
    return c

# ── Sahne 2-5: grup ───────────────────────────────────────────────────────
def _mac_kutusu(c, d, x, y, w, m, a):
    """Açılış maçı: iki takım satırı + Fextopus oranı."""
    h = 150
    d.rounded_rectangle([x, y, x + w, y + h], 16, fill=sol(KUTU, a), outline=sol(CIZGI, a * .6), width=2)
    pa = round(m['pa'] * 100)
    f_ad, f_p = _f('Inter-SemiBold.ttf', 30), _f('Inter-Bold.ttf', 32)
    for i, (t, pct) in enumerate(((m['a'], pa), (m['b'], 100 - pa))):
        yy = y + 22 + i * 64
        _yapistir(c, logo(t['id'], t['logo'], t['ad'], t['ac'], 44), x + 18, yy, a)
        fav = pct >= 50
        d.text((x + 76, yy + 6), _kisa(t, d, f_ad, w - 190), font=f_ad, fill=sol(INK if fav else MUTED, a))
        s = f'%{pct}'
        d.text((x + w - 20 - d.textlength(s, font=f_p), yy + 5), s, font=f_p, fill=sol(MOR if fav else FAINT, a))
    return h

def _etiket_kutusu(d, x, y, w, ust, alt, a, vurgu=False):
    h = 96
    d.rounded_rectangle([x, y, x + w, y + h], 16, fill=sol((40, 16, 26) if vurgu else KUTU, a),
                        outline=sol(KIRMIZI if vurgu else CIZGI, a * (.8 if vurgu else .6)), width=2)
    f1, f2 = _f('Inter-SemiBold.ttf', 28), _f('Inter-Regular.ttf', 24)
    d.text((x + (w - d.textlength(ust, font=f1)) / 2, y + 16), ust, font=f1, fill=sol(INK, a))
    d.text((x + (w - d.textlength(alt, font=f2)) / 2, y + 54), alt, font=f2,
           fill=sol(KIRMIZI if vurgu else FAINT, a))

def sahne_grup(g, t):
    c = _zemin(); d = ImageDraw.Draw(c)
    a0 = _eas(t / 0.18)
    d.text((90, 96), 'VCT CHAMPIONS 2026', font=_f('Inter-SemiBold.ttf', 28), fill=sol(KIRMIZI, a0))
    d.text((90 - (1 - a0) * 40, 132), g['ad'], font=_f('Inter-Bold.ttf', 108), fill=sol(INK, a0))
    gun = g['gun']
    d.text((92, 262), f'{gun.day} {AY[gun.month]} başlıyor · Bo3 · GSL', font=_f('Inter-Regular.ttf', 30),
           fill=sol(MUTED, a0))

    # Ağaç: sol sütun açılış maçları, sağ sütun sonraki maçlar
    a1, a2 = _eas((t - 0.08) / 0.2), _eas((t - 0.2) / 0.2)
    xs, ws = 70, 520
    y1, y2 = 350, 530
    _mac_kutusu(c, d, xs, y1, ws, g['maclar'][0], a1)
    _mac_kutusu(c, d, xs, y2, ws, g['maclar'][1], a1)
    xr, wr = 650, 360
    yk, ye, yb = 340, 500, 660
    _etiket_kutusu(d, xr, yk, wr, 'Kazananlar maçı', 'kazanan → 1. sıra', a2, vurgu=True)
    _etiket_kutusu(d, xr, ye, wr, 'Elenme maçı', 'kaybeden elenir', a2)
    _etiket_kutusu(d, xr, yb, wr, 'Belirleyici maç', 'kazanan → 2. sıra', a2, vurgu=True)
    cz = sol(CIZGI, a2)
    mx = xs + ws + 30
    for yy in (y1 + 55, y2 + 55):     # galipler → kazananlar
        d.line([(xs + ws, yy), (mx, yy), (mx, yk + 48), (xr, yk + 48)], fill=cz, width=3)
    for yy in (y1 + 110, y2 + 110):   # mağluplar → elenme
        d.line([(xs + ws, yy), (mx + 12, yy), (mx + 12, ye + 48), (xr, ye + 48)], fill=cz, width=3)
    # Kazananlar maçının KAYBEDENİ → belirleyici (sağdan dolaşan çizgi)
    sx = xr + wr + 22
    d.line([(xr + wr, yk + 48), (sx, yk + 48), (sx, yb + 48), (xr + wr, yb + 48)], fill=cz, width=3)
    d.polygon([(xr + wr, yb + 48), (xr + wr + 10, yb + 42), (xr + wr + 10, yb + 54)], fill=cz)
    # Elenme maçının GALİBİ → belirleyici
    d.line([(xr + wr / 2, ye + 96), (xr + wr / 2, yb)], fill=cz, width=3)
    d.polygon([(xr + wr / 2, yb), (xr + wr / 2 - 6, yb - 10), (xr + wr / 2 + 6, yb - 10)], fill=cz)

    # Playoff ihtimalleri
    a3 = _eas((t - 0.3) / 0.2)
    ust = 830
    d.text((90, ust), "FEXTOPUS: PLAYOFF'A ÇIKMA İHTİMALİ", font=_f('Inter-Bold.ttf', 34), fill=sol(INK, a3))
    satir_h = 190
    for i, tm in enumerate(g['takimlar']):
        ai = _eas((t - 0.36 - i * 0.07) / 0.2)
        if ai <= 0.01:
            continue
        y = ust + 70 + i * satir_h + (22 if i >= 2 else 0)
        turk = _turk_mu(tm['ad'])
        if turk:
            d.rounded_rectangle([70, y - 12, W - 70, y + satir_h - 30], 20, fill=sol(KOYU_K, ai),
                                outline=sol(KIRMIZI, ai * .7), width=2)
        _yapistir(c, logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 76), 100, y + 8, ai)
        f_ad = _f('Inter-SemiBold.ttf', 38)
        d.text((200, y + 8), _kisa(tm, d, f_ad, 460), font=f_ad, fill=sol(INK, ai))
        yuzde = tm['cikar'] * 100 * ai
        cikiyor = i < 2
        f_p = _f('Inter-Bold.ttf', 64)
        s = f'%{yuzde:.0f}'
        d.text((W - 100 - d.textlength(s, font=f_p), y - 4), s, font=f_p,
               fill=sol(MOR if cikiyor else MUTED, ai))
        bx0, bx1, by = 200, W - 100, y + 84
        d.rounded_rectangle([bx0, by, bx1, by + 18], 9, fill=sol(GRI, ai))
        dolu = int((bx1 - bx0) * tm['cikar'] * ai)
        if dolu > 4:
            d.rounded_rectangle([bx0, by, bx0 + dolu, by + 18], 9, fill=sol(MOR if cikiyor else CIZGI, ai))
        d.text((200, y + 112), f"1. sıra %{tm['birinci'] * 100:.0f}  ·  2. sıra %{tm['ikinci'] * 100:.0f}",
               font=_f('Inter-Regular.ttf', 24), fill=sol(FAINT, ai))
        if i == 1:   # playoff çizgisi
            ly = y + satir_h - 8
            for x in range(90, W - 90, 28):
                d.line([(x, ly), (x + 14, ly)], fill=sol(KIRMIZI, ai * .8), width=3)
            etk = 'PLAYOFF ÇİZGİSİ'
            fe = _f('Inter-SemiBold.ttf', 22)
            tw = d.textlength(etk, font=fe)
            d.rectangle([W - 90 - tw - 20, ly - 16, W - 90, ly + 16], fill=BG)
            d.text((W - 100 - tw, ly - 13), etk, font=fe, fill=sol(KIRMIZI, ai))
    _alt_bilgi(c, d)
    return c

# ── Sahne 6: kapanış ──────────────────────────────────────────────────────
def sahne_kapanis(gruplar, t):
    c = _zemin(); d = ImageDraw.Draw(c)
    a1, a2 = _eas(t / 0.3), _eas((t - 0.3) / 0.3)
    turk = next(((g, tm) for g in gruplar for tm in g['takimlar'] if _turk_mu(tm['ad'])), None)
    if turk:
        g, tm = turk
        _yapistir(c, logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 220), (W - 220) / 2, 360, a1)
        ort(d, 640, tm['ad'].upper(), _f('Inter-Bold.ttf', 80), sol(INK, a1))
        ort(d, 740, f"{g['ad']} · playoff ihtimali", _f('Inter-Regular.ttf', 38), sol(MUTED, a1))
        ort(d, 820, f"%{tm['cikar'] * 100 * a1:.0f}", _f('Inter-Bold.ttf', 200), sol(KIRMIZI, a1))
        sira = next(i for i, x in enumerate(g['takimlar']) if x['id'] == tm['id']) + 1
        ort(d, 1060, f'Fextopus grubunda {sira}. sıraya koyuyor', _f('Inter-SemiBold.ttf', 40), sol(INK, a2))
    f = _f('Inter-SemiBold.ttf', 44)
    ort(d, 1260, 'Sence Fextopus nerede yanılıyor?', f, sol(INK, a2))
    ort(d, 1330, 'Yorumlara yaz.', f, sol(MOR, a2))
    ort(d, 1470, "Tüm maçlar ve canlı tahminler fextesports.com'da",
        _f('Inter-Regular.ttf', 32), sol(MUTED, a2))
    _alt_bilgi(c, d)
    return c

# ── Video ─────────────────────────────────────────────────────────────────
def kareler(gruplar):
    sahneler = [(S_GIRIS, lambda t: sahne_giris(t))]
    for g in gruplar:
        sahneler.append((S_GRUP, lambda t, g=g: sahne_grup(g, t)))
    sahneler.append((S_KAPANIS, lambda t: sahne_kapanis(gruplar, t)))
    for sure, ciz in sahneler:
        n = int(sure * FPS)
        for i in range(n):
            t = i / (n - 1)
            im = ciz(t)
            # sahne sonu: son 0,25 sn hafif kararma → geçiş
            kalan = (1 - t) * sure
            if kalan < 0.25:
                im = Image.blend(im, Image.new('RGB', (W, H), BG), (0.25 - kalan) / 0.25 * 0.6)
            yield im

def aciklama(gruplar):
    satirlar = ['VCT Champions 2026 yarın Şanghay\'da başlıyor.',
                "Fextopus 4 grubun olası bütün sonuçlarını hesapladı: kim playoff'a çıkar?", '']
    for g in gruplar:
        ilk2 = ', '.join(f"{t['ad']} %{t['cikar'] * 100:.0f}" for t in g['takimlar'][:2])
        satirlar.append(f"{g['ad'].title()}: {ilk2}")
    turk = next(((g, tm) for g in gruplar for tm in g['takimlar'] if _turk_mu(tm['ad'])), None)
    if turk:
        g, tm = turk
        satirlar += ['', f"{tm['ad']}: playoff ihtimali %{tm['cikar'] * 100:.0f}."]
    satirlar += ['', "Sence Fextopus nerede yanılıyor? Yorumlara yaz.",
                 "Tüm maçlar ve canlı tahminler fextesports.com'da.", '',
                 '#valorant #vctchampions #espor #FUTesports']
    return '\n'.join(satirlar)

def uret(dosya):
    gruplar = veri()
    pr = subprocess.Popen([ffmpeg_yolu(), '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
        '-r', str(FPS), '-i', '-', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', dosya], stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for im in kareler(gruplar):
        pr.stdin.write(im.tobytes())
    pr.stdin.close(); pr.wait()
    with open(os.path.splitext(dosya)[0] + '.txt', 'w', encoding='utf-8') as f:
        f.write(aciklama(gruplar))
    print(f'  {dosya}  ({os.path.getsize(dosya) // 1024} KB)')

if __name__ == '__main__':
    os.makedirs(radar.CIKTI, exist_ok=True)
    uret(os.path.join(radar.CIKTI, 'champions-2026-gruplar.mp4'))
