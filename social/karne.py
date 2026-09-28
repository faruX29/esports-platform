# -*- coding: utf-8 -*-
"""Fextopus karnesi — bir etkinlikte hangi maçları bildi, nerede yanıldı (1080x1920, ~21 sn).

Kullanım:  python karne.py                 → cikti/fextopus-karne-<tarih>.mp4 (+ .txt)

Kurucu isteği (28 Eyl): omurga KARNE listesi, ama Türk takımına vurgu.
Sahneler: başlık → 8 maçlık karne (FUT satırı çerçeveli) → skor (7/8) → Türk
takımının sıradaki maçı + Fextopus'un tahmini + soru.

Yanılgıyı saklamamak BİLEREK: güven veren şey doğru bildikleri değil, yanıldığını
da göstermesi. Aynı gerekçe /stats sayfasında da yazılı.

Tasarım champions.py ile aynı dil (Inter, saydam katman, alt bilgi).
"""
import os, sys, subprocess
from datetime import timedelta
from PIL import Image, ImageDraw

import radar
from radar import W, H, FPS, INK, MUTED, FAINT, MOR, GRI, YOL, AY, logo, ffmpeg_yolu, _turk_mu
import champions
from champions import (inter, Katman, ortala, yapistir, kisa, _zemin, _alt_bilgi,
                       _eas, KIRMIZI, KUTU, CIZGI, ELENDI, ETKINLIK, _elo)
import psycopg

S_BASLIK, S_KARNE, S_SKOR, S_KAPANIS = 3.0, 9.0, 4.0, 5.0

def veri():
    """Etkinliğin biten maçları (tahmin + sonuç) ve Türk takımının sıradaki maçı."""
    sql = """
      SELECT t.name, m.scheduled_at, m.status,
             ta.id, ta.name, ta.acronym, ta.logo_url,
             tb.id, tb.name, tb.acronym, tb.logo_url,
             m.team_a_score, m.team_b_score, m.winner_id, m.prediction_team_a
      FROM matches m
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN teams ta ON ta.id = m.team_a_id
      JOIN teams tb ON tb.id = m.team_b_id
      WHERE t.event_name = %s AND m.prediction_team_a IS NOT NULL
      ORDER BY m.scheduled_at
    """
    with psycopg.connect(os.environ['DATABASE_URL']) as cn, cn.cursor() as c:
        c.execute(sql, (ETKINLIK,))
        satir = c.fetchall()
    bitmis, siradaki = [], []
    for (grup, saat, durum, aid, aad, aac, alogo, bid, bad, bac, blogo,
         sa, sb, kazanan, pa) in satir:
        m = {
            'grup': grup.split()[-1], 'saat': saat + timedelta(hours=3),
            'a': {'id': aid, 'ad': aad, 'ac': aac, 'logo': alogo},
            'b': {'id': bid, 'ad': bad, 'ac': bac, 'logo': blogo},
            'sa': sa, 'sb': sb, 'pa': float(pa),
        }
        m['fav'] = m['a'] if m['pa'] >= 0.5 else m['b']
        m['fav_yuzde'] = round(max(m['pa'], 1 - m['pa']) * 100)
        if durum == 'finished' and kazanan:
            m['kazanan'] = m['a'] if kazanan == aid else m['b']
            m['dogru'] = m['kazanan']['id'] == m['fav']['id']
            bitmis.append(m)
        elif durum != 'finished':
            siradaki.append(m)
    return bitmis, siradaki

def turk_maci(bitmis, siradaki):
    """Türk takımının son kazandığı maç + sıradaki maçı (kapanış sahnesi için)."""
    son = next((m for m in reversed(bitmis) if _turk_mu(m['a']['ad']) or _turk_mu(m['b']['ad'])), None)
    gelecek = next((m for m in siradaki if _turk_mu(m['a']['ad']) or _turk_mu(m['b']['ad'])), None)
    return son, gelecek

