// Büyük harf ve dil. index.html `lang="tr"` olduğu için CSS `textTransform: 'uppercase'`
// Türkçe kuralı uygular: İngilizce "i" → "İ" ("COUNTER-STRİKE 2", "AURORA GAMİNG", "TİER").
// İngilizce ad gösteren büyük harfli öğeye `lang={adDili(ad)}` (ya da düz `lang="en"`) verilir.
// Statik Türkçe etiketlere dokunulmaz; orada "i" → "İ" doğrudur.

const TURKCE_HARF = /[çğıöşüÇĞİÖŞÜ]/

/** Özel ad (takım, oyun, turnuva, harita) için büyük harf dili: Türkçe harf varsa
 *  'tr' ("Beşiktaş" → "BEŞİKTAŞ"), yoksa 'en' ("Eternal Fire" → "ETERNAL FIRE"). */
export function adDili(ad) {
  return TURKCE_HARF.test(String(ad || '')) ? 'tr' : 'en'
}

/** Türkçe ondalık: 47.9 → "47,9". Sayı değilse "—". */
export function ondalik(n, basamak = 1) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return x.toLocaleString('tr-TR', { minimumFractionDigits: basamak, maximumFractionDigits: basamak })
}

/** Türkçe yüzde: işaret önde, virgüllü ondalık (47.9 → "%47,9"). */
export function yuzde(n, basamak = 0) {
  const s = ondalik(n, basamak)
  return s === '—' ? s : `%${s}`
}

/** Biçimlenmiş iki tarihten aralık: aynı güne düşerse tek tarih ("28 Ağu – 28 Ağu" değil), biri boşsa öteki. */
export function tarihAraligi(bas, bit, ayrac = ' – ') {
  const a = bas || ''
  const b = bit || ''
  if (!a || !b || a === b) return a || b
  return `${a}${ayrac}${b}`
}
