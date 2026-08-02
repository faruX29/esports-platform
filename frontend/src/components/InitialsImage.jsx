import { useEffect, useMemo, useState } from 'react'

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

/**
 * Dış (http) görselleri wsrv.nl proxy'siyle GÖSTERİM boyutunda + WebP olarak sunar.
 * PandaScore logoları 500x500 gelip 18-63px gösteriliyordu (logo başına ~50-266KB);
 * proxy ile ~1-3KB'a düşer → mobilde LCP/veri büyük kazanç. data:/blob:/yerel (/)
 * görsellere dokunulmaz. Proxy hata verirse orijinale, o da olmazsa baş harflere düşer.
 */
function proxiedSrc(src, size) {
  if (typeof src !== 'string' || !/^https?:\/\//i.test(src)) return src
  if (src.includes('wsrv.nl')) return src
  const w = Math.min(Math.round((Number(size) || 32) * 2), 256)   // 2x retina, tavan 256
  return `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=${w}&output=webp&q=80`
}

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
}) {
  // 'proxy' → wsrv küçültülmüş; 'original' → ham kaynak; 'failed' → baş harf avatarı
  const [stage, setStage] = useState('proxy')

  useEffect(() => {
    setStage('proxy')
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

  const displaySrc = useMemo(() => {
    if (!src) return null
    if (stage === 'original') return src
    return proxiedSrc(src, Math.max(numericWidth, numericHeight) || 32)
  }, [src, stage, numericWidth, numericHeight])

  if (src && stage !== 'failed') {
    return (
      <img
        src={displaySrc}
        alt={alt || name || ''}
        loading='lazy'
        decoding='async'
        onError={() => setStage(s => (s === 'proxy' ? 'original' : 'failed'))}
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
