// Küçük "Türk takımı" göstergesi — gerçek Türk bayrağı çipi (kırmızı zemin,
// beyaz ay-yıldız). Emoji değil → her cihazda birebir aynı görünür.

export default function TurkishBadge({ compact = false, style = {} }) {
  const w = compact ? 18 : 22
  return (
    <span title="Türk takımı" style={{ display: 'inline-flex', flexShrink: 0, lineHeight: 0, ...style }}>
      <svg
        viewBox="0 0 30 20" width={w} height={w * 20 / 30}
        style={{ borderRadius: 3, display: 'block', boxShadow: '0 0 0 1px rgba(0,0,0,.18)' }}
        role="img" aria-label="Türk takımı"
      >
        <rect width="30" height="20" fill="#E30A17" />
        {/* Ay (hilal): dış daire eksi sağa kaydırılmış iç daire */}
        <path fill="#fff" fillRule="evenodd" d="M6 10a5 5 0 1 0 10 0a5 5 0 1 0-10 0ZM8.2 10a4 4 0 1 0 8 0a4 4 0 1 0-8 0Z" />
        {/* Yıldız */}
        <path fill="#fff" d="M16.30 7.50 L16.89 9.19 L18.68 9.23 L17.25 10.31 L17.77 12.02 L16.30 11.00 L14.83 12.02 L15.35 10.31 L13.92 9.23 L15.71 9.19 Z" />
      </svg>
    </span>
  )
}
