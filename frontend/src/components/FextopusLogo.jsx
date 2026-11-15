import { useEffect, useRef, useState } from 'react'
import baseImg from '../assets/fextopus-base.webp'
import shinesImg from '../assets/fextopus-shines.webp'
import mahcupAgizImg from '../assets/fextopus-agiz-mahcup.webp'

// Göz kapaklarının yeri: 512'lik çizimde siyah göz disklerinin içi (kenarda ~15 birim
// siyah halka kalır → sağ göz gövdeden taşsa da kapanınca çerçevesiz pembe çıkıntı olmaz).
// Değerler fextopus-base.png'den ölçüldü; çizim değişirse yeniden ölç.
const GOZLER = [
  { ad: 'sol', cx: 215.5, cy: 227, rx: 64, ry: 64 }, // yakın, büyük göz
  { ad: 'sag', cx: 382,   cy: 188, rx: 48, ry: 53 },
]
// Mahcup yanakları ve ağız yaması (aynı 512'lik ölçek). Yama, eski gülümsemenin olduğu
// düz pembe bölgeyi tümden örter; içindeki ağız maskotun kendi gülümsemesinin ters,
// yatay ve yassı hâli (çizgi kalınlığı aynı kalsın diye yeniden çizilmedi).
const YANAKLAR = [{ cx: 232, cy: 326, rx: 34, ry: 15 }, { cx: 404, cy: 276, rx: 24, ry: 12 }]
const AGIZ_YAMASI = { x: 298, y: 262, w: 72, h: 56 }
const GOVDE_PEMBE = '#E24989'
const CIZGI = '#252525'
const yuzde = (v) => `${(v / 512) * 100}%`
const kutu = (x, y, w, h) => ({ position: 'absolute', left: yuzde(x), top: yuzde(y), width: yuzde(w), height: yuzde(h), pointerEvents: 'none' })

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
 * prefers-reduced-motion açıksa hareket durur (ifadenin duruşu kalır).
 *
 * Props: height (px), wordmark (bool), interactive (göz takibi aç/kapa),
 *   ifade: 'normal' | 'uykulu' (canlı maç yok) | 'saskin' (bulunamadı) | 'mahcup' (hata, Fextopus yanıldı),
 *   kirp: true olunca `kirpGecikme` ms sonra yakın gözüyle bir kez göz kırpar (Fextopus bildi).
 */
