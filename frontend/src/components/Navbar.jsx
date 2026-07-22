import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import BRANDING from '../branding.config'
import FextopusLogo from './FextopusLogo'
import ThemeToggle from './ThemeToggle'
import { FEXT } from '../theme'

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
            color: isActive ? FEXT.accentText : (hover ? 'var(--text)' : 'var(--text-2)'),
            background: isActive ? FEXT.accentSoftBg : (hover ? 'var(--surface-2)' : 'var(--surface)'),
            border: isActive ? `1px solid ${FEXT.accentBorder}` : '1px solid var(--line)',
            display: 'flex', alignItems: 'center', gap: 9, transition: 'all .15s',
          }
        : {
            textDecoration: 'none', padding: '7px 11px', borderRadius: 8, fontSize: 12,
            fontWeight: isActive ? 700 : 500,
            color: isActive ? FEXT.accentText : (hover ? 'var(--text-1)' : 'var(--text-3)'),
            background: isActive ? FEXT.accentSoftBg : (hover ? 'var(--hover)' : 'transparent'),
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
  const username = profile?.username || metaUsername || (profileLoading ? 'Yükleniyor...' : (user?.email?.split('@')?.[0] || 'Fan'))

  return (
    <>
      {!isAuthenticated ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34 }}>
          <button onClick={() => navigate('/login')} style={{ background: FEXT.accentGrad, border: '1px solid rgba(255,255,255,.12)', borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 800, padding: '8px 13px', cursor: 'pointer', whiteSpace: 'nowrap', height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Giriş Yap</button>
          <button onClick={() => navigate('/register')} style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--text-2)', fontSize: 12, fontWeight: 700, padding: '8px 13px', cursor: 'pointer', whiteSpace: 'nowrap', height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Kayıt Ol</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34 }}>
          <button onClick={() => navigate('/settings')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 20, padding: '5px 9px', cursor: 'pointer', height: 34 }}>
            {avatar
              ? <img src={avatar} alt={username} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--line-2)' }} />
              : <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--line)', color: 'var(--text-1)', fontSize: 10, fontWeight: 800 }}>{username.slice(0, 2).toUpperCase()}</div>
            }
            <span style={{ fontSize: 12, color: 'var(--text-2)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
          </button>
          <button onClick={signOut} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text-3)', padding: '6px 9px', fontSize: 11, cursor: 'pointer', height: 34 }}>Çıkış</button>
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
      background: 'var(--nav-bg)',
      backdropFilter: 'blur(14px)',
      borderBottom: '1px solid var(--nav-border)',
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
        <NavLink to="/" style={{ textDecoration: 'none', marginRight: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', height: 36 }} aria-label="feXt ana sayfa">
          <FextopusLogo height={30} />
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
              <ThemeToggle />
              <AuthWidget />
            </div>
          </>
        )}

        {isMobile && (
          <button
            onClick={() => setMenuOpen(prev => !prev)}
            aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
            aria-expanded={menuOpen}
            style={{
              marginLeft: 'auto',
              width: 36,
              height: 36,
              borderRadius: 10,
              border: '1px solid var(--line)',
              background: 'var(--surface-2)',
              color: 'var(--text-1)',
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
          borderTop: '1px solid var(--line)',
          background: 'var(--bg)',
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

            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThemeToggle />
              <AuthWidget />
            </div>
          </div>
          </div>
        </div>
      )}
    </nav>
  )
}
