/**
 * Tutarlı "TR" rozeti — bayrak emojisi (🇹🇷) platformlar arası tutarsız görünüyordu:
 * Windows regional-indicator glyph'i çizemediği için "TR" harflerini, telefon (iOS/
 * Android) ise gerçek bayrağı gösteriyordu. Aynı görünsün diye metin rozet kullanılır.
 */
export default function TrBadge({ style }) {
  return (
    <span
      title="Türk takımı"
      style={{
        fontSize: '0.7em',
        fontWeight: 800,
        letterSpacing: '.4px',
        color: '#E0455E',
        margin: '0 3px',
        verticalAlign: 'baseline',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      TR
    </span>
  )
}
