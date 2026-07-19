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
      color: 'var(--text-4)',
      textAlign: align,
      letterSpacing: '.2px',
    }}>
      Data powered by{' '}
      <a
        href="https://liquipedia.net"
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{ color: 'var(--text-3)', textDecoration: 'underline', fontWeight: 600 }}
      >
        Liquipedia
      </a>
    </div>
  )
}
