import fextopusImg from '../assets/fextopus-trim.png'

/**
 * FextopusLogo — feXt marka logosu: gerçek Fextopus maskotu (arkadaş çizimi PNG,
 * birebir) + feXt wordmark.
 * Animasyon: hafif süzülme (float) + hover'da küçük eğilme/büyüme. Maskot tek parça
 * (gölgeli) olduğu için parça-bazlı animasyon (göz takibi/kırpma) yerine bütün-gövde
 * hareketi kullanılır. prefers-reduced-motion açıksa durur.
 *
 * Not: göz-takibi/kırpma istenirse maskotun katmanları (gözsüz gövde + ayrı göz
 * parlamaları) ayrı şeffaf PNG olarak lazım — o zaman overlay ile eklenebilir.
 *
 * Props: height (px), wordmark (bool).
 */
export default function FextopusLogo({ height = 30, wordmark = true }) {
  const size = Math.round(height * 1.5)

  return (
    <span className="fx-logo" style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(height * 0.32), lineHeight: 1 }}>
      <span className="fx-float" style={{ display: 'inline-flex' }}>
        <img
          className="fx-mascot"
          src={fextopusImg}
          alt="feXt Fextopus"
          width={size}
          height={size}
          style={{ display: 'block', width: size, height: size, objectFit: 'contain' }}
        />
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
        .fx-mascot { transform-origin: center 70%; transition: transform .25s cubic-bezier(.34,1.56,.64,1); }
        .fx-logo:hover .fx-mascot { transform: rotate(-5deg) scale(1.08); }
        @keyframes fxFloat { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-3px) } }
        @media (prefers-reduced-motion: reduce) {
          .fx-float { animation: none !important; }
          .fx-logo:hover .fx-mascot { transform: none; }
        }
      `}</style>
    </span>
  )
}
