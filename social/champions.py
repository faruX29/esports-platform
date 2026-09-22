# -*- coding: utf-8 -*-
"""VCT Champions 2026 — her grup için AYRI dikey video (1080x1920, ~18,5 sn).

Kullanım:  python champions.py        → cikti/champions-2026-grup-a.mp4 … grup-d.mp4 (+ .txt)

Kurucu geri bildirimleri (22 Eyl, iki tur):
  • Tek videoda 4 grup çok hızlıydı → her grup ayrı video.
  • Ağaç ile ihtimaller aynı ekrana sıkışmıştı → ayrı sahneler.
  • Yazı tipi: sitede başlıklar Inter 900/800 (canlıda ölçüldü). Baloo 2 YALNIZ
    "feXt" logosunda; videoda metin için KULLANILMAZ.
  • Görünme efekti: renk arka plan renginden beyaza kaydırılıyordu; zemin düz
    olmadığı için yazılar önce koyu gölge gibi beliriyordu. Artık her öğe
    saydam katmanda çizilip GERÇEK alfa ile birleşir (Katman).
  • Ağaç çok yazılıydı → renk dili: yeşil çizgi = kazanan, kırmızı = kaybeden;
    kutularda tek kelime, sonuçlar etiket ("1. SIRA", "ELENİR").
  • Kapanış her grupta FARKLI ve veriden seçilir.

Olasılıklar gsl.py'de TAM hesaplanır (32 sonuç); maç olasılıkları Fextopus Elo'su.
"""
import os, sys, subprocess, logging
from datetime import timedelta
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import psycopg

import radar
from radar import W, H, FPS, BG, INK, MUTED, FAINT, MOR, GRI, YOL, AY, logo, MARKA, ffmpeg_yolu, _turk_mu
from gsl import gsl_olasiliklari

ETKINLIK = 'Champions 2026'
KIRMIZI = (255, 70, 85)
YESIL = (64, 196, 110)
ALTIN = (214, 178, 92)
KUTU = (20, 25, 38)
CIZGI = (78, 88, 112)
S_TANITIM, S_AGAC, S_IHTIMAL, S_KAPANIS = 3.0, 6.5, 5.5, 4.0

# ── Yazı tipi: sitenin başlık dili (Inter) ────────────────────────────────
@lru_cache(maxsize=None)
def inter(agirlik, boyut):
    ad = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold',
          800: 'ExtraBold', 900: 'Black'}[agirlik]
    return ImageFont.truetype(YOL('fonts', f'Inter-{ad}.ttf'), boyut)

