import { useCallback, useState } from 'react'

/** Aktif temayı <html data-theme> üzerinden okur (erken script index.html'de ayarlar). */
function readTheme() {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function reduceMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Temayı uygular. Geçişi View Transitions API yapar.
 *
 * NEDEN: önce <html>'e geçici bir sınıf ekleyip `*` üzerinden 8 özelliği
 * (box-shadow ve background-image dahil) 500ms geçiriyorduk. 1183 elemanda
 * bu her karede tam repaint demekti — ölçümde kareler 103-138ms'ye çıkıyor,
 * 11 karenin 8'i düşüyordu; sayfa kasıyormuş gibi hissettiriyordu.
 *
 * View Transitions eski ve yeni görüntünün anlık görüntüsünü alıp GPU'da
 * çapraz geçiş yapar: eleman sayısından bağımsız, tek kompozit katman.
 * Desteklemeyen tarayıcıda geçiş anlık olur — kasmadansa anlık iyidir.
 */
function applyTheme(t) {
  const root = document.documentElement

  const commit = () => {
    root.setAttribute('data-theme', t)
    try { localStorage.setItem('fext-theme', t) } catch { /* yok say */ }
    const m = document.querySelector('meta[name="theme-color"]')
    if (m) m.setAttribute('content', t === 'light' ? '#f5f7fb' : '#0B0F19')
  }

  if (typeof document.startViewTransition === 'function' && !reduceMotion()) {
    document.startViewTransition(commit)
  } else {
    commit()
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState(readTheme)
  const setTheme = useCallback((t) => { applyTheme(t); setThemeState(t) }, [])
  const toggle = useCallback(() => { const next = readTheme() === 'light' ? 'dark' : 'light'; applyTheme(next); setThemeState(next) }, [])
  return { theme, toggle, setTheme }
}
