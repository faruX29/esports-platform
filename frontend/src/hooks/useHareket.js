import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Animasyon kancaları (UX P2). Hepsi "hareketi azalt" açıkken son hâli
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

/**
 * Liste sırası değişince satırlar eski yerinden yenisine kayar (FLIP; UX P2 A6).
 * `kapRef` içindeki `[data-flip="<anahtar>"]` satırları izlenir; `imza` (sıranın özeti,
 * ör. anahtarların birleşimi) değişince çalışır. Konum `offsetTop`'tan okunur (transform
 * etkilemez). `ilkSira` verilirse (anahtar → önceki sıra indeksi) liste ilk kez dolunca
 * satırlar o sıradaki yerlerinde görünür, kısa bir duraktan sonra yeni yerlerine kayar.
 */
export function useSiraGecisi(kapRef, imza, ilkSira = null) {
  const onceki = useRef(null)

  useLayoutEffect(() => {
    const kap = kapRef.current
    if (!kap) return undefined
    const els = [...kap.querySelectorAll('[data-flip]')]
    const yeni = new Map(els.map(el => [el.dataset.flip, el.offsetTop]))
    let eski = onceki.current
    onceki.current = yeni
    if (!els.length || hareketAzalt()) return undefined

    let durak = 0
    if (!eski?.size) {
      if (!ilkSira) return undefined
      eski = new Map()
      for (const el of els) {
        const i = ilkSira.get(el.dataset.flip)
        if (i != null) eski.set(el.dataset.flip, els[Math.min(i, els.length - 1)].offsetTop)
      }
      durak = 500
    }

    const hareketli = []
    for (const el of els) {
      const o = eski.get(el.dataset.flip)
      const n = yeni.get(el.dataset.flip)
      if (o == null || o === n) continue
      // Satırın kendi position/z-index'i geri konacak (kart linki örtüsü position: relative ister)
      // (yarıda kalan geçişte zaten saklı: üstüne yazma, geçişin değerlerini saklamış oluruz)
      if (!el.dataset.flipStil) el.dataset.flipStil = JSON.stringify([el.style.position, el.style.zIndex])
      el.style.transition = 'none'
      el.style.transform = `translateY(${o - n}px)`
      el.style.position = 'relative'
      el.style.zIndex = '1'
      el.style.backgroundColor = 'var(--surface)'
      hareketli.push(el)
    }
    if (!hareketli.length) return undefined

    const temizle = el => {
      const [pos = '', z = ''] = JSON.parse(el.dataset.flipStil || '[]')
      delete el.dataset.flipStil
      el.style.transition = ''; el.style.transform = ''
      el.style.position = pos; el.style.zIndex = z; el.style.backgroundColor = ''
    }
    void kap.offsetHeight // reflow: başlangıç konumu çizilsin
    let bitis = 0
    const basla = window.setTimeout(() => {
      for (const el of hareketli) {
        el.style.transition = 'transform .7s cubic-bezier(.2,.8,.25,1)'
        el.style.transform = ''
      }
      bitis = window.setTimeout(() => hareketli.forEach(temizle), 750)
    }, durak || 16)

    return () => {
      window.clearTimeout(basla)
      window.clearTimeout(bitis)
      hareketli.forEach(temizle)
    }
  }, [imza]) // eslint-disable-line react-hooks/exhaustive-deps -- yalnız sıra değişince
}
