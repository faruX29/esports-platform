/**
 * SearchPage.jsx — Global Search
 * /search
 *
 * • Fuzzy search: teams + players + tournaments (Promise.all)
 * • Yearly Timeline: 2024 / 2025 / 2026
 * • Tournament Bento Grid
 * • Cross-filter Sidebar: Oyun × Yıl × Tier
 * • Turkish Pride + Radial Glow tasarım dili
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams }              from 'react-router-dom'
import { supabase }                                  from './supabaseClient'
import { getRoleBadge }                              from './roleHelper'
import { isTurkishTeam }                             from './constants'
import { GAMES }                                     from './GameContext'

// ─── Sabitler ────────────────────────────────────────────────────────────────

const YEARS     = [2024, 2025, 2026]
const TIER_META = {
  S: { color: '#FFD700', bg: 'rgba(255,215,0,.15)',  label: 'S · Premier'  },
  A: { color: '#FF4655', bg: 'rgba(255,70,85,.15)',  label: 'A · Major'    },
  B: { color: '#FF8C00', bg: 'rgba(255,140,0,.15)',  label: 'B · Regional' },
  C: { color: '#818cf8', bg: 'rgba(129,140,248,.15)',label: 'C · Qualifier' },
}
const GAME_META = {
  valorant:         { icon: '⚡', color: '#FF4655', label: 'VALORANT'         },
  'counter-strike': { icon: '🎯', color: '#F0A500', label: 'CS2'             },
  cs2:              { icon: '🎯', color: '#F0A500', label: 'CS2'             },
  lol:              { icon: '🏆', color: '#C89B3C', label: 'League of Legends' },
  dota:             { icon: '🔮', color: '#9d2226', label: 'Dota 2'          },
}

function normalizeTierKey(value) {
  if (!value) return null
  const normalized = String(value).toUpperCase().replace(/\s+/g, '').replace('_TIER', '')
  if (['S', 'A', 'B', 'C'].includes(normalized)) return normalized
  return null
}

function getTierMeta(rawTier) {
  const key = normalizeTierKey(rawTier)
  if (key && TIER_META[key]) return { ...TIER_META[key], key }
  return {
    key: rawTier || '-',
    color: '#888',
    bg: 'rgba(136,136,136,.12)',
    label: rawTier ? `Tier ${rawTier}` : 'Tier N/A',
  }
}

function slugToGame(name = '') {
  const n = name.toLowerCase()
  if (n.includes('valorant'))                 return GAME_META.valorant
  if (n.includes('counter') || n.includes('cs2') || n.includes('cs-go')) return GAME_META.cs2
  if (n.includes('league') || n.includes('legends')) return GAME_META.lol
  if (n.includes('dota'))                     return GAME_META.dota
  return { icon: '🎮', color: '#aaa', label: name }
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useDebounce(value, delay) {
  const [dv, setDv] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDv(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return dv
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(90deg,#111 25%,#1c1c1c 50%,#111 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
    }} />
  )
}

// ─── Section title ────────────────────────────────────────────────────────────

function ST({ icon, label, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#555',
        letterSpacing: '1.5px', textTransform: 'uppercase' }}>
        {label}
      </span>
      {count != null && (
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6,
          background: '#1a1a1a', color: '#444' }}>
          {count}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: '#1a1a1a' }} />
    </div>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Av({ src, name, size = 40, round = true }) {
  const [err, setErr] = useState(false)
  const initials = (name || '?').split(/[\s_]/)
    .map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const r = round ? '50%' : '8px'
  if (src && !err) {
    return (
      <img src={src} alt={name} onError={() => setErr(true)}
        style={{ width: size, height: size, borderRadius: r,
          objectFit: 'cover', flexShrink: 0, display: 'block' }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(135deg,#1e1e1e,#2a2a2a)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 800, color: '#555',
    }}>{initials}</div>
  )
}

// ─── Team Result Card ─────────────────────────────────────────────────────────

function TeamCard({ team, navigate }) {
  const isTR = isTurkishTeam(team.name)
  return (
    <div
      onClick={() => navigate(`/team/${team.id}`)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 12, background: '#0d0d0d',
        border: isTR ? '1.5px solid rgba(200,16,46,.4)' : '1.5px solid #1e1e1e',
        cursor: 'pointer', transition: 'all .18s',
        boxShadow: isTR ? '0 0 10px rgba(200,16,46,.1)' : 'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = isTR ? '#C8102E' : '#FF4655'
        e.currentTarget.style.transform   = 'translateY(-2px)'
        e.currentTarget.style.boxShadow   =
          `0 6px 20px ${isTR ? 'rgba(200,16,46,.25)' : 'rgba(255,70,85,.18)'}`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = isTR ? 'rgba(200,16,46,.4)' : '#1e1e1e'
        e.currentTarget.style.transform   = 'none'
        e.currentTarget.style.boxShadow   = isTR ? '0 0 10px rgba(200,16,46,.1)' : 'none'
      }}
    >
      <Av src={team.logo_url} name={team.name} size={40} round={false} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#eee',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {team.name}{isTR && ' 🇹🇷'}
        </div>
        <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>
          {team.acronym && <span style={{ marginRight: 6 }}>({team.acronym})</span>}
          {team.location && `📍 ${team.location}`}
        </div>
      </div>
      <span style={{ fontSize: 11, color: '#333' }}>→</span>
    </div>
  )
}

// ─── Player Result Card ───────────────────────────────────────────────────────

function PlayerCard({ player, navigate }) {
  const badge = getRoleBadge(player.role)
  return (
    <div
      onClick={() => navigate(`/player/${player.id}`)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 12,
        background: '#0d0d0d', border: '1.5px solid #1e1e1e',
        cursor: 'pointer', transition: 'all .18s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = badge.border
        e.currentTarget.style.transform   = 'translateY(-2px)'
        e.currentTarget.style.boxShadow   = `0 6px 20px ${badge.border}33`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#1e1e1e'
        e.currentTarget.style.transform   = 'none'
        e.currentTarget.style.boxShadow   = 'none'
      }}
    >
      <Av src={player.image_url} name={player.nickname} size={40} round />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#eee',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {player.nickname}
        </div>
        {player.real_name && (
          <div style={{ fontSize: 11, color: '#555',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {player.real_name}
          </div>
        )}
      </div>
      {player.role && (
        <span style={{ padding: '3px 9px', borderRadius: 8, fontSize: 10,
          fontWeight: 700, background: badge.bg,
          border: `1px solid ${badge.border}`, color: badge.color, flexShrink: 0 }}>
          {badge.label}
        </span>
      )}
    </div>
  )
}

// ─── Tournament Bento Card ────────────────────────────────────────────────────

function TournamentCard({ t, navigate, highlighted }) {
  const gm   = slugToGame(t.game?.name ?? t.name ?? '')
  const tier = getTierMeta(t.tier)
  const isTR = isTurkishTeam(t.name ?? '') || t.region === 'TR'
  const [hov, setHov] = useState(false)

  return (
    <div
      style={{
        position: 'relative', overflow: 'hidden', borderRadius: 16,
        padding: '0 0 14px', background: '#0d0d0d',
        border: highlighted
          ? `1.5px solid ${gm.color}88`
          : isTR
          ? '1.5px solid rgba(200,16,46,.4)'
          : `1.5px solid ${hov ? '#333' : '#1a1a1a'}`,
        boxShadow: hov
          ? `0 8px 28px ${gm.color}22`
          : isTR ? '0 0 12px rgba(200,16,46,.1)' : 'none',
        cursor: 'pointer', transition: 'all .2s',
      }}
      onClick={() => navigate(`/tournament/${t.id}`)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Radial glow top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 80, pointerEvents: 'none',
        background: `radial-gradient(ellipse at 50% 0%,${gm.color}22 0%,transparent 70%)`,
      }} />

      {/* TR stripe */}
      {isTR && (
        <div style={{
          background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)',
          padding: '4px 14px', marginBottom: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1.5px',
            color: '#fff', textTransform: 'uppercase' }}>🇹🇷 Turkish Event</span>
        </div>
      )}

      <div style={{ padding: isTR ? '0 14px 0' : '14px 14px 0' }}>
        {/* Badges */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700,
            background: `${gm.color}22`, border: `1px solid ${gm.color}55`, color: gm.color }}>
            {gm.icon} {gm.label}
          </span>
          <span style={{ padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700,
            background: tier.bg, border: `1px solid ${tier.color}55`, color: tier.color }}>
            {tier.label}
          </span>
          {t.region && (
            <span style={{
              padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700,
              background: 'rgba(255,255,255,.06)', border: '1px solid #333', color: '#aaa',
            }}>
              📍 {String(t.region).toUpperCase()}
            </span>
          )}
        </div>

        {/* Name */}
        <div style={{ fontSize: 14, fontWeight: 800, color: '#ddd',
          marginBottom: 8, lineHeight: 1.3 }}>
          {t.name}
        </div>

        {/* Dates */}
        {(t.begin_at || t.end_at) && (
          <div style={{ fontSize: 10, color: '#444', marginBottom: 12 }}>
            📅{' '}
            {t.begin_at
              ? new Date(t.begin_at).toLocaleDateString('tr-TR',
                  { day: '2-digit', month: 'short', year: 'numeric' })
              : '?'}
            {t.end_at &&
              ` — ${new Date(t.end_at).toLocaleDateString('tr-TR',
                  { day: '2-digit', month: 'short' })}`}
          </div>
        )}

        {/* Özet butonu */}
        <button
          onClick={e => { e.stopPropagation(); navigate(`/tournament/${t.id}`) }}
          style={{
            width: '100%', padding: '7px 0', borderRadius: 8,
            background: `${gm.color}18`, border: `1px solid ${gm.color}44`,
            color: gm.color, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', transition: 'background .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = `${gm.color}30`}
          onMouseLeave={e => e.currentTarget.style.background = `${gm.color}18`}
        >🔍 Özet →</button>
      </div>
    </div>
  )
}

