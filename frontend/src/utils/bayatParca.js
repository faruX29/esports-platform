/**
 * bayatParca.js — yayından sonra açık kalan sekmenin eski parçaları isteme sorunu.
 *
 * Her dağıtım parça adlarını (LoginPage-<hash>.js) değiştirir ve eskileri siler.
 * Eski sürümle açık bir sekme lazy sayfaya geçince silinmiş dosyayı ister ve
 * "Failed to fetch dynamically imported module" alır. Çare tek bir yenileme:
 * yeni index.html yeni parça adlarını getirir. Döngüye girmemek için kısa süre
 * içinde ikinci kez yenilemeyiz; çevrimdışıyken de yenilemeyiz (sebep ağ).
 */
const ANAHTAR = '_parca_yenile'
const BEKLEME_MS = 30000

let yenileniyor = false

export function yenilemeBekleniyor() {
  return yenileniyor
}

/** Yeniledi ise true döner; çağıran hatayı yutabilir. */
export function bayatParcadaYenile() {
  if (yenileniyor) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  try {
    const son = Number(sessionStorage.getItem(ANAHTAR) || 0)
    if (Date.now() - son < BEKLEME_MS) return false
    sessionStorage.setItem(ANAHTAR, String(Date.now()))
  } catch {
    // Depolama yoksa döngü korumasını kuramayız; yenilemeyi deneme.
    return false
  }
  yenileniyor = true
  window.location.reload()
  return true
}

// Chrome / Firefox / Safari'nin dinamik import hata metinleri.
const PARCA_HATASI_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Expected the result of a dynamic import\(\) call/i

export function parcaHatasiMi(err) {
  return PARCA_HATASI_RE.test(String(err?.message || err || ''))
}
