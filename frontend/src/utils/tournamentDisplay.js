// Turnuva isimlerini ayırt edici yapar.
//
// Sorun: PandaScore turnuva `name`'i çoğunlukla yalnızca AŞAMA ("Playoffs",
// "Group A", "Regular Season"). Lig/serie adı ("VCT", "LCK") DB'de saklanmıyor
// (post-launch ETL işi). Elimizdeki `region` ile jenerik isimlere bölge öneki
// ekleyerek "Playoffs" → "NA Playoffs" gibi ayırt edilebilir hale getiriyoruz.
// (Yıl zaten kartların/hero'nun tarih satırında görünüyor.)

const GENERIC_STAGE = /^(play-?offs?|play-?ins?|group(\s*[a-z])?\b|group stage|regular season|main event|qualifiers?|swiss(\s*(stage|phase))?|lower|upper|final(s)?|bracket|stage\s*\d|round\s*\d|week\s*\d|knockout|elimination)/i

/**
 * @param {string} name    turnuva adı (ör. "Group A")
 * @param {string} region  bölge kodu (ör. "NA", "WEU", "EEU")
 * @returns {string} ayırt edici ad (ör. "NA Group A") ya da ismin kendisi
 */
export function distinctiveTournamentName(name, region) {
  const n = String(name || '').trim()
  if (!n) return 'Turnuva'
  const r = String(region || '').trim()
  if (r && GENERIC_STAGE.test(n) && !n.toLowerCase().includes(r.toLowerCase())) {
    return `${r.toUpperCase()} ${n}`
  }
  return n
}

/** İsim jenerik aşama mı (bölge önekinden fayda görür mü)? */
export function isGenericStageName(name) {
  return GENERIC_STAGE.test(String(name || '').trim())
}
