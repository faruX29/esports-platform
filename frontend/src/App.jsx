/**
 * App.jsx — Router + Navbar + GameSelectorBar
 */
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { GameProvider, useGame, GAMES } from './GameContext'
import { useState, useRef, useEffect, useCallback } from 'react'
import { UserProvider } from './context/UserContext'
import { AuthProvider } from './context/AuthContext'

import Dashboard      from './Dashboard'
import Matches        from './Matches'
import MatchDetailPage from './MatchDetailPage'
import RankingsPage   from './pages/RankingsPage'
import TeamPage       from './TeamPage'
import TournamentPage from './TournamentPage'
import PlayersPage    from './pages/PlayersPage'
import PlayerPage     from './PlayerPage'
import SearchPage     from './SearchPage'
import ProfileSettings from './ProfileSettings'
import ProtectedRoute from './components/ProtectedRoute'
import NavbarComponent from './components/Navbar'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import NewsPage from './pages/NewsPage'
import NewsDetailPage from './pages/NewsDetailPage'

import './App.css'

/* ─── Nav linkleri ──────────────────────────────────────────────────────────── */
const NAV_LINKS = [
  { to: '/',         label: '🏠 Home',     end: true  },
  { to: '/matches',  label: '📅 Matches',  end: false },
  { to: '/rankings', label: '🏆 Rankings', end: false },
  { to: '/players',  label: '👤 Players',  end: false },
  { to: '/news',     label: '📰 News',     end: false },
]

