# Elle Tamamlanan Takım Logoları

PandaScore'un logosunu vermediği takımlar için buraya PNG koy.

**Dosya adı = takım ID'si.** Örnek: `137699.png`

Şu an eksik olan **3 takım** (son 90 günün S/A maçlarında oynayanlar):

| Oyun | Takım | Dosya adı |
|---|---|---|
| Counter-Strike 2 | FOKUS | `137699.png` |
| Counter-Strike 2 | magic | `137739.png` |
| Valorant | REBORN | `138449.png` |

**Biçim:** şeffaf arka planlı PNG, en az 200×200. Kare olması şart değil.

Dosya buraya konursa `radar.py` onu kullanır; yoksa veritabanındaki
logo_url'den indirir; o da yoksa takım baş harflerini daire içinde çizer
(yani logo olmadan da video bozulmaz).

**Not:** 148 S/A takımından yalnızca 3'ünde logo eksik. Yani bu liste
kısa kalacak — her yeni sezonda birkaç takım eklenebilir.

## Koyu zemin için elle düzeltilmiş logolar (15 Eylül 2026)

Buradaki dosyalar radar tarafından **olduğu gibi** kullanılır; otomatik
beyazlatma kuralı UYGULANMAZ. Champions 2026 öncesi 16 takımın logosu video
zemininde tek tek kontrol edildi, dördü düzeltildi:

| Takım | Dosya | Sorun | Çözüm |
|---|---|---|---|
| EDward Gaming | `128976.png` | beyazlatma kuralı logoyu düz beyaz diske çeviriyordu | orijinal (siyah daire + beyaz yazı) |
| FUT Esports | `128578.png` | koyu gri çizim zeminde kayboluyordu | koyu kısımlar açıldı, kırmızı yıldız korundu |
| 100 Thieves | `128605.png` | siyah "100" okunmuyordu | koyu kısımlar açıldı, kırmızı halka korundu |
| Team Liquid | `128541.png` | lacivert yazı/kalkan zemine karışıyordu | parlaklık tersine çevrildi |
