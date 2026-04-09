import { NavLink, useNavigate } from 'react-router-dom'
import { Cat } from 'lucide-react'
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
        <NavLink to="/" style={{ textDecoration: 'none', marginRight: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', height: 34 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Cat size={14} strokeWidth={2.2} color="#F0A500" />
            <span style={{
              fontSize: 16,
              fontWeight: 900,
              letterSpacing: '-0.5px',
              background: 'linear-gradient(135deg,#FF4655,#F0A500)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              ⚡ {BRANDING.shortName}
            </span>
          </span>
        </NavLink>

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
      </div>
    </nav>
  )
}
