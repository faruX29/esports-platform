# -*- coding: utf-8 -*-
"""Türk takımı kadro değişikliği videosu (Reels, 1080x1920).

Kullanım:
  python kadro.py                     yeni Türk takımı transfer haberlerinden video üret, haberleri işaretle
  python kadro.py --kuru              aynısı, işaretlemeden (deneme)
  python kadro.py --takim <id> [--gun 30]   o takımın son N gündeki değişiklikleri, işaretlemeden

Kaynak YAYINLANMIŞ transfer haberidir (news_articles, content_type='transfer'), ham kadro
farkı değil: haberin 12 saat beklemesi ve sahte ayrılış süzgeci (news_generator.py) burada da
geçerli olur; video sitede okunacak bir habere gönderir. Aynı Türk takımının birikmiş
değişiklikleri tek videoda (ör. 4 oyuncu aynı gün katıldı → tek video).

Hangi haberin videosu üretildi: ekler.reels = üretim günü. Radar iş akışı saatlerce
gecikebildiği için zaman penceresi yerine işaret kullanılır (pencere kayınca haber kaçar).

Görsel dil radarla aynı (mor orta ışıma, alt bilgi); sahneler: takım → değişiklik → çağrı.
Renk dili: yeşil = katıldı, kırmızı = ayrıldı, "?" = takımı belli değil.
"""
import argparse, os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFilter
import psycopg
from psycopg.types.json import Jsonb

import radar
from radar import W, H, FPS, BG, INK, MUTED, FAINT, MOR, MOR_D, YOL, AY, logo, takim_etiketi
from champions import inter, Katman, ortala, yapistir, _alt_bilgi, _eas, KIRMIZI, YESIL, CIZGI
from haftalik import _ikon, _yaz

TSI = timezone(timedelta(hours=3))
# İlk koşuda geçmişteki bütün Türk transfer haberleri videoya dönmesin: yalnız son 3 gün.
YENI_GUN = 3
MAKS_SATIR = 6
S_BASLIK, S_DEGISIKLIK, S_KAPANIS = 3.0, 5.5, 4.0
# oyun slug'ı → (ikon dosyası, etiket, ad)
OYUN = {'valorant': ('valorant', '#valorant', 'VALORANT'),
        'csgo': ('cs2', '#cs2', 'CS2'), 'cs-go': ('cs2', '#cs2', 'CS2'), 'cs2': ('cs2', '#cs2', 'CS2'),
        'lol': ('lol', '#leagueoflegends', 'LoL'), 'league-of-legends': ('lol', '#leagueoflegends', 'LoL')}
KATILDI_DOLGU, AYRILDI_DOLGU = (18, 44, 32), (50, 20, 30)


# ── Veri ──────────────────────────────────────────────────────────────────
def haberler(takim=None, gun=YENI_GUN, hepsi=False):
    """Türk takımlı transfer haberleri. takim verilirse yalnız o takımınkiler;
    hepsi=False ise videosu üretilmiş (ekler.reels) olanlar atlanır."""
    sql = """
      SELECT na.id, na.created_at, na.hero_score,
             (na.ekler->>'eski_takim_id')::bigint, (na.ekler->>'yeni_takim_id')::bigint,
             p.nickname, p.id, p.team_pandascore_id
      FROM news_articles na
      LEFT JOIN players p ON p.id::text = na.ekler->>'oyuncu_id'
      WHERE na.content_type = 'transfer'
        AND na.created_at > NOW() - make_interval(days => %(gun)s)
        AND (%(hepsi)s OR NOT (COALESCE(na.ekler, '{}'::jsonb) ? 'reels'))
        AND EXISTS (SELECT 1 FROM turk_takimlar k
                    WHERE k.team_id::text IN (na.ekler->>'eski_takim_id', na.ekler->>'yeni_takim_id'))
        AND (%(takim)s::bigint IS NULL OR %(takim)s::bigint IN ((na.ekler->>'eski_takim_id')::bigint,
                                                                (na.ekler->>'yeni_takim_id')::bigint))
      ORDER BY na.created_at
    """
    with psycopg.connect(os.environ['DATABASE_URL']) as cn:
        rows = cn.execute(sql, {'gun': gun, 'hepsi': hepsi, 'takim': takim}).fetchall()
        ids = {t for r in rows for t in (r[3], r[4]) if t}
        takimlar = {}
        if ids:
            for tid, ad, ac, lg, slug, oyun in cn.execute("""
                SELECT t.id, t.name, t.acronym, t.logo_url, t.slug, g.slug
                FROM teams t LEFT JOIN games g ON g.id = t.game_id
                WHERE t.id = ANY(%s)""", (list(ids),)):
                takimlar[tid] = {'id': tid, 'ad': (ad or '').strip(), 'ac': ac, 'logo': lg,
                                 'slug': slug, 'oyun': oyun, 'tr': radar._turk_mu(tid=tid)}
    return [{'haber': hid, 'zaman': zaman, 'oyuncu': nick or hero or '?',
             'eski': takimlar.get(eski), 'yeni': takimlar.get(yeni),
             'tutarli': _tutarli(pid, guncel, eski, yeni)}
            for hid, zaman, hero, eski, yeni, nick, pid, guncel in rows]


