import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Trophy, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import BRANDING from '../branding.config'

/* Nav öğesi — lucide ikon + hover state (emoji "AI havası"nı kaldırır) */
function NavItem({ link, mobile = false }) {
  const [hover, setHover] = useState(false)
  const Icon = link.icon
  return (
    <NavLink
      to={link.to}
      end={link.end}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={({ isActive }) => (mobile
        ? {
            textDecoration: 'none', padding: '9px 12px', borderRadius: 10, fontSize: 13,
            fontWeight: isActive ? 800 : 600,
            color: isActive ? '#fff' : (hover ? '#fff' : '#cbd5e1'),
            background: isActive ? 'linear-gradient(120deg, rgba(255,70,85,.2), rgba(255,184,0,.12))' : (hover ? '#172032' : '#131b2b'),
            border: isActive ? '1px solid rgba(255,120,130,.4)' : '1px solid #26324a',
            display: 'flex', alignItems: 'center', gap: 9, transition: 'all .15s',
          }
        : {
            textDecoration: 'none', padding: '7px 11px', borderRadius: 8, fontSize: 12,
            fontWeight: isActive ? 700 : 500,
            color: isActive ? '#fff' : (hover ? '#e2e8f0' : '#94a3b8'),
            background: isActive ? 'rgba(255,255,255,.08)' : (hover ? 'rgba(255,255,255,.05)' : 'transparent'),
            transition: 'all .15s', whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'center', gap: 7, height: 34,
          })}
    >
      {Icon && <Icon size={mobile ? 16 : 15} strokeWidth={2} />}
      {link.label}
    </NavLink>
  )
}

function AuthWidget() {
  const navigate = useNavigate()
  const { user, profile, profileLoading, signOut, isAuthenticated } = useAuth()

  const avatar = profile?.avatar_url
  const metaUsername = user?.user_metadata?.username
  const username = profile?.username || metaUsername || (profileLoading ? 'Yukleniyor...' : (user?.email?.split('@')?.[0] || 'Fan'))

  return (
    <>
      {!isAuthenticated ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34 }}>
          <button onClick={() => navigate('/login')} style={{ background: 'linear-gradient(135deg,#FF4655,#e63a48)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 800, padding: '8px 13px', cursor: 'pointer', whiteSpace: 'nowrap', height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Giris Yap</button>
          <button onClick={() => navigate('/register')} style={{ background: '#172032', border: '1px solid #26324a', borderRadius: 9, color: '#cbd5e1', fontSize: 12, fontWeight: 700, padding: '8px 13px', cursor: 'pointer', whiteSpace: 'nowrap', height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Kayit Ol</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34 }}>
          <button onClick={() => navigate('/settings')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#131b2b', border: '1px solid #26324a', borderRadius: 20, padding: '5px 9px', cursor: 'pointer', height: 34 }}>
            {avatar
              ? <img src={avatar} alt={username} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', border: '1px solid #33415d' }} />
              : <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#26324a', color: '#e2e8f0', fontSize: 10, fontWeight: 800 }}>{username.slice(0, 2).toUpperCase()}</div>
            }
            <span style={{ fontSize: 12, color: '#cbd5e1', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
          </button>
          <button onClick={signOut} style={{ background: '#131b2b', border: '1px solid #26324a', borderRadius: 8, color: '#94a3b8', padding: '6px 9px', fontSize: 11, cursor: 'pointer', height: 34 }}>Cikis</button>
        </div>
      )}

    </>
  )
}

export default function Navbar({ navLinks, SearchComponent }) {
  const location = useLocation()
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 980)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= 980
      setIsMobile(mobile)
      if (!mobile) setMenuOpen(false)
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 1000,
      background: 'rgba(11,15,25,.82)',
      backdropFilter: 'blur(14px)',
      borderBottom: '1px solid rgba(38,50,74,.6)',
    }}>
      <div style={{
        maxWidth: 1440,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 16px',
        height: 58,
      }}>
        <NavLink to="/" style={{ textDecoration: 'none', marginRight: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', height: 36 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, transform: 'translateY(.5px)' }}>
              <Trophy size={14} strokeWidth={2.2} color="#F0A500" />
            </span>
            <span style={{
              fontSize: 16,
              fontWeight: 900,
              letterSpacing: '-0.5px',
              background: 'linear-gradient(135deg,#FF4655,#F0A500)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              transform: 'translateY(.5px)',
            }}>
              {BRANDING.shortName}
            </span>
          </span>
        </NavLink>

        {!isMobile && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, height: 34 }}>
              {navLinks.map(l => (
                <NavItem key={l.to} link={l} />
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34 }}>
              {SearchComponent ? <SearchComponent /> : null}
              <AuthWidget />
            </div>
          </>
        )}

        {isMobile && (
          <button
            onClick={() => setMenuOpen(prev => !prev)}
            aria-label='Menu'
            style={{
              marginLeft: 'auto',
              width: 36,
              height: 36,
              borderRadius: 10,
              border: '1px solid #26324a',
              background: '#172032',
              color: '#e2e8f0',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            {menuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        )}
      </div>

      {isMobile && (
        <div style={{
          borderTop: '1px solid #26324a',
          background: 'rgba(11,15,25,.97)',
          overflow: 'hidden',
          maxHeight: menuOpen ? 420 : 0,
          opacity: menuOpen ? 1 : 0,
          transform: menuOpen ? 'translateY(0)' : 'translateY(-6px)',
          transition: 'max-height .28s ease, opacity .2s ease, transform .24s ease',
          pointerEvents: menuOpen ? 'auto' : 'none',
        }}>
          <div style={{ padding: '10px 14px 12px' }}>
          <div style={{ display: 'grid', gap: 7 }}>
            {SearchComponent ? (
              <div style={{ marginBottom: 2 }}>
                <SearchComponent />
              </div>
            ) : null}

            {navLinks.map(l => (
              <NavItem key={`mobile_${l.to}`} link={l} mobile />
            ))}

            <div style={{ marginTop: 6 }}>
              <AuthWidget />
            </div>
          </div>
          </div>
        </div>
      )}
    </nav>
  )
}
