/**
 * LiquipediaCredit — "Data powered by Liquipedia" atıf backlink'i.
 *
 * Liquipedia API kullanım şartı (zorunlu): verisini gösterdiğimiz her yerde
 * görünür bir atıf + backlink. Harita/oyuncu KDA (hybrid v3) ve transfer
 * haberlerinin altına hafif tonda yerleştirilir.
 *
 * Props:
 *   align  — 'left' | 'center' | 'right' (varsayılan: left)
 *   compact — daha küçük varyant
 */
export default function LiquipediaCredit({ align = 'left', compact = false }) {
  return (
    <div style={{
      marginTop: 8,
      fontSize: compact ? 9 : 10,
      color: '#5a5a5a',
      textAlign: align,
      letterSpacing: '.2px',
    }}>
      Data powered by{' '}
      <a
        href="https://liquipedia.net"
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{ color: '#8a8a8a', textDecoration: 'underline', fontWeight: 600 }}
      >
        Liquipedia
      </a>
    </div>
  )
}
