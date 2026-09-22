# -*- coding: utf-8 -*-
"""VCT Champions 2026 — her grup için AYRI dikey video (1080x1920, ~18,5 sn).

Kullanım:  python champions.py        → cikti/champions-2026-grup-a.mp4 … grup-d.mp4 (+ .txt)

Kurucu geri bildirimi (22 Eyl) üzerine ikinci tasarım:
  • Tek videoda 4 grup çok hızlı geçiyordu → her grup ayrı video.
  • Ağaç ile ihtimaller aynı ekrana sıkışmıştı → önce tam ekran, adım adım
    açılan ANLAŞILIR ağaç, sonra ayrı sahnede ihtimal sıralaması.
  • Yazı tipi siteye benzemiyordu → sitenin başlık dili Inter Black (900) +
    marka sesi Baloo 2 (logodaki "feXt").
  • Kapanış sahnesi her grupta FARKLI ve veriden seçilir (Türk takımı / çizgiye
    en yakın takım / başa baş liderlik / sürpriz adayı).

Olasılıklar gsl.py'de TAM hesaplanır (32 sonuç); maç olasılıkları Fextopus Elo'su.
"""
import os, sys, subprocess, logging
from datetime import timedelta
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import psycopg

import radar
from radar import (W, H, FPS, BG, INK, MUTED, FAINT, MOR, GRI, YOL, AY,
                   sol, logo, MARKA, ffmpeg_yolu, _turk_mu)
from gsl import gsl_olasiliklari

ETKINLIK = 'Champions 2026'
KIRMIZI = (255, 70, 85)
YESIL = (70, 190, 110)
KUTU = (20, 25, 38)
CIZGI = (78, 88, 112)
S_TANITIM, S_AGAC, S_IHTIMAL, S_KAPANIS = 3.0, 6.0, 5.5, 4.0

# ── Yazı tipleri (sitenin dili) ───────────────────────────────────────────
@lru_cache(maxsize=None)
def inter(agirlik, boyut):
    ad = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold',
          800: 'ExtraBold', 900: 'Black'}[agirlik]
    return ImageFont.truetype(YOL('fonts', f'Inter-{ad}.ttf'), boyut)

@lru_cache(maxsize=None)
def baloo(boyut, agirlik=800):
    f = ImageFont.truetype(YOL('fonts', 'Baloo2-Variable.ttf'), boyut)
    f.set_variation_by_axes([agirlik])
    return f

def ortala(d, y, metin, font, renk):
    d.text(((W - d.textlength(metin, font=font)) / 2, y), metin, font=font, fill=renk)

