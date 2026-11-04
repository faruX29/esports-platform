import { useGorununce, hareketAzalt } from '../hooks/useHareket'

/**
 * Çocuğu ekrana girince damga gibi basar (UX P2 A3: "Fextopus bildi / yanıldı").
 * Girene kadar yer tutar ama görünmez; hareketi azalt açıkken düz görünür.
 * `aci`: damganın son eğimi (derece). Küçük rozetlerde 0 bırak, okunsun.
 */
export function Damga({ children, aci = 0, gecikme = 0, style }) {
  const [ref, gorundu] = useGorununce(0.6)
  const rm = hareketAzalt()
  return (
    <span
      ref={ref}
      style={{
        display: 'inline-flex',
        '--damga-aci': `${aci}deg`,
        transform: `rotate(${aci}deg)`,
        opacity: gorundu || rm ? 1 : 0,
        animation: gorundu && !rm ? `fxDamga .52s cubic-bezier(.2,.9,.3,1.25) ${gecikme}ms both` : 'none',
        ...style,
      }}
    >
      {children}
    </span>
  )
}

/**
 * Kartın üstüne binen 1 sn'lik parlama (UX P2 A1: canlı skor değişti).
 * Ebeveyn `position: relative` olmalı. `n` her artışta animasyon baştan oynar
 * (key); 0 iken hiçbir şey çizilmez. Gölge içe vurur: overflow:hidden kart kesmesin.
 */
export function SkorParlamasi({ n, radius = 16 }) {
  if (!n) return null
  return (
    <span
      key={n}
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, borderRadius: radius, pointerEvents: 'none',
        animation: 'fxSkorParla 1s ease-out both',
      }}
    />
  )
}
