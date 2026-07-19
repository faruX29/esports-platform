import { useTheme } from '../hooks/useTheme'

/** Açık/Koyu tema düğmesi — güneş/ay ikonu (lucide brand-riski yok, inline SVG). */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isLight = theme === 'light'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? 'Koyu temaya geç' : 'Açık temaya geç'}
      title={isLight ? 'Koyu tema' : 'Açık tema'}
      style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: 'var(--surface)', border: '1px solid var(--line)',
        color: 'var(--text-3)', cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'color .15s, border-color .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--line-2)' }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--line)' }}
    >
      {isLight ? (
        // Ay (koyuya geçmeyi temsil eder)
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        // Güneş (açığa geçmeyi temsil eder)
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  )
}
