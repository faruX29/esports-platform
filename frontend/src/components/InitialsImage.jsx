import { useEffect, useMemo, useState } from 'react'
import { kucukGorsel, THUMB_AZAMI_PX } from '../utils/gorsel'

function buildInitials(name, max = 2) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[-_]+/g, ' ')

  if (!cleaned) return '?'

  const pieces = cleaned.split(/\s+/).filter(Boolean)
  if (pieces.length === 1) return pieces[0].slice(0, max).toUpperCase()

  return pieces
    .slice(0, max)
    .map(piece => piece[0])
    .join('')
    .toUpperCase()
}

function hashSeed(input) {
  const text = String(input || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function makeTone(seed) {
  const hue = seed % 360
  return {
    background: `linear-gradient(135deg, hsla(${hue}, 28%, 20%, 1), hsla(${(hue + 28) % 360}, 34%, 13%, 1))`,
    border: `1px solid hsla(${hue}, 42%, 42%, .38)`,
    color: `hsl(${hue}, 48%, 82%)`,
  }
}

// NOT: Görselleri wsrv.nl proxy'siyle küçültme DENENDİ ama proxy timeout verdiği
// için logolar boş kalıyordu → geri alındı (logo güvenilirliği > bayt tasarrufu).
// İleride görsel optimizasyonu güvenilir bir çözümle (Vercel Image Opt / self-host
// imgproxy) yapılabilir; wsrv KULLANMA.
// Bugünkü küçültme proxy'siz: PandaScore'un kendi thumb_ sürümü (utils/gorsel.js);
// thumb açılmazsa önce orijinal denenir, o da açılmazsa baş harfler.
//
// priority: ilk ekranda görünen (LCP adayı) görseller için → tembel yükleme yok,
// tarayıcı yüksek öncelikle çeker. Yalnız ilk birkaç görsele ver.
export default function InitialsImage({
  src,
  name,
  alt,
  width = 32,
  height = 32,
  borderRadius = 10,
  objectFit = 'contain',
  style = {},
  imgStyle = {},
  textScale = 0.42,
  fallbackBackground,
  fallbackBorder,
  fallbackColor,
  priority = false,
}) {
  // 0: thumb (ya da küçültülemeyen orijinal), 1: orijinal, 2: baş harfler
  const [deneme, setDeneme] = useState(0)

  useEffect(() => {
    setDeneme(0)
  }, [src])

  const label = name || alt || ''
  const initials = useMemo(() => buildInitials(label, 2), [label])
  const tone = useMemo(() => makeTone(hashSeed(label)), [label])

  const numericWidth = Number(width)
  const numericHeight = Number(height)
  const baseSize = Number.isFinite(numericWidth) && Number.isFinite(numericHeight)
    ? Math.min(numericWidth, numericHeight)
    : 28
  const textSize = Math.max(10, Math.round(baseSize * textScale))

  // Yüzde gibi sayı olmayan boyutta ya da büyük basımda thumb kullanılmaz.
  const sayisalEn = Math.max(numericWidth, numericHeight)
  const thumbUygun = Number.isFinite(sayisalEn) && sayisalEn <= THUMB_AZAMI_PX
  const thumb = thumbUygun ? kucukGorsel(src) : src
  const gosterilen = deneme === 0 ? thumb : src
  // thumb zaten orijinalse ikinci deneme anlamsız → doğrudan baş harfler
  const sonraki = () => setDeneme(d => (d === 0 && thumb !== src ? 1 : 2))

  if (src && deneme < 2) {
    return (
      <img
        // key: thumb → orijinal geçişinde YENİ <img> öğesi. Aynı öğe kalırsa global
        // imageGuard'ın 2 sn sonraki yedek-logo değişimi sağlam orijinali de ezer.
        key={gosterilen}
        src={gosterilen}
        alt={alt || name || ''}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding='async'
        onError={sonraki}
        style={{
          width,
          height,
          borderRadius,
          objectFit,
          flexShrink: 0,
          display: 'block',
          ...imgStyle,
          ...style,
        }}
      />
    )
  }

  return (
    <div
      aria-label={alt || name || 'placeholder'}
      title={name || alt || ''}
      style={{
        width,
        height,
        borderRadius,
        background: fallbackBackground || tone.background,
        border: fallbackBorder || tone.border,
        color: fallbackColor || tone.color,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        fontSize: textSize,
        lineHeight: 1,
        userSelect: 'none',
        ...style,
      }}
    >
      <span>{initials}</span>
    </div>
  )
}
