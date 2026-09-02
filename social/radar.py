# -*- coding: utf-8 -*-
"""feXt — Fextopus Maç Radarı: oyun başına günlük S/A maç videosu (1080x1920).

Kullanım:  python radar.py [YYYY-AA-GG]   (varsayılan: bugün)

Logo kuralları:
  1. social/elle/<takim_id>.png varsa O kullanılır (elle tamamlanan logolar)
  2. Yoksa DB'deki logo_url indirilir ve social/onbellek/ altında önbelleğe alınır
  3. Logonun ortalama parlaklığı ölçülür; KOYU ise beyaza çevrilir, değilse
     rengine dokunulmaz. (2118 logonun yalnızca 399'u lightmode — hepsini
     körlemesine siluete çevirmek renkli logoları bozuyordu.)
  4. Logo hiç yoksa takım baş harfleri daire içinde çizilir
"""
import json, os, subprocess, sys, urllib.request
from datetime import datetime, timedelta, timezone
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import psycopg

# Repo koku neresi olursa olsun calissin: her yol BU dosyaya gore cozulur.
BASE  = os.path.dirname(os.path.abspath(__file__))
YOL   = lambda *p: os.path.join(BASE, *p)
CIKTI = os.environ.get('RADAR_CIKTI') or YOL('cikti')

# Yerelde backend/.env, CI'da dogrudan ortam degiskeni kullanilir.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(BASE, '..', 'backend', '.env'))
except Exception:
    pass

def ffmpeg_yolu():
    """Once imageio-ffmpeg'in tasidigi statik ikili (yerel ve CI ayni surumu
    kullansin diye), yoksa sistemdeki ffmpeg.

    NOT: GitHub ubuntu-latest runner'inda ffmpeg KURULU DEGIL -- 2026-09-02'de
    bu varsayim yuzunden is patladi. Bu yuzden imageio-ffmpeg artik
    requirements.txt'te zorunlu bagimlilik.
    """
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        import shutil
        exe = shutil.which('ffmpeg')
        if exe:
            return exe
        raise RuntimeError('ffmpeg bulunamadi: imageio-ffmpeg kurulu degil ve sistemde ffmpeg yok')
W, H, FPS, SEC = 1080, 1920, 30, 6
N = FPS * SEC
BG, INK, MUTED, FAINT, MOR, MOR_D, GRI = (11,15,25),(240,243,248),(139,148,166),(104,113,133),(167,139,250),(124,58,237),(52,62,82)
FD = YOL('fonts') + os.sep
_f = lambda n, s: ImageFont.truetype(FD+n, s)
AY = {1:'Ocak',2:'Şubat',3:'Mart',4:'Nisan',5:'Mayıs',6:'Haziran',7:'Temmuz',
      8:'Ağustos',9:'Eylül',10:'Ekim',11:'Kasım',12:'Aralık'}
OYUN = {'valorant':('VALORANT','#FF4655'), 'cs-go':('COUNTER-STRIKE 2','#F0A500'),
        'cs2':('COUNTER-STRIKE 2','#F0A500'), 'lol':('LEAGUE OF LEGENDS','#C89B3C'),
        'league-of-legends':('LEAGUE OF LEGENDS','#C89B3C'), 'dota2':('DOTA 2','#9d2226')}
IKON = {'VALORANT':'valorant','COUNTER-STRIKE 2':'cs2','LEAGUE OF LEGENDS':'lol','DOTA 2':'dota2'}
hx = lambda s: tuple(int(s[i:i+2],16) for i in (1,3,5))

