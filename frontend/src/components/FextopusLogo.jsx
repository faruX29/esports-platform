import { useEffect, useRef } from 'react'
import baseImg from '../assets/fextopus-base.png'
import shinesImg from '../assets/fextopus-shines.png'

/**
 * FextopusLogo — gerçek Fextopus maskotu (arkadaş çizimi, birebir PNG) + feXt wordmark.
 * İki katman: gövde (fextopus-base, parlamasız) + göz parlamaları (fextopus-shines).
 * Animasyon:
 *  • float  — hafif süzülme (CSS)
 *  • göz takibi — parlamalar (shines) fareye doğru kayar → gözler seni takip eder
 *  • hover  — küçük eğilme/büyüme
 * prefers-reduced-motion açıksa hareket durur.
 *
 * Props: height (px), wordmark (bool), interactive (göz takibi aç/kapa).
 */
export default function FextopusLogo({ height = 30, wordmark = true, interactive = true }) {
  const innerRef = useRef(null)
  const shinesRef = useRef(null)
  const size = Math.round(height * 1.5)

  useEffect(() => {
    if (!interactive) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const inner = innerRef.current
    const shines = shinesRef.current
    if (!inner || !shines) return
    const maxMove = size * 0.05
    let raf = 0
    function onMove(e) {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const r = inner.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const dist = Math.hypot(dx, dy) || 1
        const move = Math.min(maxMove, dist / 40)
        const px = ((dx / dist) * move).toFixed(2)
        const py = ((dy / dist) * move).toFixed(2)
        shines.style.transform = `translate(${px}px, ${py}px)`
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => { window.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf) }
  }, [interactive, size])

  return (
    <span className="fx-logo" style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(height * 0.32), lineHeight: 1 }}>
      <span className="fx-float" style={{ display: 'inline-flex' }}>
        <span ref={innerRef} className="fx-inner" style={{ position: 'relative', display: 'block', width: size, height: size }}>
          <img className="fx-base" src={baseImg} alt="feXt Fextopus" width={size} height={size} style={{ display: 'block', width: size, height: size, objectFit: 'contain' }} />
          <img ref={shinesRef} className="fx-shines" src={shinesImg} alt="" aria-hidden="true" width={size} height={size} style={{ position: 'absolute', inset: 0, width: size, height: size, objectFit: 'contain', transition: 'transform .12s ease-out', pointerEvents: 'none' }} />
        </span>
      </span>

      {wordmark && (
        <span style={{
          fontSize: Math.round(height * 1.06), fontWeight: 700, letterSpacing: '-0.01em',
          fontFamily: "'Baloo 2','Fredoka',system-ui,-apple-system,'Segoe UI',sans-serif",
        }}>
          <span style={{ color: 'var(--text)' }}>fe</span>
          <span style={{
            background: 'linear-gradient(135deg,#DF4888 0%,#8B3AA0 55%,#6A297F 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            <span style={{ fontSize: '1.22em' }}>X</span>t
          </span>
        </span>
      )}

      <style>{`
        .fx-float { animation: fxFloat 4.2s ease-in-out infinite; will-change: transform; }
        .fx-inner { transform-origin: center 68%; transition: transform .25s cubic-bezier(.34,1.56,.64,1); }
        .fx-logo:hover .fx-inner { transform: rotate(-5deg) scale(1.08); }
        @keyframes fxFloat { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-3px) } }
        @media (prefers-reduced-motion: reduce) {
          .fx-float { animation: none !important; }
          .fx-logo:hover .fx-inner { transform: none; }
        }
      `}</style>
    </span>
  )
}
