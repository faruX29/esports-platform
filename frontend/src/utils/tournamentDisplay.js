// Turnuva isimlerini ayırt edici yapar.
//
// Sorun: PandaScore turnuva `name`'i çoğunlukla yalnızca AŞAMA ("Playoffs",
// "Group A", "Regular Season"). Lig/serie adı ("VCT", "LCK") DB'de saklanmıyor
// (post-launch ETL işi). Elimizdeki `region` ile jenerik isimlere bölge öneki
// ekleyerek "Playoffs" → "NA Playoffs" gibi ayırt edilebilir hale getiriyoruz.
// (Yıl zaten kartların/hero'nun tarih satırında görünüyor.)

const GENERIC_STAGE = /^(play-?offs?|play-?ins?|group(\s*[a-z])?\b|group stage|regular season|main event|qualifiers?|swiss(\s*(stage|phase))?|lower|upper|final(s)?|bracket|stage\s*\d|round\s*\d|week\s*\d|knockout|elimination)/i

// Valorant'ın uluslararası bölge ligi resmen "EMEA" (Avrupa+Orta Doğu+Afrika).
// PandaScore Avrupa'yı weu/eu/europe olarak kodlayabiliyor → Valorant'ta EMEA göster.
// CS2/LoL'de "WEU" gerçekten "Batı Avrupa" olabildiği için sadece Valorant'a uygulanır.
const VAL_EUROPE_CODES = new Set(['weu', 'eu', 'europe', 'emea'])

/**
 * Bölge kodunu oyuna göre gösterime uyarlar (Valorant Avrupa → EMEA).
 * @param {string} region  ham bölge kodu (ör. "WEU")
 * @param {string} game    normalize oyun id'si (ör. "valorant")
 * @returns {string} gösterilecek bölge (ör. "EMEA")
 */
export function displayRegion(region, game) {
  const r = String(region || '').trim()
  if (!r) return r
  const g = String(game || '').trim().toLowerCase()
  if ((g === 'valorant' || g === 'val') && VAL_EUROPE_CODES.has(r.toLowerCase())) return 'EMEA'
  return r
}

/**
 * @param {string} name    turnuva adı (ör. "Group A")
 * @param {string} region  bölge kodu (ör. "NA", "WEU", "EEU")
 * @param {string} [game]  normalize oyun id'si (Valorant Avrupa → EMEA öneki için)
 * @returns {string} ayırt edici ad (ör. "NA Group A") ya da ismin kendisi
 */
export function distinctiveTournamentName(name, region, game) {
  const n = String(name || '').trim()
  if (!n) return 'Turnuva'
  const r = displayRegion(region, game)
  if (r && GENERIC_STAGE.test(n) && !n.toLowerCase().includes(r.toLowerCase())) {
    return `${r.toUpperCase()} ${n}`
  }
  return n
}

/** İsim jenerik aşama mı (bölge önekinden fayda görür mü)? */
export function isGenericStageName(name) {
  return GENERIC_STAGE.test(String(name || '').trim())
}
