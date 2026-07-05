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
  const id = String(story?.id ?? '')
  // Transfer makalesi: maç yok, id = "transfer_<uuid>" — slug sonuna eklenir
  if (id.startsWith('transfer_')) {
    const titleSlug = slugify(story?.title)
    return titleSlug ? `${titleSlug}-${id}` : id
  }
  // Turnuva recap: maç yok, id = "tournament_<id>" — slug sonuna eklenir
  if (id.startsWith('tournament_')) {
    const titleSlug = slugify(story?.title)
    return titleSlug ? `${titleSlug}-${id}` : id
  }
  const matchId = extractMatchId(story?.id ?? story?.matchId)
  if (!matchId) return id
  const titleSlug = slugify(story?.title)
  return titleSlug ? `${titleSlug}-${matchId}` : matchId
}

/**
 * URL parametresini çözer: maç haberi mi, transfer haberi mi?
 * @returns {{type:'match'|'transfer'|'tournament'|'unknown', id: number|string|null}}
 */
export function parseNewsRef(param) {
  const str = String(param || '')
  const tr = str.match(/transfer_([0-9a-fA-F-]{36})/)
  if (tr) return { type: 'transfer', id: tr[1] }
  // tournament_<id> — numeric fallback'ten ÖNCE yakala (yoksa maç sanılır)
  const tour = str.match(/tournament_(\d+)/)
  if (tour) return { type: 'tournament', id: Number(tour[1]) }
  const mid = parseNewsId(param)
  return mid != null ? { type: 'match', id: mid } : { type: 'unknown', id: null }
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
