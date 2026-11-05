import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Home, CalendarDays, Trophy, Newspaper, Flag } from 'lucide-react'
import { FEXT, yazi } from '../theme'

/**
 * Telefonda alt gezinme çubuğu (skor uygulamalarında standart; Android uygulamasında da).
 * Beş ana yer; Sıralama, Scout, ayarlar hamburger menüde kalır. Modallar (z-index 1000+)
 * üstte açılır. Sayfa sonu çubuğun altında kalmasın diye AppShell `ALT_GEZINME_PAY` kadar
 * boşluk bırakır.
 */
export const ALT_GEZINME_PX = 768
export const ALT_GEZINME_YUKSEKLIK = 58

const OGELER = [
  { to: '/', label: 'Ana Sayfa', end: true, Icon: Home },
  { to: '/matches', label: 'Maçlar', Icon: CalendarDays },
  { to: '/tournaments', label: 'Turnuvalar', Icon: Trophy },
  { to: '/news', label: 'Haberler', Icon: Newspaper },
  { to: '/turk-takimlari', label: 'Türk', Icon: Flag },
]

const SORGU = `(max-width: ${ALT_GEZINME_PX}px)`

export function useAltGezinme() {
  const [acik, setAcik] = useState(() => typeof window !== 'undefined' && window.matchMedia(SORGU).matches)
  useEffect(() => {
    const mq = window.matchMedia(SORGU)
    const degisti = () => setAcik(mq.matches)
    mq.addEventListener('change', degisti)
    return () => mq.removeEventListener('change', degisti)
  }, [])
  return acik
}

export default function AltGezinme() {
  return (
    <nav
      aria-label="Alt gezinme"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 900,
        display: 'grid', gridTemplateColumns: `repeat(${OGELER.length}, 1fr)`,
        height: ALT_GEZINME_YUKSEKLIK, paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'content-box',
        background: 'var(--bg)', borderTop: '1px solid var(--line)',
        boxShadow: '0 -6px 18px var(--shadow)',
      }}
    >
      {OGELER.map(o => (
        <NavLink
          key={o.to}
          to={o.to}
          end={o.end}
          style={({ isActive }) => ({
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
            textDecoration: 'none', fontSize: yazi(10), fontWeight: isActive ? 800 : 600,
            color: isActive ? FEXT.accentText : 'var(--text-4)',
            position: 'relative',
          })}
        >
          {({ isActive }) => (
            <>
              {/* Aktif sekmenin üstünde ince çizgi */}
              <span aria-hidden="true" style={{
                position: 'absolute', top: 0, left: '28%', right: '28%', height: 2, borderRadius: 2,
                background: isActive ? FEXT.accent : 'transparent', transition: 'background .2s',
              }} />
              <o.Icon size={19} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
              {o.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
