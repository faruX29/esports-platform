import FextopusLogo from './FextopusLogo'

/**
 * Mascot — feXt Fextopus maskotu (arkadaş çizimi).
 * Boş durumlar, "sonuç yok" ve hata ekranlarında sevimli marka dokunuşu.
 * UX P2 A9: navbar logosunun katmanlarını kullanır → göz kırpar, hafif süzülür,
 * gözleri fareyi izler. Hareketi azalt açıkken düz durur (FextopusLogo).
 * ifade: 'uykulu' (canlı maç yok), 'saskin' (bulunamadı), 'mahcup' (hata).
 */
export default function Mascot({ size = 72, style, dim = false, ifade = 'normal', kirp = false, kirpGecikme = 0 }) {
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', opacity: dim ? 0.72 : 1, ...style }}>
      {/* FextopusLogo maskotu height × 1.5 boyutunda çizer */}
      <FextopusLogo height={size / 1.5} wordmark={false} ifade={ifade} kirp={kirp} kirpGecikme={kirpGecikme} />
    </span>
  )
}
