import { useEffect, useRef, useState } from 'react'

/**
 * Animasyon kancaları (UX P2 A1-A3). Hepsi "hareketi azalt" açıkken son hâli
 * anında verir; animasyon JS'le sürüldüğü için CSS media query'si yetmez.
 */

export function hareketAzalt() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Eleman ekrana bir kez girdi mi? [ref, gorundu]. Bir kez true olunca kalır.
 * IntersectionObserver yoksa hemen true (içerik gizli kalmasın).
 */
export function useGorununce(esik = 0.35) {
  const ref = useRef(null)
  const [gorundu, setGorundu] = useState(() => hareketAzalt() || typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (gorundu) return undefined
    const el = ref.current
    if (!el) return undefined
    const io = new IntersectionObserver(([g]) => {
      if (g?.isIntersecting) { setGorundu(true); io.disconnect() }
    }, { threshold: esik })
    io.observe(el)
    return () => io.disconnect()
  }, [gorundu, esik])

  return [ref, gorundu]
}

/**
 * Sayıyı ekrana girince `baslangic`tan `hedef`e kaydırır (ease-out). Sonraki
 * hedef değişimlerinde baştan değil o anki değerden geçer (canlı oran değişimi).
 * Döner: [ref, deger]. Kancayı küçük bir bileşende kullan: her karede yeniden çizer.
 */
export function useAcilisGecisi(hedef, { baslangic = 50, sure = 900 } = {}) {
  const [ref, gorundu] = useGorununce()
  const rm = hareketAzalt()
  const [deger, setDeger] = useState(rm ? hedef : baslangic)
  const degerRef = useRef(deger)

  useEffect(() => {
    if (!Number.isFinite(hedef)) return undefined
    if (rm || !gorundu) return undefined
    const from = degerRef.current
    if (from === hedef) return undefined

    let raf = 0
    let start = 0
    const tick = ts => {
      if (!start) start = ts
      const p = Math.min(1, (ts - start) / sure)
      const v = from + (hedef - from) * (1 - Math.pow(1 - p, 3))
      degerRef.current = v
      setDeger(v)
      if (p < 1) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [hedef, gorundu, rm, sure])

  // Hareketi azalt: geçiş yok, hep hedef
  return [ref, rm || !Number.isFinite(hedef) ? hedef : deger]
}

/**
 * `deger` her değiştiğinde artan sayaç (ilk çizimde 0; `deger` null ise izlenmez). `kimlik` değişirse
 * (başka maça geçildi) sayaç artmaz, yalnız yeni değer kaydedilir.
 * Kullanım: <SkorParlamasi n={sayac} /> → her artışta animasyon baştan oynar.
 */
export function useDegisimSayaci(deger, kimlik) {
  const [sayac, setSayac] = useState(0)
  const onceki = useRef({ deger, kimlik })

  useEffect(() => {
    const o = onceki.current
    onceki.current = { deger, kimlik }
    // null'a/null'dan geçiş (canlı başladı ya da bitti) değişim sayılmaz
    if (o.kimlik !== kimlik || o.deger === deger || o.deger == null || deger == null || hareketAzalt()) return
    setSayac(n => n + 1)
  }, [deger, kimlik])

  return sayac
}
