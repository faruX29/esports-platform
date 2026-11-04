/**
 * Maç yayını yardımcıları. PandaScore streams_list: [{ raw_url, embed_url, language, official, main }].
 * Son 30 günde host dağılımı: Twitch > Kick > YouTube > diğerleri (w.tv, Bilibili, Huya, Douyu).
 */

// Ek, Türkçe okunuşa göre: "Twitch'te", "YouTube'da"
const PLATFORMLAR = [
  { desen: 'twitch.tv',    ad: 'Twitch',   ek: "'te" },
  { desen: 'youtube.com',  ad: 'YouTube',  ek: "'da" },
  { desen: 'youtu.be',     ad: 'YouTube',  ek: "'da" },
  { desen: 'kick.com',     ad: 'Kick',     ek: "'te" },
  { desen: 'bilibili.com', ad: 'Bilibili', ek: "'de" },
  { desen: 'huya.com',     ad: 'Huya',     ek: "'da" },
  { desen: 'douyu.com',    ad: 'Douyu',    ek: "'da" },
  { desen: 'afreecatv.com', ad: 'AfreecaTV', ek: "'de" },
  { desen: 'sooplive',     ad: 'SOOP',     ek: "'ta" },
]

const DILLER = {
  tr: 'Türkçe', en: 'İngilizce', de: 'Almanca', fr: 'Fransızca', es: 'İspanyolca', pt: 'Portekizce',
  ru: 'Rusça', uk: 'Ukraynaca', pl: 'Lehçe', it: 'İtalyanca', zh: 'Çince', ko: 'Korece', ja: 'Japonca',
  vi: 'Vietnamca', th: 'Tayca', ar: 'Arapça', fi: 'Fince', da: 'Danca', sv: 'İsveççe', no: 'Norveççe',
  cs: 'Çekçe', hu: 'Macarca', ro: 'Rumence', id: 'Endonezce', tl: 'Filipince', mn: 'Moğolca', kk: 'Kazakça',
}

function hostu(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

/** { ad, ek } — bilinmeyen site için host adı, eksiz. */
export function yayinPlatformu(url) {
  const host = hostu(url)
  const p = PLATFORMLAR.find(x => host === x.desen || host.endsWith(`.${x.desen}`) || host.includes(x.desen))
  return p ? { ad: p.ad, ek: p.ek } : { ad: host || 'Yayın', ek: null }
}

/** Buton metni: "Twitch'te izle", bilinmeyen sitede "Canlı izle". */
export function izleEtiketi(url) {
  const { ad, ek } = yayinPlatformu(url)
  return ek ? `${ad}${ek} izle` : 'Canlı izle'
}

export function dilAdi(kod) {
  const k = String(kod || '').toLowerCase().split(/[-_]/)[0]
  if (!k) return ''
  return DILLER[k] || k.toUpperCase()
}

/** Tekrarsız, sıralı yayın listesi: Türkçe önce, sonra resmi/ana yayın, sonra diğerleri. */
export function yayinlariSirala(liste) {
  const gorulen = new Set()
  const temiz = []
  for (const s of liste || []) {
    const url = String(s?.raw_url || '').trim()
    if (!/^https?:\/\//i.test(url) || gorulen.has(url)) continue
    gorulen.add(url)
    temiz.push({ ...s, raw_url: url })
  }
  const puan = s => (String(s.language || '').toLowerCase().startsWith('tr') ? 0 : 4) + (s.official ? 0 : 2) + (s.main ? 0 : 1)
  return temiz.sort((a, b) => puan(a) - puan(b))
}