// ─── Yearly Timeline ──────────────────────────────────────────────────────────

function YearTimeline({ activeYear, onChange, counts }) {
  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', gap: 0,
      marginBottom: 32, padding: '0 20px',
    }}>
      {/* Connector line */}
      <div style={{
        position: 'absolute', left: '20px', right: '20px', top: '50%',
        height: 2,
        background: 'linear-gradient(90deg,#1a1a1a,#2a2a2a,#1a1a1a)',
        zIndex: 0, transform: 'translateY(-50%)',
      }} />

      {YEARS.map(y => {
        const active = activeYear === y
        const cnt    = counts?.[y] ?? 0
        return (
          <div key={y} style={{ flex: 1, display: 'flex',
            flexDirection: 'column', alignItems: 'center', zIndex: 1 }}>
            {/* Count label */}
            <div style={{
              fontSize: 10, fontWeight: 700,
              color: active ? '#FF4655' : '#333',
              marginBottom: 6, transition: 'color .2s', height: 16,
            }}>
              {cnt > 0 ? `${cnt.toLocaleString('tr-TR')} maç` : ''}
            </div>

            {/* Node */}
            <button
              onClick={() => onChange(active ? null : y)}
              style={{
                width: active ? 52 : 44, height: active ? 52 : 44,
                borderRadius: '50%', border: 'none',
                background: active
                  ? 'linear-gradient(135deg,#FF4655,#FF8C00)'
                  : '#111',
                outline: active
                  ? '3px solid rgba(255,70,85,.3)'
                  : '2px solid #222',
                color: active ? '#fff' : '#555',
                fontSize: active ? 14 : 13,
                fontWeight: active ? 900 : 600,
                cursor: 'pointer',
                transition: 'all .22s cubic-bezier(.34,1.56,.64,1)',
                boxShadow: active ? '0 0 20px rgba(255,70,85,.4)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              onMouseEnter={e => {
                if (!active) {
                  e.currentTarget.style.outline = '2px solid #FF4655'
                  e.currentTarget.style.color   = '#FF4655'
                }
              }}
              onMouseLeave={e => {
                if (!active) {
                  e.currentTarget.style.outline = '2px solid #222'
                  e.currentTarget.style.color   = '#555'
                }
              }}
            >{y}</button>

            {active && (
              <div style={{ fontSize: 9, color: '#FF4655',
                marginTop: 6, fontWeight: 800, letterSpacing: '1px' }}>
                SEÇİLİ
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Cross-filter Sidebar ─────────────────────────────────────────────────────

function Sidebar({ filters, onChange, collapsed, onToggle }) {
  const { gameId, tierId } = filters
  const activeCount = [gameId, tierId].filter(Boolean).length

  return (
    <div style={{
      width: collapsed ? 44 : 220, flexShrink: 0,
      background: '#0a0a0a', borderRadius: 16,
      border: '1px solid #1a1a1a',
      transition: 'width .25s cubic-bezier(.4,0,.2,1)',
      overflow: 'hidden', alignSelf: 'flex-start',
      position: 'sticky', top: 116,
    }}>
      {/* Toggle header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: collapsed ? '12px 0' : '12px 16px',
          background: 'none', border: 'none',
          borderBottom: '1px solid #1a1a1a',
          color: '#555', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, fontWeight: 700, letterSpacing: '1px',
        }}
      >
        <span style={{ fontSize: 14 }}>{collapsed ? '⚙️' : '◀'}</span>
        {!collapsed && (
          <>
            <span style={{ textTransform: 'uppercase', color: '#555' }}>Filtreler</span>
            {activeCount > 0 && (
              <span style={{
                marginLeft: 'auto', fontSize: 10, padding: '1px 6px',
                borderRadius: 10, background: 'rgba(255,70,85,.2)',
                border: '1px solid rgba(255,70,85,.4)', color: '#FF4655',
                fontWeight: 800,
              }}>{activeCount}</span>
            )}
          </>
        )}
      </button>

      {!collapsed && (
        <div style={{ padding: '14px 14px' }}>

          {/* Aktif filtre temizle */}
          {activeCount > 0 && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12, padding: '6px 10px', borderRadius: 8,
              background: 'rgba(255,70,85,.1)',
              border: '1px solid rgba(255,70,85,.3)',
            }}>
              <span style={{ fontSize: 11, color: '#FF4655', fontWeight: 700 }}>
                {activeCount} aktif filtre
              </span>
              <button
                onClick={() => onChange({})}
                style={{ background: 'none', border: 'none',
                  color: '#FF4655', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
              >Temizle ✕</button>
            </div>
          )}

          {/* Oyun filtresi */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: '#444', fontWeight: 700,
              letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
              Oyun
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {GAMES.filter(g => g.id !== 'all' && !g.soon).map(g => {
                const active = gameId === g.id
                return (
                  <button
                    key={g.id}
                    onClick={() => onChange({ ...filters, gameId: active ? undefined : g.id })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 8, border: 'none',
                      background: active ? `${g.color}20` : 'transparent',
                      color: active ? g.color : '#666',
                      fontSize: 12, fontWeight: active ? 700 : 400,
                      cursor: 'pointer', transition: 'all .15s', textAlign: 'left',
                      outline: active ? `1px solid ${g.color}44` : '1px solid transparent',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.color = g.color }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#666' }}
                  >
                    <span>{g.icon}</span>
                    <span>{g.shortLabel}</span>
                    {active && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Tier filtresi */}
          <div>
            <div style={{ fontSize: 10, color: '#444', fontWeight: 700,
              letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8 }}>
              Turnuva Tieri
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(TIER_META).map(([key, m]) => {
                const active = tierId === key
                return (
                  <button
                    key={key}
                    onClick={() => onChange({ ...filters, tierId: active ? undefined : key })}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 8, border: 'none',
                      background: active ? m.bg : 'transparent',
                      color: active ? m.color : '#666',
                      fontSize: 12, fontWeight: active ? 700 : 400,
                      cursor: 'pointer', transition: 'all .15s', textAlign: 'left',
                      outline: active ? `1px solid ${m.color}44` : '1px solid transparent',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.color = m.color }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#666' }}
                  >
                    <span style={{ fontSize: 9 }}>◆</span>
                    <span>{m.label}</span>
                    {active && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Debug Panel ─────────────────────────────────────────────────────────────

function DebugPanel({ info, onClose }) {
  if (!info) return null
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      background: '#0d0d0d', border: '1px solid #333', borderRadius: 12,
      padding: '14px 18px', maxWidth: 420, fontSize: 11,
      boxShadow: '0 8px 32px rgba(0,0,0,.6)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
        marginBottom: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 800, color: '#FF4655' }}>🐛 Debug Log</span>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none',
            color: '#555', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>
      <pre style={{ margin: 0, color: '#888', whiteSpace: 'pre-wrap',
        wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto' }}>
        {JSON.stringify(info, null, 2)}
      </pre>
    </div>
  )
}

// ─── Ana Bileşen ──────────────────────────────────────────────────────────────

export default function SearchPage() {
  const navigate                        = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── State ──────────────────────────────────────────────────────
  const [query,       setQuery]       = useState(searchParams.get('q') || '')
  const [activeYear,  setActiveYear]  = useState(null)
  const [gameId,      setGameId]      = useState(undefined)   // filtreler ayrı state
  const [tierId,      setTierId]      = useState(undefined)   // referans sorunu yok
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const [teams,       setTeams]       = useState([])
  const [players,     setPlayers]     = useState([])
  const [tournaments, setTournaments] = useState([])
  const [yearCounts,  setYearCounts]  = useState({})

  const [loading,     setLoading]     = useState(false)
  const [tourLoading, setTourLoading] = useState(true)
  const [searchDone,  setSearchDone]  = useState(false)
  const [debugInfo,   setDebugInfo]   = useState(null)
  const [showDebug,   setShowDebug]   = useState(false)

  const inputRef   = useRef(null)
  const debouncedQ = useDebounce(query, 280)

  // ── Sidebar filters nesnesi (referans kararlı değil → primitive state kullan)
  const filters = { gameId, tierId }
  function setFilters(f) {
    setGameId(f.gameId)
    setTierId(f.tierId)
  }

  // ── URL senkron ────────────────────────────────────────────────
  useEffect(() => {
    if (query) setSearchParams({ q: query }, { replace: true })
    else       setSearchParams({},           { replace: true })
  }, [query])  // eslint-disable-line

  // ── İlk yükleme ────────────────────────────────────────────────
  useEffect(() => {
    fetchYearCounts()
    inputRef.current?.focus()
  }, [])

  // ── Turnuva yenile: bağımlılıklar primitive ────────────────────
  useEffect(() => {
    fetchTournaments()
  }, [activeYear, gameId, tierId])  // primitive değerler → güvenli

  // ── Arama ──────────────────────────────────────────────────────
  useEffect(() => {
    if (debouncedQ.trim().length < 2) {
      setTeams([]); setPlayers([]); setSearchDone(false)
      return
    }
    runSearch(debouncedQ.trim())
  }, [debouncedQ])

  // ── Year counts ────────────────────────────────────────────────
  async function fetchYearCounts() {
    try {
      const results = await Promise.all(
        YEARS.map(y =>
          supabase
            .from('matches')
            .select('id', { count: 'exact', head: true })
            .gte('scheduled_at', `${y}-01-01`)
            .lt( 'scheduled_at', `${y + 1}-01-01`)
            .then(({ count, error }) => {
              if (error) console.warn(`Year count ${y}:`, error.message)
              return { y, count: count ?? 0 }
            })
        )
      )
      const map = {}
      for (const { y, count } of results) map[y] = count
      setYearCounts(map)
      console.log('📅 Year counts:', map)
    } catch (e) {
      console.error('fetchYearCounts:', e)
    }
  }

  // ── Turnuvalar ─────────────────────────────────────────────────
  async function fetchTournaments() {
    setTourLoading(true)
    const dbg = {
      activeYear, gameId, tierId,
      appliedFilters: [], rawCount: null, error: null,
    }

    try {
      let q = supabase
        .from('tournaments')
        .select('id, name, tier, begin_at, end_at, region, game:games(id, name, slug)')
        .order('begin_at', { ascending: false, nullsFirst: false })  // NULL'lar sona
        .limit(80)

      // ── GUARD 1: Yıl filtresi ────────────────────────────────────
      // begin_at NULL olabilir → yalnızca NOT NULL satırlarla sorgula
      if (activeYear != null) {
        q = q
          .not('begin_at', 'is', null)                    // NULL'ları dışla
          .gte('begin_at', `${activeYear}-01-01`)
          .lt( 'begin_at', `${activeYear + 1}-01-01`)
        dbg.appliedFilters.push(`year=${activeYear}`)
      }

      // ── GUARD 2: Tier filtresi ───────────────────────────────────
      if (tierId != null && tierId !== '') {
        q = q.eq('tier', tierId)
        dbg.appliedFilters.push(`tier=${tierId}`)
      }

      // ── GUARD 3: Oyun filtresi ───────────────────────────────────
      if (gameId != null && gameId !== '') {
        const gameEntry = GAMES.find(g => g.id === gameId)
        if (gameEntry?.patterns?.length > 0) {
          const orStr = gameEntry.patterns
            .map(p => `name.ilike.%${p}%`)
            .join(',')
          q = q.or(orStr)
          dbg.appliedFilters.push(`game=${gameId}`)
        }
      }

      const { data, error } = await q

      if (error) {
        // begin_at kolonu yok hatası → kolonsuz fallback sorgu
        if (error.message?.includes('begin_at') ||
            error.code === '42703') {          // PostgreSQL: undefined_column
          console.warn('⚠️ begin_at kolonu yok, fallback sorgu çalışıyor...')
          return fetchTournamentsFallback(dbg)
        }
        dbg.error = error.message
        throw error
      }

      dbg.rawCount = data?.length ?? 0
      console.log('🏆 fetchTournaments:', dbg)

      setTournaments(data || [])
      setDebugInfo(dbg)
    } catch (e) {
      console.error('fetchTournaments catch:', e)
      dbg.error = e.message
      setDebugInfo(dbg)
      setTournaments([])
    } finally {
      setTourLoading(false)
    }
  }

  /**
   * Fallback: begin_at kolonu yoksa veya tümü NULL ise
   * matches tablosu üzerinden turnuvaları bul.
   * matches.tournament_id → tournaments join
   */
  async function fetchTournamentsFallback(dbg = {}) {
    console.log('🔄 Fallback: matches üzerinden turnuvalar sorgulanıyor...')
    try {
      let q = supabase
        .from('matches')
        .select(`
          tournament:tournaments!inner(
            id, name, tier, region,
            game:games(id, name, slug)
          )
        `)
        .not('tournament_id', 'is', null)

      // Yıl filtresi → matches.scheduled_at üzerinden
      if (activeYear != null) {
        q = q
          .gte('scheduled_at', `${activeYear}-01-01`)
          .lt( 'scheduled_at', `${activeYear + 1}-01-01`)
        dbg.appliedFilters = dbg.appliedFilters || []
        dbg.appliedFilters.push(`year=${activeYear} (via matches.scheduled_at)`)
      }

      if (tierId != null && tierId !== '') {
        q = q.eq('tournament.tier', tierId)
      }

      q = q.limit(500)   // daha fazla maç → unique turnuva sayısı artar

      const { data, error } = await q
      if (error) throw error

      // Unique turnuvaları çıkar
      const seen = new Set()
      const unique = []
      for (const row of (data || [])) {
        const t = row.tournament
        if (t && !seen.has(t.id)) {
          seen.add(t.id)

          // Oyun filtresi client-side uygula
          if (gameId != null && gameId !== '') {
            const gameEntry = GAMES.find(g => g.id === gameId)
            const match = gameEntry?.patterns?.some(p =>
              t.name?.toLowerCase().includes(p)
            )
            if (!match) continue
          }

          unique.push({ ...t, begin_at: null, end_at: null })
        }
      }

      dbg.rawCount = unique.length
      dbg.fallback = true
      console.log('🔄 Fallback sonuç:', dbg)

      setTournaments(unique)
      setDebugInfo(dbg)
    } catch (e) {
      console.error('fetchTournamentsFallback:', e)
      setTournaments([])
      setDebugInfo({ ...dbg, error: e.message })
    } finally {
      setTourLoading(false)
    }
  }

  // ── Arama fonksiyonu ───────────────────────────────────────────
  const runSearch = useCallback(async (q) => {
    setLoading(true); setSearchDone(false)
    try {
      const [teamRes, playerRes] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, acronym, logo_url, location')
          .ilike('name', `%${q}%`)
          .limit(12),
        supabase
          .from('players')
          .select('id, nickname, real_name, role, image_url, nationality, team_pandascore_id')
          .or(`nickname.ilike.%${q}%,real_name.ilike.%${q}%`)
          .limit(16),
      ])

      if (teamRes.error || playerRes.error) {
        const baseMsg = [teamRes.error?.message, playerRes.error?.message]
          .filter(Boolean)
          .join(' | ')

        // Kolon geçişlerinde once eski schema'yi destekleyen fallback dene.
        if (/location|nationality/i.test(baseMsg)) {
          const [teamFallback, playerFallback] = await Promise.all([
            supabase
              .from('teams')
              .select('id, name, acronym, logo_url')
              .ilike('name', `%${q}%`)
              .limit(12),
            supabase
              .from('players')
              .select('id, nickname, real_name, role, image_url, team_pandascore_id')
              .or(`nickname.ilike.%${q}%,real_name.ilike.%${q}%`)
              .limit(16),
          ])

          if (teamFallback.error || playerFallback.error) {
            throw new Error(
              `Search fallback failed: ${teamFallback.error?.message || ''} ${playerFallback.error?.message || ''}`.trim()
            )
          }

          setTeams(teamFallback.data || [])
          setPlayers(playerFallback.data || [])
          setSearchDone(true)
          return
        }

        throw new Error(baseMsg || 'Search query failed')
      }

      console.log(`🔍 Search "${q}": teams=${teamRes.data?.length}, players=${playerRes.data?.length}`)

      setTeams(teamRes.data   || [])
      setPlayers(playerRes.data || [])
      setSearchDone(true)
    } catch (e) {
      console.error('runSearch error:', e.message || e)
      setTeams([])
      setPlayers([])
      setSearchDone(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Query ile turnuva filtrele (client-side, search varsa) ─────
  const visibleTournaments = tournaments.filter(t => {
    if (!query.trim()) return true
    return t.name?.toLowerCase().includes(query.toLowerCase())
  })

  const totalResults = teams.length + players.length + visibleTournaments.length
  const hasQuery     = debouncedQ.trim().length >= 2
  const isEmpty      = searchDone && hasQuery && totalResults === 0

  // ── Tüm filtreleri sıfırla ─────────────────────────────────────
  function clearAllFilters() {
    setActiveYear(null)
    setGameId(undefined)
    setTierId(undefined)
    setQuery('')
  }

  const hasActiveFilters = activeYear != null || gameId != null || tierId != null

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: 'white', position: 'relative' }}>

      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
      `}</style>

      {/* ══ HERO SEARCH BAR ════════════════════════════════════════ */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(160deg,#0a0a0a 0%,#0f0f0f 100%)',
        borderBottom: '1px solid #141414',
        padding: '40px 24px 32px',
      }}>
        {/* Radial glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 0%,' +
            'rgba(255,70,85,.08) 0%,transparent 65%)',
        }} />

        <div style={{ maxWidth: 680, margin: '0 auto', position: 'relative' }}>
          <h1 style={{
            textAlign: 'center', margin: '0 0 6px',
            fontSize: 28, fontWeight: 900,
            background: 'linear-gradient(135deg,#FF4655,#F0A500)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>🔍 Global Search</h1>

          <p style={{ textAlign: 'center', color: '#383838', fontSize: 13, margin: '0 0 24px' }}>
            Takımlar, oyuncular, turnuvalar — hepsi bir arada
          </p>

          {/* Search input */}
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
              fontSize: 16, color: '#444', pointerEvents: 'none',
            }}>🔍</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Galatasaray, s1mple, VCT Champions..."
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '16px 48px 16px 46px',
                borderRadius: 14, fontSize: 16,
                background: '#111', color: 'white',
                border: '2px solid #1e1e1e', outline: 'none',
                transition: 'border-color .2s, box-shadow .2s',
              }}
              onFocus={e => {
                e.target.style.borderColor = '#FF4655'
                e.target.style.boxShadow   = '0 0 0 3px rgba(255,70,85,.12)'
              }}
              onBlur={e => {
                e.target.style.borderColor = '#1e1e1e'
                e.target.style.boxShadow   = 'none'
              }}
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setTeams([]); setPlayers([]); setSearchDone(false) }}
                style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: '#555', fontSize: 18,
                  cursor: 'pointer', width: 28, height: 28,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = '#555'}
              >✕</button>
            )}
          </div>

          {/* Quick chips */}
          {!query && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14,
              justifyContent: 'center', flexWrap: 'wrap' }}>
              {['Eternal Fire', 'BBL Esports', 'NaVi', 'G2', 's1mple', 'VCT'].map(s => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  style={{
                    padding: '5px 12px', borderRadius: 8,
                    background: '#111', border: '1px solid #222',
                    color: '#555', fontSize: 12, cursor: 'pointer', transition: 'all .15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#FF4655'
                    e.currentTarget.style.color = '#FF4655'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#222'
                    e.currentTarget.style.color = '#555'
                  }}
                >{s}</button>
              ))}
            </div>
          )}

          {/* Sonuç özeti */}
          {searchDone && hasQuery && (
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12,
              color: '#444', animation: 'fadeUp .3s ease' }}>
              {totalResults > 0 ? (
                <><span style={{ color: '#FF4655', fontWeight: 700 }}>{totalResults}</span>
                {' '}sonuç — "{debouncedQ}"</>
              ) : (
                <span>"{debouncedQ}" için sonuç bulunamadı</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══ YEARLY TIMELINE ════════════════════════════════════════ */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 0' }}>
        <ST icon="📅" label="Yıl Filtresi" />
        <YearTimeline
          activeYear={activeYear}
          onChange={setActiveYear}
          counts={yearCounts}
        />
      </div>

      {/* ══ ANA İÇERİK ════════════════════════════════════════════ */}
      <div style={{ maxWidth: 1200, margin: '0 auto',
        padding: '0 24px 80px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* Sidebar */}
        <Sidebar
          filters={filters}
          onChange={setFilters}
          collapsed={!sidebarOpen}
          onToggle={() => setSidebarOpen(v => !v)}
        />

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, animation: 'fadeUp .3s ease' }}>

          {/* ── Loading skeleton ── */}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              {[1, 2, 3].map(i => <Sk key={i} h="60px" r="12px" />)}
            </div>
          )}

          {/* ── Arama sonuçları ── */}
          {!loading && searchDone && hasQuery && (
            <>
              {teams.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <ST icon="🛡️" label="Takımlar" count={teams.length} />
                  <div style={{ display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                    {teams.map(t => <TeamCard key={t.id} team={t} navigate={navigate} />)}
                  </div>
                </div>
              )}

              {players.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <ST icon="👤" label="Oyuncular" count={players.length} />
                  <div style={{ display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                    {players.map(p => <PlayerCard key={p.id} player={p} navigate={navigate} />)}
                  </div>
                </div>
              )}

              {visibleTournaments.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <ST icon="🏆" label="Eşleşen Turnuvalar" count={visibleTournaments.length} />
                  <div style={{ display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {visibleTournaments.slice(0, 9).map(t => (
                      <TournamentCard key={t.id} t={t} navigate={navigate} highlighted />
                    ))}
                  </div>
                </div>
              )}

              {isEmpty && (
                <div style={{ textAlign: 'center', padding: '60px',
                  color: '#383838', animation: 'fadeUp .3s ease' }}>
                  <div style={{ fontSize: 44, marginBottom: 14 }}>📭</div>
                  <div style={{ fontSize: 16, color: '#444' }}>Sonuç bulunamadı</div>
                  <div style={{ fontSize: 12, color: '#2a2a2a', marginBottom: 20 }}>
                    Farklı bir ifade deneyin veya filtreleri kaldırın
                  </div>
                  {hasActiveFilters && (
                    <button
                      onClick={clearAllFilters}
                      style={{
                        marginTop: 16, padding: '10px 24px', borderRadius: 10,
                        background: 'rgba(255,70,85,.15)',
                        border: '1px solid rgba(255,70,85,.4)',
                        color: '#FF4655', fontSize: 13, fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >🔄 Kriterleri Temizle</button>
                  )}
                </div>
              )}
            </>
          )}

          {/* ══ TOURNAMENT COLLECTIONS ══════════════════════════════ */}
          <div>
            {/* Başlık + debug toggle */}
            <div style={{ display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <span style={{ fontSize: 13 }}>🏆</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#555',
                  letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                  {activeYear
                    ? `${activeYear} Turnuvaları`
                    : hasActiveFilters
                    ? 'Filtrelenmiş Turnuvalar'
                    : 'Tüm Turnuvalar'}
                </span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6,
                  background: '#1a1a1a', color: '#444' }}>
                  {visibleTournaments.length}
                </span>
                <div style={{ flex: 1, height: 1, background: '#1a1a1a' }} />
              </div>

              {/* Debug butonu */}
              <button
                onClick={() => setShowDebug(v => !v)}
                style={{
                  marginLeft: 8, padding: '3px 10px', borderRadius: 6,
                  background: '#111', border: '1px solid #222',
                  color: '#444', fontSize: 10, cursor: 'pointer',
                }}
                title="Debug log göster"
              >🐛</button>
            </div>

            {/* Aktif filtreler özeti */}
            {hasActiveFilters && (
              <div style={{
                display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 11, color: '#444' }}>Aktif:</span>
                {activeYear && (
                  <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11,
                    background: 'rgba(255,70,85,.1)',
                    border: '1px solid rgba(255,70,85,.3)', color: '#FF4655' }}>
                    📅 {activeYear}
                    <button onClick={() => setActiveYear(null)}
                      style={{ background: 'none', border: 'none',
                        color: '#FF4655', cursor: 'pointer', marginLeft: 4 }}>✕</button>
                  </span>
                )}
                {gameId && (
                  <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11,
                    background: 'rgba(255,70,85,.1)',
                    border: '1px solid rgba(255,70,85,.3)', color: '#FF4655' }}>
                    🎮 {GAMES.find(g => g.id === gameId)?.label ?? gameId}
                    <button onClick={() => setGameId(undefined)}
                      style={{ background: 'none', border: 'none',
                        color: '#FF4655', cursor: 'pointer', marginLeft: 4 }}>✕</button>
                  </span>
                )}
                {tierId && (
                  <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11,
                    background: 'rgba(255,70,85,.1)',
                    border: '1px solid rgba(255,70,85,.3)', color: '#FF4655' }}>
                    ◆ {TIER_META[tierId]?.label ?? tierId}
                    <button onClick={() => setTierId(undefined)}
                      style={{ background: 'none', border: 'none',
                        color: '#FF4655', cursor: 'pointer', marginLeft: 4 }}>✕</button>
                  </span>
                )}
                <button
                  onClick={clearAllFilters}
                  style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11,
                    background: 'transparent', border: '1px solid #2a2a2a',
                    color: '#555', cursor: 'pointer' }}>
                  Tümünü Temizle
                </button>
              </div>
            )}

            {/* Turnuva grid */}
            {tourLoading ? (
              <div style={{ display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {[1, 2, 3, 4, 5, 6].map(i => <Sk key={i} h="180px" r="16px" />)}
              </div>
            ) : visibleTournaments.length === 0 ? (
              /* ── Fallback: boş durum ── */
              <div style={{ textAlign: 'center', padding: '48px 20px',
                color: '#383838', background: '#0d0d0d', borderRadius: 16,
                border: '1px dashed #1e1e1e' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏆</div>
                <div style={{ fontSize: 15, color: '#444', marginBottom: 6 }}>
                  Bu kriterlerde turnuva bulunamadı
                </div>
                <div style={{ fontSize: 12, color: '#2a2a2a', marginBottom: 20 }}>
                  {hasActiveFilters
                    ? 'Filtreler sonuçları daraltıyor olabilir'
                    : 'Veritabanında tournaments tablosu boş olabilir'}
                </div>
                {hasActiveFilters && (
                  <button
                    onClick={clearAllFilters}
                    style={{
                      padding: '10px 28px', borderRadius: 12,
                      background: 'linear-gradient(135deg,rgba(255,70,85,.2),rgba(255,140,0,.1))',
                      border: '1px solid rgba(255,70,85,.4)',
                      color: '#FF4655', fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', transition: 'all .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background =
                      'linear-gradient(135deg,rgba(255,70,85,.3),rgba(255,140,0,.2))'}
                    onMouseLeave={e => e.currentTarget.style.background =
                      'linear-gradient(135deg,rgba(255,70,85,.2),rgba(255,140,0,.1))'}
                  >🔄 Kriterleri Temizle ve Tümünü Göster</button>
                )}
                {/* Debug bilgisi */}
                {debugInfo && (
                  <div style={{ marginTop: 20, padding: '10px 14px', borderRadius: 10,
                    background: '#111', border: '1px solid #1e1e1e',
                    textAlign: 'left', fontSize: 10, color: '#555' }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, color: '#444' }}>
                      🐛 Son sorgu:
                    </div>
                    <div>Filtreler: {debugInfo.appliedFilters.length === 0
                      ? 'Hiçbiri (tümü getirilmeli)' : debugInfo.appliedFilters.join(' | ')}</div>
                    <div>Dönen kayıt: {debugInfo.rawCount ?? '—'}</div>
                    {debugInfo.error && (
                      <div style={{ color: '#FF4655', marginTop: 4 }}>
                        Hata: {debugInfo.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {visibleTournaments.map(t => (
                  <TournamentCard key={t.id} t={t} navigate={navigate} highlighted={false} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Debug overlay */}
      {showDebug && (
        <DebugPanel info={debugInfo} onClose={() => setShowDebug(false)} />
      )}
    </div>
  )
}