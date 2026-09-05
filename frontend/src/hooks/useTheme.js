import { useCallback, useState } from 'react'

/** Aktif temayı <html data-theme> üzerinden okur (erken script index.html'de ayarlar). */
function readTheme() {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

let animTimer = 0

function applyTheme(t) {
  const root = document.documentElement

  // `theme-anim` sınıfı yalnızca geçiş süresince duruyor: tüm yüzeylerin rengi
  // ani takla atmak yerine yumuşakça çözülüyor (kural index.css'te). Kalıcı
  // global transition BIRAKILMIYOR — her hover/render'ı yavaşlatırdı.
  root.classList.add('theme-anim')
  window.clearTimeout(animTimer)
  animTimer = window.setTimeout(() => root.classList.remove('theme-anim'), 560)

  root.setAttribute('data-theme', t)
  try { localStorage.setItem('fext-theme', t) } catch { /* yok say */ }
  const m = document.querySelector('meta[name="theme-color"]')
  if (m) m.setAttribute('content', t === 'light' ? '#f5f7fb' : '#0B0F19')
}

export function useTheme() {
  const [theme, setThemeState] = useState(readTheme)
  const setTheme = useCallback((t) => { applyTheme(t); setThemeState(t) }, [])
  const toggle = useCallback(() => { const next = readTheme() === 'light' ? 'dark' : 'light'; applyTheme(next); setThemeState(next) }, [])
  return { theme, toggle, setTheme }
}
