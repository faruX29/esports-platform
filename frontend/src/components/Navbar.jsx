import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Menu, Trophy, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import BRANDING from '../branding.config'

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
          <button onClick={() => navigate('/login')} style={{ background: 'linear-gradient(135deg,#C8102E,#001f6d)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 10, color: '#fff', fontSize: 12, fontWeight: 800, padding: '8px 12px', cursor: 'pointer', boxShadow: '0 0 16px rgba(200,16,46,.18)', whiteSpace: 'nowrap', height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Giris Yap</button>
          <button onClick={() => navigate('/register')} style={{ background: '#121212', border: '1px solid #2d2d2d', borderRadius: 10, color: '#ddd', fontSize: 12, fontWeight: 700, padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap', height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Kayit Ol</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34 }}>
          <button onClick={() => navigate('/settings')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#101010', border: '1px solid #252525', borderRadius: 20, padding: '5px 9px', cursor: 'pointer', height: 34 }}>
            {avatar
              ? <img src={avatar} alt={username} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', border: '1px solid #333' }} />
              : <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#1d1d1d', color: '#ddd', fontSize: 10, fontWeight: 800 }}>{username.slice(0, 2).toUpperCase()}</div>
            }
            <span style={{ fontSize: 12, color: '#ddd', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
          </button>
          <button onClick={signOut} style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 8, color: '#777', padding: '6px 9px', fontSize: 11, cursor: 'pointer', height: 34 }}>Cikis</button>
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
      background: 'rgba(10,10,10,.92)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid #141414',
    }}>
      <div style={{
        maxWidth: 1240,
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
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  style={({ isActive }) => ({
                    textDecoration: 'none',
                    padding: '7px 11px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#fff' : '#555',
                    background: isActive ? 'rgba(255,255,255,.07)' : 'transparent',
                    transition: 'all .15s',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: 34,
                  })}
                >
                  {l.label}
                </NavLink>
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
              border: '1px solid #2a2a2a',
              background: '#121212',
              color: '#e6e6e6',
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
          borderTop: '1px solid #161616',
          background: 'rgba(8,8,8,.95)',
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
              <NavLink
                key={`mobile_${l.to}`}
                to={l.to}
                end={l.end}
                style={({ isActive }) => ({
                  textDecoration: 'none',
                  padding: '9px 10px',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: isActive ? 800 : 600,
                  color: isActive ? '#fff' : '#c1c1c1',
                  background: isActive ? 'linear-gradient(120deg, rgba(255,70,85,.24), rgba(255,184,0,.15))' : '#111',
                  border: isActive ? '1px solid rgba(255,120,130,.45)' : '1px solid #242424',
                })}
              >
                {l.label}
              </NavLink>
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