export default function FextopusLogo({ height = 30, wordmark = true, interactive = true, ifade = 'normal', kirp = false, kirpGecikme = 0 }) {
  const innerRef = useRef(null)
  const shinesRef = useRef(null)
  const [wink, setWink] = useState(false)
  const size = Math.round(height * 1.5)
  const cizgi = Math.max(1, (size * 14) / 512)
  const takip = interactive && ifade === 'normal'

  useEffect(() => {
    if (!takip) return
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
    return () => { window.removeEventListener('mousemove', onMove); if (raf) cancelAnimationFrame(raf); shines.style.transform = '' }
  }, [takip, size])

  // Göz kırpma tek seferlik: sınıf ~0,7 sn kalır, sonra olağan kırpma döngüsü geri gelir.
  useEffect(() => {
    if (!kirp) return
    const t1 = setTimeout(() => setWink(true), kirpGecikme)
    const t2 = setTimeout(() => setWink(false), kirpGecikme + 700)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [kirp, kirpGecikme])

  return (
    <span className={`fx-logo${wink ? ' fx-wink' : ''}`} data-ifade={ifade} style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(height * 0.32), lineHeight: 1 }}>
      <span className="fx-float" style={{ display: 'inline-flex', position: 'relative' }}>
        <span ref={innerRef} className="fx-inner" style={{ position: 'relative', display: 'block', width: size, height: size }}>
          <img className="fx-base" src={baseImg} alt="feXt Fextopus" width={size} height={size} style={{ display: 'block', width: size, height: size, objectFit: 'contain' }} />
          {ifade === 'mahcup' && (
            <>
              <img src={mahcupAgizImg} alt="" aria-hidden="true" style={kutu(AGIZ_YAMASI.x, AGIZ_YAMASI.y, AGIZ_YAMASI.w, AGIZ_YAMASI.h)} />
              {YANAKLAR.map((y, i) => (
                <span key={i} aria-hidden="true" style={{ ...kutu(y.cx - y.rx, y.cy - y.ry, y.rx * 2, y.ry * 2), borderRadius: '50%', background: '#ff5c93', opacity: 0.75, filter: 'blur(1px)' }} />
              ))}
            </>
          )}
          <img ref={shinesRef} className="fx-shines" src={shinesImg} alt="" aria-hidden="true" width={size} height={size} style={{ position: 'absolute', inset: 0, width: size, height: size, objectFit: 'contain', transition: 'transform .12s ease-out', pointerEvents: 'none' }} />
          {GOZLER.map((g) => (
            <span key={g.ad} className={`fx-goz-${g.ad}`} aria-hidden="true" style={{
              ...kutu(g.cx - g.rx, g.cy - g.ry, g.rx * 2, g.ry * 2), borderRadius: '50%', overflow: 'hidden',
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
        {ifade === 'uykulu' && (
          <span aria-hidden="true" style={{ position: 'absolute', right: -size * 0.08, top: 0, fontFamily: "'Baloo 2 Variable','Baloo 2',system-ui,sans-serif", fontWeight: 800, color: 'var(--text-4)', pointerEvents: 'none' }}>
            <span className="fx-z" style={{ position: 'absolute', right: 0, top: size * 0.06, fontSize: Math.max(12, size * 0.17) }}>z</span>
            <span className="fx-z fx-z2" style={{ position: 'absolute', right: -size * 0.07, top: 0, fontSize: Math.max(12, size * 0.13) }}>z</span>
          </span>
        )}
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
        /* Kırpma: kapaklar açıkken göz diskinin epey dışında bekler (%101'de alt kenardan pembe
           şerit sızıyordu); hareketi azaltta da öyle. Açık hâl --ust-acik ile ifadeye göre değişir
           (uykulu/mahcup gözler yarı kapalı). Parlamalar kapalıyken söner: fareyle kayınca siyah
           halkanın üstüne taşabiliyor. */
        .fx-kapak-ust { transform: translateY(var(--ust-acik, -125%)); animation: fxUstKapak 8s ease-in-out infinite; will-change: transform; }
        .fx-kapak-alt { transform: translateY(125%); animation: fxAltKapak 8s ease-in-out infinite; will-change: transform; }
        .fx-shines { animation: fxParlama 8s ease-in-out infinite; }
        @keyframes fxFloat { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-3px) } }
        @keyframes fxUstKapak {
          0%,38%,41.8%,88%,91.2%,92.5%,96%,100% { transform: translateY(var(--ust-acik, -125%)) }
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

        /* Uykulu: üst kapaklar yarıda, ara sıra tam kapanıp yavaşça açılır; z'ler süzülür. */
        [data-ifade="uykulu"] { --ust-acik: -52%; }
        [data-ifade="uykulu"] .fx-kapak-ust { animation: fxUykulu 5s ease-in-out infinite; }
        [data-ifade="uykulu"] .fx-kapak-alt { animation: none; }
        [data-ifade="uykulu"] .fx-shines { animation: none; opacity: .55; }
        [data-ifade="uykulu"] .fx-float { animation-duration: 5s; }
        @keyframes fxUykulu { 0%,55%,100% { transform: translateY(-52%) } 62%,74% { transform: translateY(0) } 85% { transform: translateY(-52%) } }
        .fx-z { opacity: 0; animation: fxZ 3s ease-out infinite; }
        .fx-z2 { animation-delay: 1.5s; }
        @keyframes fxZ { 0% { opacity: 0; transform: translate(0,0) scale(.6) } 20% { opacity: 1 } 100% { opacity: 0; transform: translate(10px,-26px) scale(1.15) } }

        /* Şaşkın: zıplar, iki hızlı kırpma, sonra etrafa bakınır. */
        [data-ifade="saskin"] .fx-float { animation: fxHop 3.2s cubic-bezier(.3,1.6,.5,1) infinite; }
        [data-ifade="saskin"] .fx-kapak-ust { animation: fxSaskinUst 3.2s ease-in-out infinite; }
        [data-ifade="saskin"] .fx-kapak-alt { animation: fxSaskinAlt 3.2s ease-in-out infinite; }
        [data-ifade="saskin"] .fx-shines { animation: fxBakin 3.2s ease-in-out infinite; }
        @keyframes fxHop { 0%,100% { transform: translateY(0) } 6% { transform: translateY(-14%) scale(1.06) } 14% { transform: translateY(0) } }
        @keyframes fxSaskinUst { 0%,18%,21%,24%,27%,100% { transform: translateY(-125%) } 19.5%,25.5% { transform: translateY(0) } }
        @keyframes fxSaskinAlt { 0%,18%,21%,24%,27%,100% { transform: translateY(125%) } 19.5%,25.5% { transform: translateY(0) } }
        @keyframes fxBakin { 0%,30% { transform: translate(0,0) } 40%,55% { transform: translate(-5%,-1%) } 65%,80% { transform: translate(5%,-1%) } 90%,100% { transform: translate(0,0) } }

        /* Mahcup: yere bakar, gözler yarı kapalı, yanaklar kızarık, hafif eğik. */
        [data-ifade="mahcup"] { --ust-acik: -62%; }
        [data-ifade="mahcup"] .fx-inner { rotate: -7deg; }
        [data-ifade="mahcup"] .fx-shines { transform: translate(-3%, 4%); }

        /* Fextopus bildi: yakın (sol) gözüyle tek, kısa göz kırpma + küçük sıçrama. */
        .fx-wink .fx-goz-sol .fx-kapak-ust { animation: fxWinkUst .42s ease-in-out both; }
        .fx-wink .fx-goz-sol .fx-kapak-alt { animation: fxWinkAlt .42s ease-in-out both; }
        .fx-wink .fx-float { animation: fxZipla .6s cubic-bezier(.3,1.6,.5,1) both; }
        @keyframes fxWinkUst { 0%,100% { transform: translateY(var(--ust-acik, -125%)) } 30%,58% { transform: translateY(0) } }
        @keyframes fxWinkAlt { 0%,100% { transform: translateY(125%) } 30%,58% { transform: translateY(0) } }
        @keyframes fxZipla { 0%,100% { transform: translateY(0) } 35% { transform: translateY(-14%) rotate(-6deg) } }

        @media (prefers-reduced-motion: reduce) {
          .fx-float, .fx-kapak-ust, .fx-kapak-alt, .fx-shines, .fx-z { animation: none !important; }
          .fx-logo:hover .fx-inner { transform: none; }
        }
      `}</style>
    </span>
  )
}
