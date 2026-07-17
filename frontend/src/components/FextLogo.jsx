import { useEffect, useRef } from 'react'
import { MASCOT_BASE, MASCOT_PUPILS, MASCOT_VIEWBOX } from './fextMascotPaths'

/**
 * FextLogo — feXt marka logosu (inline mascot + wordmark).
 * Animasyon:
 *  • float   — hafif süzülme (CSS)
 *  • göz takibi — göz bebekleri (pupiller) fareye doğru kayar (viewBox biriminde)
 *  • blink   — arada göz kırpma (kafa-rengi göz kapağı elipsleri, scaleY)
 *
 * Props: height (px), wordmark (bool), interactive (göz takibi aç/kapa).
 */
export default function FextLogo({ height = 34, wordmark = true, interactive = true, _forceBlink = false }) {
  const svgRef = useRef(null)
  const pupilsRef = useRef(null)

  useEffect(() => {
    if (!interactive) return
    const svg = svgRef.current
    const pupils = pupilsRef.current
    if (!svg || !pupils) return
    let raf = 0
    function onMove(e) {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const r = svg.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const dist = Math.hypot(dx, dy) || 1
        // pupiller viewBox biriminde kayar (logo boyutuyla ölçeklenir)
        const range = Math.min(7, dist / 22)
        const px = ((dx / dist) * range).toFixed(2)
        const py = ((dy / dist) * range).toFixed(2)
        pupils.setAttribute('transform', `translate(${px} ${py})`)
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
        viewBox={MASCOT_VIEWBOX}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="feXt"
        style={{ display: 'block', animation: 'fextFloat 4.2s ease-in-out infinite', willChange: 'translate' }}
      >
        {/* Mascot gövdesi (pupiller hariç) */}
        <g dangerouslySetInnerHTML={{ __html: MASCOT_BASE }} />
        {/* Göz bebekleri — fareyi takip eder */}
        <g ref={pupilsRef} style={{ transition: 'transform .12s ease-out' }} dangerouslySetInnerHTML={{ __html: MASCOT_PUPILS }} />
        {/* Gülümseme — navy dolgu mutlu ağız; eski nötr ağzı içine alır (navy-üstü-navy,
            gözü pembeleştirmez, yama gerekmez) */}
        <path d="M206 250 Q225 257 244 250 Q246 273 225 275 Q204 273 206 250 Z" fill="#201240" />
        {/* Göz kapakları — blink */}
        <g>
          <ellipse className={`fext-lid${_forceBlink ? ' fext-lid-closed' : ''}`} cx="182" cy="229" rx="42" ry="41" fill="#DF4888" stroke="#201240" strokeWidth="5" />
          <ellipse className={`fext-lid${_forceBlink ? ' fext-lid-closed' : ''}`} cx="266" cy="205" rx="26" ry="26" fill="#DF4888" stroke="#201240" strokeWidth="5" />
        </g>
      </svg>

      {wordmark && (
        <span style={{
          fontSize: Math.round(height * 1.06), fontWeight: 700, letterSpacing: '-0.01em',
          fontFamily: "'Baloo 2','Fredoka',system-ui,-apple-system,'Segoe UI',sans-serif",
        }}>
          <span style={{ color: '#F8FAFC' }}>fe</span>
          <span style={{
            background: 'linear-gradient(135deg,#DF4888 0%,#8B3AA0 55%,#6A297F 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            <span style={{ fontSize: '1.22em' }}>X</span>t
          </span>
        </span>
      )}

      <style>{`
        @keyframes fextFloat { 0%,100%{ translate: 0 0 } 50%{ translate: 0 -3px } }
        .fext-lid { transform-box: fill-box; transform-origin: center top; transform: scaleY(0); animation: fextBlink 5s ease-in-out infinite; }
        .fext-lid-closed { transform: scaleY(1) !important; animation: none !important; }
        @keyframes fextBlink { 0%, 92%, 100% { transform: scaleY(0); } 94.5%, 96.5% { transform: scaleY(1); } }
        @media (prefers-reduced-motion: reduce) {
          svg[aria-label="feXt"] { animation: none !important; }
          .fext-lid { animation: none !important; transform: scaleY(0) !important; }
        }
      `}</style>
    </span>
  )
}
