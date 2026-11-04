import { Children, useEffect, useState } from 'react'
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

/**
 * Çocukları ekrana girince soldan sağa sırayla belirtir (UX P2 A10: G/M form rozetleri).
 * Her çocuk bir sarmalayıcıya girer; ebeveyn flex ise yerleşim değişmez.
 * Son rozet en geç ~200 ms'de başlar (çok rozette `aralik` kısalır), toplam ≤ ~400 ms.
 */
export function Sirayla({ children, aralik = 40, className, style }) {
  const [ref, gorundu] = useGorununce(0.2)
  const rm = hareketAzalt()
  const adim = Math.min(aralik, Math.floor(200 / Math.max(1, Children.count(children) - 1)))
  return (
    <div ref={ref} className={className} style={style}>
      {Children.map(children, (c, i) => (
        <span style={{
          display: 'inline-flex',
          opacity: gorundu || rm ? 1 : 0,
          animation: gorundu && !rm ? `fxBelir .2s ease-out ${i * adim}ms both` : 'none',
        }}>{c}</span>
      ))}
    </div>
  )
}

// Konfeti parçaları modül yüklenirken bir kez üretilir (çizimde rastgelelik yok).
const KONFETI_RENK = ['#f0a500', '#ffd23f', '#DF4888', '#8B3AA0', '#4CAF50', '#60a5fa']
const KONFETI = Array.from({ length: 22 }, (_, i) => {
  const t = (i * 0.6180339887) % 1            // altın oranla düzgün dağılmış 0..1
  const aci = -Math.PI * (0.08 + 0.84 * t)    // yukarı yarım daire
  const hiz = 60 + ((i * 37) % 50)
  return {
    dx: Math.round(Math.cos(aci) * hiz * 1.6),
    dy: Math.round(Math.sin(aci) * hiz),
    r: ((i * 97) % 540) - 270,
    renk: KONFETI_RENK[i % KONFETI_RENK.length],
    w: i % 3 === 0 ? 5 : 7,
    h: i % 3 === 0 ? 5 : 3,
    yuvarlak: i % 3 === 0,
    gecikme: (i % 5) * 25,
  }
})

/**
 * Şampiyon kartında bir kez patlayan konfeti (UX P2 A5). Ebeveyn `position: relative`
 * olmalı; parçalar `x`/`y` noktasından (ebeveyne göre px) saçılır. Ekrana girince oynar,
 * 1,6 sn sonra DOM'dan çıkar. Hareketi azalt açıkken hiç çizilmez.
 */
export function Konfeti({ x = '50%', y = '50%' }) {
  const [ref, gorundu] = useGorununce(0.6)
  const [bitti, setBitti] = useState(false)
  const rm = hareketAzalt()

  useEffect(() => {
    if (!gorundu || rm) return undefined
    const t = window.setTimeout(() => setBitti(true), 1600)
    return () => window.clearTimeout(t)
  }, [gorundu, rm])

  if (rm || bitti) return null
  return (
    <span ref={ref} aria-hidden="true" style={{ position: 'absolute', left: x, top: y, width: 1, height: 1, pointerEvents: 'none', zIndex: 2 }}>
      {gorundu && KONFETI.map((p, i) => (
        <span key={i} style={{
          position: 'absolute', left: -p.w / 2, top: -p.h / 2, width: p.w, height: p.h,
          borderRadius: p.yuvarlak ? '50%' : 1, background: p.renk,
          '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--r': `${p.r}deg`,
          animation: `fxKonfeti 1.35s cubic-bezier(.15,.7,.3,1) ${p.gecikme}ms both`,
        }} />
      ))}
    </span>
  )
}