def _eas(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3

def _yapistir(c, im, x, y, a):
    t = im.copy(); t.putalpha(t.split()[-1].point(lambda v: int(v * a)))
    c.paste(t, (int(x), int(y)), t)

def _kisa(t, d, font, maks):
    s = t['ad']
    if d.textlength(s, font=font) > maks:
        s = t['ac'] if t.get('ac') and len(t['ac']) <= 6 else s[:10].rstrip() + '…'
    return s

# ── Veri ──────────────────────────────────────────────────────────────────
def _elo():
    sys.path.insert(0, os.path.join(radar.BASE, '..', 'backend'))
    logging.disable(logging.INFO)
    from etl.predict import MatchPredictor
    mp = MatchPredictor(); mp.build_elo_ratings()
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
    for ad, (m1, m2) in sorted(ham.items()):
        for m in (m1, m2):
            m['pa'] = p(m['a']['id'], m['b']['id'])
        olas = gsl_olasiliklari((m1['a']['id'], m1['b']['id']), (m2['a']['id'], m2['b']['id']), p)
        takimlar = [m1['a'], m1['b'], m2['a'], m2['b']]
        for t in takimlar:
            t.update(olas[t['id']])
        takimlar.sort(key=lambda t: -t['cikar'])
        gruplar.append({'ham': ad, 'harf': ad.split()[-1].upper(), 'maclar': [m1, m2],
                        'takimlar': takimlar, 'gun': m1['saat'] + timedelta(hours=3)})
    assert len(gruplar) == 4, f'4 grup bekleniyordu: {[g["ham"] for g in gruplar]}'
    _kapanis_turu_ata(gruplar)
    return gruplar

def _kapanis_turu_ata(gruplar):
    """Her gruba FARKLI kapanış: türk → çizgi → kafa kafaya → sürpriz (veriden seçilir)."""
    kalan = list(gruplar)
    for g in kalan[:]:
        if any(_turk_mu(t['ad']) for t in g['takimlar']):
            g['kapanis'] = 'turk'; kalan.remove(g)
    if kalan:   # 2. ile 3. arası en dar → "çizginin hemen altı"
        g = min(kalan, key=lambda g: g['takimlar'][1]['cikar'] - g['takimlar'][2]['cikar'])
        g['kapanis'] = 'cizgi'; kalan.remove(g)
    if kalan:   # 1. sıra ihtimalleri en yakın → "kafa kafaya"
        g = min(kalan, key=lambda g: abs(sorted(t['birinci'] for t in g['takimlar'])[-1]
                                         - sorted(t['birinci'] for t in g['takimlar'])[-2]))
        g['kapanis'] = 'kafa'; kalan.remove(g)
    for g in kalan:
        g['kapanis'] = 'surpriz'

# ── Ortak zemin ve alt bilgi ──────────────────────────────────────────────
@lru_cache(maxsize=1)
def _zemin_cache():
    c = Image.new('RGB', (W, H), BG)
    g = Image.new('RGB', (W, H), BG)
    gd = ImageDraw.Draw(g)
    gd.ellipse([-350, -250, 650, 650], fill=(130, 26, 44))
    gd.ellipse([480, 1250, 1480, 2150], fill=(80, 32, 120))
    return Image.blend(c, g.filter(ImageFilter.GaussianBlur(260)), 0.24)

def _zemin():
    return _zemin_cache().copy()

def _ust_etiket(d, harf, a):
    f = inter(800, 28)
    d.text((80, 80), 'VCT CHAMPIONS 2026', font=f, fill=sol(KIRMIZI, a))
    s = f'GRUP {harf}'
    d.text((W - 80 - d.textlength(s, font=f), 80), s, font=f, fill=sol(MUTED, a))

def _alt_bilgi(c, d):
    d.line([(80, 1710), (W - 80, 1710)], fill=(30, 37, 52), width=2)
    c.paste(MARKA, (80, 1748), MARKA)
    site, hesap = 'fextesports.com', '@fextesports'
    d.text((W - 80 - d.textlength(site, font=inter(800, 36)), 1742), site, font=inter(800, 36), fill=sol(INK, .95))
    d.text((W - 80 - d.textlength(hesap, font=inter(500, 28)), 1790), hesap, font=inter(500, 28), fill=FAINT)

# ── Sahne 1: grup tanıtımı ────────────────────────────────────────────────
def sahne_tanitim(g, t):
    c = _zemin(); d = ImageDraw.Draw(c)
    a0 = _eas(t / 0.25)
    ortala(d, 190, 'VCT CHAMPIONS 2026 · ŞANGHAY', inter(800, 34), sol(KIRMIZI, a0))
    ortala(d, 250 - (1 - a0) * 40, f'GRUP {g["harf"]}', inter(900, 230), sol(INK, a0))
    gun = g['gun']
    ortala(d, 520, f'{gun.day} {AY[gun.month]} başlıyor', inter(600, 42), sol(MUTED, a0))
    # 4 takım, 2x2
    for i, tm in enumerate(sorted(g['takimlar'], key=lambda x: x['ad'])):
        ai = _eas((t - 0.2 - i * 0.08) / 0.25)
        if ai <= 0.01:
            continue
        cx = 290 if i % 2 == 0 else W - 290
        y = 680 + (i // 2) * 380
        lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 190)
        _yapistir(c, lg, cx - lg.width / 2, y + (1 - ai) * 30 + (190 - lg.height) / 2, ai)
        f = inter(800, 40)
        s = _kisa(tm, d, f, 440)
        d.text((cx - d.textlength(s, font=f) / 2, y + 215), s, font=f, fill=sol(INK, ai))
    a2 = _eas((t - 0.62) / 0.25)
    fx = YOL('assets', 'fextopus-icon.png')
    if os.path.exists(fx):
        im = Image.open(fx).convert('RGBA'); im = im.resize((int(im.width * 84 / im.height), 84), Image.LANCZOS)
        mt = 'Fextopus bu grubu hesapladı'
        tw = im.width + 18 + d.textlength(mt, font=baloo(54))
        x0 = (W - tw) / 2
        _yapistir(c, im, x0, 1480, a2)
        d.text((x0 + im.width + 18, 1484), mt, font=baloo(54), fill=sol(INK, a2))
    _alt_bilgi(c, d)
    return c

# ── Sahne 2: anlaşılır turnuva ağacı ──────────────────────────────────────
def _acilis_karti(c, d, y, m, a, no):
    """Açılış maçı kartı (yükseklik 214). Telefonda okunacak boyutlar."""
    x0, x1 = 50, W - 50
    d.rounded_rectangle([x0, y, x1, y + 214], 28, fill=sol(KUTU, a), outline=sol(CIZGI, a * .7), width=2)
    d.text((x0 + 30, y + 18), f'AÇILIŞ MAÇI {no}', font=inter(800, 26), fill=sol(FAINT, a))
    pa = round(m['pa'] * 100); pb = 100 - pa
    for t, pct, sag in ((m['a'], pa, False), (m['b'], pb, True)):
        lg = logo(t['id'], t['logo'], t['ad'], t['ac'], 96)
        f = inter(800, 42)
        s = _kisa(t, d, f, 290)
        fav = pct >= 50
        fp = inter(900, 44) if fav else inter(600, 40)
        ps = f'%{pct}'
        if not sag:
            _yapistir(c, lg, x0 + 30, y + 70 + (96 - lg.height) / 2, a)
            d.text((x0 + 144, y + 72), s, font=f, fill=sol(INK if fav else MUTED, a))
            d.text((x0 + 144, y + 128), ps, font=fp, fill=sol(MOR if fav else FAINT, a))
        else:
            _yapistir(c, lg, x1 - 30 - lg.width, y + 70 + (96 - lg.height) / 2, a)
            d.text((x1 - 144 - d.textlength(s, font=f), y + 72), s, font=f, fill=sol(INK if fav else MUTED, a))
            d.text((x1 - 144 - d.textlength(ps, font=fp), y + 128), ps, font=fp, fill=sol(MOR if fav else FAINT, a))
    ortala(d, y + 96, 'vs', inter(800, 40), sol(FAINT, a))

def _sonuc_kutusu(d, x, y, w, baslik, satirlar, a, renk):
    h = 88 + 52 * len(satirlar)
    d.rounded_rectangle([x, y, x + w, y + h], 26, fill=sol(KUTU, a), outline=sol(renk, a * .9), width=4)
    d.text((x + (w - d.textlength(baslik, font=inter(900, 46))) / 2, y + 22), baslik,
           font=inter(900, 46), fill=sol(INK, a))
    for i, (metin, rk) in enumerate(satirlar):
        f = inter(700, 32)
        d.text((x + (w - d.textlength(metin, font=f)) / 2, y + 88 + i * 52), metin, font=f, fill=sol(rk, a))
    return h

def sahne_agac(g, t):
    c = _zemin(); d = ImageDraw.Draw(c)
    _ust_etiket(d, g['harf'], 1)
    a0 = _eas(t / 0.12)
    d.text((80, 140), 'GRUP NASIL OYNANIR?', font=inter(900, 68), fill=sol(INK, a0))
    d.text((82, 230), 'GSL formatı · tüm maçlar Bo3 · ilk 2 takım playoff\'a', font=inter(500, 30),
           fill=sol(MUTED, a0))
    # Adım 1: açılış maçları
    a1 = _eas((t - 0.08) / 0.18)
    _acilis_karti(c, d, 320, g['maclar'][0], a1, 1)
    _acilis_karti(c, d, 560, g['maclar'][1], a1, 2)
    # Adım 2: galipler / mağluplar
    a2 = _eas((t - 0.32) / 0.18)
    kx, kw = 50, W // 2 - 70
    ex = W - 50 - kw
    ky = 880
    fo = inter(800, 34)
    d.text((kx + 16, ky - 58), 'iki galip ↓', font=fo, fill=sol(YESIL, a2))
    d.text((ex + kw - 16 - d.textlength('iki mağlup ↓', font=fo), ky - 58), 'iki mağlup ↓', font=fo,
           fill=sol(KIRMIZI, a2))
    hk = _sonuc_kutusu(d, kx, ky, kw, 'KAZANANLAR', [('kazanan → 1. sıra ✓', YESIL),
                                                    ('kaybeden → belirleyici', MUTED)], a2, YESIL)
    _sonuc_kutusu(d, ex, ky, kw, 'ELENME', [('kazanan → belirleyici', MUTED),
                                            ('kaybeden → elenir ✗', KIRMIZI)], a2, KIRMIZI)
    # Adım 3: belirleyici
    a3 = _eas((t - 0.56) / 0.18)
    by = ky + hk + 110
    cz = sol(CIZGI, a3)
    d.line([(kx + kw / 2, ky + hk), (kx + kw / 2, by - 40), (ex + kw / 2, by - 40), (ex + kw / 2, ky + hk)],
           fill=cz, width=5)
    d.line([(W / 2, by - 40), (W / 2, by - 4)], fill=cz, width=5)
    d.polygon([(W / 2, by + 4), (W / 2 - 16, by - 18), (W / 2 + 16, by - 18)], fill=cz)
    bw = 780
    hb = _sonuc_kutusu(d, (W - bw) / 2, by + 10, bw, 'BELİRLEYİCİ MAÇ',
                       [('kazanan → 2. sıra ✓', YESIL), ('kaybeden → elenir ✗', KIRMIZI)], a3, (210, 175, 90))
    a4 = _eas((t - 0.8) / 0.15)
    ortala(d, by + 10 + hb + 60, "Sonuç: 2 takım playoff'a, 2 takım eve", inter(900, 42), sol(INK, a4))
    _alt_bilgi(c, d)
    return c

# ── Sahne 3: playoff ihtimalleri ──────────────────────────────────────────
def sahne_ihtimal(g, t):
    c = _zemin(); d = ImageDraw.Draw(c)
    _ust_etiket(d, g['harf'], 1)
    a0 = _eas(t / 0.12)
    d.text((80, 140), "PLAYOFF'A KİM ÇIKAR?", font=inter(900, 72), fill=sol(INK, a0))
    fx = YOL('assets', 'fextopus-icon.png')
    if os.path.exists(fx):
        im = Image.open(fx).convert('RGBA'); im = im.resize((int(im.width * 44 / im.height), 44), Image.LANCZOS)
        _yapistir(c, im, 80, 238, a0)
    d.text((136, 236), 'Fextopus 32 olası sonucu tek tek hesapladı', font=baloo(40), fill=sol(MUTED, a0))
    satir_h = 300
    for i, tm in enumerate(g['takimlar']):
        ai = _eas((t - 0.15 - i * 0.1) / 0.22)
        if ai <= 0.01:
            continue
        y = 360 + i * satir_h + (50 if i >= 2 else 0)
        cikiyor = i < 2
        if _turk_mu(tm['ad']):
            d.rounded_rectangle([56, y - 16, W - 56, y + satir_h - 50], 28, fill=sol((56, 18, 30), ai),
                                outline=sol(KIRMIZI, ai * .8), width=3)
        lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 120)
        _yapistir(c, lg, 90 + (120 - lg.width) / 2, y + 8 + (120 - lg.height) / 2, ai)
        f = inter(900, 50)
        d.text((240, y + 14), _kisa(tm, d, f, 440), font=f, fill=sol(INK, ai))
        d.text((240, y + 82), f"1. sıra %{tm['birinci'] * 100:.0f}  ·  2. sıra %{tm['ikinci'] * 100:.0f}",
               font=inter(500, 28), fill=sol(FAINT, ai))
        s = f'%{tm["cikar"] * 100 * ai:.0f}'
        fp = inter(900, 104)
        d.text((W - 90 - d.textlength(s, font=fp), y - 10), s, font=fp, fill=sol(MOR if cikiyor else MUTED, ai))
        bx0, bx1, by = 90, W - 90, y + 150
        d.rounded_rectangle([bx0, by, bx1, by + 22], 11, fill=sol(GRI, ai))
        dolu = int((bx1 - bx0) * tm['cikar'] * ai)
        if dolu > 6:
            d.rounded_rectangle([bx0, by, bx0 + dolu, by + 22], 11, fill=sol(MOR if cikiyor else CIZGI, ai))
        if i == 1:
            ly = y + satir_h - 12
            for x in range(80, W - 80, 30):
                d.line([(x, ly), (x + 16, ly)], fill=sol(KIRMIZI, ai * .85), width=4)
            etk = 'PLAYOFF ÇİZGİSİ'
            fe = inter(800, 26)
            tw = d.textlength(etk, font=fe)
            d.rectangle([W / 2 - tw / 2 - 18, ly - 20, W / 2 + tw / 2 + 18, ly + 20], fill=BG)
            ortala(d, ly - 16, etk, fe, sol(KIRMIZI, ai))
    _alt_bilgi(c, d)
    return c