/* ─── NavSearch ─────────────────────────────────────────────────────────────── */
function NavSearch() {
  const navigate                  = useNavigate()
  const location                  = useLocation()
  const [q,       setQ]           = useState('')
  const [focused, setFocused]     = useState(false)
  const [results, setResults]     = useState({ teams: [], players: [] })
  const [loading, setLoading]     = useState(false)
  const inputRef                  = useRef(null)
  const dropdownRef               = useRef(null)
  const debounceRef               = useRef(null)

  // route değişince kapat
  useEffect(() => {
    setQ('')
    setResults({ teams: [], players: [] })
    setFocused(false)
  }, [location.pathname])

  // Dropdown dışı tıklama → kapat
  useEffect(() => {
    function handleClick(e) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        inputRef.current    && !inputRef.current.contains(e.target)
      ) setFocused(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setFocused(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  async function fetchQuickResults(query) {
    if (query.trim().length < 2) {
      setResults({ teams: [], players: [] })
      return
    }
    setLoading(true)
    try {
      const { supabase } = await import('./supabaseClient')
      const [teamRes, playerRes] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, logo_url')
          .ilike('name', `%${query}%`)
          .limit(4),
        supabase
          .from('players')
          .select('id, nickname, role, image_url')
          .ilike('nickname', `%${query}%`)
          .limit(4),
      ])
      setResults({
        teams:   teamRes.data   || [],
        players: playerRes.data || [],
      })
    } catch (e) {
      console.error('NavSearch fetch:', e)
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e) {
    const val = e.target.value
    setQ(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchQuickResults(val), 250)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!q.trim()) return
    setFocused(false)
    navigate(`/search?q=${encodeURIComponent(q.trim())}`)
  }

  const hasResults = results.teams.length > 0 || results.players.length > 0
  const showDrop   = focused && q.trim().length >= 2

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Input */}
      <form onSubmit={handleSubmit}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: focused ? '#1a1a1a' : '#111',
          border: `1.5px solid ${focused ? '#FF4655' : '#1e1e1e'}`,
          borderRadius: 10, padding: '5px 10px',
          transition: 'all .2s',
          boxShadow: focused ? '0 0 0 3px rgba(255,70,85,.1)' : 'none',
          width: focused ? 260 : 180,
        }}>
          <span style={{ fontSize: 12, color: focused ? '#FF4655' : '#444',
            flexShrink: 0, transition: 'color .2s' }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            placeholder="Ara…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: '#fff', fontSize: 13, minWidth: 0,
            }}
          />
          {/* Ctrl+K badge — sadece unfocused */}
          {!focused && (
            <span style={{
              fontSize: 9, padding: '2px 5px', borderRadius: 4,
              background: '#1a1a1a', border: '1px solid #2a2a2a',
              color: '#444', flexShrink: 0, fontFamily: 'monospace',
            }}>⌘K</span>
          )}
          {/* Clear */}
          {focused && q && (
            <button
              type="button"
              onClick={() => { setQ(''); setResults({ teams: [], players: [] }); inputRef.current?.focus() }}
              style={{ background: 'none', border: 'none', color: '#555',
                cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0 }}
            >✕</button>
          )}
          {/* Loading dot */}
          {loading && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#FF4655', flexShrink: 0,
              animation: 'pulse 1s infinite',
            }} />
          )}
        </div>
      </form>

      {/* Dropdown */}
      {showDrop && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 320, background: '#0d0d0d',
            border: '1px solid #1e1e1e', borderRadius: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,.7)',
            overflow: 'hidden', zIndex: 9999,
            animation: 'fadeUp .15s ease',
          }}
        >
          {!hasResults && !loading && (
            <div style={{ padding: '20px', textAlign: 'center',
              fontSize: 12, color: '#444' }}>
              "{q}" için sonuç yok
            </div>
          )}

          {/* Teams */}
          {results.teams.length > 0 && (
            <div>
              <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#444',
                fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                🛡️ Takımlar
              </div>
              {results.teams.map(t => (
                <div
                  key={t.id}
                  onMouseDown={() => { setFocused(false); navigate(`/team/${t.id}`) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 14px', cursor: 'pointer',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {t.logo_url
                    ? <img src={t.logo_url} alt={t.name}
                        style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }} />
                    : <div style={{ width: 26, height: 26, borderRadius: 6,
                        background: '#1e1e1e', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: '#444' }}>🛡️</div>
                  }
                  <span style={{ fontSize: 13, color: '#ccc',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: '#333' }}>→</span>
                </div>
              ))}
            </div>
          )}

          {/* Players */}
          {results.players.length > 0 && (
            <div style={{ borderTop: results.teams.length > 0 ? '1px solid #141414' : 'none' }}>
              <div style={{ padding: '8px 14px 4px', fontSize: 9, color: '#444',
                fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                👤 Oyuncular
              </div>
              {results.players.map(p => (
                <div
                  key={p.id}
                  onMouseDown={() => { setFocused(false); navigate(`/player/${p.id}`) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 14px', cursor: 'pointer',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {p.image_url
                    ? <img src={p.image_url} alt={p.nickname}
                        style={{ width: 26, height: 26, objectFit: 'cover',
                          borderRadius: '50%', flexShrink: 0 }} />
                    : <div style={{ width: 26, height: 26, borderRadius: '50%',
                        background: '#1e1e1e', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: '#444' }}>👤</div>
                  }
                  <span style={{ fontSize: 13, color: '#ccc',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.nickname}
                  </span>
                  {p.role && (
                    <span style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 6px',
                      borderRadius: 4, background: '#1a1a1a', color: '#555',
                      flexShrink: 0 }}>{p.role}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Footer: full search */}
          <div
            onMouseDown={handleSubmit}
            style={{
              padding: '10px 14px',
              borderTop: '1px solid #141414',
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', transition: 'background .12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#141414'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ fontSize: 12, color: '#FF4655' }}>🔍</span>
            <span style={{ fontSize: 12, color: '#888' }}>
              "<span style={{ color: '#FF4655', fontWeight: 700 }}>{q}</span>" için tüm sonuçları gör
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#333' }}>Enter ↵</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── GameSelectorBar ───────────────────────────────────────────────────────── */
function GameSelectorBar() {
  const { activeGame, setActiveGame } = useGame()
  const location = useLocation()

  // Sadece belirli sayfalarda göster
  const showOn = ['/', '/matches', '/rankings']
  if (!showOn.includes(location.pathname)) return null

  return (
    <div style={{
      background: '#0a0a0a', borderBottom: '1px solid #111',
      overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      <div style={{
        display: 'flex', gap: 4,
        maxWidth: 1240, margin: '0 auto', padding: '6px 16px',
      }}>
        {GAMES.map(g => {
          const active = activeGame === g.id
          return (
            <button
              key={g.id}
              onClick={() => setActiveGame(g.id)}
              disabled={g.soon}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 8, border: 'none',
                background: active ? `${g.color}22` : 'transparent',
                color: active ? g.color : g.soon ? '#2a2a2a' : '#555',
                fontSize: 12, fontWeight: active ? 700 : 400,
                cursor: g.soon ? 'default' : 'pointer',
                outline: active ? `1.5px solid ${g.color}55` : 'none',
                transition: 'all .15s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
              onMouseEnter={e => { if (!active && !g.soon) e.currentTarget.style.color = g.color }}
              onMouseLeave={e => { if (!active && !g.soon) e.currentTarget.style.color = '#555' }}
            >
              <span>{g.icon}</span>
              <span>{g.shortLabel ?? g.label}</span>
              {g.soon && (
                <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 4,
                  background: '#1a1a1a', color: '#333' }}>soon</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ─── AppShell ──────────────────────────────────────────────────────────────── */
function AppShell() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: 'white' }}>
      <NavbarComponent navLinks={NAV_LINKS} SearchComponent={NavSearch} />
      <GameSelectorBar />
      <Routes>
        <Route path="/"                         element={<Dashboard />}      />
        <Route path="/matches"                  element={<Matches />}        />
        <Route path="/match/:id"                element={<MatchDetailPage />} />
        <Route path="/rankings"                 element={<RankingsPage />}   />
        <Route path="/team/:teamId"             element={<TeamPage />}       />
        <Route path="/tournament/:tournamentId" element={<TournamentPage />} />
        <Route path="/players"                  element={<PlayersPage />}    />
        <Route path="/player/:id"               element={<PlayerPage />}     />
        <Route path="/search"                   element={<SearchPage />}     />
        <Route path="/news"                     element={<NewsPage />}       />
        <Route path="/news/:newsId"             element={<NewsDetailPage />} />
        <Route path="/login"                    element={<LoginPage />}      />
        <Route path="/register"                 element={<RegisterPage />}   />
        <Route path="/settings"                 element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
      </Routes>
    </div>
  )
}

/* ─── App root ──────────────────────────────────────────────────────────────── */
export default function App() {
  return (
    <Router>
      <AuthProvider>
        <UserProvider>
          <GameProvider>
            <AppShell />
          </GameProvider>
        </UserProvider>
      </AuthProvider>
    </Router>
  )
}