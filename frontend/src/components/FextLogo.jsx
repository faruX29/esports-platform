import { useEffect, useRef } from 'react'

/**
 * FextLogo — feXt marka logosu.
 * Mascot: gerçek illüstrasyon (public/fext-mascot.svg, vectorizer.ai çıktısından
 * harfsiz/şeffaf ayıklandı). Wordmark: "fe" beyaz + "Xt" mor gradyan (dark-mode).
 *
 * Animasyon:
 *  • float  — hafif yukarı-aşağı süzülme (CSS)
 *  • parallax — fareyi takip: mascot imlece doğru birkaç px kayar (JS mousemove)
 *
 * Props: height (px), wordmark (bool), interactive (parallax aç/kapa)
 */
export default function FextLogo({ height = 34, wordmark = true, interactive = true }) {
  const mascotRef = useRef(null)

  useEffect(() => {
    if (!interactive) return
    const el = mascotRef.current
    if (!el) return

    let raf = 0
    function onMove(e) {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const dx = e.clientX - cx
        const dy = e.clientY - cy
        const dist = Math.hypot(dx, dy) || 1
        const strength = Math.min(6, dist / 45) // en fazla 6px
        el.style.setProperty('--px', ((dx / dist) * strength).toFixed(2) + 'px')
        el.style.setProperty('--py', ((dy / dist) * strength).toFixed(2) + 'px')
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => { window.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf) }
  }, [interactive])

  const mascotSize = Math.round(height * 1.4)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(height * 0.3), lineHeight: 1 }}>
      <img
        ref={mascotRef}
        src="/fext-mascot.svg"
        alt="feXt"
        width={mascotSize}
        height={mascotSize}
        style={{
          display: 'block',
          transform: 'translate(var(--px,0px), var(--py,0px))',
          transition: 'transform .2s ease-out',
          animation: 'fextFloat 4.2s ease-in-out infinite',
          willChange: 'transform, translate',
        }}
      />
      {wordmark && (
        <span style={{
          fontSize: height,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          fontFamily: "'Baloo 2','Fredoka','Nunito',system-ui,-apple-system,'Segoe UI',sans-serif",
        }}>
          <span style={{ color: '#F8FAFC' }}>fe</span>
          <span style={{
            background: 'linear-gradient(135deg,#DF4888 0%,#8B3AA0 55%,#6A297F 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>Xt</span>
        </span>
      )}
      <style>{`@keyframes fextFloat { 0%,100%{ translate: 0 0 } 50%{ translate: 0 -3px } }`}</style>
    </span>
  )
}
