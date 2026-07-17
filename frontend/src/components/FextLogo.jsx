import { useEffect, useRef } from 'react'
import mascotRaw from '../assets/fext-mascot.svg?raw'

// Mascot path'lerini <svg> sarmalayıcısı olmadan al (inline gömmek için).
const MASCOT_INNER = mascotRaw.replace(/<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '')

/**
 * FextLogo — feXt marka logosu (inline mascot + wordmark).
 * Animasyon: float (süzülme) + parallax (fareyi takip) + göz-kırpma (blink).
 * Göz kapakları gözlerin üstüne kafa-rengi elips olarak konur, arada scaleY ile iner.
 *
 * Props: height (px), wordmark (bool), interactive (parallax), _forceBlink (test).
 */
export default function FextLogo({ height = 34, wordmark = true, interactive = true, _forceBlink = false }) {
  const svgRef = useRef(null)

  useEffect(() => {
    if (!interactive) return
    const el = svgRef.current
    if (!el) return
    let raf = 0
    function onMove(e) {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const r = el.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const dist = Math.hypot(dx, dy) || 1
        const s = Math.min(6, dist / 45)
        el.style.setProperty('--px', ((dx / dist) * s).toFixed(2) + 'px')
        el.style.setProperty('--py', ((dy / dist) * s).toFixed(2) + 'px')
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => { window.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf) }
  }, [interactive])

  const size = Math.round(height * 1.4)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(height * 0.3), lineHeight: 1 }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox="95 130 195 205"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="feXt"
        style={{
          display: 'block',
          overflow: 'visible',
          transform: 'translate(var(--px,0px), var(--py,0px))',
          transition: 'transform .2s ease-out',
          animation: 'fextFloat 4.2s ease-in-out infinite',
          willChange: 'transform, translate',
        }}
      >
        <g dangerouslySetInnerHTML={{ __html: MASCOT_INNER }} />
        {/* Göz kapakları — blink */}
        <g>
          <ellipse className={`fext-lid${_forceBlink ? ' fext-lid-closed' : ''}`} cx="182" cy="229" rx="42" ry="41" fill="#DF4888" stroke="#201240" strokeWidth="5" />
          <ellipse className={`fext-lid${_forceBlink ? ' fext-lid-closed' : ''}`} cx="266" cy="205" rx="26" ry="26" fill="#DF4888" stroke="#201240" strokeWidth="5" />
        </g>
      </svg>

      {wordmark && (
        <span style={{
          fontSize: height, fontWeight: 800, letterSpacing: '-0.03em',
          fontFamily: "'Baloo 2','Fredoka','Nunito',system-ui,-apple-system,'Segoe UI',sans-serif",
        }}>
          <span style={{ color: '#F8FAFC' }}>fe</span>
          <span style={{
            background: 'linear-gradient(135deg,#DF4888 0%,#8B3AA0 55%,#6A297F 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Xt</span>
        </span>
      )}

      <style>{`
        @keyframes fextFloat { 0%,100%{ translate: 0 0 } 50%{ translate: 0 -3px } }
        .fext-lid { transform-box: fill-box; transform-origin: center top; transform: scaleY(0); animation: fextBlink 5s ease-in-out infinite; }
        .fext-lid-closed { transform: scaleY(1) !important; animation: none !important; }
        @keyframes fextBlink {
          0%, 92%, 100% { transform: scaleY(0); }
          94.5%, 96.5%  { transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          svg[aria-label="feXt"] { animation: none !important; }
          .fext-lid { animation: none !important; transform: scaleY(0) !important; }
        }
      `}</style>
    </span>
  )
}
