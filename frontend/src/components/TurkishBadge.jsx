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
        {/* Hilal: dış daire eksi sağa kaydırılmış iç daire (evenodd) */}
        <path fillRule="evenodd" clipRule="evenodd" d="M1.5 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0ZM6.2 12a7 7 0 1 0 14 0a7 7 0 1 0-14 0Z" />
        {/* Yıldız (hilalin ağzında) */}
        <path d="M16.20 9.00 L16.91 11.03 L19.05 11.07 L17.34 12.37 L17.96 14.43 L16.20 13.20 L14.44 14.43 L15.06 12.37 L13.35 11.07 L15.49 11.03 Z" />
      </svg>
      TR
    </span>
  )
}
