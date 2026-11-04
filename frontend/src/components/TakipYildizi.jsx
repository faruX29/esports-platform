import { useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { hareketAzalt } from '../hooks/useHareket'

const ALTIN = '#FFD700'

/**
 * Takip yıldızı (UX P2 A7). `aktif` false → true olunca yıldız "pop" yapar ve
 * çevresinden altın bir halka açılır. İlk çizimde, takip bırakılınca ve
 * tıklamasız değişimde oynamaz.
 * Hareketi azalt açıkken düz yıldız.
 */
export default function TakipYildizi({ aktif, size = 14, renk = 'currentColor' }) {
  const [n, setN] = useState(0)
  const onceki = useRef(aktif)
  const kok = useRef(null)
  const tiklama = useRef(0)

  // Yalnız tıklamanın sonucu oynasın: takip listesi sunucudan geç gelince
  // (ilk yükleme, başka sekme) yıldız kendiliğinden zıplamasın.
  useEffect(() => {
    const btn = kok.current?.closest('button')
    if (!btn) return undefined
    const f = () => { tiklama.current = Date.now() }
    btn.addEventListener('click', f)
    return () => btn.removeEventListener('click', f)
  }, [])

  useEffect(() => {
    const o = onceki.current
    onceki.current = aktif
    if (!o && aktif && Date.now() - tiklama.current < 1500 && !hareketAzalt()) setN(x => x + 1)
  }, [aktif])

  return (
    <span ref={kok} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <span key={n} style={{ display: 'inline-flex', animation: n ? 'fxPop .45s cubic-bezier(.3,1.4,.5,1) both' : 'none' }}>
        <Star size={size} fill={aktif ? ALTIN : 'none'} color={aktif ? ALTIN : renk} />
      </span>
      {n > 0 && (
        <span key={`h${n}`} aria-hidden="true" style={{
          position: 'absolute', inset: -size * 0.35, borderRadius: '50%', pointerEvents: 'none',
          border: `2px solid ${ALTIN}`, animation: 'fxHalka .5s ease-out both',
        }} />
      )}
    </span>
  )
}