# ── Sahne 1: başlık ───────────────────────────────────────────────────────
def sahne_baslik(veriler, t):
    bitmis, _ = veriler
    c = _zemin()
    a1, a2 = _eas(t / 0.3), _eas((t - 0.3) / 0.3)
    with Katman(c, a1) as (im, d):
        # Maskot başlığın üstünde: karne "Fextopus'un" karnesi, marka yüzü görünsün.
        fx = YOL('assets', 'fextopus-icon.png')
        if os.path.exists(fx):
            ikon = Image.open(fx).convert('RGBA')
            ikon = ikon.resize((int(ikon.width * 210 / ikon.height), 210), Image.LANCZOS)
            yapistir(im, ikon, (W - ikon.width) / 2, 300 + (1 - a1) * 26)
        ortala(d, 560, 'FEXTOPUS', inter(900, 150), INK)
        ortala(d, 720, 'KARNESİ', inter(900, 150), MOR)
    with Katman(c, a2) as (im, d):
        ortala(d, 960, 'VCT Champions 2026 · grup açılış maçları', inter(600, 40), MUTED)
        ortala(d, 1040, f'{len(bitmis)} maç, tek tek', inter(800, 44), INK)
        ortala(d, 1200, 'Doğru bildikleri kadar', inter(600, 36), MUTED)
        ortala(d, 1252, 'yanıldığı maç da burada', inter(800, 40), INK)
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Sahne 2: karne listesi ────────────────────────────────────────────────
def _karne_satiri(im, d, y, m, a):
    h = 128
    turk = _turk_mu(m['a']['ad']) or _turk_mu(m['b']['ad'])
    if turk:
        d.rounded_rectangle([50, y, W - 50, y + h], 22, fill=(52, 20, 30), outline=KIRMIZI, width=3)
    else:
        d.rounded_rectangle([50, y, W - 50, y + h], 22, fill=KUTU, outline=CIZGI, width=2)
    d.text((74, y + 14), f"GRUP {m['grup']}", font=inter(800, 20), fill=FAINT)
    # Takımlar + skor
    f_ad = inter(800, 32)
    for tm, skor, x, sag in ((m['a'], m['sa'], 74, False), (m['b'], m['sb'], W - 74, True)):
        lg = logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], 52)
        s = tm['ac'] if tm.get('ac') and len(tm['ac']) <= 6 else kisa(tm, d, f_ad, 160)
        kazandi = m['kazanan']['id'] == tm['id']
        renk = INK if kazandi else MUTED
        if not sag:
            yapistir(im, lg, x, y + 52)
            d.text((x + 66, y + 58), s, font=f_ad, fill=renk)
        else:
            yapistir(im, lg, x - lg.width, y + 52)
            d.text((x - 66 - d.textlength(s, font=f_ad), y + 58), s, font=f_ad, fill=renk)
    skor = f"{m['sa']} - {m['sb']}"
    ortala(d, y + 52, skor, inter(900, 46), INK)
    # Tahmin ve sonuç
    tahmin = f"Fextopus: {m['fav']['ac'] or m['fav']['ad']} %{m['fav_yuzde']}"
    d.text((W / 2 - d.textlength(tahmin, font=inter(600, 24)) / 2, y + 100), tahmin,
           font=inter(600, 24), fill=FAINT)
    isaret, renk = ('DOĞRU', MOR) if m['dogru'] else ('YANILDI', ELENDI)
    f = inter(900, 26)
    w = d.textlength(isaret, font=f) + 40
    d.rounded_rectangle([W - 74 - w, y + 12, W - 74, y + 52], 20, fill=renk)
    d.text((W - 74 - w / 2 - d.textlength(isaret, font=f) / 2, y + 19), isaret, font=f,
           fill=(10, 14, 22) if m['dogru'] else INK)
    return h