def _tutarli(oyuncu_id, guncel, eski, yeni):
    """Otomatik teyit: oyuncunun BUGÜNKÜ takımı haberle hâlâ uyuşuyor mu?
    PandaScore kadroyu bir süre yanlış gösterip geri alabiliyor; geri alınmış
    değişikliğin videosu çıkmasın. Katılım: hâlâ yeni takımda. Ayrılış: eski
    takımına dönmemiş. Oyuncu kaydı yoksa bakılamaz (None) ve atlanmaz."""
    if oyuncu_id is None:
        return None
    return guncel == yeni if yeni else guncel != eski


def grupla(liste, takim=None):
    """Konu takımı başına bir video. Konu: yeni takım Türkse o (katılım daha çok ilgi
    çeker; Phoenix → Royal Foxes gibi iki Türk takımı arasında da), değilse eski takım."""
    gruplar = {}
    for h in liste:
        if takim is not None:
            konu = h['yeni'] if h['yeni'] and h['yeni']['id'] == takim else h['eski']
        else:
            konu = h['yeni'] if h['yeni'] and h['yeni']['tr'] else h['eski']
        if not konu:
            continue
        g = gruplar.setdefault(konu['id'], {'takim': konu, 'satirlar': {}, 'haberler': []})
        g['haberler'].append(h['haber'])
        # Aynı oyuncunun birden çok kaydı varsa son durum (sıralı geldiği için üzerine yazılır)
        g['satirlar'][h['oyuncu']] = {
            **h, 'katildi': bool(h['yeni'] and h['yeni']['id'] == konu['id']),
        }
    for g in gruplar.values():
        g['satirlar'] = list(g['satirlar'].values())
        g['zaman'] = max(s['zaman'] for s in g['satirlar'])
    return list(gruplar.values())


def isaretle(haber_idleri, gun):
    with psycopg.connect(os.environ['DATABASE_URL']) as cn:
        cn.execute("""UPDATE news_articles
                      SET ekler = COALESCE(ekler, '{}'::jsonb) || %s
                      WHERE id = ANY(%s)""", (Jsonb({'reels': gun}), list(haber_idleri)))


