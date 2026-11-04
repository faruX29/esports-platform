/**
 * Sayfa içi bölüm asansörü (ilk kez /turk-takimlari'da; ana sayfa da kullanır).
 * Masaüstü: solda yapışkan ikon sütunu, vurgu kutusu aktif bölüme kayar.
 * Mobil: navbar altında yapışkan, yatay kayan bölüm şeridi.
 *
 * bolumler: [{ id, baslik, kisa, ikon: boyut => <Ikon size={boyut} /> }] — sayfadaki
 * sırayla aynı olmalı; her bölümün kapsayıcısında id={b.id} ve scrollMarginTop={ustPay}.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { FEXT } from '../theme'

export const NAVBAR_YUKSEKLIK = 58
export const MOBIL_SERIT = 50
export const ASANSOR_TUS = 40
export const ASANSOR_ARA = 6
/** Masaüstü ızgarasında asansör sütununun genişliği */
export const ASANSOR_SUTUN = ASANSOR_TUS + ASANSOR_ARA * 2 + 2

/** Kaydırırken aktif bölümü izler; git(id) yumuşak kaydırır ve başlığı kısa süre vurgular. */
export function useAsansor(bolumler, isMobile) {
  const ustPay = NAVBAR_YUKSEKLIK + (isMobile ? MOBIL_SERIT + 10 : 16)
  const ilk = bolumler[0]?.id ?? null
  const [aktif, setAktif] = useState(ilk)
  const [vurgu, setVurgu] = useState(null)
  const kayiyorRef = useRef(false)   // tıklamayla kayarken ara bölümler aktif olmasın
  const zamanRef = useRef(null)
  // Bölüm listesi koşullu (ör. canlı maç yoksa "Canlı" yok) → kimliklerden anahtar
  const anahtar = bolumler.map(b => b.id).join('|')

  useEffect(() => {
    const idler = anahtar ? anahtar.split('|') : []
    let zaman = 0
    const hesapla = () => {
      zaman = 0
      if (kayiyorRef.current || !idler.length) return
      // Sayfa sonuna gelindiyse son bölüm (kısa bölüm hiçbir zaman tepeye çıkamaz)
      const altta = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      let secili = idler[0]
      if (altta) secili = idler[idler.length - 1]
      else {
        for (const id of idler) {
          const el = document.getElementById(id)
          if (el && el.getBoundingClientRect().top <= ustPay + 40) secili = id
        }
      }
      setAktif(secili)
    }
    // Kısa zamanlayıcıyla seyreltilir (rAF arka plan sekmesinde hiç çalışmıyor)
    const onScroll = () => { if (!zaman) zaman = setTimeout(hesapla, 60) }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(zaman) }
  }, [ustPay, anahtar])

  useEffect(() => () => clearTimeout(zamanRef.current), [])

  const git = useCallback(id => {
    const el = document.getElementById(id)
    if (!el) return
    const azHareket = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    kayiyorRef.current = true
    setAktif(id)
    setVurgu(id)
    el.scrollIntoView({ behavior: azHareket ? 'auto' : 'smooth', block: 'start' })
    clearTimeout(zamanRef.current)
    zamanRef.current = setTimeout(() => { kayiyorRef.current = false; setVurgu(null) }, 900)
  }, [])

  return { aktif, vurgu, git, ustPay }
}

