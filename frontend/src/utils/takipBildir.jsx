import { Star } from 'lucide-react'
import toast from 'react-hot-toast'

const ALTIN = '#FFD700'

/**
 * Takip edilince kısa bilgi: takip edilenin nerede göründüğünü söyler.
 * Yalnız ekleme anında çağır (takibi bırakınca sessiz).
 */
export function takipEdildiBildir(ad) {
  const kim = ad ? `${ad} takip ediliyor.` : 'Takip ediliyor.'
  toast(`${kim} Maçları ana sayfada "Takip Ettiklerim"de.`, {
    id: 'takip-edildi',
    duration: 3200,
    icon: <Star size={15} fill={ALTIN} color={ALTIN} />,
  })
}
