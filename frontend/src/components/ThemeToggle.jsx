import { useTheme } from '../hooks/useTheme'

/**
 * Açık/Koyu tema düğmesi — güneş/ay ikonu (lucide brand-riski yok, inline SVG).
 *
 * İkonlar üst üste duruyor ve 17×17'lik pencerede kayıyor: giden ikon aşağı
 * süzülüp kaybolurken gelen ikon yukarıdan iniyor. Gösterilen ikon HEDEF temayı
 * temsil eder (koyudayken güneş = "açığa geç"), etiketler de öyle.
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isLight = theme === 'light'

  // Ay AŞAĞIDA, güneş YUKARIDA bekler. Böylece koyu→açık geçişinde ay
  // aşağıdan yükselir, açık→koyuda ay aşağı iner ve güneş yukarıdan gelir —
  // iki yönde de tek yönlü, tutarlı bir kayma.
  //
  // Döndürme/küçültme YOK: 17px'lik pencerede ikon dönerken küçülünce hareket
  // okunmuyor, yalnızca bir titreme gibi görünüyordu (5 Eyl geri bildirimi).
  const iconStyle = (shown, restY) => ({
    position: 'absolute',
    inset: 0,
    transform: shown ? 'translateY(0)' : `translateY(${restY})`,
    opacity: shown ? 1 : 0,
    transition: 'transform .5s cubic-bezier(.34,1.15,.5,1), opacity .3s ease',
  })

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
      {/* overflow:hidden → ikonlar kutunun dışına taşmadan girip çıkar */}
      <span style={{ position: 'relative', width: 18, height: 18, overflow: 'hidden', display: 'block' }}>
        {/* Ay (koyuya geçmeyi temsil eder) */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={iconStyle(isLight, '115%')}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        {/* Güneş (açığa geçmeyi temsil eder) */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={iconStyle(!isLight, '-115%')}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </span>
    </button>
  )
}
