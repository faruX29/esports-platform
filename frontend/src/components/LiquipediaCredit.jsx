/**
 * LiquipediaCredit — "Oyuncu verisi: Liquipedia" atıf backlink'i.
 *
 * Liquipedia kullanım şartı (zorunlu): verisini gösterdiğimiz her yerde görünür
 * bir atıf + backlink. YALNIZ Liquipedia verisi gösteren blokların altına konur
 * (oyuncu KDA/ACS, Scout). Harita skorları ve takım analitiği PandaScore'dan;
 * oraya konursa atıf yanlış veriye iliştirilmiş olur (UX denetimi, 3 Kasım).
 *
 * Props:
 *   align  — 'left' | 'center' | 'right' (varsayılan: left)
 *   compact — daha küçük varyant
 */
// Liquipedia'dan son veri alındığı gün (API erişimi 21 Eylül 2026'da kapandı).
// Veri sitede kalabilir (Liquipedia'nın yazılı onayı), ama DONMUŞTUR — tarih
// yazılmazsa eski istatistik güncelmiş gibi okunur.
export const LIQUIPEDIA_SON_TARIH = '21 Eylül 2026'

export default function LiquipediaCredit({ align = 'left', compact = false }) {
  return (
    <div style={{
      marginTop: 8,
      fontSize: compact ? 9 : 10,
      color: 'var(--text-4)',
      textAlign: align,
      letterSpacing: '.2px',
    }}>
      Oyuncu verisi:{' '}
      <a
        href="https://liquipedia.net"
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{ color: 'var(--text-3)', textDecoration: 'underline', fontWeight: 600 }}
      >
        Liquipedia
      </a>
      {' '}({LIQUIPEDIA_SON_TARIH}'ya kadar)
    </div>
  )
}
