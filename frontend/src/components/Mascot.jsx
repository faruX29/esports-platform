/**
 * Mascot — feXt ahtapot maskotu (public/fext-mascot.svg).
 * Boş durumlar, "sonuç yok" ve hata ekranlarında sevimli marka dokunuşu.
 * SVG dosyadan gelir → kurucu daha kaliteli mascot koyunca otomatik güncellenir.
 */
export default function Mascot({ size = 72, style, dim = false }) {
  return (
    <img
      src="/fext-mascot.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ display: 'block', opacity: dim ? 0.7 : 1, ...style }}
    />
  )
}
