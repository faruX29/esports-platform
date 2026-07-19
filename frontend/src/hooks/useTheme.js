import { useCallback, useState } from 'react'

/** Aktif temayı <html data-theme> üzerinden okur (erken script index.html'de ayarlar). */
function readTheme() {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t)
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
