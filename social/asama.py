# -*- coding: utf-8 -*-
"""Champions aşama videosu — bir turun (kazananlar / elenme / decider) tüm maçları.

Kullanım:
    python asama.py kazananlar     → cikti/champions-kazananlar-maclari.mp4 (+ .txt)
    python asama.py elenme
    python asama.py decider

Kurucu (28 Eyl): "4 maçı birden göster". Aşama maçları iki güne yayılıyor
(ör. kazananlar 29-30 Eylül), hepsi tek videoda tarih/saatiyle listelenir.
Türk takımının maçı vurgulanır ve kapanış sahnesi ona ayrılır.

Tasarım champions.py ile aynı dil; saatler her koşuda veritabanından tazelenir
(PandaScore saatleri değiştirebiliyor — 28 Eyl'de FUT maçı 12:00'den 15:00'e kaydı).
"""
import os, sys, subprocess
from datetime import timedelta
from PIL import Image, ImageDraw
import psycopg

import radar
from radar import W, H, FPS, INK, MUTED, FAINT, MOR, GRI, YOL, AY, logo, ffmpeg_yolu, _turk_mu
import champions
from champions import (inter, Katman, ortala, yapistir, kisa, _zemin, _alt_bilgi, _eas,
                       KIRMIZI, KUTU, CIZGI, ETKINLIK)

ASAMALAR = {
    'kazananlar': ('Winners Match', 'KAZANANLAR MAÇLARI', 'Kazanan doğrudan playoff’a'),
    'elenme':     ('Elimination Match', 'ELENME MAÇLARI', 'Kaybeden turnuvaya veda ediyor'),
    'decider':    ('Decider Match', 'DECIDER MAÇLARI', 'Son playoff bileti'),
}
S_BASLIK, S_MACLAR, S_KAPANIS = 3.0, 8.0, 4.5

def veri(asama_kelime):
    sql = """
      SELECT t.name, m.scheduled_at, m.prediction_team_a,
             ta.id, ta.name, ta.acronym, ta.logo_url,
             tb.id, tb.name, tb.acronym, tb.logo_url
      FROM matches m
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN teams ta ON ta.id = m.team_a_id
      JOIN teams tb ON tb.id = m.team_b_id
      WHERE t.event_name = %s AND m.round_info ILIKE %s
        AND m.status <> 'finished' AND m.prediction_team_a IS NOT NULL
      ORDER BY m.scheduled_at
    """
    with psycopg.connect(os.environ['DATABASE_URL']) as cn, cn.cursor() as c:
        c.execute(sql, (ETKINLIK, f'%{asama_kelime}%'))
        satir = c.fetchall()
    maclar = []
    for grup, saat, pa, aid, aad, aac, alogo, bid, bad, bac, blogo in satir:
        maclar.append({
            'grup': grup.split()[-1], 'saat': saat + timedelta(hours=3), 'pa': float(pa),
            'a': {'id': aid, 'ad': aad, 'ac': aac, 'logo': alogo},
            'b': {'id': bid, 'ad': bad, 'ac': bac, 'logo': blogo},
        })
    return maclar

def _turk_mac(maclar):
    return next((m for m in maclar if _turk_mu(m['a']['ad']) or _turk_mu(m['b']['ad'])), None)