# ── Sahne 4: gruba özel kapanış ───────────────────────────────────────────
def _cta(d, a, y=1440):
    ortala(d, y, 'Yorumlara yaz', baloo(64), sol(MOR, a))
    ortala(d, y + 90, "Canlı tahminler fextesports.com'da", inter(500, 32), sol(MUTED, a))

def sahne_kapanis(g, t):
    c = _zemin(); d = ImageDraw.Draw(c)
    _ust_etiket(d, g['harf'], 1)
    a1, a2 = _eas(t / 0.3), _eas((t - 0.35) / 0.3)
    tk = g['takimlar']
    tur = g['kapanis']
    if tur == 'turk':
        tm = next(x for x in tk if _turk_mu(x['ad']))
        sira = tk.index(tm) + 1
        lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 240)
        _yapistir(c, lg, (W - lg.width) / 2, 260, a1)
        ortala(d, 540, tm['ad'].upper(), inter(900, 84), sol(INK, a1))
        ortala(d, 650, "playoff ihtimali", inter(600, 40), sol(MUTED, a1))
        ortala(d, 710, f"%{tm['cikar'] * 100 * a1:.0f}", inter(900, 240), sol(KIRMIZI, a1))
        ortala(d, 1010, f'Fextopus grubunda {sira}. sıraya koyuyor', inter(800, 42), sol(INK, a2))
        ortala(d, 1200, 'Sence FUT gruptan çıkar mı?', baloo(62), sol(INK, a2))
    elif tur == 'cizgi':
        ust, alt = tk[1], tk[2]
        ortala(d, 200, 'ÇİZGİDE KIYAMET', inter(900, 90), sol(INK, a1))
        for tm, cx, rk in ((ust, 300, MOR), (alt, W - 300, MUTED)):
            lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 190)
            _yapistir(c, lg, cx - lg.width / 2, 400, a1)
            f = inter(800, 40); s = _kisa(tm, d, f, 380)
            d.text((cx - d.textlength(s, font=f) / 2, 620), s, font=f, fill=sol(INK, a1))
            p = f"%{tm['cikar'] * 100 * a1:.0f}"
            d.text((cx - d.textlength(p, font=inter(900, 130)) / 2, 680), p, font=inter(900, 130), fill=sol(rk, a1))
        ortala(d, 500, 'vs', inter(800, 50), sol(FAINT, a1))
        fark = (ust['cikar'] - alt['cikar']) * 100
        ortala(d, 920, f"Aradaki fark sadece {fark:.0f} puan", inter(800, 46), sol(KIRMIZI, a2))
        ortala(d, 1010, f"{alt['ad']} çizginin altında kaldı", inter(600, 38), sol(MUTED, a2))
        ortala(d, 1200, 'Fextopus haksız mı?', baloo(70), sol(INK, a2))
    elif tur == 'kafa':
        bir = sorted(tk, key=lambda x: -x['birinci'])[:2]
        ortala(d, 200, 'BİRİNCİLİK', inter(900, 96), sol(INK, a1))
        ortala(d, 310, 'YAZI TURA', inter(900, 96), sol(KIRMIZI, a1))
        for tm, cx in ((bir[0], 300), (bir[1], W - 300)):
            lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 190)
            _yapistir(c, lg, cx - lg.width / 2, 480, a1)
            f = inter(800, 40); s = _kisa(tm, d, f, 380)
            d.text((cx - d.textlength(s, font=f) / 2, 700), s, font=f, fill=sol(INK, a1))
            p = f"%{tm['birinci'] * 100 * a1:.0f}"
            d.text((cx - d.textlength(p, font=inter(900, 120)) / 2, 760), p, font=inter(900, 120), fill=sol(MOR, a1))
        ortala(d, 930, 'grup birincisi olma ihtimali', inter(600, 36), sol(MUTED, a2))
        ortala(d, 1200, 'Sence hangisi lider?', baloo(70), sol(INK, a2))
    else:  # surpriz
        tm = tk[-1]
        ortala(d, 200, 'SÜRPRİZ ADAYI', inter(900, 96), sol(INK, a1))
        lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 230)
        _yapistir(c, lg, (W - lg.width) / 2, 360, a1)
        ortala(d, 620, tm['ad'].upper(), inter(900, 70), sol(INK, a1))
        ortala(d, 720, "playoff ihtimali", inter(600, 40), sol(MUTED, a1))
        ortala(d, 780, f"%{tm['cikar'] * 100 * a1:.0f}", inter(900, 200), sol(KIRMIZI, a1))
        ortala(d, 1040, 'Fextopus şansını düşük görüyor', inter(800, 42), sol(INK, a2))
        ortala(d, 1200, 'Grubu karıştırır mı?', baloo(70), sol(INK, a2))
    _cta(d, a2)
    _alt_bilgi(c, d)
    return c

