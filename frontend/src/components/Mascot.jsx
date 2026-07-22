import mascotImg from '../assets/fextopus-icon.png'

/**
 * Mascot — feXt Fextopus maskotu (arkadaş çizimi).
 * Boş durumlar, "sonuç yok" ve hata ekranlarında sevimli marka dokunuşu.
 */
export default function Mascot({ size = 72, style, dim = false }) {
  return (
    <img
      src={mascotImg}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ display: 'block', width: size, height: size, objectFit: 'contain', opacity: dim ? 0.72 : 1, ...style }}
    />
  )
}