# ── Sahne 1 ───────────────────────────────────────────────────────────────
def sahne_baslik(maclar, baslik, alt, t):
    c = _zemin()
    a1, a2 = _eas(t / 0.3), _eas((t - 0.32) / 0.3)
    with Katman(c, a1) as (im, d):
        ortala(d, 300, 'VCT CHAMPIONS 2026', inter(800, 36), KIRMIZI)
        for i, kelime in enumerate(baslik.split()):
            ortala(d, 420 + i * 130, kelime, inter(900, 118), INK)
    with Katman(c, a2) as (im, d):
        ortala(d, 760, alt, inter(700, 44), MOR)
        gunler = sorted({(m['saat'].day, m['saat'].month) for m in maclar})
        metin = ' ve '.join(f'{g} {AY[ay]}' for g, ay in gunler)
        ortala(d, 880, f'{len(maclar)} maç · {metin}', inter(600, 38), MUTED)
    fx = YOL('assets', 'fextopus-icon.png')
    with Katman(c, a2) as (im, d):
        if os.path.exists(fx):
            ikon = Image.open(fx).convert('RGBA')
            ikon = ikon.resize((int(ikon.width * 150 / ikon.height), 150), Image.LANCZOS)
            yapistir(im, ikon, (W - ikon.width) / 2, 1080)
        ortala(d, 1270, 'Fextopus her maç için', inter(600, 38), MUTED)
        ortala(d, 1325, 'kazanma ihtimalini hesapladı', inter(800, 42), INK)
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Sahne 2 ───────────────────────────────────────────────────────────────
def _mac_karti(im, d, y, m, a):
    h = 272
    turk = _turk_mu(m['a']['ad']) or _turk_mu(m['b']['ad'])
    if turk:
        d.rounded_rectangle([50, y, W - 50, y + h], 26, fill=(52, 20, 30), outline=KIRMIZI, width=3)
    else:
        d.rounded_rectangle([50, y, W - 50, y + h], 26, fill=KUTU, outline=CIZGI, width=2)
    d.text((80, y + 22), f"GRUP {m['grup']}", font=inter(800, 26), fill=FAINT)
    g = m['saat']
    tarih = f'{g.day} {AY[g.month]} · {g:%H:%M}'
    d.text((W - 80 - d.textlength(tarih, font=inter(700, 30)), y + 20), tarih,
           font=inter(700, 30), fill=MUTED)
    pa = round(m['pa'] * 100)
    f_ad, f_p = inter(800, 40), inter(900, 46)
    for tm, pct, sag in ((m['a'], pa, False), (m['b'], 100 - pa, True)):
        lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 92)
        s = kisa(tm, d, f_ad, 300)
        ps = f'%{pct}'
        renk = MOR if pct >= 50 else FAINT
        if not sag:
            yapistir(im, lg, 82, y + 86 + (92 - lg.height) / 2)
            d.text((196, y + 90), s, font=f_ad, fill=INK)
            d.text((196, y + 140), ps, font=f_p, fill=renk)
        else:
            yapistir(im, lg, W - 82 - lg.width, y + 86 + (92 - lg.height) / 2)
            d.text((W - 196 - d.textlength(s, font=f_ad), y + 90), s, font=f_ad, fill=INK)
            d.text((W - 196 - d.textlength(ps, font=f_p), y + 140), ps, font=f_p, fill=renk)
    d.text((W / 2 - d.textlength('vs', font=inter(800, 34)) / 2, y + 116), 'vs',
           font=inter(800, 34), fill=FAINT)
    bx0, bx1, by = 90, W - 90, y + 218
    d.rounded_rectangle([bx0, by, bx1, by + 20], 10, fill=GRI)
    dolu = int((bx1 - bx0) * m['pa'] * a)
    kutu = [bx0, by, bx0 + dolu, by + 20] if pa >= 50 else [bx1 - dolu, by, bx1, by + 20]
    if dolu > 6:
        d.rounded_rectangle(kutu, 10, fill=MOR)
    return h

