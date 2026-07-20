import { MoonStar } from 'lucide-react'

// Küçük "Türk takımı" rozeti — hazır lucide MoonStar (ay-yıldız) ikonu + TR.
// Çerçeve/renk: markanın moruyla (magenta) aynı ton ailesinde bir rose-kırmızı.

const ROSE = '#E0455E'

export default function TurkishBadge({ compact = false, style = {} }) {
  const px = compact ? 12 : 14
  return (
    <span
      title="Türk takımı"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: compact ? '1px 6px' : '2px 8px',
        borderRadius: 999,
        border: `1px solid ${ROSE}`,
        background: `${ROSE}1a`,
        color: ROSE,
        fontSize: compact ? 8.5 : 9.5,
        fontWeight: 800,
        letterSpacing: '.5px',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <MoonStar size={px} strokeWidth={2.3} aria-hidden="true" />
      TR
    </span>
  )
}
