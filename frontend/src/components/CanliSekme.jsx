import { useEffect, useState } from 'react'
import { SAATI_GECTI_ESIGI_MS } from '../theme'

/**
 * Canlı maç sayfası açıkken sekme başlığı ve favicon (başka sekmedeki kullanıcı skoru görsün).
 * Skor seri skorudur (harita/oyun); raund verisi yok. Bir taraf skor alınca başlık ~8 sn
 * "EF haritayı aldı!" der.
 */

/** Canlıyken favicon'un köşesine kırmızı nokta koyar; ayrılınca eski ikonları geri takar. */
export function CanliFavicon({ aktif }) {
  useEffect(() => {
    if (!aktif || typeof document === 'undefined') return undefined
    const linkler = [...document.querySelectorAll('link[rel="icon"]')]
    if (!linkler.length) return undefined
    const eski = linkler.map(l => l.getAttribute('href'))
    let iptal = false
    const img = new Image()
    img.onload = () => {
      if (iptal) return
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const g = c.getContext('2d')
      if (!g) return
      g.drawImage(img, 0, 0, 64, 64)
      g.beginPath(); g.arc(50, 14, 13, 0, Math.PI * 2)
      g.fillStyle = '#FF4655'; g.fill()
      g.lineWidth = 4; g.strokeStyle = '#0b0f19'; g.stroke()
      const url = c.toDataURL('image/png')
      linkler.forEach(l => l.setAttribute('href', url))
    }
    img.src = eski[0]
    return () => {
      iptal = true
      linkler.forEach((l, i) => l.setAttribute('href', eski[i]))
    }
  }, [aktif])
  return null
}

/**
 * Yaklaşan maçın saati: son 15 dakikada saniyeli geri sayım, saat gelince "Başlaması bekleniyor".
 * Maçlar çoğu zaman ilan edilen saatten birkaç dakika sonra başlıyor (bazen çok daha geç), o yüzden
 * 00:00'da asla "CANLI" denmez; CANLI yalnız maç gerçekten başlayınca (status=running) gelir.
 */
export function GeriSayim({ zaman, varsayilan, style }) {
  const hedef = zaman ? new Date(zaman).getTime() : NaN
  const [simdi, setSimdi] = useState(() => Date.now())
  const kalan = hedef - simdi
  // Saatten 20 dk sonra sayfa zaten "Sonuç bekleniyor" rozetine geçiyor (saatiGecti); orada bırak.
  const gecti = kalan <= -SAATI_GECTI_ESIGI_MS
  const yakin = kalan <= 16 * 60 * 1000 && !gecti
  useEffect(() => {
    if (!Number.isFinite(hedef) || gecti) return undefined
    const t = setInterval(() => setSimdi(Date.now()), yakin ? 1000 : 30000)
    return () => clearInterval(t)
  }, [hedef, yakin, gecti])

  if (!Number.isFinite(hedef) || gecti || kalan > 15 * 60 * 1000) return <div style={style}>{varsayilan}</div>
  if (kalan <= 0) return <div style={{ ...style, color: 'var(--altin-fg)' }}>Başlaması bekleniyor</div>
  const sn = Math.ceil(kalan / 1000)
  const metin = `${String(Math.floor(sn / 60)).padStart(2, '0')}:${String(sn % 60).padStart(2, '0')}`
  return (
    <div style={style} aria-label={`Başlamasına ${Math.ceil(sn / 60)} dakika`}>
      <span style={{ fontSize: '0.85em', fontWeight: 600, color: 'var(--text-4)' }}>Başlamasına </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: sn <= 60 ? 'var(--altin-fg)' : undefined }}>{metin}</span>
    </div>
  )
}
