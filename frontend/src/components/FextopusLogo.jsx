import { useEffect, useRef } from 'react'
import baseImg from '../assets/fextopus-base.webp'
import shinesImg from '../assets/fextopus-shines.webp'

// Göz kapaklarının yeri: 512'lik çizimde siyah göz disklerinin içi (kenarda ~15 birim
// siyah halka kalır → sağ göz gövdeden taşsa da kapanınca çerçevesiz pembe çıkıntı olmaz).
// Değerler fextopus-base.png'den ölçüldü; çizim değişirse yeniden ölç.
const GOZLER = [
  { cx: 215.5, cy: 227, rx: 64, ry: 64 }, // sol
  { cx: 382,   cy: 188, rx: 48, ry: 53 }, // sağ
]
const GOVDE_PEMBE = '#E24989'
const CIZGI = '#252525'
const yuzde = (v) => `${(v / 512) * 100}%`

/**
 * FextopusLogo — gerçek Fextopus maskotu (arkadaş çizimi, birebir PNG) + feXt wordmark.
 * Katmanlar: gövde (fextopus-base, parlamasız) + göz parlamaları (fextopus-shines)
 * + her gözün üstünde pembe göz kapakları (HTML, yalnız transform ile oynar).
 * Animasyon:
 *  • float  — hafif süzülme (CSS)
 *  • göz takibi — parlamalar (shines) fareye doğru kayar → gözler seni takip eder
 *  • göz kırpma — üst kapak iner, alt kapak kalkar; 8 sn'de bir tek, bir çift kırpma.
 *    Gövde resmi hiç değişmez (eski kapalı-göz karesi farklı ölçekteydi, logo zıplıyordu).
 *  • hover  — küçük eğilme/büyüme
 * prefers-reduced-motion açıksa hareket durur (gözler açık kalır).
 *
 * Props: height (px), wordmark (bool), interactive (göz takibi aç/kapa).
 */
export default function FextopusLogo({ height = 30, wordmark = true, interactive = true }) {
  const innerRef = useRef(null)
  const shinesRef = useRef(null)
  const size = Math.round(height * 1.5)
  const cizgi = Math.max(1, (size * 14) / 512)

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
          {GOZLER.map((g, i) => (
            <span key={i} aria-hidden="true" style={{
              position: 'absolute', left: yuzde(g.cx - g.rx), top: yuzde(g.cy - g.ry),
              width: yuzde(g.rx * 2), height: yuzde(g.ry * 2),
              borderRadius: '50%', overflow: 'hidden', pointerEvents: 'none',
            }}>
              <span className="fx-kapak-alt" style={{ position: 'absolute', left: 0, top: '35%', width: '100%', height: '65%', background: GOVDE_PEMBE }} />
              <span className="fx-kapak-ust" style={{
                position: 'absolute', left: '-5%', top: 0, width: '110%', height: '66%', boxSizing: 'border-box',
                background: GOVDE_PEMBE, borderBottom: `${cizgi}px solid ${CIZGI}`,
                borderBottomLeftRadius: '50% 45%', borderBottomRightRadius: '50% 45%',
              }} />
            </span>
          ))}
        </span>
      </span>

      {wordmark && (
        <span style={{
          fontSize: Math.round(height * 1.06), fontWeight: 700, letterSpacing: '-0.01em',
          fontFamily: "'Baloo 2 Variable','Baloo 2','Fredoka',system-ui,-apple-system,'Segoe UI',sans-serif",
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
        /* Kırpma: kapaklar açıkken göz diskinin epey dışında bekler (%101'de alt kenardan pembe şerit sızıyordu) (hareketi azaltta da öyle).
           Parlamalar kapalıyken söner: fareyle kayınca siyah halkanın üstüne taşabiliyor. */
        .fx-kapak-ust { transform: translateY(-125%); animation: fxUstKapak 8s ease-in-out infinite; will-change: transform; }
        .fx-kapak-alt { transform: translateY(125%); animation: fxAltKapak 8s ease-in-out infinite; will-change: transform; }
        .fx-shines { animation: fxParlama 8s ease-in-out infinite; }
        @keyframes fxFloat { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-3px) } }
        @keyframes fxUstKapak {
          0%,38%,41.8%,88%,91.2%,92.5%,96%,100% { transform: translateY(-125%) }
          39.2%,40.2%,89.2%,90%,93.7%,94.5% { transform: translateY(0) }
        }
        @keyframes fxAltKapak {
          0%,38%,41.8%,88%,91.2%,92.5%,96%,100% { transform: translateY(125%) }
          39.2%,40.2%,89.2%,90%,93.7%,94.5% { transform: translateY(0) }
        }
        @keyframes fxParlama {
          0%,38.4%,41.4%,88.4%,90.8%,92.9%,95.6%,100% { opacity: 1 }
          39.2%,40.2%,89.2%,90%,93.7%,94.5% { opacity: 0 }
        }
        @media (prefers-reduced-motion: reduce) {
          .fx-float { animation: none !important; }
          .fx-kapak-ust, .fx-kapak-alt, .fx-shines { animation: none !important; }
          .fx-logo:hover .fx-inner { transform: none; }
        }
      `}</style>
    </span>
  )
}
