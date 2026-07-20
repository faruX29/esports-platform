// Küçük "Türk takımı" göstergesi — sade "TR" rozeti.
// Çerçeve/renk: markanın moruyla (magenta) aynı ton ailesinde bir rose-kırmızı.

const ROSE = '#E0455E'

export default function TurkishBadge({ compact = false, style = {} }) {
  return (
    <span
      title="Türk takımı"
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: compact ? '2px 7px' : '3px 9px',
        borderRadius: 999,
        border: `1px solid ${ROSE}`,
        background: `${ROSE}1a`,
        color: ROSE,
        fontSize: compact ? 9 : 10,
        fontWeight: 800,
        letterSpacing: '.6px',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}
    >
      TR
    </span>
  )
}
