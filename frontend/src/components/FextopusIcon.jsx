import iconImg from '../assets/fextopus-icon.png'

/**
 * FextopusIcon — Fextopus maskotunun küçük statik rozet ikonu (AI/tahmin
 * etiketlerinin yanına). Animasyonsuz (çok sayıda örnek olabilir); sadece
 * marka görünürlüğü. size = px.
 */
export default function FextopusIcon({ size = 18, style, title = 'Fextopus' }) {
  return (
    <img
      src={iconImg}
      alt=""
      aria-hidden="true"
      title={title}
      width={size}
      height={size}
      style={{ display: 'inline-block', width: size, height: size, objectFit: 'contain', verticalAlign: 'middle', flexShrink: 0, ...style }}
    />
  )
}
