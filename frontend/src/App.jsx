/**
 * App.jsx — Router + Navbar + GameSelectorBar
 */
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { GameProvider, useGame, GAMES } from './context/GameContext'
import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import toast, { Toaster } from 'react-hot-toast'
import { UserProvider, useUser } from './context/UserContext'
import { AuthProvider } from './context/AuthContext'
import { Analytics } from '@vercel/analytics/react'
import { useAuth } from './context/AuthContext'
import {
  supabase,
  buildMatchRealtimeNotification,
  buildManualTestNotification,
  subscribeToMatchesUpdates,
  requestBrowserNotificationPermission,
  triggerBrowserMatchNotification,
} from './supabaseClient'

import ProtectedRoute from './components/ProtectedRoute'
import NavbarComponent from './components/Navbar'
import Footer from './components/Footer'
import { FEXT } from './theme'
import { Home, CalendarDays, Trophy, BarChart3, Newspaper, Radar, Search, X as XIcon, Shield, User, ArrowRight, CornerDownLeft } from 'lucide-react'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Matches = lazy(() => import('./pages/Matches'))
const MatchDetailPage = lazy(() => import('./pages/MatchDetailPage'))
const RankingsPage = lazy(() => import('./pages/RankingsPage'))
const TeamPage = lazy(() => import('./pages/TeamPage'))
const TournamentPage = lazy(() => import('./pages/TournamentPage'))
const PlayersPage = lazy(() => import('./pages/PlayersPage'))
const PlayerPage = lazy(() => import('./pages/PlayerPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const ProfileSettings = lazy(() => import('./pages/ProfileSettings'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const NewsPage = lazy(() => import('./pages/NewsPage'))
const NewsArchivePage = lazy(() => import('./pages/NewsArchivePage'))
const NewsDetailPage = lazy(() => import('./pages/NewsDetailPage'))
const TournamentsListPage = lazy(() => import('./pages/TournamentsListPage'))
const ScoutEnginePage = lazy(() => import('./pages/ScoutEnginePage'))

import './App.css'

/* ─── Nav linkleri (emoji yerine lucide ikon → "AI havası" kalkar; Navbar hover ekler) ── */
const NAV_LINKS = [
  { to: '/',         label: 'Ana Sayfa', end: true,  icon: Home },
  { to: '/matches',  label: 'Maçlar',    end: false, icon: CalendarDays },
  { to: '/tournaments', label: 'Turnuvalar', end: false, icon: Trophy },
  { to: '/rankings', label: 'Sıralama',  end: false, icon: BarChart3 },
  // NOT: '/players' listeleme sekmesi gizlendi — oyuncu istatistikleri seyrek olduğu
  // için sıralama/compare boş duruyordu. Oyuncu DETAY sayfaları (/player/:id) arama +
  // takım kadrosu + maç üzerinden erişilir kalır. İstatistik kapsamı büyüyünce geri açılır.
  { to: '/news',     label: 'Haberler',  end: false, icon: Newspaper },
  { to: '/scout',    label: 'Scout',     end: false, icon: Radar },
]

/* Klavye kısayol simgesi platforma göre (Mac ⌘ / diğer Ctrl) */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')

/* ─── NavSearch ─────────────────────────────────────────────────────────────── */
function NavSearch() {
  const navigate                  = useNavigate()
  const location                  = useLocation()
  const [q,       setQ]           = useState('')
  const [focused, setFocused]     = useState(false)
  const [results, setResults]     = useState({ teams: [], players: [], tournaments: [] })
  const [loading, setLoading]     = useState(false)
  const inputRef                  = useRef(null)
  const dropdownRef               = useRef(null)
  const debounceRef               = useRef(null)

  // route değişince kapat
  useEffect(() => {
    setQ('')
    setResults({ teams: [], players: [], tournaments: [] })
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
      setResults({ teams: [], players: [], tournaments: [] })
      return
    }
    setLoading(true)
    try {
      const [teamRes, playerRes, tourRes] = await Promise.all([
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
        supabase
          .from('tournaments')
          .select('id, name, tier, game:games(name)')
          .ilike('name', `%${query}%`)
          .order('begin_at', { ascending: false, nullsFirst: false })
          .limit(4),
      ])
      setResults({
        teams:       teamRes.data   || [],
        players:     playerRes.data || [],
        tournaments: tourRes.data   || [],
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

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current)
    }
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    if (!q.trim()) return
    setFocused(false)
    navigate(`/search?q=${encodeURIComponent(q.trim())}`)
  }

  const hasResults = results.teams.length > 0 || results.players.length > 0 || results.tournaments.length > 0
  const showDrop   = focused && q.trim().length >= 2

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Input */}
      <form onSubmit={handleSubmit}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: focused ? 'var(--surface-2)' : 'var(--surface)',
          border: `1.5px solid ${focused ? FEXT.accent : 'var(--line)'}`,
          borderRadius: 10, padding: '5px 10px',
          transition: 'all .2s',
          boxShadow: focused ? `0 0 0 3px ${FEXT.accentGlow}` : 'none',
          width: focused ? 'min(260px, 70vw)' : 180,
        }}>
          <span style={{ color: focused ? FEXT.accent : 'var(--text-4)',
            flexShrink: 0, transition: 'color .2s', display: 'inline-flex' }}><Search size={14} /></span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            placeholder="Ara…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: 'var(--text)', fontSize: 13, minWidth: 0,
            }}
          />
          {/* Kısayol rozeti — Mac'te ⌘K, diğerlerinde Ctrl K */}
          {!focused && (
            <span style={{
              fontSize: 9, padding: '2px 5px', borderRadius: 4,
              background: 'var(--surface-2)', border: '1px solid var(--line)',
              color: 'var(--text-4)', flexShrink: 0, fontFamily: 'monospace', whiteSpace: 'nowrap',
            }}>{IS_MAC ? '⌘K' : 'Ctrl K'}</span>
          )}
          {/* Clear */}
          {focused && q && (
            <button
              type="button"
              onClick={() => { setQ(''); setResults({ teams: [], players: [], tournaments: [] }); inputRef.current?.focus() }}
              style={{ background: 'none', border: 'none', color: 'var(--text-4)',
                cursor: 'pointer', padding: 0, flexShrink: 0, display: 'inline-flex' }}
            ><XIcon size={14} /></button>
          )}
          {/* Loading dot */}
          {loading && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: FEXT.accent, flexShrink: 0,
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
            width: 320, background: 'var(--surface)',
            border: '1px solid var(--line)', borderRadius: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,.55)',
            overflow: 'hidden', zIndex: 9999,
            animation: 'fadeUp .15s ease',
          }}
        >
          {!hasResults && !loading && (
            <div style={{ padding: '20px', textAlign: 'center',
              fontSize: 12, color: 'var(--text-4)' }}>
              "{q}" için sonuç yok
            </div>
          )}

          {/* Teams */}
          {results.teams.length > 0 && (
            <div>
              <div style={{ padding: '8px 14px 4px', fontSize: 9, color: 'var(--text-5)',
                fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Shield size={11} /> Takımlar
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
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {t.logo_url
                    ? <img src={t.logo_url} alt={t.name}
                        style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }} />
                    : <div style={{ width: 26, height: 26, borderRadius: 6,
                        background: 'var(--surface-2)', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-5)' }}><Shield size={13} /></div>
                  }
                  <span style={{ fontSize: 13, color: 'var(--text-2)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-6)' }}>→</span>
                </div>
              ))}
            </div>
          )}

          {/* Players */}
          {results.players.length > 0 && (
            <div style={{ borderTop: results.teams.length > 0 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ padding: '8px 14px 4px', fontSize: 9, color: 'var(--text-5)',
                fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                <User size={11} /> Oyuncular
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
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {p.image_url
                    ? <img src={p.image_url} alt={p.nickname}
                        style={{ width: 26, height: 26, objectFit: 'cover',
                          borderRadius: '50%', flexShrink: 0 }} />
                    : <div style={{ width: 26, height: 26, borderRadius: '50%',
                        background: 'var(--surface-2)', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--text-5)' }}><User size={13} /></div>
                  }
                  <span style={{ fontSize: 13, color: 'var(--text-2)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.nickname}
                  </span>
                  {p.role && (
                    <span style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 6px',
                      borderRadius: 4, background: 'var(--surface-2)', color: 'var(--text-4)',
                      flexShrink: 0 }}>{p.role}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tournaments */}
          {results.tournaments.length > 0 && (
            <div style={{ borderTop: (results.teams.length > 0 || results.players.length > 0) ? '1px solid var(--line)' : 'none' }}>
              <div style={{ padding: '8px 14px 4px', fontSize: 9, color: 'var(--text-5)',
                fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Trophy size={11} /> Turnuvalar
              </div>
              {results.tournaments.map(t => (
                <div
                  key={t.id}
                  onMouseDown={() => { setFocused(false); navigate(`/tournament/${t.id}`) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 14px', cursor: 'pointer', transition: 'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--surface-2)', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}><Trophy size={13} /></div>
                  <span style={{ fontSize: 13, color: 'var(--text-2)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                  {t.tier && (
                    <span style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 6px',
                      borderRadius: 4, background: 'var(--surface-2)', color: 'var(--text-4)', flexShrink: 0 }}>
                      {String(t.tier).toUpperCase()}
                    </span>
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
              borderTop: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', transition: 'background .12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <span style={{ color: FEXT.accentText, display: 'inline-flex' }}><Search size={13} /></span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              "<span style={{ color: FEXT.accentText, fontWeight: 700 }}>{q}</span>" için tüm sonuçları gör
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-5)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Enter <CornerDownLeft size={11} /></span>
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
  const showOn = ['/', '/matches', '/rankings', '/tournaments']
  if (!showOn.includes(location.pathname)) return null

  return (
    <div style={{
      background: 'var(--bg)', borderBottom: '1px solid var(--line)',
      overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      <div style={{
        display: 'flex', gap: 4,
        maxWidth: 1440, margin: '0 auto', padding: '6px 16px',
      }}>
        {GAMES.map(g => {
          const active = activeGame === g.id
          return (
            <button
              key={g.id}
              onClick={() => setActiveGame(g.id)}
              disabled={g.soon}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 12px', border: 'none', background: 'transparent',
                borderBottom: active ? `2px solid ${g.color}` : '2px solid transparent',
                color: active ? 'var(--text)' : g.soon ? 'var(--text-5)' : 'var(--text-3)',
                fontSize: 11, fontWeight: active ? 800 : 600,
                letterSpacing: '.5px', textTransform: 'uppercase',
                cursor: g.soon ? 'default' : 'pointer',
                transition: 'all .15s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
              onMouseEnter={e => { if (!active && !g.soon) e.currentTarget.style.color = g.color }}
              onMouseLeave={e => { if (!active && !g.soon) e.currentTarget.style.color = 'var(--text-3)' }}
            >
              {/* emoji yerine brand-renkli nokta — her oyunun kimliği, kurumsal */}
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: g.soon ? 'var(--text-5)' : g.color,
              }} />
              <span>{g.shortLabel ?? g.label}</span>
              {g.soon && (
                <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 4,
                  background: 'var(--surface-2)', color: 'var(--text-4)', letterSpacing: 0 }}>soon</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RealtimeToastBridge() {
  const { user, profile } = useAuth()
  const { followedTeamIds } = useUser()
  const shownRef = useRef(new Map())
  const followedRef = useRef([])
  useEffect(() => { followedRef.current = (followedTeamIds || []).map(Number) }, [followedTeamIds])

  const canManualTest = !!(
    import.meta.env.DEV
    || String(profile?.username || '').toLowerCase() === 'admin'
    || String(user?.email || '').toLowerCase().includes('admin')
  )

  const handleManualNotificationTest = useCallback((kind = 'start') => {
    const notification = buildManualTestNotification(kind)
    if (!notification) return

    const text = `${notification.title} ${notification.message}`
    if (notification.variant === 'success') {
      toast.success(text, { duration: 3600 })
    } else if (notification.variant === 'live') {
      toast(text, { duration: 3000, icon: '⚡' })
    } else {
      toast(text, { duration: 3200, icon: '📡' })
    }
    triggerBrowserMatchNotification(notification)
  }, [])

  useEffect(() => {
    requestBrowserNotificationPermission({ allowPrompt: true })

    const unsubscribe = subscribeToMatchesUpdates(async payload => {
      const row = payload?.new || {}
      const aId = Number(row.team_a_id), bId = Number(row.team_b_id)

      // SADECE FAVORİLER: maç, takip edilen bir takımı içermiyorsa bildirme.
      const followed = followedRef.current
      if (!followed.length) return
      if (!followed.includes(aId) && !followed.includes(bId)) return

      // Bu güncelleme aslında bir bildirim üretiyor mu? (isim çekmeden önce ucuz kontrol)
      if (!buildMatchRealtimeNotification(payload)) return

      // Realtime payload isim taşımaz → iki takımın adını çek (okunur metin için).
      let teamNames = new Map()
      try {
        const ids = [aId, bId].filter(Number.isFinite)
        const { data } = await supabase.from('teams').select('id,name').in('id', ids)
        teamNames = new Map((data || []).map(t => [t.id, t.name]))
      } catch { /* isim gelmezse "Takım A/B" fallback */ }

      const notification = buildMatchRealtimeNotification(payload, { teamNames })
      if (!notification) return

      const now = Date.now()
      const previousAt = shownRef.current.get(notification.dedupeKey) || 0
      if ((now - previousAt) < 9000) return

      shownRef.current.set(notification.dedupeKey, now)
      if (shownRef.current.size > 120) {
        const expiry = now - (60 * 1000)
        for (const [key, ts] of shownRef.current.entries()) {
          if (ts < expiry) shownRef.current.delete(key)
        }
      }

      const text = `${notification.title} · ${notification.message}`
      const options = {
        duration: notification.variant === 'live' ? 2800 : 3600,
      }

      if (notification.variant === 'success') {
        toast.success(text, options)
      } else if (notification.variant === 'live') {
        toast(text, { ...options, icon: '⚡' })
      } else {
        toast(text, { ...options, icon: '📡' })
      }

      triggerBrowserMatchNotification(notification)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  return (
    <>
      {canManualTest && (
        <div style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 10001,
          display: 'flex',
          gap: 8,
        }}>
          <button
            type='button'
            onClick={() => handleManualNotificationTest('start')}
            style={{
              background: 'rgba(22,22,22,.95)',
              color: '#ffd66f',
              border: '1px solid rgba(255,214,111,.35)',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Test Notification
          </button>
          <button
            type='button'
            onClick={() => handleManualNotificationTest('finish')}
            style={{
              background: 'rgba(22,22,22,.95)',
              color: '#8ff3b4',
              border: '1px solid rgba(143,243,180,.35)',
              borderRadius: 999,
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Test Finish
          </button>
        </div>
      )}

      <Toaster
        position='top-right'
        gutter={10}
        toastOptions={{
          style: {
            background: 'rgba(18,18,18,.94)',
            color: 'var(--text-1)',
            border: '1px solid rgba(255,255,255,.12)',
            boxShadow: '0 10px 26px rgba(0,0,0,.35)',
            fontSize: 12,
          },
        }}
      />
    </>
  )
}

/* ─── RecoveryGate ──────────────────────────────────────────────────────────────
   Şifre-kurtarma linkinden gelen kullanıcı, YENİ ŞİFRE belirlemeden hiçbir sayfaya
   gidemesin — aksi halde link'le girip şifre koymadan çıkınca eski (bilinmeyen)
   şifreye kilitleniyordu. Yeni şifre kaydedilince (veya çıkış) recoveryMode temizlenir. */
function RecoveryGate() {
  const { recoveryMode } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (recoveryMode && location.pathname !== '/reset-password') {
      navigate('/reset-password', { replace: true })
    }
  }, [recoveryMode, location.pathname, navigate])
  return null
}

/* ─── AppShell ──────────────────────────────────────────────────────────────── */
function AppShell() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <RecoveryGate />
      <RealtimeToastBridge />
      <NavbarComponent navLinks={NAV_LINKS} SearchComponent={NavSearch} />
      <GameSelectorBar />
      <Suspense fallback={(
        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '18px 16px 26px' }}>
          <div style={{ height: 12, width: 190, borderRadius: 999, background: 'var(--surface-2)', marginBottom: 14 }} />
          <div style={{ height: 170, borderRadius: 14, background: 'linear-gradient(90deg,var(--surface) 20%,var(--surface-2) 50%,var(--surface) 80%)', backgroundSize: '200% 100%', animation: 'appRouteLoad 1.3s ease-in-out infinite' }} />
          <style>{`@keyframes appRouteLoad { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
        </div>
      )}>
        <Routes>
          <Route path="/"                         element={<Dashboard />}      />
          <Route path="/matches"                  element={<Matches />}        />
          <Route path="/tournaments"              element={<TournamentsListPage />} />
          <Route path="/match/:id"                element={<MatchDetailPage />} />
          <Route path="/rankings"                 element={<RankingsPage />}   />
          <Route path="/team/:teamId"             element={<TeamPage />}       />
          <Route path="/tournament/:tournamentId" element={<TournamentPage />} />
          <Route path="/players"                  element={<PlayersPage />}    />
          <Route path="/player/:id"               element={<PlayerPage />}     />
          <Route path="/search"                   element={<SearchPage />}     />
          <Route path="/news"                     element={<NewsPage />}       />
          <Route path="/news/archive"             element={<NewsArchivePage />} />
          <Route path="/news/:newsId"             element={<NewsDetailPage />} />
          <Route path="/scout"                    element={<ScoutEnginePage />} />
          <Route path="/login"                    element={<LoginPage />}      />
          <Route path="/register"                 element={<RegisterPage />}   />
          <Route path="/forgot-password"          element={<ForgotPasswordPage />} />
          <Route path="/reset-password"           element={<ResetPasswordPage />} />
          <Route path="/settings"                 element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
        </Routes>
      </Suspense>
      <Footer />
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
            <Analytics />
          </GameProvider>
        </UserProvider>
      </AuthProvider>
    </Router>
  )
}