# ── Veri ──────────────────────────────────────────────────────────────────
def gunun_maclari(gun):
    sql = """
      SELECT m.id, ta.id, ta.name, ta.acronym, ta.logo_url,
                    tb.id, tb.name, tb.acronym, tb.logo_url,
             m.prediction_team_a, m.prediction_team_b, m.scheduled_at,
             t.name, t.tier, g.slug, g.name
      FROM matches m
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN games g       ON g.id = m.game_id
      JOIN teams ta ON ta.id = m.team_a_id
      JOIN teams tb ON tb.id = m.team_b_id
      WHERE UPPER(LEFT(COALESCE(t.tier,''),1)) IN ('S','A')
        AND m.scheduled_at >= %s AND m.scheduled_at < %s
        AND m.prediction_team_a IS NOT NULL
      ORDER BY m.scheduled_at
    """
    bas = datetime.combine(gun, datetime.min.time(), tzinfo=timezone.utc) - timedelta(hours=3)
    with psycopg.connect(os.environ['DATABASE_URL']) as cn, cn.cursor() as c:
        c.execute(sql, (bas, bas + timedelta(days=1)))
        satir = c.fetchall()
    gruplar = {}
    for r in satir:
        etiket, renk = OYUN.get(r[14], (r[15].upper(), '#a78bfa'))
        gruplar.setdefault((etiket, renk), []).append({
            'a_id': r[1], 'a': r[2], 'a_ac': r[3], 'a_logo': r[4],
            'b_id': r[5], 'b': r[6], 'b_ac': r[7], 'b_logo': r[8],
            'pa': float(r[9]), 'pb': float(r[10]), 'saat': r[11], 'tur': r[12],
            'oyun': etiket, 'ikon': IKON.get(etiket),
        })
    return gruplar

# ── Logo ──────────────────────────────────────────────────────────────────
_cache = {}
def logo(tid, url, ad, ac, box):
    k = (tid, box)
    if k in _cache: return _cache[k]
    im = None
    elle = YOL('elle', f'{tid}.png')
    yol = elle if os.path.exists(elle) else YOL('onbellek', f'{tid}.png')
    if not os.path.exists(yol) and url:
        try:
            os.makedirs(YOL('onbellek'), exist_ok=True)
            req = urllib.request.Request(url, headers={'User-Agent':'feXt/1.0'})
            with urllib.request.urlopen(req, timeout=20) as r, open(yol,'wb') as f:
                f.write(r.read())
        except Exception: yol = None
    if yol and os.path.exists(yol):
        try: im = Image.open(yol).convert('RGBA')
        except Exception: im = None
    if im is not None:
        a = im.split()[-1]
        bb = a.getbbox()
        if bb: im = im.crop(bb); a = im.split()[-1]
        # Beyazlatma kurali: SADECE parlakliga bakmak YANLIS.
        # Sentinels'in kirmizisi (206,0,55) parlaklik olarak 68 -> "koyu" sanilip
        # beyazlatiliyordu ve logo beyaz bir kutuya donusuyordu. Oysa doygun bir
        # renk, koyu zeminde gayet gorunur; beyazlatilmasi gereken sey RENKSIZ
        # koyu cizimdir (siyah/gri artwork, "lightmode" varyantlari).
        # Dogru olcut: DUSUK DOYGUNLUK **ve** DUSUK PARLAKLIK.
        hsv = im.convert('RGB').convert('HSV')
        sk = list(hsv.split()[1].getdata())      # doygunluk
        vk = list(hsv.split()[2].getdata())      # parlaklik
        ak = list(a.getdata())
        ts = tv = say = 0
        for sv, vv, alf in zip(sk, vk, ak):
            if alf > 40: ts += sv; tv += vv; say += 1
        doygunluk = (ts/say) if say else 255
        parlaklik = (tv/say) if say else 255
        if doygunluk < 60 and parlaklik < 95:
            im = Image.merge('RGBA', (Image.new('L', im.size, 236),)*3 + (a,))
        # Kaynak cizim hedef boyuttan kucukse buyutulur; basit sekiller buna
        # iyi dayanir, detayli/yazili logolar bulaniklasir -> log'a dusur ki
        # cron ciktisinda fark edilsin.
        if max(im.size) < box * 0.9:
            print(f'    ! dusuk cozunurluklu logo: takim {tid} ({im.width}x{im.height} -> {box}px)')
        sc = min(box/im.width, box/im.height)
        im = im.resize((max(1,int(im.width*sc)), max(1,int(im.height*sc))), Image.LANCZOS)
    else:
        # Logo yok -> bas harfler
        im = Image.new('RGBA', (box, box), (0,0,0,0))
        d = ImageDraw.Draw(im)
        d.ellipse([0,0,box-1,box-1], fill=(28,34,48,255), outline=(58,68,90,255), width=2)
        h = (ac or ''.join(w[0] for w in ad.split()[:2]) or ad[:2]).upper()[:3]
        f = _f('Inter-SemiBold.ttf', int(box*0.36))
        d.text(((box-d.textlength(h,font=f))/2, box*0.30), h, font=f, fill=(150,160,180,255))
    _cache[k] = im
    return im

