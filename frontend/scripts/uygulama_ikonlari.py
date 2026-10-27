"""Android uygulama ikonu, splash ve bildirim ikonu üretir (Capacitor, frontend/android).

Kaynak: public/icons/icon-512.png (saydam maskot). Zemin: marka laciverti #0B0F19
(index.html theme-color). Maskot değişirse bu betiği yeniden çalıştır:

    cd frontend && python scripts/uygulama_ikonlari.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

KOK = Path(__file__).resolve().parent.parent
KAYNAK = KOK / "public" / "icons" / "icon-512.png"
RES = KOK / "android" / "app" / "src" / "main" / "res"
ZEMIN = (11, 15, 25, 255)

# yoğunluk → ölçek (mdpi = 1)
YOGUNLUK = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def maskot(boyut: int) -> Image.Image:
    return Image.open(KAYNAK).convert("RGBA").resize((boyut, boyut), Image.LANCZOS)


def ortala(tuval: Image.Image, resim: Image.Image) -> Image.Image:
    x = (tuval.width - resim.width) // 2
    y = (tuval.height - resim.height) // 2
    tuval.alpha_composite(resim, (x, y))
    return tuval


def launcher():
    for ad, olcek in YOGUNLUK.items():
        klasor = RES / f"mipmap-{ad}"
        # Adaptive ön plan: 108dp tuval, görünür güvenli alan ortadaki 66dp.
        on = int(108 * olcek)
        ortala(Image.new("RGBA", (on, on), (0, 0, 0, 0)), maskot(int(on * 0.58))).save(klasor / "ic_launcher_foreground.png")
        # Eski Android (< 8): kare ve yuvarlak tam ikon.
        b = int(48 * olcek)
        kare = ortala(Image.new("RGBA", (b, b), ZEMIN), maskot(int(b * 0.8)))
        kare.save(klasor / "ic_launcher.png")
        maske = Image.new("L", (b, b), 0)
        ImageDraw.Draw(maske).ellipse((0, 0, b - 1, b - 1), fill=255)
        yuvarlak = Image.new("RGBA", (b, b), (0, 0, 0, 0))
        yuvarlak.paste(kare, (0, 0), maske)
        yuvarlak.save(klasor / "ic_launcher_round.png")


def splash():
    # Android 12+ sistem splash'i launcher ikonunu kullanır; bu görseller eski sürümler için.
    for yol in RES.glob("drawable*/splash.png"):
        g, y = Image.open(yol).size
        tuval = Image.new("RGBA", (g, y), ZEMIN)
        ortala(tuval, maskot(int(min(g, y) * 0.32))).convert("RGB").save(yol)


def bildirim():
    # Durum çubuğu ikonu tek renk olmalı (Android yalnız alfa kanalını kullanır):
    # maskotun gövdesi beyaz, siyah dış çizgi ve gözbebekleri saydam.
    for ad, olcek in YOGUNLUK.items():
        b = int(24 * olcek)
        kaynak = maskot(b * 4)
        siluet = Image.new("RGBA", kaynak.size, (0, 0, 0, 0))
        kp, sp = kaynak.load(), siluet.load()
        for x in range(kaynak.width):
            for yy in range(kaynak.height):
                r, g, bb, a = kp[x, yy]
                if a > 128 and (r + g + bb) / 3 > 70:
                    sp[x, yy] = (255, 255, 255, 255)
        klasor = RES / f"drawable-{ad}"
        klasor.mkdir(exist_ok=True)
        siluet.resize((b, b), Image.LANCZOS).save(klasor / "ic_bildirim.png")


if __name__ == "__main__":
    launcher()
    splash()
    bildirim()
    print("ikonlar yazıldı:", RES)
