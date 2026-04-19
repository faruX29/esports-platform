import { useEffect, useMemo, useState } from 'react'

function buildInitials(name, max = 2) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[\-_]+/g, ' ')

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
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
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

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={alt || name || ''}
        loading='lazy'
        decoding='async'
        onError={() => setFailed(true)}
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