/** Masaüstü: solda yapışkan ikon sütunu; vurgu kutusu aktif bölüme kayar. */
export function Asansor({ bolumler, aktif, onGit }) {
  const [uzerinde, setUzerinde] = useState(null)
  const sira = Math.max(0, bolumler.findIndex(b => b.id === aktif))
  if (!bolumler.length) return <div />
  return (
    <nav aria-label="Sayfa bölümleri" style={{ position: 'sticky', top: NAVBAR_YUKSEKLIK + 20, alignSelf: 'start', zIndex: 4 }}>
      <div style={{ position: 'relative', display: 'grid', gap: ASANSOR_ARA, padding: ASANSOR_ARA, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)' }}>
        <span aria-hidden="true" style={{
          position: 'absolute', left: ASANSOR_ARA, top: ASANSOR_ARA, width: ASANSOR_TUS, height: ASANSOR_TUS,
          borderRadius: 10, background: FEXT.accentSoftBg, border: `1px solid ${FEXT.accentBorder}`, boxSizing: 'border-box',
          transform: `translateY(${sira * (ASANSOR_TUS + ASANSOR_ARA)}px)`,
          transition: 'transform .38s cubic-bezier(.34,1.12,.5,1)', pointerEvents: 'none',
        }} />
        {bolumler.map(b => {
          const secili = b.id === aktif
          const acik = uzerinde === b.id
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onGit(b.id)}
              aria-label={b.baslik}
              aria-current={secili ? 'true' : undefined}
              onMouseEnter={() => setUzerinde(b.id)}
              onMouseLeave={() => setUzerinde(null)}
              onFocus={() => setUzerinde(b.id)}
              onBlur={() => setUzerinde(null)}
              style={{
                position: 'relative', width: ASANSOR_TUS, height: ASANSOR_TUS, display: 'grid', placeItems: 'center',
                border: 'none', background: 'transparent', borderRadius: 10, cursor: 'pointer', padding: 0,
                color: secili ? 'var(--accent-fg)' : 'var(--text-3)', transition: 'color .2s',
              }}
            >
              {b.ikon(18)}
              <span style={{
                position: 'absolute', left: ASANSOR_TUS + 12, top: '50%', zIndex: 5,
                transform: `translate(${acik ? 0 : -4}px,-50%)`, opacity: acik ? 1 : 0,
                transition: 'opacity .15s, transform .15s', pointerEvents: 'none', whiteSpace: 'nowrap',
                fontSize: 12, fontWeight: 700, color: 'var(--text-1)', background: 'var(--surface-2)',
                border: '1px solid var(--line)', borderRadius: 8, padding: '5px 9px',
              }}>
                {b.baslik}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** Mobil: navbar altında yapışkan, yatay kayan bölüm şeridi. kenar = sayfanın yatay iç boşluğu. */
export function MobilAsansor({ bolumler, aktif, onGit, kenar = 16 }) {
  const seritRef = useRef(null)
  // Aktif çip şeridin dışında kalmasın (scrollIntoView sayfanın kaymasını bölebilir → elle)
  useEffect(() => {
    const serit = seritRef.current
    const cip = serit?.querySelector('[aria-current="true"]')
    if (!serit || !cip) return
    const hedef = cip.offsetLeft - (serit.clientWidth - cip.offsetWidth) / 2
    serit.scrollTo({ left: Math.max(0, hedef), behavior: 'smooth' })
  }, [aktif])
  if (!bolumler.length) return null
  return (
    <nav ref={seritRef} aria-label="Sayfa bölümleri" style={{
      position: 'sticky', top: NAVBAR_YUKSEKLIK, zIndex: 20, height: MOBIL_SERIT, boxSizing: 'border-box',
      margin: `0 -${kenar}px 14px`, padding: `8px ${kenar}px`, background: 'var(--bg)', borderBottom: '1px solid var(--line)',
      display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      {bolumler.map(b => {
        const secili = b.id === aktif
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onGit(b.id)}
            aria-current={secili ? 'true' : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '0 11px', borderRadius: 999,
              border: `1px solid ${secili ? FEXT.accentBorder : 'var(--line)'}`,
              background: secili ? FEXT.accentSoftBg : 'var(--surface)',
              color: secili ? 'var(--accent-fg)' : 'var(--text-3)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'background .2s, color .2s, border-color .2s',
            }}
          >
            {b.ikon(14)} {b.kisa}
          </button>
        )
      })}
    </nav>
  )
}