# ── Çizim ─────────────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def _zemin_cache():
    """Radarın zemini: ortada mor ışıma."""
    c = Image.new('RGB', (W, H), BG)
    g = Image.new('RGB', (W, H), BG)
    ImageDraw.Draw(g).ellipse([W // 2 - 620, 520, W // 2 + 620, 1620], fill=MOR_D)
    return Image.blend(c, g.filter(ImageFilter.GaussianBlur(280)), 0.16).convert('RGBA')


def _zemin():
    return _zemin_cache().copy()


def _sigdir(d, metin, agirlik, boyut, maks):
    """Metin maks genişliğe sığana kadar fontu küçült."""
    while boyut > 24:
        f = inter(agirlik, boyut)
        if d.textlength(metin, font=f) <= maks:
            return f
        boyut -= 4
    return inter(agirlik, boyut)


def _bilinmeyen(boy):
    """Takımı belli değil: kesikli halka + soru işareti."""
    im = Image.new('RGBA', (boy, boy), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    k = max(3, boy // 40)
    for i in range(0, 360, 20):
        d.arc([k, k, boy - k, boy - k], i, i + 11, fill=CIZGI, width=k)
    f = inter(900, int(boy * 0.46))
    d.text(((boy - d.textlength('?', font=f)) / 2, boy * 0.2), '?', font=f, fill=FAINT)
    return im


def _logo(tm, boy):
    return logo(tm['id'], tm['logo'], tm['ad'], tm['ac'], boy) if tm else _bilinmeyen(boy)


def _ok(d, x0, x1, y, renk, kalin, ilerleme=1.0):
    """x0'dan x1'e çizilen ok (x1 < x0 ise sola bakar); ilerleme ile uzar."""
    if ilerleme <= 0.01:
        return
    yon = 1 if x1 >= x0 else -1
    uc = x0 + (x1 - x0) * ilerleme
    d.line([(x0, y), (uc, y)], fill=renk, width=kalin)
    b = kalin * 2.6
    d.line([(uc - yon * b, y - b), (uc, y), (uc - yon * b, y + b)], fill=renk, width=kalin, joint='curve')


def _hap(d, cx, y, metin, katildi, boyut=40):
    f = inter(800, boyut)
    w = d.textlength(metin, font=f)
    px, h = boyut * 0.8, boyut * 1.7
    d.rounded_rectangle([cx - w / 2 - px, y, cx + w / 2 + px, y + h], int(h / 2),
                        fill=KATILDI_DOLGU if katildi else AYRILDI_DOLGU)
    d.text((cx - w / 2, y + (h - boyut * 1.2) / 2), metin, font=f, fill=YESIL if katildi else KIRMIZI)


def _oyun_ikonu(takim, boy):
    o = OYUN.get(takim.get('oyun') or '')
    return _ikon(YOL('assets', 'oyun', f'{o[0]}.png'), boy) if o else None


def sahne_baslik(g, t):
    tk = g['takim']
    c = _zemin()
    a1, a2 = _eas(t / 0.3), _eas((t - 0.3) / 0.3)
    with Katman(c, a1) as (im, d):
        oi = _oyun_ikonu(tk, 64)
        if oi:
            yapistir(im, oi, (W - oi.width) / 2, 300)
        lg = _logo(tk, 320)
        yapistir(im, lg, (W - lg.width) / 2, 420 + (320 - lg.height) / 2 + (1 - a1) * 26)
        ortala(d, 790, tk['ad'], _sigdir(d, tk['ad'], 900, 84, W - 160), INK)
    with Katman(c, a2) as (im, d):
        y = 960 + (1 - a2) * 26
        ortala(d, y, 'KADRO', _sigdir(d, 'KADRO', 900, 170, W - 160), INK)
        ortala(d, y + 190, 'DEĞİŞİKLİĞİ', _sigdir(d, 'DEĞİŞİKLİĞİ', 900, 150, W - 160), MOR)
        z = g['zaman'].astimezone(TSI)
        ortala(d, y + 400, f'{z.day} {AY[z.month]}', inter(700, 44), MUTED)
    _alt_bilgi(c)
    return c.convert('RGB')


def _tek(c, s, t):
    """Tek değişiklik: oyuncu adı büyük, altında eski takım → yeni takım."""
    a1, a2, a3 = _eas(t / 0.15), _eas((t - 0.12) / 0.18), _eas((t - 0.3) / 0.25)
    with Katman(c, a1) as (im, d):
        _hap(d, W / 2, 580, 'KATILDI' if s['katildi'] else 'AYRILDI', s['katildi'])
        ortala(d, 690 + (1 - a1) * 20, s['oyuncu'], _sigdir(d, s['oyuncu'], 900, 150, W - 140), INK)
    with Katman(c, a2) as (im, d):
        for tm, cx, etiket in ((s['eski'], 270, 'ESKİ TAKIM'), (s['yeni'], W - 270, 'YENİ TAKIM')):
            ortala_x(d, cx, 990, etiket, inter(700, 30), FAINT)
            lg = _logo(tm, 240)
            yapistir(im, lg, cx - lg.width / 2, 1050 + (240 - lg.height) / 2)
            # Kısaltma yerine küçült: "GS" Galatasaray'ı tanıtmıyor, tam ad 460px'e sığar
            ad = tm['ad'] if tm else 'Belli değil'
            konu = tm and tm['tr']
            ortala_x(d, cx, 1320, ad, _sigdir(d, ad, 800, 42, 460), INK if konu else MUTED)
    with Katman(c, 1) as (im, d):
        _ok(d, 430, W - 430, 1170, MOR, 10, a3)


def ortala_x(d, cx, y, metin, font, renk):
    d.text((cx - d.textlength(metin, font=font) / 2, y), metin, font=font, fill=renk)


def _satir(im, d, y, s, h):
    """Çoklu değişiklik satırı: şerit rengi katıldı/ayrıldı, sağda öbür takım ve ok yönü."""
    renk = YESIL if s['katildi'] else KIRMIZI
    d.rounded_rectangle([50, y, W - 50, y + h], 30, fill=KATILDI_DOLGU if s['katildi'] else AYRILDI_DOLGU)
    d.rounded_rectangle([50, y, 64, y + h], 7, fill=renk)
    # Az satırda (≤3) satır büyür: telefonda bir bakışta okunsun
    buyuk = h > 190
    f = _sigdir(d, s['oyuncu'], 900, 68 if buyuk else 56, 520)
    d.text((110, y + h / 2 - (64 if buyuk else 52)), s['oyuncu'], font=f, fill=INK)
    d.text((110, y + h / 2 + (20 if buyuk else 14)), 'KATILDI' if s['katildi'] else 'AYRILDI',
           font=inter(800, 36 if buyuk else 32), fill=renk)
    # Öbür takım: katılımda geldiği, ayrılışta gittiği. Ok oyuncunun hareket yönünde.
    obur = s['eski'] if s['katildi'] else s['yeni']
    lg = _logo(obur, 128 if buyuk else 104)
    lx = W - 100 - lg.width
    yapistir(im, lg, lx, y + (h - lg.height) / 2)
    ox0, ox1 = lx - 150, lx - 40
    if s['katildi']:
        _ok(d, ox1, ox0, y + h / 2, MUTED, 7)
    else:
        _ok(d, ox0, ox1, y + h / 2, MUTED, 7)


def _coklu(c, g, t):
    tk = g['takim']
    satirlar = g['satirlar'][:MAKS_SATIR]
    with Katman(c, _eas(t / 0.1)) as (im, d):
        lg = _logo(tk, 96)
        f = _sigdir(d, tk['ad'], 900, 60, W - 160 - 120)
        yapistir(im, lg, 80, 140 + (96 - lg.height) / 2)
        d.text((80 + 120, 154), tk['ad'], font=f, fill=INK)
    h, ara = (230, 28) if len(satirlar) <= 3 else (170, 22)
    adim = h + ara
    y = 300 + max(0, (1660 - 300 - adim * len(satirlar)) // 2)
    gecis = 0.55 / max(1, len(satirlar))
    for i, s in enumerate(satirlar):
        ai = _eas((t - 0.06 - i * gecis) / 0.14)
        with Katman(c, ai) as (im, d):
            _satir(im, d, y + (1 - ai) * 30, s, h)
        y += adim


def sahne_degisiklik(g, t):
    c = _zemin()
    if len(g['satirlar']) == 1:
        _tek(c, g['satirlar'][0], t)
    else:
        _coklu(c, g, t)
    _alt_bilgi(c)
    return c.convert('RGB')


def sahne_kapanis(g, t):
    """Kapanış: soru (yorum) + siteye çağrı. Kadronun tamamı bilerek videoda yok: sitede."""
    tk = g['takim']
    c = _zemin()
    a1, a2 = _eas(t / 0.25), _eas((t - 0.3) / 0.25)
    with Katman(c, a1) as (im, d):
        lg = _logo(tk, 200)
        yapistir(im, lg, (W - lg.width) / 2, 540 + (200 - lg.height) / 2)
        ortala(d, 810, 'Sence doğru hamle mi?', _sigdir(d, 'Sence doğru hamle mi?', 900, 76, W - 160), INK)
    with Katman(c, a2) as (im, d):
        y = 1120 + (1 - a2) * 20
        ortala(d, y, 'Güncel kadro ve haberin tamamı', inter(700, 44), MUTED)
        ortala(d, y + 70, 'fextesports.com', inter(900, 100), MOR)
        ortala(d, y + 200, 'link profilde', inter(600, 40), FAINT)
    _alt_bilgi(c)
    return c.convert('RGB')


def kareler(g):
    n_ek = max(0, min(len(g['satirlar']), MAKS_SATIR) - 2)
    sahneler = [(S_BASLIK, sahne_baslik), (S_DEGISIKLIK + 0.5 * n_ek, sahne_degisiklik),
                (S_KAPANIS, sahne_kapanis)]
    # Sahne geçişi zemine söner; alt bilgi yerinde kalır (titremesin)
    bos = _zemin()
    _alt_bilgi(bos)
    bos = bos.convert('RGB')
    for sure, ciz in sahneler:
        n = int(sure * FPS)
        son = ciz is sahneler[-1][1]
        for i in range(n):
            t = i / (n - 1)
            im = ciz(g, t)
            kalan = (1 - t) * sure
            if kalan < 0.3 and not son:
                im = Image.blend(im, bos, (0.3 - kalan) / 0.3)
            yield im


# ── Paylaşım metni ────────────────────────────────────────────────────────
def aciklama(g):
    tk = g['takim']
    oyun = OYUN.get(tk.get('oyun') or '')
    s = [f"{tk['ad']} kadrosunda değişiklik" + (f" ({oyun[2]})." if oyun else '.'), '']
    for r in g['satirlar']:
        if r['katildi']:
            nereden = f" (önceki takımı: {r['eski']['ad']})" if r['eski'] else ''
            s.append(f"+ {r['oyuncu']} katıldı{nereden}")
        else:
            nereye = f", yeni takımı: {r['yeni']['ad']}" if r['yeni'] else ' (yeni takımı henüz belli değil)'
            s.append(f"- {r['oyuncu']} ayrıldı{nereye}")
    s += ['', "Güncel kadro ve haberin tamamı fextesports.com'da, link profilde.", '']
    # En fazla 5 etiket (Instagram/TikTok sınırı): takım → oyun → #espor → #transfer → öbür takımlar
    etiketler = [takim_etiketi(tk['ad']), oyun[1] if oyun else None, '#espor', '#transfer']
    for r in g['satirlar']:
        obur = r['eski'] if r['katildi'] else r['yeni']
        etiketler.append(takim_etiketi(obur['ad']) if obur else None)
    s.append(' '.join(radar._tekil(etiketler)[:radar.MAKS_ETIKET]))
    return '\n'.join(s)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--takim', type=int, help='yalnız bu takım (işaretlemez, üretilmişleri de alır)')
    ap.add_argument('--gun', type=int, default=None, help=f'kaç günlük haber (varsayılan {YENI_GUN}; --takim ile 30)')
    ap.add_argument('--kuru', action='store_true', help='haberleri işaretleme')
    arg = ap.parse_args()

    gun_sayisi = arg.gun or (30 if arg.takim else YENI_GUN)
    liste = haberler(takim=arg.takim, gun=gun_sayisi, hepsi=arg.takim is not None)
    tutarsiz = [h for h in liste if h['tutarli'] is False]
    liste = [h for h in liste if h['tutarli'] is not False]
    for h in tutarsiz:
        print(f"Atlandı (kadro geri alınmış ya da yine değişmiş): {h['oyuncu']}")
    gruplar = grupla(liste, takim=arg.takim)
    if not gruplar:
        print('Yeni Türk takımı kadro değişikliği yok — kadro videosu üretilmedi.')
    bugun = datetime.now(TSI).date().isoformat()
    # Tutarsızlar da işaretlenir ki her gün yeniden denenmesin
    if tutarsiz and not (arg.kuru or arg.takim):
        isaretle([h['haber'] for h in tutarsiz], f'tutarsiz-{bugun}')
    os.makedirs(radar.CIKTI, exist_ok=True)
    for g in gruplar:
        ad = g['takim']['slug'] or str(g['takim']['id'])
        dosya = os.path.join(radar.CIKTI, f'kadro-{ad}-{bugun}.mp4')
        print(f"{g['takim']['ad']}: {len(g['satirlar'])} değişiklik")
        _yaz(dosya, kareler(g), aciklama(g))
        if not (arg.kuru or arg.takim):
            isaretle(g['haberler'], bugun)