# ── Video ve açıklama ─────────────────────────────────────────────────────
def kareler(g):
    sahneler = [(S_TANITIM, sahne_tanitim), (S_AGAC, sahne_agac),
                (S_IHTIMAL, sahne_ihtimal), (S_KAPANIS, sahne_kapanis)]
    for sure, ciz in sahneler:
        n = int(sure * FPS)
        for i in range(n):
            t = i / (n - 1)
            im = ciz(g, t)
            kalan = (1 - t) * sure
            if kalan < 0.3 and ciz is not sahne_kapanis:
                im = Image.blend(im, Image.new('RGB', (W, H), BG), (0.3 - kalan) / 0.3 * 0.7)
            yield im

def aciklama(g):
    tk = g['takimlar']
    gun = g['gun']
    kanca = {
        'turk': lambda: next(f"{x['ad']} için Fextopus'un playoff ihtimali %{x['cikar'] * 100:.0f}. "
                             f"Sence FUT gruptan çıkar mı?" for x in tk if _turk_mu(x['ad'])),
        'cizgi': lambda: f"{tk[2]['ad']} %{tk[2]['cikar'] * 100:.0f} ile playoff çizgisinin hemen altında. "
                         f"Fextopus haksız mı?",
        'kafa': lambda: "Bu grupta birincilik yazı tura. Sence hangisi lider?",
        'surpriz': lambda: f"{tk[-1]['ad']} için sadece %{tk[-1]['cikar'] * 100:.0f}. Grubu karıştırır mı?",
    }[g['kapanis']]()
    satirlar = [f"VCT Champions 2026 · Grup {g['harf']} ({gun.day} {AY[gun.month]}'de başlıyor)", '',
                kanca, '',
                "Fextopus'un playoff ihtimalleri:"]
    satirlar += [f"{i + 1}. {x['ad']} %{x['cikar'] * 100:.0f}" for i, x in enumerate(tk)]
    satirlar += ['', "Canlı tahminler fextesports.com'da.", '',
                 '#valorant #vctchampions #espor' + (' #FUTesports' if g['kapanis'] == 'turk' else '')]
    return '\n'.join(satirlar)

def uret(g, dosya):
    pr = subprocess.Popen([ffmpeg_yolu(), '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
        '-r', str(FPS), '-i', '-', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', dosya], stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for im in kareler(g):
        pr.stdin.write(im.tobytes())
    pr.stdin.close(); pr.wait()
    with open(os.path.splitext(dosya)[0] + '.txt', 'w', encoding='utf-8') as f:
        f.write(aciklama(g))
    print(f'  {dosya}  ({os.path.getsize(dosya) // 1024} KB, kapanış: {g["kapanis"]})')

if __name__ == '__main__':
    os.makedirs(radar.CIKTI, exist_ok=True)
    for g in veri():
        uret(g, os.path.join(radar.CIKTI, f'champions-2026-grup-{g["harf"].lower()}.mp4'))