def sahne_maclar(maclar, baslik, alt, t):
    c = _zemin()
    a0 = _eas(t / 0.12)
    with Katman(c, a0) as (im, d):
        d.text((80, 96), 'VCT CHAMPIONS 2026', font=inter(800, 28), fill=KIRMIZI)
        d.text((80, 140), baslik, font=inter(900, 62), fill=INK)
        d.text((82, 226), alt, font=inter(600, 32), fill=MOR)
    y = 300
    for i, m in enumerate(maclar):
        ai = _eas((t - 0.1 - i * 0.14) / 0.22)
        with Katman(c, ai) as (im, d):
            h = _mac_karti(im, d, y, m, ai)
        y += h + 24
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Sahne 3 ───────────────────────────────────────────────────────────────
def sahne_kapanis(maclar, alt, t):
    c = _zemin()
    a1, a2 = _eas(t / 0.3), _eas((t - 0.35) / 0.3)
    m = _turk_mac(maclar) or maclar[0]
    turk = _turk_mu(m['a']['ad'])
    tk, rakip = (m['a'], m['b']) if turk or not _turk_mu(m['b']['ad']) else (m['b'], m['a'])
    p_tk = round((m['pa'] if tk is m['a'] else 1 - m['pa']) * 100)
    g = m['saat']
    with Katman(c, a1) as (im, d):
        lg = logo(tk['id'], tk['logo'], tk['ad'], tk['ac'], 200)
        yapistir(im, lg, (W - lg.width) / 2, 240)
        ortala(d, 470, f"{tk['ad'].upper()}", inter(900, 72), INK)
        ortala(d, 560, f"{rakip['ad']} karşısında", inter(600, 38), MUTED)
        ortala(d, 620, f'{g.day} {AY[g.month]} · {g:%H:%M}', inter(800, 40), INK)
        ortala(d, 690, alt, inter(600, 34), MOR)
    with Katman(c, a2) as (im, d):
        ortala(d, 820, "FEXTOPUS'UN TAHMİNİ", inter(800, 32), MUTED)
        bx0, bx1, by = 140, W - 140, 900
        d.rounded_rectangle([bx0, by, bx1, by + 28], 14, fill=GRI)
        dolu = int((bx1 - bx0) * p_tk / 100 * a2)
        if dolu > 6:
            d.rounded_rectangle([bx0, by, bx0 + dolu, by + 28], 14, fill=MOR)
        d.text((bx0, by + 46), f"{tk['ac'] or tk['ad']} %{p_tk}", font=inter(900, 44), fill=MOR)
        s = f"%{100 - p_tk} {rakip['ac'] or rakip['ad']}"
        d.text((bx1 - d.textlength(s, font=inter(900, 44)), by + 46), s, font=inter(900, 44), fill=MUTED)
        soru = (f"Fextopus {tk['ad']}'a inanmıyor." if p_tk < 50
                else f"Fextopus {tk['ad']}'ı favori görüyor.")
        ortala(d, 1120, soru, inter(800, 44), INK)
        ortala(d, 1200, 'Sen ne diyorsun?', inter(900, 58), MOR)
        ortala(d, 1330, "Canlı tahminler fextesports.com'da", inter(500, 32), MUTED)
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Video ─────────────────────────────────────────────────────────────────
def kareler(maclar, baslik, alt):
    sahneler = [(S_BASLIK, lambda t: sahne_baslik(maclar, baslik, alt, t)),
                (S_MACLAR, lambda t: sahne_maclar(maclar, baslik, alt, t)),
                (S_KAPANIS, lambda t: sahne_kapanis(maclar, alt, t))]
    for sure, ciz in sahneler:
        n = int(sure * FPS)
        for i in range(n):
            t = i / (n - 1)
            im = ciz(t)
            kalan = (1 - t) * sure
            if kalan < 0.3 and ciz is not sahneler[-1][1]:
                im = Image.blend(im, champions._zemin_cache().convert('RGB'), (0.3 - kalan) / 0.3)
            yield im

def aciklama(maclar, baslik, alt):
    s = [f'VCT Champions 2026 · {baslik.lower().capitalize()}', alt + '.', '']
    for m in maclar:
        pa = round(m['pa'] * 100)
        fav = m['a'] if pa >= 50 else m['b']
        g = m['saat']
        s.append(f"Grup {m['grup']} · {g.day} {AY[g.month]} {g:%H:%M} — {m['a']['ad']} vs {m['b']['ad']} "
                 f"(Fextopus: {fav['ad']} %{max(pa, 100 - pa)})")
    tm = _turk_mac(maclar)
    if tm:
        tk = tm['a'] if _turk_mu(tm['a']['ad']) else tm['b']
        p = round((tm['pa'] if tk is tm['a'] else 1 - tm['pa']) * 100)
        s += ['', f"{tk['ad']} için Fextopus'un tahmini %{p}. Sen ne diyorsun?"]
    s += ['', "Canlı tahminler fextesports.com'da.", '',
          '#valorant #vctchampions #espor' + (' #FUTesports' if tm else '')]
    return '\n'.join(s)

def uret(anahtar, dosya):
    kelime, baslik, alt = ASAMALAR[anahtar]
    maclar = veri(kelime)
    assert maclar, f'{kelime} için oynanmamış maç yok'
    pr = subprocess.Popen([ffmpeg_yolu(), '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
        '-r', str(FPS), '-i', '-', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', dosya], stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for im in kareler(maclar, baslik, alt):
        pr.stdin.write(im.tobytes())
    pr.stdin.close(); pr.wait()
    with open(os.path.splitext(dosya)[0] + '.txt', 'w', encoding='utf-8') as f:
        f.write(aciklama(maclar, baslik, alt))
    print(f'  {dosya}  ({os.path.getsize(dosya) // 1024} KB, {len(maclar)} maç)')

if __name__ == '__main__':
    anahtar = (sys.argv[1] if len(sys.argv) > 1 else 'kazananlar').lower()
    assert anahtar in ASAMALAR, f'Bilinmeyen aşama: {anahtar} (seçenekler: {", ".join(ASAMALAR)})'
    os.makedirs(radar.CIKTI, exist_ok=True)
    uret(anahtar, os.path.join(radar.CIKTI, f'champions-{anahtar}-maclari.mp4'))
