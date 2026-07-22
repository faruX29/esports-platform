import { useEffect, useId, useRef } from 'react'

/**
 * FextopusLogo — yeni Fextopus maskotu (katmanlı, animasyonlu) + feXt wordmark.
 * Arkadaş çizimi PNG'nin temiz vektör yorumu; parçalar ayrı olduğu için animasyon:
 *  • float   — hafif süzülme (CSS)
 *  • göz takibi — beyaz parlamalar (pupil grubu) fareye doğru kayar
 *  • blink   — pembe göz kapakları (scaleY) arada kırpar
 *  • kaş     — arada hafifçe kalkar (idle)
 * prefers-reduced-motion açıksa tüm hareket durur.
 *
 * Props: height (px), wordmark (bool), interactive (göz takibi aç/kapa).
 */
export default function FextopusLogo({ height = 30, wordmark = true, interactive = true }) {
  const svgRef = useRef(null)
  const pupilsRef = useRef(null)
  const gid = useId().replace(/:/g, '') // SVG id'lerinde ':' geçersiz

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
        const range = Math.min(6, dist / 24)
        const px = ((dx / dist) * range).toFixed(2)
        const py = ((dy / dist) * range).toFixed(2)
        pupils.setAttribute('transform', `translate(${px} ${py})`)
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => { window.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf) }
  }, [interactive])

  const size = Math.round(height * 1.5)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(height * 0.32), lineHeight: 1 }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="feXt Fextopus"
        style={{ display: 'block', overflow: 'visible', animation: 'fxFloat 4.2s ease-in-out infinite', willChange: 'transform' }}
      >
        <defs>
          <linearGradient id={`${gid}b`} x1="0.25" y1="0.08" x2="0.62" y2="0.98">
            <stop offset="0" stopColor="#F04E86" />
            <stop offset="0.5" stopColor="#D23C8B" />
            <stop offset="1" stopColor="#6E2A86" />
          </linearGradient>
        </defs>

        {/* Gövde silüeti (kafa + tentaküller) */}
        <path d="M96 22 C140 20 174 52 174 96 C174 118 165 133 155 143 C156 160 153 176 143 176 C134 176 133 162 128 154 C123 163 121 178 111 178 C102 178 102 162 97 154 C92 163 90 178 81 176 C72 174 73 160 69 153 C63 161 55 168 47 162 C38 155 33 135 31 114 C28 84 38 38 96 22 Z"
          fill={`url(#${gid}b)`} stroke="#241634" strokeWidth="7" strokeLinejoin="round" />

        {/* İç parlaklıklar */}
        <path d="M58 58 C50 74 47 90 49 104" fill="none" stroke="#FF74AE" strokeWidth="9" strokeLinecap="round" opacity="0.55" />
        <path d="M110 29 C133 32 152 46 161 65" fill="none" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" opacity="0.92" />

        {/* Küçük göz bump'ı */}
        <circle cx="150" cy="70" r="25" fill={`url(#${gid}b)`} stroke="#241634" strokeWidth="7" />

        {/* Gözler (siyah) */}
        <circle cx="86" cy="98" r="31" fill="#17121f" />
        <circle cx="150" cy="70" r="18" fill="#17121f" />

        {/* Kaşlar — idle'da hafif kalkar */}
        <g className="fx-brows">
          <path d="M64 70 C72 64 82 64 90 68" fill="none" stroke="#241634" strokeWidth="6" strokeLinecap="round" />
          <path d="M136 44 C144 40 154 41 160 47" fill="none" stroke="#241634" strokeWidth="6" strokeLinecap="round" />
        </g>

        {/* Göz parlamaları — fareyi takip eder */}
        <g ref={pupilsRef} style={{ transition: 'transform .12s ease-out' }}>
          <circle cx="95" cy="89" r="8.5" fill="#ffffff" />
          <circle cx="156" cy="63" r="6" fill="#ffffff" />
        </g>

        {/* Göz kapakları — blink */}
        <ellipse className="fx-lid" cx="86" cy="98" rx="34" ry="33" fill="#E24A8B" stroke="#241634" strokeWidth="5" />
        <ellipse className="fx-lid" cx="150" cy="70" rx="21" ry="20" fill="#E24A8B" stroke="#241634" strokeWidth="5" />

        {/* Gülümseme + yanak */}
        <path d="M118 124 C124 132 134 132 140 124" fill="none" stroke="#241634" strokeWidth="5.5" strokeLinecap="round" />
        <circle cx="150" cy="118" r="6" fill="#F98FC0" opacity="0.75" />

        <style>{`
          @keyframes fxFloat { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-3px) } }
          .fx-lid { transform-box: fill-box; transform-origin: center top; transform: scaleY(0); animation: fxBlink 5.4s ease-in-out infinite; }
          @keyframes fxBlink { 0%,90%,100%{ transform: scaleY(0) } 93.5%,95.5%{ transform: scaleY(1) } }
          .fx-brows { transform-box: fill-box; transform-origin: center; animation: fxBrow 4.8s ease-in-out infinite; }
          @keyframes fxBrow { 0%,68%,100%{ transform: translateY(0) } 80%,88%{ transform: translateY(-2.5px) } }
          @media (prefers-reduced-motion: reduce) {
            svg[aria-label="feXt Fextopus"] { animation: none !important; }
            .fx-lid { animation: none !important; transform: scaleY(0) !important; }
            .fx-brows { animation: none !important; transform: none !important; }
          }
        `}</style>
      </svg>

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
    </span>
  )
}
