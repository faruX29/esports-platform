import { useEffect, useRef, useState } from 'react'

/**
 * Sayı animasyonları — iki ayrı ihtiyaç, tek dosya.
 *
 *  • <CountUp />    : açılışta 0'dan hedefe sayar (istatistik kutuları).
 *  • <FlipNumber /> : değer DEĞİŞTİĞİNDE takla atar (canlı skor).
 *
 * İkisi de "reduce motion" açıkken anında son değeri gösterir; animasyon
 * JS'le sürüldüğü için CSS media query'si tek başına yetmez.
 */

function reduceMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Açılışta 0'dan `value`'ya sayar. Sonraki değişimlerde 0'a DÖNMEZ —
 * o anki gösterilen sayıdan yeni değere geçer (canlı sayaç zıplamasın).
 */
export function CountUp({ value, duration = 900, format = n => n.toLocaleString('tr-TR') }) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null
  const rm = reduceMotion()
  const [shown, setShown] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    if (numeric == null || rm) return undefined

    const from = fromRef.current
    if (from === numeric) return undefined

    let raf = 0
    let start = 0
    const tick = ts => {
      if (!start) start = ts
      const p = Math.min(1, (ts - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)          // ease-out cubic
      const next = Math.round(from + (numeric - from) * eased)
      setShown(next)
      if (p < 1) raf = window.requestAnimationFrame(tick)
      else fromRef.current = numeric
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [numeric, duration, rm])

  if (numeric == null) return <>{value}</>
  return <>{format(rm ? numeric : shown)}</>
}

/**
 * Değer değişince dikey takla + kısa vurgu. Gösterilen sayı taklanın TAM
 * ORTASINDA değişir; yoksa yeni rakam daha dönüş başlamadan görünürdü.
 */
export function FlipNumber({ value, style }) {
  const rm = reduceMotion()
  const [shown, setShown] = useState(value)
  const [run, setRun] = useState(0)          // her takla için artar → key ile yeniden oynatır
  const shownRef = useRef(value)

  // DİKKAT: bağımlılık YALNIZCA [value, rm]. Buraya `shown` eklenirse efekt
  // kendi setShown'ı yüzünden yeniden kurulur, cleanup bitiş zamanlayıcısını
  // iptal eder ve takla bir daha asla oynamaz (5 Eyl'de bu hataya düşüldü).
  useEffect(() => {
    if (rm || shownRef.current === value) return undefined

    setRun(r => r + 1)
    const mid = window.setTimeout(() => { shownRef.current = value; setShown(value) }, 230)
    return () => window.clearTimeout(mid)
  }, [value, rm])

  return (
    <span
      // key değişimi elemanı yeniden oluşturur → animasyon her seferinde
      // baştan oynar; art arda gelen skor güncellemelerinde bile.
      key={run}
      style={{
        display: 'inline-block',
        animation: run > 0 && !rm ? 'scoreFlip .47s cubic-bezier(.2,.8,.3,1)' : 'none',
        ...style,
      }}
    >
      {rm ? value : shown}
    </span>
  )
}