def sahne_karne(veriler, t):
    bitmis, _ = veriler
    c = _zemin()
    a0 = _eas(t / 0.1)
    with Katman(c, a0) as (im, d):
        d.text((80, 96), 'VCT CHAMPIONS 2026', font=inter(800, 28), fill=KIRMIZI)
        d.text((80, 140), 'AÇILIŞ MAÇLARI', font=inter(900, 66), fill=INK)
    y = 250
    for i, m in enumerate(bitmis):
        ai = _eas((t - 0.08 - i * 0.085) / 0.16)
        with Katman(c, ai) as (im, d):
            h = _karne_satiri(im, d, y, m, ai)
        y += h + 22
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Sahne 3: skor ─────────────────────────────────────────────────────────
def sahne_skor(veriler, t):
    bitmis, _ = veriler
    dogru = sum(1 for m in bitmis if m['dogru'])
    yanlis = next((m for m in bitmis if not m['dogru']), None)
    c = _zemin()
    a1, a2 = _eas(t / 0.3), _eas((t - 0.35) / 0.3)
    with Katman(c, a1) as (im, d):
        ortala(d, 420, 'FEXTOPUS', inter(800, 44), MUTED)
        ortala(d, 500, f'{int(dogru * a1)} / {len(bitmis)}', inter(900, 300), MOR)
        ortala(d, 840, f'açılış maçlarında %{dogru / len(bitmis) * 100:.0f} isabet',
               inter(700, 40), INK)
    if yanlis:
        with Katman(c, a2) as (im, d):
            ortala(d, 1010, 'Tek yanıldığı maç', inter(600, 36), MUTED)
            ad = f"{yanlis['a']['ad']} – {yanlis['b']['ad']}"
            ortala(d, 1070, ad, inter(900, 48), INK)
            ortala(d, 1140, f"Fextopus {yanlis['fav']['ad']} demişti (%{yanlis['fav_yuzde']}), "
                            f"{yanlis['kazanan']['ad']} kazandı", inter(500, 30), ELENDI)
    with Katman(c, a2) as (im, d):
        ortala(d, 1320, 'Genel isabet oranımız 36 binden fazla maçta %63.', inter(500, 30), FAINT)
        ortala(d, 1366, 'Hepsi fextesports.com/stats sayfasında.', inter(500, 30), FAINT)
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Sahne 4: Türk takımı + sıradaki maç ───────────────────────────────────
def sahne_kapanis(veriler, t):
    bitmis, siradaki = veriler
    son, gelecek = turk_maci(bitmis, siradaki)
    c = _zemin()
    a1, a2, a3 = _eas(t / 0.25), _eas((t - 0.28) / 0.25), _eas((t - 0.56) / 0.25)
    if son:
        tk = son['a'] if _turk_mu(son['a']['ad']) else son['b']
        rakip = son['b'] if tk is son['a'] else son['a']
        skor = f"{son['sa']} - {son['sb']}" if tk is son['a'] else f"{son['sb']} - {son['sa']}"
        with Katman(c, a1) as (im, d):
            lg = logo(tk['id'], tk['logo'], tk['ad'], tk['ac'], 170)
            yapistir(im, lg, (W - lg.width) / 2, 200)
            ortala(d, 400, f"{tk['ad'].upper()}  {skor}", inter(900, 70), INK)
            ortala(d, 490, f"{rakip['ad']} karşısında", inter(600, 34), MUTED)
            ok = son['dogru']
            ortala(d, 550, f"Fextopus {son['fav_yuzde']}% demişti" + (' ✓' if ok else ' ✗'),
                   inter(700, 36), MOR if ok else ELENDI)
    if gelecek:
        tk = gelecek['a'] if _turk_mu(gelecek['a']['ad']) else gelecek['b']
        rakip = gelecek['b'] if tk is gelecek['a'] else gelecek['a']
        p_turk = round((gelecek['pa'] if tk is gelecek['a'] else 1 - gelecek['pa']) * 100)
        g = gelecek['saat']
        with Katman(c, a2) as (im, d):
            ortala(d, 700, 'SIRADAKİ MAÇ', inter(800, 34), MUTED)
            ortala(d, 760, f"{tk['ad']}  –  {rakip['ad']}", inter(900, 56), INK)
            ortala(d, 840, f"{g.day} {AY[g.month]} · {g:%H:%M} · kazanan playoff'a",
                   inter(600, 34), MUTED)
            # Fextopus barı
            bx0, bx1, by = 140, W - 140, 940
            d.rounded_rectangle([bx0, by, bx1, by + 26], 13, fill=GRI)
            dolu = int((bx1 - bx0) * p_turk / 100)
            d.rounded_rectangle([bx0, by, bx0 + dolu, by + 26], 13, fill=MOR)
            d.text((bx0, by + 44), f"{tk['ac'] or tk['ad']} %{p_turk}", font=inter(900, 40), fill=MOR)
            s = f"%{100 - p_turk} {rakip['ac'] or rakip['ad']}"
            d.text((bx1 - d.textlength(s, font=inter(900, 40)), by + 44), s,
                   font=inter(900, 40), fill=MUTED)
        with Katman(c, a3) as (im, d):
            soru = ('Fextopus bu maçta ' + tk['ad'] + "'a inanmıyor."
                    if p_turk < 50 else 'Fextopus ' + tk['ad'] + "'ı favori görüyor.")
            ortala(d, 1140, soru, inter(800, 42), INK)
            ortala(d, 1210, 'Sen ne diyorsun?', inter(900, 56), MOR)
            ortala(d, 1330, "Canlı tahminler fextesports.com'da", inter(500, 32), MUTED)
    _alt_bilgi(c)
    return c.convert('RGB')

