import { Link } from 'react-router-dom'

function InstagramIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  )
}

/**
 * Footer — tüm sayfaların altında. feXt wordmark + gezinme + sosyal + veri atıfları.
 * Liquipedia atıf backlink'i burada da bulunur (kullanım şartı gereği görünür atıf).
 */
const WORDMARK = (
  <span style={{ fontFamily: "'Baloo 2','Fredoka',system-ui,sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: '-.01em' }}>
    <span style={{ color: 'var(--text)' }}>fe</span>
    <span style={{ background: 'linear-gradient(135deg,#DF4888 0%,#8B3AA0 55%,#6A297F 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
      <span style={{ fontSize: '1.22em' }}>X</span>t
    </span>
  </span>
)

function Col({ title, children }) {
  return (
    <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--text-5)' }}>{title}</div>
      {children}
    </div>
  )
}

const linkStyle = { fontSize: 13, color: 'var(--text-3)', textDecoration: 'none' }

function FLink({ to, children }) {
  return (
    <Link to={to} style={linkStyle} onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}>{children}</Link>
  )
}

function Social({ href, label, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}
      style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = '#8B3AA0' }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--line)' }}>
      {children}
    </a>
  )
}

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer style={{ borderTop: '1px solid var(--line)', background: 'var(--bg)', marginTop: 40 }}>
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 16px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, justifyContent: 'space-between' }}>
          {/* Marka + sosyal */}
          <div style={{ display: 'grid', gap: 12, maxWidth: 300 }}>
            <Link to="/" style={{ textDecoration: 'none' }}>{WORDMARK}</Link>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.6 }}>
              Valorant, CS2 ve LoL espor maçları, canlı skorlar, transferler ve AI destekli haberler — tek yerde.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <Social href="https://instagram.com/fextesports" label="Instagram"><InstagramIcon /></Social>
              <Social href="https://x.com/fextesports" label="X (Twitter)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              </Social>
              <Social href="https://www.tiktok.com/@fextesports" label="TikTok">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" /></svg>
              </Social>
            </div>
          </div>

          {/* Gezinme kolonları */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40 }}>
            <Col title="Keşfet">
              <FLink to="/matches">Maçlar</FLink>
              <FLink to="/tournaments">Turnuvalar</FLink>
              <FLink to="/rankings">Sıralamalar</FLink>
            </Col>
            <Col title="İçerik">
              <FLink to="/news">Haberler</FLink>
              <FLink to="/scout">Scout</FLink>
            </Col>
            <Col title="Hesap">
              <FLink to="/login">Giriş Yap</FLink>
              <FLink to="/register">Kayıt Ol</FLink>
              <FLink to="/settings">Profil</FLink>
            </Col>
          </div>
        </div>

        {/* Alt şerit: telif + veri atıfları */}
        <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--surface-2)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text-5)' }}>© {year} feXt · Tüm hakları saklıdır.</span>
          <span style={{ fontSize: 11, color: 'var(--text-5)' }}>
            Veri kaynakları:{' '}
            <a href="https://liquipedia.net" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-4)', textDecoration: 'underline' }}>Liquipedia</a>
            {' · '}
            <a href="https://pandascore.co" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-4)', textDecoration: 'underline' }}>PandaScore</a>
          </span>
        </div>
      </div>
    </footer>
  )
}
