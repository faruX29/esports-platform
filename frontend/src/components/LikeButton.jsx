import { Heart } from 'lucide-react'

/**
 * LikeButton — haber "Beğeni" kalbi (feXt marka pembesi).
 *
 * Beğeni SAYISI 1'den itibaren görünür (Gemini #14/4, 2026-08-19): 12 kullanıcılı
 * lansman öncesinde 10 barajı sayacı tamamen görünmez kılıyordu → sosyal kanıt
 * sinyali sıfırdı. 500+ aktif kullanıcıya ulaşınca baraj tekrar değerlendirilecek.
 *
 * Giriş kontrolü onToggle içinde yapılır (giriş yoksa kayıt modalı açılır),
 * bu yüzden buton her zaman tıklanabilir.
 *
 * Props:
 *   liked   — kullanıcı beğendi mi (dolu kalp)
 *   count   — toplam beğeni (>=1 ise sayı, 0 ise 'Beğen'/'Beğenildi' etiketi)
 *   onToggle — tıklama handler'ı
 *   size    — ikon boyutu (px, varsayılan 15)
 */
export default function LikeButton({ liked, count = 0, onToggle, size = 15 }) {
  const showCount = count >= 1
  return (
    <button
      type="button"
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle?.() }}
      aria-label={liked ? 'Beğeniyi geri al' : 'Beğen'}
      aria-pressed={liked}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        border: `1px solid ${liked ? 'rgba(223,72,136,.55)' : 'var(--line-2)'}`,
        background: liked ? 'rgba(223,72,136,.12)' : 'var(--surface)',
        color: liked ? '#DF4888' : 'var(--text-2)',
        borderRadius: 9, padding: '9px 13px', minHeight: 38, cursor: 'pointer',
        fontSize: 12.5, fontWeight: 700, lineHeight: 1,
        transition: 'background .15s, border-color .15s, color .15s',
      }}
    >
      <Heart size={size} fill={liked ? '#DF4888' : 'none'} strokeWidth={liked ? 0 : 2} />
      {showCount ? count : (liked ? 'Beğenildi' : 'Beğen')}
    </button>
  )
}
