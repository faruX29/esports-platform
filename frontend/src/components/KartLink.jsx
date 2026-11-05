import { Link } from 'react-router-dom'

/*
 * Kart linkleri — kartlar onClick + navigate yerine gerçek <a href>: orta tık / Ctrl+tık
 * yeni sekme, telefonda uzun bas → "linki kopyala", Google da linki görür. Görünüm aynı.
 *
 * KartLink   → kartın kendisi link. Yalnız içinde düğme/link YOKSA (<a> içinde <a>/<button> olmaz).
 * KartOrtusu → içinde takip yıldızı, yayın linki gibi öğe olan kart için: kartı kaplayan boş link.
 *              Kart `position: relative` olmalı; karttaki düğme/linkler `UST_KATMAN` alır, yoksa
 *              örtünün altında kalıp tıklanmaz. UST_KATMAN'lı öğenin atası opacity/transform
 *              taşımasın (yeni yığın bağlamı açar, öğe yine örtünün altında kalır).
 */
export const UST_KATMAN = { position: 'relative', zIndex: 2 }

export function KartLink({ to, style, ...rest }) {
  return <Link to={to} style={{ display: 'block', color: 'inherit', textDecoration: 'none', ...style }} {...rest} />
}

export function KartOrtusu({ to, label, state }) {
  return (
    <Link
      to={to}
      state={state}
      aria-label={label}
      style={{ position: 'absolute', inset: 0, zIndex: 1, borderRadius: 'inherit' }}
    />
  )
}