# ── Video ─────────────────────────────────────────────────────────────────
def kareler(veriler):
    for sure, ciz in ((S_BASLIK, sahne_baslik), (S_KARNE, sahne_karne),
                      (S_SKOR, sahne_skor), (S_KAPANIS, sahne_kapanis)):
        n = int(sure * FPS)
        for i in range(n):
            t = i / (n - 1)
            im = ciz(veriler, t)
            kalan = (1 - t) * sure
            if kalan < 0.3 and ciz is not sahne_kapanis:
                im = Image.blend(im, champions._zemin_cache().convert('RGB'), (0.3 - kalan) / 0.3)
            yield im

def aciklama(veriler):
    bitmis, siradaki = veriler
    dogru = sum(1 for m in bitmis if m['dogru'])
    son, gelecek = turk_maci(bitmis, siradaki)
    s = [f"Fextopus, VCT Champions açılış maçlarının {len(bitmis)}'inde {dogru} doğru tahmin yaptı.", '']
    for m in bitmis:
        isaret = '✓' if m['dogru'] else '✗'
        s.append(f"{isaret} {m['a']['ad']} {m['sa']}-{m['sb']} {m['b']['ad']} "
                 f"(tahmin: {m['fav']['ad']} %{m['fav_yuzde']})")
    if gelecek:
        tk = gelecek['a'] if _turk_mu(gelecek['a']['ad']) else gelecek['b']
        rakip = gelecek['b'] if tk is gelecek['a'] else gelecek['a']
        p = round((gelecek['pa'] if tk is gelecek['a'] else 1 - gelecek['pa']) * 100)
        g = gelecek['saat']
        s += ['', f"Sıradaki: {tk['ad']} – {rakip['ad']}, {g.day} {AY[g.month]} {g:%H:%M}. "
                  f"Fextopus {tk['ad']}'a %{p} veriyor. Sen ne diyorsun?"]
    s += ['', "Tüm tahminler ve isabet oranları fextesports.com'da.", '',
          '#valorant #vctchampions #espor #FUTesports']
    return '\n'.join(s)

def uret(dosya):
    veriler = veri()
    bitmis, _ = veriler
    assert bitmis, 'Bitmiş maç yok'
    pr = subprocess.Popen([ffmpeg_yolu(), '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
        '-r', str(FPS), '-i', '-', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '64k',
        '-movflags', '+faststart', dosya], stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for im in kareler(veriler):
        pr.stdin.write(im.tobytes())
    pr.stdin.close(); pr.wait()
    with open(os.path.splitext(dosya)[0] + '.txt', 'w', encoding='utf-8') as f:
        f.write(aciklama(veriler))
    print(f'  {dosya}  ({os.path.getsize(dosya) // 1024} KB, {len(bitmis)} maç)')

if __name__ == '__main__':
    from datetime import date
    os.makedirs(radar.CIKTI, exist_ok=True)
    uret(os.path.join(radar.CIKTI, f'fextopus-karne-{date.today():%d-%m}.mp4'))