def _eas(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3

class Katman:
    """Saydam katman: içine TAM renkle çizilir, çıkışta `a` alfasıyla zemine birleşir.
    Böylece öğe gerçekten görünmezden belirir (arka plan ne olursa olsun)."""
    def __init__(self, taban, a):
        self.taban, self.a = taban, a
    def __enter__(self):
        self.im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        return self.im, ImageDraw.Draw(self.im)
    def __exit__(self, *hata):
        if self.a <= 0.004:
            return
        if self.a < 0.996:
            self.im.putalpha(self.im.getchannel('A').point(lambda v: int(v * self.a)))
        self.taban.alpha_composite(self.im)

def ortala(d, y, metin, font, renk):
    d.text(((W - d.textlength(metin, font=font)) / 2, y), metin, font=font, fill=renk)

def yapistir(im, lg, x, y):
    im.alpha_composite(lg, (int(x), int(y)))

def kisa(t, d, font, maks):
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
        def fark(g):
            b = sorted((t['birinci'] for t in g['takimlar']), reverse=True)
            return b[0] - b[1]
        g = min(kalan, key=fark)
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
    return Image.blend(c, g.filter(ImageFilter.GaussianBlur(260)), 0.24).convert('RGBA')

def _zemin():
    return _zemin_cache().copy()

def _ust_etiket(c, harf):
    with Katman(c, 1) as (im, d):
        f = inter(800, 28)
        d.text((80, 80), 'VCT CHAMPIONS 2026', font=f, fill=KIRMIZI)
        s = f'GRUP {harf}'
        d.text((W - 80 - d.textlength(s, font=f), 80), s, font=f, fill=MUTED)

def _alt_bilgi(c):
    with Katman(c, 1) as (im, d):
        d.line([(80, 1710), (W - 80, 1710)], fill=(30, 37, 52), width=2)
        yapistir(im, MARKA, 80, 1748)
        site, hesap = 'fextesports.com', '@fextesports'
        d.text((W - 80 - d.textlength(site, font=inter(800, 36)), 1742), site, font=inter(800, 36), fill=INK)
        d.text((W - 80 - d.textlength(hesap, font=inter(500, 28)), 1790), hesap, font=inter(500, 28), fill=FAINT)

def _fextopus_satiri(c, y, metin, a, boyut=46, ortali=True, x=80):
    fx = YOL('assets', 'fextopus-icon.png')
    with Katman(c, a) as (im, d):
        f = inter(800, boyut)
        ikon = None
        if os.path.exists(fx):
            ikon = Image.open(fx).convert('RGBA')
            ikon = ikon.resize((int(ikon.width * boyut * 1.5 / ikon.height), int(boyut * 1.5)), Image.LANCZOS)
        tw = d.textlength(metin, font=f) + (ikon.width + 16 if ikon else 0)
        x0 = (W - tw) / 2 if ortali else x
        if ikon:
            yapistir(im, ikon, x0, y - boyut * 0.2)
            x0 += ikon.width + 16
        d.text((x0, y), metin, font=f, fill=INK)

# ── Sahne 1: grup tanıtımı ────────────────────────────────────────────────
def sahne_tanitim(g, t):
    c = _zemin()
    a0 = _eas(t / 0.25)
    with Katman(c, a0) as (im, d):
        ortala(d, 190, 'VCT CHAMPIONS 2026 · ŞANGHAY', inter(800, 34), KIRMIZI)
        ortala(d, 250 + (1 - a0) * 40, f'GRUP {g["harf"]}', inter(900, 230), INK)
        gun = g['gun']
        ortala(d, 520, f'{gun.day} {AY[gun.month]} başlıyor', inter(600, 42), MUTED)
    for i, tm in enumerate(sorted(g['takimlar'], key=lambda x: x['ad'])):
        ai = _eas((t - 0.2 - i * 0.08) / 0.25)
        cx = 290 if i % 2 == 0 else W - 290
        y = 680 + (i // 2) * 380 + (1 - ai) * 30
        with Katman(c, ai) as (im, d):
            lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 190)
            yapistir(im, lg, cx - lg.width / 2, y + (190 - lg.height) / 2)
            f = inter(800, 40)
            s = kisa(tm, d, f, 440)
            d.text((cx - d.textlength(s, font=f) / 2, y + 215), s, font=f, fill=INK)
    _fextopus_satiri(c, 1484, 'Fextopus bu grubu hesapladı', _eas((t - 0.62) / 0.25))
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Sahne 2: az yazılı, renk dilli turnuva ağacı ──────────────────────────
def _dugum(d, x0, y0, x1, y1, metin, renk):
    d.rounded_rectangle([x0, y0, x1, y1], 26, fill=KUTU, outline=renk, width=5)
    f = inter(900, 40)
    d.text(((x0 + x1 - d.textlength(metin, font=f)) / 2, (y0 + y1) / 2 - 26), metin, font=f, fill=INK)

def _etiket(d, cx, y, metin, renk):
    """Dolu hap etiket: sonuç (1. SIRA / ELENİR)."""
    f = inter(900, 32)
    w = d.textlength(metin, font=f) + 56
    d.rounded_rectangle([cx - w / 2, y, cx + w / 2, y + 64], 32, fill=renk)
    d.text((cx - d.textlength(metin, font=f) / 2, y + 13), metin, font=f,
           fill=(10, 14, 22) if renk == YESIL else INK)

def _yol(d, noktalar, renk):
    """Köşeli yol + ok ucu (son noktaya doğru)."""
    d.line(noktalar, fill=renk, width=7, joint='curve')
    (x0, y0), (x1, y1) = noktalar[-2], noktalar[-1]
    if y1 > y0:      # aşağı ok
        d.polygon([(x1, y1 + 2), (x1 - 15, y1 - 20), (x1 + 15, y1 - 20)], fill=renk)

def _acilis_cipi(im, d, x0, y0, m):
    """Açılış maçı: iki logo + kısaltma + Fextopus yüzdesi. Cümle yok."""
    w, h = 470, 230
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], 28, fill=KUTU, outline=CIZGI, width=2)
    pa = round(m['pa'] * 100)
    for t, pct, cx in ((m['a'], pa, x0 + 120), (m['b'], 100 - pa, x0 + w - 120)):
        lg = logo(t['id'], t['logo'], t['ad'], t['ac'], 96)
        yapistir(im, lg, cx - lg.width / 2, y0 + 22 + (96 - lg.height) / 2)
        f = inter(800, 30)
        s = t['ac'] if t.get('ac') and len(t['ac']) <= 6 else kisa(t, d, f, 180)
        d.text((cx - d.textlength(s, font=f) / 2, y0 + 128), s, font=f, fill=INK)
        fav = pct >= 50
        fp = inter(900, 38)
        ps = f'%{pct}'
        d.text((cx - d.textlength(ps, font=fp) / 2, y0 + 168), ps, font=fp, fill=MOR if fav else FAINT)
    d.text((x0 + w / 2 - d.textlength('vs', font=inter(800, 30)) / 2, y0 + 58), 'vs', font=inter(800, 30), fill=FAINT)

