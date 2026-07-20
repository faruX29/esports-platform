// Küçük "Türk takımı" rozeti — ay-yıldız ikonu + TR.
// Çerçeve/renk: markanın moruyla (magenta) aynı ton ailesinde bir rose-kırmızı.
// Eski büyük "Bizim Takım / Turkish Pride" şeritlerinin yerine geçer (küçük, sade).

const ROSE = '#E0455E'

export default function TurkishBadge({ compact = false, style = {} }) {
  const px = compact ? 10 : 12
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
      <svg viewBox="0 0 24 24" width={px} height={px} fill="currentColor" aria-hidden="true">
        {/* Hilal: dış daire (merkez ~11) eksi sağa kaydırılmış iç daire → ay */}
        <path fillRule="evenodd" clipRule="evenodd" d="M2 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0ZM7.4 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0Z" />
        {/* Yıldız (hilalin ağzında) */}
        <path d="M17 9.4 17.59 11.19 19.47 11.2 17.95 12.31 18.53 14.1 17 13 15.47 14.1 16.05 12.31 14.53 11.2 16.41 11.19Z" />
      </svg>
      TR
    </span>
  )
}
