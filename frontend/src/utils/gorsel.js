// PandaScore CDN her görselin yanında 200 px'lik "thumb_" sürümünü tutar
// (…/team/image/123/logo.png → …/team/image/123/thumb_logo.png). Logolar sitede
// 18-64 px basılıyor; orijinal 500 px PNG'ler 100-300 KB, thumb'lar ~4-5 kat küçük.
// 27 Ekim 2026: 98 rastgele takım/oyuncu görselinin hepsinde thumb vardı. Yine de
// thumb açılmazsa çağıran orijinale düşmeli (InitialsImage bunu yapar).
const PANDASCORE_GORSEL_RE = /^(https:\/\/cdn-api\.pandascore\.co\/images\/[^?#]+\/)(?!thumb_)([^/?#]+)$/

// Bu boyuttan (CSS px) büyük basılan görselde thumb bulanık kalabilir → orijinal.
export const THUMB_AZAMI_PX = 100

export function kucukGorsel(url) {
  if (typeof url !== 'string') return url
  const m = url.match(PANDASCORE_GORSEL_RE)
  return m ? `${m[1]}thumb_${m[2]}` : url
}

// Yedek: bazı Türkiye hatlarında "Güvenli İnternet" filtresi *.pandascore.co'yu
// kesiyor (30 Ekim 2026). Takım logolarının thumb_ sürümü Supabase Storage'a
// kopyalanır (supabase/functions/gorsel-yedek); PandaScore açılmazsa buradan
// denenir. Yol kuralı fonksiyondakiyle aynı: `/images/` sonrası, dosya adı thumb_ ile.
// Şimdilik yalnız takım logoları kopyalanıyor; oyuncu görseli için null döner.
const YEDEK_RE = /^https:\/\/cdn-api\.pandascore\.co\/images\/(team\/[^?#]+\/)(?:thumb_)?([^/?#]+)$/
const YEDEK_KOK = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/gorsel-yedek/`

export function yedekGorsel(url) {
  if (typeof url !== 'string' || !import.meta.env.VITE_SUPABASE_URL) return null
  const m = url.match(YEDEK_RE)
  return m ? `${YEDEK_KOK}${m[1]}thumb_${m[2]}` : null
}