# ── Çizim ─────────────────────────────────────────────────────────────────
f_eye  = _f('Inter-SemiBold.ttf', 34)
f_date = _f('Inter-Regular.ttf', 30)
f_tag  = _f('Inter-Regular.ttf', 30)
f_foot = _f('Inter-Regular.ttf', 27)

def sol(renk, a):
    a = max(0.0, min(1.0, a))
    return tuple(int(BG[i] + (renk[i]-BG[i])*a) for i in range(3))

def ort(d, y, t, f, c):
    d.text(((W - d.textlength(t, font=f))/2, y), t, font=f, fill=c)

MARKA = Image.open(YOL('assets', 'logo-yatay-seffaf.png')).convert('RGBA')
MARKA = MARKA.resize((int(MARKA.width*74/MARKA.height), 74), Image.LANCZOS)

def kare(oyun, renk, maclar, gun, ilerleme=1.0, glow=1.0, zoom=1.0):
    """ilerleme 0..1 — satırlar sırayla belirir, yüzdeler sayarak dolar."""
    c = Image.new('RGB', (W, H), BG)
    if glow > 0:
        g = Image.new('RGB', (W,H), BG)
        ImageDraw.Draw(g).ellipse([W//2-620, 520, W//2+620, 1620], fill=MOR_D)
        c = Image.blend(c, g.filter(ImageFilter.GaussianBlur(280)), 0.16*glow)
    d = ImageDraw.Draw(c)
    R = hx(renk)

    # ── Başlık ────────────────────────────────────────────────────────
    # "FEXTOPUS MAÇ RADARI" ilk kez gören için hiçbir şey ifade etmiyordu;
    # üstelik yüzdelerin NE olduğu hiçbir yerde yazmıyordu ("bu oranlar ne?").
    # Artık: ne olduğu (günün maçları) + hangi oyun/gün + yüzdenin tanımı.
    ik = IKON.get(oyun)
    # Birleşik videoda tek bir oyun ikonu yok; o zaman ikonun yeri boş
    # kalmasın diye başlık bloğu yukarı çekilir.
    top_y = 120 if ik else 190
    if ik and os.path.exists(YOL('assets','oyun',f'{ik}.png')):
        gi = Image.open(YOL('assets','oyun',f'{ik}.png')).convert('RGBA')
        gi = gi.resize((int(gi.width*72/gi.height), 72), Image.LANCZOS)
        c.paste(gi, ((W-gi.width)//2, top_y), gi)
    ort(d, top_y+96,  'GÜNÜN MAÇLARI', _f('Inter-Bold.ttf', 52), sol(INK, 1))
    ort(d, top_y+166, f'{oyun} · {gun.day} {AY[gun.month]}', f_eye, sol(R, 1))
    # Fextopus imzasi: maskot ikonu + "Fextopus'un tahminleri"
    # (Ahtapot emojisi DEGIL -- markanin kendi maskot gorseli kullanilir.)
    imza = "Fextopus'un tahminleri"
    gen_metin = d.textlength(imza, font=f_date)
    ikon_h = 40
    fx = None
    if os.path.exists(YOL('assets','fextopus-icon.png')):
        fx = Image.open(YOL('assets','fextopus-icon.png')).convert('RGBA')
        fx = fx.resize((int(fx.width*ikon_h/fx.height), ikon_h), Image.LANCZOS)
    toplam = gen_metin + (fx.width + 14 if fx else 0)
    sx = (W - toplam)/2
    if fx:
        c.paste(fx, (int(sx), top_y+226), fx)
        sx += fx.width + 14
    d.text((sx, top_y+232), imza, font=f_date, fill=sol(MUTED, 1))

    # Satırlar — az maç varken GERILMEZ, blok dikeyde ORTALANIR.
    # Önceden yükseklik alana bölünüyordu; 1 maçlı günde tek satır 226px
    # kalıp altında ~870px boşluk bırakıyordu.
    n = len(maclar)
    ust, alt = 512, 1608
    alan = alt - ust
    yuk = min(216, max(158, alan // max(1, n)))
    ust = ust + max(0, (alan - yuk*n)) // 2          # bloğu ortala
    for i, m in enumerate(maclar):
        gec = max(0.0, min(1.0, ilerleme*n - i*0.55))
        gec = 1 - (1-gec)**3
        if gec <= 0.01: continue
        y = ust + i*yuk
        kay = int((1-gec)*26)
        pa, pb = round(m['pa']*100), 100-round(m['pa']*100)
        fav_a = pa >= pb
        favp  = max(pa, pb)
        gos   = int(favp*gec)

        lg_a = logo(m['a_id'], m['a_logo'], m['a'], m['a_ac'], 84)
        lg_b = logo(m['b_id'], m['b_logo'], m['b'], m['b_ac'], 84)
        for lg, cx in ((lg_a, 138), (lg_b, W-138)):
            t = lg.copy(); t.putalpha(t.split()[-1].point(lambda v: int(v*gec)))
            c.paste(t, (cx-t.width//2, y+kay+18), t)

        # Uzun isimde kirpma yerine KISALTMA: taraftar zaten "IG", "NIP", "VKS"
        # diye biliyor; "Invictus Gam..." hem cirkin hem daha az taniniyor.
        f_ad = _f('Inter-SemiBold.ttf', 30)
        for ad, ac, cx in ((m['a'], m['a_ac'], 138), (m['b'], m['b_ac'], W-138)):
            s = ad
            if d.textlength(s, font=f_ad) > 214:
                s = ac if ac and len(ac) <= 6 else (ad[:11].rstrip()+'…')
            d.text((cx - d.textlength(s, font=f_ad)/2, y+kay+118), s, font=f_ad, fill=sol(INK, gec*.92))

        # Orta: bar + yüzdeler
        x0, x1 = 250, W-250
        by = y + kay + 62
        d.rounded_rectangle([x0, by, x1, by+16], 8, fill=sol(GRI, gec))
        dolu = int((x1-x0) * (gos/100))
        if fav_a:
            if dolu > 3: d.rounded_rectangle([x0, by, x0+dolu, by+16], 8, fill=sol(MOR, gec))
        else:
            if dolu > 3: d.rounded_rectangle([x1-dolu, by, x1, by+16], 8, fill=sol(MOR, gec))
        f_p, f_s = _f('Inter-Bold.ttf', 46), _f('Inter-Regular.ttf', 34)
        sa, sb = (f'%{gos}', f'%{100-gos}') if fav_a else (f'%{100-gos}', f'%{gos}')
        d.text((x0, by-58), sa, font=f_p if fav_a else f_s, fill=sol(MOR if fav_a else FAINT, gec))
        d.text((x1-d.textlength(sb, font=f_p if not fav_a else f_s), by-58), sb,
               font=f_p if not fav_a else f_s, fill=sol(MOR if not fav_a else FAINT, gec))
        st = (m['saat'] + timedelta(hours=3)).strftime('%H:%M')
        # Birleşik videoda satırın hangi oyuna ait olduğu görünmeli
        oik = m.get('ikon')
        if oik and os.path.exists(YOL('assets','oyun',f'{oik}.png')):
            gi = Image.open(YOL('assets','oyun',f'{oik}.png')).convert('RGBA')
            gi = gi.resize((int(gi.width*26/gi.height), 26), Image.LANCZOS)
            gi.putalpha(gi.split()[-1].point(lambda v: int(v*gec*.85)))
            gw = gi.width + 10
            tw = d.textlength(st, font=f_foot)
            sx = (W - (gw + tw)) / 2
            c.paste(gi, (int(sx), by+32), gi)
            d.text((sx+gw, by+30), st, font=f_foot, fill=sol(FAINT, gec*.8))
        else:
            ort(d, by+30, st, f_foot, sol(FAINT, gec*.8))
        if i < n-1:
            d.line([(180, y+yuk-6), (W-180, y+yuk-6)], fill=(24,30,42), width=2)

    d.line([(110, 1710), (W-110, 1710)], fill=(30,37,52), width=2)
    c.paste(MARKA, (110, 1748), MARKA)
    t = '@fextesports'
    d.text((W-110-d.textlength(t, font=f_tag), 1770), t, font=f_tag, fill=FAINT)

    if zoom != 1.0:
        nw, nh = int(W*zoom), int(H*zoom)
        c = c.resize((nw,nh), Image.LANCZOS).crop(((nw-W)//2,(nh-H)//2,(nw-W)//2+W,(nh-H)//2+H))
    return c

def uret(oyun, renk, maclar, gun, dosya):
    exe = ffmpeg_yolu()
    pr = subprocess.Popen([exe,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),
        '-i','-','-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-shortest',
        '-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-c:a','aac','-b:a','64k',
        '-movflags','+faststart', dosya],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for i in range(N):
        t = i/(N-1)
        pr.stdin.write(kare(oyun, renk, maclar, gun,
                            ilerleme=min(1.0, t/0.62), glow=1.0, zoom=1.0+0.03*t).tobytes())
    pr.stdin.close(); pr.wait()
    print(f'  {dosya}  ({os.path.getsize(dosya)//1024} KB, {len(maclar)} maç)')

# Bir oyunun KENDI videosunu hak etmesi icin gereken maç sayısı.
# Altında kalanlar tek bir "GÜNÜN MAÇLARI" videosunda birleştirilir —
# 1-2 maçlık ayrı videolar ekranın yarısını boş bırakıyordu.
TEK_BASINA_ESIK = 4

if __name__ == '__main__':
    gun = datetime.strptime(sys.argv[1], '%Y-%m-%d').date() if len(sys.argv) > 1 else datetime.now().date()
    gruplar = gunun_maclari(gun)
    if not gruplar:
        print(f'{gun}: S/A maç yok — video üretilmedi.'); sys.exit(0)
    os.makedirs(CIKTI, exist_ok=True)

    tekil  = {k: v for k, v in gruplar.items() if len(v) >= TEK_BASINA_ESIK}
    kalan  = [m for k, v in gruplar.items() if len(v) < TEK_BASINA_ESIK for m in v]

    toplam = sum(len(v) for v in gruplar.values())
    print(f'{gun} | {toplam} mac, {len(gruplar)} oyun '
          f'-> {len(tekil)} ayri video' + (f' + 1 birlesik ({len(kalan)} mac)' if kalan else ''))

    for (oyun, renk), maclar in tekil.items():
        uret(oyun, renk, maclar, gun, os.path.join(CIKTI, f"{gun}-{IKON.get(oyun,'x')}.mp4"))

    if kalan:
        kalan.sort(key=lambda m: m['saat'])
        oyunlar = sorted({m['oyun'] for m in kalan})
        # Tek oyun kaldıysa adını yaz, birkaçı varsa hepsini ayır
        baslik = oyunlar[0] if len(oyunlar) == 1 else ' · '.join(
            {'VALORANT':'VALORANT','COUNTER-STRIKE 2':'CS2','LEAGUE OF LEGENDS':'LoL','DOTA 2':'DOTA 2'}.get(o,o)
            for o in oyunlar)
        uret(baslik, '#a78bfa', kalan, gun, os.path.join(CIKTI, f'{gun}-gunun-maclari.mp4'))
