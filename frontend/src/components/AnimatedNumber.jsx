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
 * 0'dan `value`'ya sayar — ama SAYAÇ EKRANA GİRİNCE başlar.
 *
 * Önceden sayfa yüklenir yüklenmez sayıyordu; ekranın altındaki kutular
 * kullanıcı oraya kaydırana kadar çoktan bitmiş oluyordu, yani animasyon
 * hiç görülmüyordu (5 Eyl geri bildirimi). IntersectionObserver ile
 * görünürlüğü bekliyoruz; bir kez tetiklendikten sonra izlemeyi bırakır.
 *
 * Sonraki değer değişimlerinde 0'a DÖNMEZ — o anki sayıdan yeni değere geçer,
 * böylece canlı güncellemeler sıfırdan saymaya başlamaz.
 */
export function CountUp({ value, duration = 900, format = n => n.toLocaleString('tr-TR') }) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null
  const rm = reduceMotion()
  const [shown, setShown] = useState(0)
  const [visible, setVisible] = useState(false)
  const fromRef = useRef(0)
  const hostRef = useRef(null)

  useEffect(() => {
    if (rm) return undefined
    const el = hostRef.current
    // IntersectionObserver yoksa (çok eski tarayıcı) animasyonu bloklama.
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined }

    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setVisible(true); io.disconnect() }
    }, { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [rm])

  useEffect(() => {
    if (numeric == null || rm || !visible) return undefined

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
  }, [numeric, duration, rm, visible])

  // ref taşıyabilmek için span şart. `shown` görünür olana kadar 0'da bekler.
  if (numeric == null) return <span ref={hostRef}>{value}</span>
  return <span ref={hostRef}>{format(rm ? numeric : shown)}</span>
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