def sahne_agac(g, t):
    c = _zemin()
    _ust_etiket(c, g['harf'])
    a0 = _eas(t / 0.12)
    with Katman(c, a0) as (im, d):
        d.text((80, 140), 'GRUP NASIL OYNANIR?', font=inter(900, 68), fill=INK)
        # Renk dili açıklaması (tek satır)
        y = 244
        d.line([(84, y + 18), (144, y + 18)], fill=YESIL, width=8)
        d.text((158, y), 'kazanan', font=inter(700, 32), fill=INK)
        x = 158 + d.textlength('kazanan', font=inter(700, 32)) + 50
        d.line([(x, y + 18), (x + 60, y + 18)], fill=KIRMIZI, width=8)
        d.text((x + 74, y), 'kaybeden', font=inter(700, 32), fill=INK)
        d.text((W - 80 - d.textlength('Bo3', font=inter(800, 32)), y), 'Bo3', font=inter(800, 32), fill=MUTED)

    c1x, c2x, cy = 50, W - 50 - 470, 330          # açılış çipleri
    kx0, kx1, ky0, ky1 = 70, 470, 720, 830          # KAZANANLAR
    ex0, ex1, ey0, ey1 = W - 470, W - 70, 720, 830  # ELENME
    bx0, bx1, by0, by1 = 290, W - 290, 1090, 1200   # BELİRLEYİCİ
    kc, ec, bc = (kx0 + kx1) / 2, (ex0 + ex1) / 2, W / 2

    a1 = _eas((t - 0.06) / 0.16)
    with Katman(c, a1) as (im, d):
        _acilis_cipi(im, d, c1x, cy, g['maclar'][0])
        _acilis_cipi(im, d, c2x, cy, g['maclar'][1])

    a2 = _eas((t - 0.26) / 0.16)       # açılış → kazananlar / elenme
    with Katman(c, a2) as (im, d):
        # Her yatay çizgi AYRI yükseklikte: aynı y'de giden kırmızı ve yeşil üst üste
        # biniyordu (22 Eyl, 3. tur). Yalnız dikey–yatay kesişme kalır, o okunur.
        alt = cy + 230
        _yol(d, [(c1x + 150, alt), (c1x + 150, alt + 45), (kc - 50, alt + 45), (kc - 50, ky0)], YESIL)
        _yol(d, [(c1x + 320, alt), (c1x + 320, alt + 90), (ec - 50, alt + 90), (ec - 50, ey0)], KIRMIZI)
        _yol(d, [(c2x + 150, alt), (c2x + 150, alt + 125), (kc + 50, alt + 125), (kc + 50, ky0)], YESIL)
        _yol(d, [(c2x + 320, alt), (c2x + 320, alt + 45), (ec + 50, alt + 45), (ec + 50, ey0)], KIRMIZI)
        _dugum(d, kx0, ky0, kx1, ky1, 'KAZANANLAR', YESIL)
        _dugum(d, ex0, ey0, ex1, ey1, 'ELENME', KIRMIZI)

    a3 = _eas((t - 0.46) / 0.16)       # kazananlar / elenme sonuçları
    with Katman(c, a3) as (im, d):
        _yol(d, [(kc - 90, ky1), (kc - 90, 910)], YESIL)
        _etiket(d, kc - 90, 918, '1. SIRA', YESIL)
        _yol(d, [(ec + 90, ey1), (ec + 90, 910)], KIRMIZI)
        _etiket(d, ec + 90, 918, 'ELENİR', KIRMIZI)
        _yol(d, [(kc + 90, ky1), (kc + 90, 1030), (bc - 60, 1030), (bc - 60, by0)], KIRMIZI)
        _yol(d, [(ec - 90, ey1), (ec - 90, 1030), (bc + 60, 1030), (bc + 60, by0)], YESIL)
        _dugum(d, bx0, by0, bx1, by1, 'BELİRLEYİCİ', ALTIN)

    a4 = _eas((t - 0.64) / 0.16)       # belirleyici sonuçları
    with Katman(c, a4) as (im, d):
        _yol(d, [(bc - 110, by1), (bc - 110, 1250), (bc - 230, 1250), (bc - 230, 1290)], YESIL)
        _etiket(d, bc - 230, 1298, '2. SIRA', YESIL)
        _yol(d, [(bc + 110, by1), (bc + 110, 1250), (bc + 230, 1250), (bc + 230, 1290)], KIRMIZI)
        _etiket(d, bc + 230, 1298, 'ELENİR', KIRMIZI)

    a5 = _eas((t - 0.8) / 0.14)
    with Katman(c, a5) as (im, d):
        f = inter(900, 44)
        s1, s2 = "2 takım playoff'a", '2 takım eve'
        orta = '  ·  '
        tw = d.textlength(s1 + orta + s2, font=f)
        x = (W - tw) / 2
        d.text((x, 1480), s1, font=f, fill=YESIL); x += d.textlength(s1, font=f)
        d.text((x, 1480), orta, font=f, fill=FAINT); x += d.textlength(orta, font=f)
        d.text((x, 1480), s2, font=f, fill=KIRMIZI)
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Sahne 3: playoff ihtimalleri ──────────────────────────────────────────
def sahne_ihtimal(g, t):
    c = _zemin()
    _ust_etiket(c, g['harf'])
    a0 = _eas(t / 0.12)
    with Katman(c, a0) as (im, d):
        d.text((80, 140), "PLAYOFF'A KİM ÇIKAR?", font=inter(900, 72), fill=INK)
    _fextopus_satiri(c, 240, 'Fextopus 32 olası sonucu hesapladı', a0, boyut=34, ortali=False)
    satir_h = 300
    for i, tm in enumerate(g['takimlar']):
        ai = _eas((t - 0.15 - i * 0.1) / 0.22)
        y = 360 + i * satir_h + (50 if i >= 2 else 0)
        cikiyor = i < 2
        with Katman(c, ai) as (im, d):
            if _turk_mu(tm['ad']):
                d.rounded_rectangle([56, y - 16, W - 56, y + satir_h - 50], 28, fill=(56, 18, 30),
                                    outline=KIRMIZI, width=3)
            lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 120)
            yapistir(im, lg, 90 + (120 - lg.width) / 2, y + 8 + (120 - lg.height) / 2)
            f = inter(900, 50)
            d.text((240, y + 14), kisa(tm, d, f, 440), font=f, fill=INK)
            d.text((240, y + 82), f"1. sıra %{tm['birinci'] * 100:.0f}  ·  2. sıra %{tm['ikinci'] * 100:.0f}",
                   font=inter(500, 28), fill=FAINT)
            s = f'%{tm["cikar"] * 100 * ai:.0f}'
            fp = inter(900, 104)
            d.text((W - 90 - d.textlength(s, font=fp), y - 10), s, font=fp, fill=MOR if cikiyor else MUTED)
            bx0, bx1, by = 90, W - 90, y + 150
            d.rounded_rectangle([bx0, by, bx1, by + 22], 11, fill=GRI)
            dolu = int((bx1 - bx0) * tm['cikar'] * ai)
            if dolu > 6:
                d.rounded_rectangle([bx0, by, bx0 + dolu, by + 22], 11, fill=MOR if cikiyor else CIZGI)
        if i == 1:
            with Katman(c, ai) as (im, d):
                ly = y + satir_h - 12
                etk, fe = 'PLAYOFF ÇİZGİSİ', inter(800, 26)
                tw = d.textlength(etk, font=fe)
                for x in range(80, W - 80, 30):
                    if not (W / 2 - tw / 2 - 24 < x + 8 < W / 2 + tw / 2 + 24):
                        d.line([(x, ly), (x + 16, ly)], fill=KIRMIZI, width=4)
                ortala(d, ly - 16, etk, fe, KIRMIZI)
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Sahne 4: gruba özel kapanış ───────────────────────────────────────────
def _cta(c, a, y=1420):
    with Katman(c, a) as (im, d):
        ortala(d, y, 'Yorumlara yaz', inter(900, 62), MOR)
        ortala(d, y + 90, "Canlı tahminler fextesports.com'da", inter(500, 32), MUTED)

