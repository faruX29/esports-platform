/**
 * App.jsx — Router + Navbar + GameSelectorBar
 */
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { GameProvider, useGame, GAMES } from './GameContext'

import Dashboard      from './Dashboard'
import Matches        from './Matches'
import MatchDetail    from './MatchDetail'
import Rankings       from './Rankings'
import TeamPage       from './TeamPage'
import TournamentPage from './TournamentPage'
import PlayerSearch   from './PlayerSearch'
import NewsPage       from './NewsPage'

import './App.css'

/* ─── Nav linkleri ──────────────────────────────────────────────────────────── */
const NAV_LINKS = [
  { to: '/',         label: '🏠 Home',     end: true  },
  { to: '/matches',  label: '📅 Matches',  end: false },
  { to: '/rankings', label: '🏆 Rankings', end: false },
  { to: '/players',  label: '🔍 Players',  end: false },
  { to: '/news',     label: '📰 News',     end: false },
]

/* ─── Navbar ────────────────────────────────────────────────────────────────── */
function Navbar() {
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 900,
      backgroundColor: 'rgba(10,10,10,.97)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid #1a1a1a',
      padding: '0 24px',
      display: 'flex', alignItems: 'center', gap: 4,
      height: 52, overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      <div style={{
        fontSize: 15, fontWeight: 900, letterSpacing: -0.3,
        background: 'linear-gradient(135deg,#FF4655,#F0A500)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        marginRight: 16, flexShrink: 0, userSelect: 'none',
      }}>⚡ EsportsHub</div>

      {NAV_LINKS.map(({ to, label, end }) => (
        <NavLink key={to} to={to} end={end}
          style={({ isActive }) => ({
            padding: '5px 11px', borderRadius: 8, textDecoration: 'none',
            fontSize: 12, fontWeight: isActive ? 700 : 500, flexShrink: 0,
            color:      isActive ? '#FF4655' : '#555',
            background: isActive ? 'rgba(255,70,85,.1)'           : 'transparent',
            border:     isActive ? '1px solid rgba(255,70,85,.2)' : '1px solid transparent',
            transition: 'all .15s',
          })}
        >{label}</NavLink>
      ))}
    </nav>
  )
}

/* ─── GameSelectorBar ───────────────────────────────────────────────────────── */
function GameSelectorBar() {
  const { activeGame, setActiveGame } = useGame()
  const location = useLocation()
  if (!['/', '/matches', '/rankings'].includes(location.pathname)) return null

  return (
    <div style={{
      position: 'sticky', top: 52, zIndex: 800,
      backgroundColor: 'rgba(10,10,10,.93)',
      backdropFilter: 'blur(8px)',
      borderBottom: '1px solid #141414',
      padding: '8px 24px',
      display: 'flex', gap: 8, alignItems: 'center',
      overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      {GAMES.map(game => {
        const active = activeGame === game.id
        return (
          <button key={game.id}
            onClick={() => !game.soon && setActiveGame(game.id)}
            disabled={game.soon}
            style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 14px', borderRadius: 10,
              cursor: game.soon ? 'not-allowed' : 'pointer',
              border:     active ? `1.5px solid ${game.color}55` : '1.5px solid transparent',
              background: active ? `${game.color}18`             : 'transparent',
              color:      active ? game.color                    : '#555',
              fontSize: 12, fontWeight: active ? 700 : 500,
              opacity: game.soon ? 0.4 : 1, transition: 'all .18s', position: 'relative',
            }}
            onMouseEnter={e => {
              if (!game.soon && !active) {
                e.currentTarget.style.background    = `${game.color}10`
                e.currentTarget.style.borderColor   = `${game.color}33`
                e.currentTarget.style.color         = game.color
              }
            }}
            onMouseLeave={e => {
              if (!active) {
                e.currentTarget.style.background  = 'transparent'
                e.currentTarget.style.borderColor = 'transparent'
                e.currentTarget.style.color       = '#555'
              }
            }}
          >
            <span>{game.icon}</span>
            <span>{game.shortLabel || game.label}</span>
            {active && !game.soon && (
              <span style={{ width:5, height:5, borderRadius:'50%', background:game.color, display:'inline-block' }} />
            )}
            {game.soon && (
              <span style={{
                position:'absolute', top:-8, right:-4,
                fontSize:8, fontWeight:800,
                background:'linear-gradient(135deg,#FFB800,#FF8C00)',
                color:'#000', padding:'1px 4px', borderRadius:4,
                letterSpacing:'.5px', textTransform:'uppercase', pointerEvents:'none',
              }}>SOON</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ─── AppShell ──────────────────────────────────────────────────────────────── */
function AppShell() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: 'white' }}>
      <Navbar />
      <GameSelectorBar />
      <Routes>
        <Route path="/"                         element={<Dashboard />}      />
        <Route path="/matches"                  element={<Matches />}        />
        <Route path="/match/:id"                element={<MatchDetail />}    />
        <Route path="/rankings"                 element={<Rankings />}       />
        <Route path="/team/:teamId"             element={<TeamPage />}       />
        <Route path="/tournament/:tournamentId" element={<TournamentPage />} />
        <Route path="/players"                  element={<PlayerSearch />}   />
        <Route path="/news"                     element={<NewsPage />}       />
      </Routes>
    </div>
  )
}

/* ─── App root ──────────────────────────────────────────────────────────────── */
export default function App() {
  return (
    <Router>
      <GameProvider>
        <AppShell />
      </GameProvider>
    </Router>
  )
}