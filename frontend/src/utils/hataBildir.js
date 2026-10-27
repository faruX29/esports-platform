import { supabase } from '../supabaseClient'
import { PLATFORM } from './platform'

/**
 * Tarayıcı hatalarını client_errors tablosuna yazar (backend/sql/hata_izleme.sql).
 * Yalnız üretim build'inde çalışır. Oturum başına en fazla 5 hata ve 3 CSP ihlali,
 * aynı hata bir kez. Kimlik gitmez: sayfanın yalnız yolu (sorgu dizesi ve # yok),
 * hata metni, yığın, tarayıcı bilgisi ve build sürümü.
 */

const SINIR = { hata: 5, csp: 3 }
const DEPO_ANAHTARI = 'fext_hata_sayac'
// Uygulamadan gelen hata sürümün önünde platformla ayrışır (ör. android-1a2b3c4).
const SURUM = (PLATFORM === 'web' ? '' : `${PLATFORM}-`) + (import.meta.env.VITE_SURUM || 'yerel')

// Bizim kodumuzla ilgisi olmayan, düzeltilemeyen gürültü.
const GURULTU_RE = /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection captured/i
const EKLENTI_RE = /(chrome|moz|safari-web|ms-browser)-extension:/i

const gonderilen = new Set()
let sayac = null

function sayaciOku() {
  if (sayac) return sayac
  sayac = { hata: 0, csp: 0 }
  try {
    const kayitli = JSON.parse(sessionStorage.getItem(DEPO_ANAHTARI) || 'null')
    if (kayitli) sayac = { hata: kayitli.hata || 0, csp: kayitli.csp || 0 }
  } catch { /* depo kapalı: sayaç yalnız bellekte */ }
  return sayac
}

function sayaciArtir(kova) {
  const s = sayaciOku()
  s[kova] += 1
  try { sessionStorage.setItem(DEPO_ANAHTARI, JSON.stringify(s)) } catch { /* bellekte kalır */ }
}

/**
 * @param {'render'|'hata'|'promise'|'csp'} tur
 * @param {string} mesaj
 * @param {string} [yigin]
 */
// Yerelde `vite preview` ile denenen üretim build'i canlı tabloyu kirletmesin.
// Capacitor https://localhost / capacitor://localhost kullanır; o bildirir.
const YEREL_ONIZLEME = typeof window !== 'undefined' && window.location.protocol === 'http:'
  && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

export function hataBildir(tur, mesaj, yigin) {
  if (!import.meta.env.PROD || YEREL_ONIZLEME) return
  const metin = String(mesaj || '').trim()
  if (!metin || GURULTU_RE.test(metin)) return
  if (EKLENTI_RE.test(metin) || EKLENTI_RE.test(yigin || '')) return

  const kova = tur === 'csp' ? 'csp' : 'hata'
  if (sayaciOku()[kova] >= SINIR[kova]) return
  const anahtar = `${tur}|${metin}`
  if (gonderilen.has(anahtar)) return
  gonderilen.add(anahtar)
  sayaciArtir(kova)

  supabase
    .rpc('client_error_kaydet', {
      p_tur: tur,
      p_mesaj: metin.slice(0, 500),
      p_yigin: yigin ? String(yigin).slice(0, 4000) : null,
      p_yol: window.location.pathname,
      p_tarayici: navigator.userAgent.slice(0, 300),
      p_surum: SURUM,
    })
    // Bildiricinin kendi hatası yeniden bildirilmez (döngü olur); yalnız konsola.
    .then(({ error }) => { if (error) console.warn('Hata kaydı yazılamadı:', error.message) },
      (err) => console.warn('Hata kaydı yazılamadı:', err?.message || err))
}

function hataMetni(err) {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

/** Uygulama açılışında bir kez çağrılır (main.jsx). */
export function hataDinleyicileriniKur() {
  if (!import.meta.env.PROD) return

  window.addEventListener('error', (e) => {
    // Görsel/betik yükleme hataları da buraya düşer (hedefi Window değil); onlar imageGuard'ın işi.
    if (e.target && e.target !== window) return
    const yer = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : ''
    hataBildir('hata', e.error ? hataMetni(e.error) : e.message, e.error?.stack || yer)
  })

  window.addEventListener('unhandledrejection', (e) => {
    hataBildir('promise', hataMetni(e.reason), e.reason?.stack)
  })

  // CSP Report-Only de bu olayı tetikler: zorunlu başlığa geçmeden önce ihlal var mı görürüz.
  document.addEventListener('securitypolicyviolation', (e) => {
    const engellenen = e.blockedURI || 'inline'
    if (EKLENTI_RE.test(engellenen) || EKLENTI_RE.test(e.sourceFile || '')) return
    const yer = e.sourceFile ? `${e.sourceFile}:${e.lineNumber}:${e.columnNumber}` : ''
    hataBildir('csp', `${e.effectiveDirective || e.violatedDirective} ${engellenen}`, yer)
  })
}

/** ErrorBoundary.componentDidCatch'ten. */
export function renderHatasiBildir(error, componentStack) {
  const yigin = [error?.stack, componentStack].filter(Boolean).join('\n--- bileşen ---\n')
  hataBildir('render', hataMetni(error), yigin)
}