def _iki_takim(c, a, sol_t, sag_t, deger, y_logo, renkler):
    with Katman(c, a) as (im, d):
        for tm, cx, rk in ((sol_t, 300, renkler[0]), (sag_t, W - 300, renkler[1])):
            lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 190)
            yapistir(im, lg, cx - lg.width / 2, y_logo + (190 - lg.height) / 2)
            f = inter(800, 40); s = kisa(tm, d, f, 380)
            d.text((cx - d.textlength(s, font=f) / 2, y_logo + 220), s, font=f, fill=INK)
            p = f"%{deger(tm) * 100 * a:.0f}"
            fp = inter(900, 128)
            d.text((cx - d.textlength(p, font=fp) / 2, y_logo + 280), p, font=fp, fill=rk)
        ortala(d, y_logo + 70, 'vs', inter(800, 50), FAINT)

def sahne_kapanis(g, t):
    c = _zemin()
    _ust_etiket(c, g['harf'])
    a1, a2 = _eas(t / 0.3), _eas((t - 0.35) / 0.3)
    tk = g['takimlar']
    tur = g['kapanis']
    if tur == 'turk':
        tm = next(x for x in tk if _turk_mu(x['ad']))
        sira = tk.index(tm) + 1
        with Katman(c, a1) as (im, d):
            lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 240)
            yapistir(im, lg, (W - lg.width) / 2, 260)
            ortala(d, 540, tm['ad'].upper(), inter(900, 84), INK)
            ortala(d, 650, 'playoff ihtimali', inter(600, 40), MUTED)
            ortala(d, 710, f"%{tm['cikar'] * 100 * a1:.0f}", inter(900, 240), KIRMIZI)
        with Katman(c, a2) as (im, d):
            ortala(d, 1010, f'Fextopus grubunda {sira}. sıraya koyuyor', inter(800, 42), INK)
            ortala(d, 1200, 'Sence FUT gruptan çıkar mı?', inter(900, 56), INK)
    elif tur == 'cizgi':
        ust, alt = tk[1], tk[2]
        with Katman(c, a1) as (im, d):
            ortala(d, 200, 'ÇİZGİDE KIYAMET', inter(900, 90), INK)
        _iki_takim(c, a1, ust, alt, lambda x: x['cikar'], 380, (MOR, MUTED))
        with Katman(c, a2) as (im, d):
            fark = (ust['cikar'] - alt['cikar']) * 100
            ortala(d, 960, f'Aradaki fark sadece {fark:.0f} puan', inter(800, 46), KIRMIZI)
            ortala(d, 1040, f"{alt['ad']} çizginin altında kaldı", inter(600, 38), MUTED)
            ortala(d, 1200, 'Fextopus haksız mı?', inter(900, 64), INK)
    elif tur == 'kafa':
        bir = sorted(tk, key=lambda x: -x['birinci'])[:2]
        with Katman(c, a1) as (im, d):
            ortala(d, 190, 'BİRİNCİLİK', inter(900, 96), INK)
            ortala(d, 300, 'YAZI TURA', inter(900, 96), KIRMIZI)
        _iki_takim(c, a1, bir[0], bir[1], lambda x: x['birinci'], 460, (MOR, MOR))
        with Katman(c, a2) as (im, d):
            ortala(d, 1030, 'grup birincisi olma ihtimali', inter(600, 36), MUTED)
            ortala(d, 1200, 'Sence hangisi lider?', inter(900, 64), INK)
    else:  # surpriz
        tm = tk[-1]
        with Katman(c, a1) as (im, d):
            ortala(d, 200, 'SÜRPRİZ ADAYI', inter(900, 96), INK)
            lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 230)
            yapistir(im, lg, (W - lg.width) / 2, 360)
            ortala(d, 620, tm['ad'].upper(), inter(900, 70), INK)
            ortala(d, 720, 'playoff ihtimali', inter(600, 40), MUTED)
            ortala(d, 780, f"%{tm['cikar'] * 100 * a1:.0f}", inter(900, 200), KIRMIZI)
        with Katman(c, a2) as (im, d):
            ortala(d, 1040, 'Fextopus şansını düşük görüyor', inter(800, 42), INK)
            ortala(d, 1200, 'Grubu karıştırır mı?', inter(900, 64), INK)
    _cta(c, a2)
    _alt_bilgi(c)
    return c.convert('RGB')

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
            if kalan < 0.3 and ciz is not sahne_kapanis:   # sahne geçişi: zemine kararma
                im = Image.blend(im, _zemin_cache().convert('RGB'), (0.3 - kalan) / 0.3)
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
