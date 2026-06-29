/**
 * Haber SEO slug yardımcıları.
 *
 * URL'ler artık "/news/karmine-corp-fpx-13-8-1561051" formatında (SEO-dostu),
 * ama internal story.id ("match_1561051") forum/etkileşim için kanonik kalır.
 * parseNewsId() hem slug'tan hem eski "match_123"/"123" formatından maç id'sini
 * çıkarır (geriye uyumlu).
 */

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u' }

function slugify(text) {
  return String(text || '')
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, ch => TR_MAP[ch] ?? TR_MAP[ch.toLowerCase()] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
}

/** "match_1561051" | 1561051 → 1561051 (numeric) */
function extractMatchId(id) {
  const str = String(id || '')
  const m = str.match(/(\d{3,})/)
  return m ? m[1] : null
}

/**
 * SEO slug üretir: "<başlık-slug>-<matchId>".
 * Başlık yoksa ya da id çıkarılamazsa ham id'ye düşer (geriye uyumlu).
 */
export function buildNewsSlug(story) {
  const matchId = extractMatchId(story?.id ?? story?.matchId)
  if (!matchId) return String(story?.id ?? '')
  const titleSlug = slugify(story?.title)
  return titleSlug ? `${titleSlug}-${matchId}` : matchId
}

/**
 * URL parametresinden maç id'sini (numeric) çıkarır.
 * Kabul: "slug-1561051" | "match_1561051" | "1561051"
 */
export function parseNewsId(param) {
  if (!param) return null
  const str = String(param)
  // "match_<digits>" öncelikli (eski format)
  const matchPrefixed = str.match(/match_(\d+)/)
  if (matchPrefixed) {
    const v = Number(matchPrefixed[1])
    return Number.isFinite(v) ? v : null
  }
  // Slug sonundaki sayı grubu (en uzun trailing digit dizisi)
  const trailing = str.match(/(\d+)(?!.*\d)/)
  if (trailing) {
    const v = Number(trailing[1])
    return Number.isFinite(v) ? v : null
  }
  return null
}
