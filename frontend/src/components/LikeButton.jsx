import { Heart } from 'lucide-react'

/**
 * LikeButton — haber "Beğeni" kalbi (feXt marka pembesi).
 *
 * Kurucu kararı: beğeni SAYISI yalnızca 10+ olunca görünür (boş "1 beğeni"
 * imaj sorununu önler). Altında sayı gizli, sadece dolu/boş kalp durumu görünür.
 *
 * Giriş kontrolü onToggle içinde yapılır (giriş yoksa kayıt modalı açılır),
 * bu yüzden buton her zaman tıklanabilir.
 *
 * Props:
 *   liked   — kullanıcı beğendi mi (dolu kalp)
 *   count   — toplam beğeni (yalnız >=10 gösterilir)
 *   onToggle — tıklama handler'ı
 *   size    — ikon boyutu (px, varsayılan 15)
 */
export default function LikeButton({ liked, count = 0, onToggle, size = 15 }) {
  const showCount = count >= 10
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onToggle?.() }}
      aria-label={liked ? 'Beğeniyi geri al' : 'Beğen'}
      aria-pressed={liked}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        border: `1px solid ${liked ? 'rgba(223,72,136,.55)' : 'var(--line-2)'}`,
        background: liked ? 'rgba(223,72,136,.12)' : 'var(--surface)',
        color: liked ? '#DF4888' : 'var(--text-2)',
        borderRadius: 9, padding: '6px 11px', cursor: 'pointer',
        fontSize: 12.5, fontWeight: 700, lineHeight: 1,
        transition: 'background .15s, border-color .15s, color .15s',
      }}
    >
      <Heart size={size} fill={liked ? '#DF4888' : 'none'} strokeWidth={liked ? 0 : 2} />
      {showCount ? count : (liked ? 'Beğenildi' : 'Beğen')}
    </button>
  )
}
