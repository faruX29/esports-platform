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
