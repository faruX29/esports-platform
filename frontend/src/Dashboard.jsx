/**
 * Dashboard.jsx — Bento Grid Layout
 * FavoritesBar → Stats Bento → Live Grid → Today List → Quick Links
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link }                from 'react-router-dom'
import { supabase, subscribeToMatchesUpdates } from './supabaseClient'
import { useGame, gameMatchesFilter, GAMES } from './GameContext'
import { isTurkishTeam }                   from './constants'
import { useUser }                          from './context/UserContext'
import BRANDING                             from './branding.config'
import { buildFinishedStory, buildUpcomingStory } from './utils/newsStories'
import { isStoryForYou, prioritizeStoriesForYou } from './utils/newsPersonalization'
import { calculatePredictionAccuracy, getMatchImpactLabel } from './utils/accuracyTracker'
import { memo }                             from 'react'

const MVP_HIDE_DREAM_TEAM = true
const MVP_HIDE_PREDICTIONS = true
const DASHBOARD_TICKER_CACHE_KEY = 'dashboard_live_ticker_cache_v1'
const DASHBOARD_NEWS_CACHE_KEY = 'dashboard_news_cache_v1'
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000
const DASHBOARD_PREF_WIZARD_SEEN_KEY = 'dashboard_pref_wizard_seen_v1'
const DASHBOARD_ACCURACY_REFRESH_MIN_INTERVAL_MS = 45 * 1000
const DASHBOARD_GLOBAL_ERROR_TEXT = 'Sunucuyla bağlantı kesildi, tekrar deneniyor...'
const POPULAR_TEAM_SEARCH_TERMS = ['galatasaray', 'eternal fire', 'fut', 'bbl', 'fenerbahce', 'sangal', 'g2', 'fnatic', 'navi']
const PREFERENCE_GAMES = GAMES.filter(game => ['valorant', 'cs2', 'lol'].includes(game.id))


/* ── Skeleton ─────────────────────────────────────────────────────────────── */
function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(90deg,#0e0e0e 25%,#181818 50%,#0e0e0e 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
    }} />
  )
}

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}
function getStatusBadge(status) {
  return {
    not_started: { text: 'Upcoming', color: '#FFB800', bg: 'rgba(255,184,0,.12)' },
    running:     { text: 'LIVE',     color: '#FF4655', bg: 'rgba(255,70,85,.18)' },
    finished:    { text: 'Bitti',    color: '#4CAF50', bg: 'rgba(76,175,80,.12)' },
  }[status] || { text: status, color: '#555', bg: 'transparent' }
}

function normalizeTierKey(value) {
  if (!value) return null
  const normalized = String(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-')

  if (normalized === 'S' || normalized.includes('S-TIER') || normalized.includes('TIER-S')) return 'S'
  if (normalized === 'A' || normalized.includes('A-TIER') || normalized.includes('TIER-A')) return 'A'
  if (normalized === 'B' || normalized.includes('B-TIER') || normalized.includes('TIER-B')) return 'B'
  if (normalized === 'C' || normalized.includes('C-TIER') || normalized.includes('TIER-C')) return 'C'

  const compact = normalized.replace(/-/g, '')
  return ['S', 'A', 'B', 'C', 'D', 'E'].includes(compact[0]) ? compact[0] : null
}

function isHeroTier(rawTier) {
  const key = normalizeTierKey(rawTier)
  return key === 'S' || key === 'A'
}

function filterMatchesByTournamentTier(matches = [], showAll = false) {
  if (showAll) return matches
  return matches.filter(match => isHeroTier(match?.tournament?.tier))
}

function safeReadCache(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function safeWriteCache(key, payload) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // Ignore quota/storage errors and continue with network data.
  }
}

function isFreshCache(payload, scope) {
  if (!payload || payload.scope !== scope) return false
  const ts = Number(payload.updatedAt || 0)
  if (!Number.isFinite(ts) || ts <= 0) return false
  return (Date.now() - ts) <= DASHBOARD_CACHE_TTL_MS
}

function patchMatchCollection(rows = [], incoming = {}) {
  if (!incoming?.id) return rows
  return (rows || []).map(match => {
    if (match.id !== incoming.id) return match
    return {
      ...match,
      status: incoming.status ?? match.status,
      scheduled_at: incoming.scheduled_at ?? match.scheduled_at,
      winner_id: incoming.winner_id ?? match.winner_id,
      team_a_score: incoming.team_a_score ?? match.team_a_score,
      team_b_score: incoming.team_b_score ?? match.team_b_score,
      team_a_id: incoming.team_a_id ?? match.team_a_id,
      team_b_id: incoming.team_b_id ?? match.team_b_id,
      prediction_team_a: incoming.prediction_team_a ?? match.prediction_team_a,
      prediction_team_b: incoming.prediction_team_b ?? match.prediction_team_b,
      prediction_confidence: incoming.prediction_confidence ?? match.prediction_confidence,
    }
  })
}

function buildTickerLines(running, finishedStories, upcomingStories, followedTeamIds = [], followedGameIds = []) {
  const lines = []
  const orderedFinished = prioritizeStoriesForYou(finishedStories || [], followedTeamIds, followedGameIds)
  const orderedUpcoming = prioritizeStoriesForYou(upcomingStories || [], followedTeamIds, followedGameIds)

  ;(running || []).forEach(match => {
    lines.push({
      id: `live_${match.id}`,
      text: `🔴 LIVE ${match.team_a?.name || '?'} ${match.team_a_score ?? 0}:${match.team_b_score ?? 0} ${match.team_b?.name || '?'}`,
      href: match?.id ? `/match/${match.id}` : null,
    })
  })
  ;orderedFinished.forEach(story => {
    const forYou = isStoryForYou(story, followedTeamIds, followedGameIds)
    lines.push({
      id: `finished_${story.id}`,
      text: `${forYou ? '⭐ FOR YOU' : '📰'} ${story.title}`,
      href: story?.id ? `/news/${story.id}` : null,
    })
    const scout = scoutSignalLine(story)
    if (scout) lines.push({ id: `finished_scout_${story.id}`, text: scout, href: null })
  })
  ;orderedUpcoming.forEach(story => {
    const forYou = isStoryForYou(story, followedTeamIds, followedGameIds)
    lines.push({
      id: `upcoming_${story.id}`,
      text: `${forYou ? '⭐ FOR YOU' : '⏳'} ${story.title}`,
      href: story?.id ? `/news/${story.id}` : null,
    })
    const scout = scoutSignalLine(story)
    if (scout) lines.push({ id: `upcoming_scout_${story.id}`, text: scout, href: null })
  })
  return lines
}

const PreferencePickerModal = memo(function PreferencePickerModal({
  open,
  onClose,
  onSave,
  gameIds,
  teamIds,
  popularTeams,
  loading,
}) {
  const [selectedGames, setSelectedGames] = useState(gameIds || [])
  const [selectedTeams, setSelectedTeams] = useState(teamIds || [])

  useEffect(() => {
    if (!open) return
    setSelectedGames(gameIds || [])
    setSelectedTeams(teamIds || [])
  }, [open, gameIds, teamIds])

  if (!open) return null

  const toggleGame = gameId => {
    setSelectedGames(prev => prev.includes(gameId)
      ? prev.filter(id => id !== gameId)
      : [...prev, gameId])
  }

  const toggleTeam = teamId => {
    setSelectedTeams(prev => prev.includes(teamId)
      ? prev.filter(id => id !== teamId)
      : [...prev, teamId])
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1200,
      background: 'rgba(6,6,6,.72)',
      display: 'grid',
      placeItems: 'center',
      padding: '16px',
    }}>
      <div style={{
        width: 'min(720px, 100%)',
        maxHeight: '85vh',
        overflowY: 'auto',
        borderRadius: 18,
        border: '1px solid #222',
        background: 'radial-gradient(circle at 14% 12%, rgba(255,70,85,.2), transparent 42%), #0f0f0f',
        boxShadow: '0 28px 70px rgba(0,0,0,.55)',
      }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #202020' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.9px', color: '#ff9ba5', textTransform: 'uppercase' }}>
            Takip Tercihleri
          </div>
          <h3 style={{ margin: '8px 0 0', fontSize: 22, color: '#f5f5f5' }}>For You akisini ozellestir</h3>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#9a9a9a', lineHeight: 1.5 }}>
            Oyun ve takim secimlerini kaydet. Dashboard ticker icerigi secimlerine gore aninda siralanir.
          </p>
        </div>

        <div style={{ padding: '14px 16px 18px' }}>
          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>Oyunlar</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {PREFERENCE_GAMES.map(game => {
              const active = selectedGames.includes(game.id)
              return (
                <button
                  key={game.id}
                  onClick={() => toggleGame(game.id)}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${active ? game.color : '#2a2a2a'}`,
                    background: active ? `${game.color}2b` : '#141414',
                    color: active ? '#fff' : '#cfcfcf',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '7px 11px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ marginRight: 5 }}>{game.icon}</span>
                  {game.shortLabel}
                </button>
              )
            })}
          </div>

          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>Populer Takimlar</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
            {(popularTeams || []).map(team => {
              const active = selectedTeams.includes(team.id)
              return (
                <button
                  key={team.id}
                  onClick={() => toggleTeam(team.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: 11,
                    border: `1px solid ${active ? '#ff6f7e' : '#262626'}`,
                    background: active ? 'rgba(255,70,85,.18)' : '#121212',
                    color: active ? '#ffd9de' : '#cdcdcd',
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  {team.logo_url
                    ? <img src={team.logo_url} alt={team.name} style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }} />
                    : <span style={{ width: 22, textAlign: 'center', fontSize: 11, color: '#8f8f8f', flexShrink: 0 }}>TM</span>}
                  <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
                </button>
              )
            })}
            {!loading && (!popularTeams || popularTeams.length === 0) && (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#777', border: '1px dashed #262626', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                Takim onerileri yuklenemedi. Daha sonra tekrar deneyebilirsin.
              </div>
            )}
            {loading && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
                {[1, 2, 3, 4, 5, 6].map(i => <Sk key={i} h="36px" r="10px" />)}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '0 16px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              borderRadius: 10,
              border: '1px solid #2d2d2d',
              background: '#141414',
              color: '#bbb',
              fontSize: 12,
              fontWeight: 700,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            Daha Sonra
          </button>
          <button
            onClick={() => onSave({ gameIds: selectedGames, teamIds: selectedTeams })}
            style={{
              borderRadius: 10,
              border: '1px solid rgba(255,70,85,.72)',
              background: 'linear-gradient(135deg, rgba(255,70,85,.26), rgba(255,70,85,.14))',
              color: '#ffe8eb',
              fontSize: 12,
              fontWeight: 800,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            Tercihleri Kaydet
          </button>
        </div>
      </div>
    </div>
  )
})

function scoutSignalLine(story) {
  const source = story?.source || {}
  if (source.impactTeam) {
    return `🧭 Scout: ${source.impactTeam}${source.impactScore != null ? ` MVP ${source.impactScore}` : ' one cikiyor'}`
  }
  if (source.favorite) {
    return `🧭 Scout: Model favorisi ${source.favorite}${source.predictionEdge != null ? ` (+${source.predictionEdge})` : ''}`
  }
  if (source.mapCount || source.mapTempo) {
    return `🧭 Scout: ${source.mapCount || '?'} map · ${source.mapTempo || 'tempo dengeli'}`
  }
  return null
}

const LiveTicker = memo(function LiveTicker({ items, loading, onItemOpen }) {
  const [ripple, setRipple] = useState({ key: null, token: 0, x: 0, y: 0 })
  const safeItems = (items || []).filter(Boolean)
  const normalized = safeItems.map((item, idx) => (typeof item === 'string'
    ? { id: `text_${idx}`, text: item, href: null }
    : {
      id: item.id || `line_${idx}`,
      text: item.text || '',
      href: item.href || null,
    }))
  const lines = safeItems.length > 0
    ? normalized
    : [
      { id: 'boot_live', text: '🔴 LIVE ticker baglaniyor...', href: null },
      { id: 'boot_news', text: '📰 Son haberler hazirlaniyor...', href: null },
      { id: 'boot_scout', text: '🧭 Scout sinyalleri yukleniyor...', href: null },
    ]
  const speedSeconds = Math.min(75, Math.max(24, lines.length * 4.2))

  const handleLineClick = (event, line, idx) => {
    if (!line?.href) return

    const rect = event.currentTarget.getBoundingClientRect()
    const token = Date.now()
    setRipple({
      key: `${line.id}_${idx}`,
      token,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })

    window.setTimeout(() => {
      setRipple(prev => (prev.token === token ? { key: null, token: 0, x: 0, y: 0 } : prev))
    }, 420)

    onItemOpen?.(line)
  }

  return (
    <div style={{ marginBottom: 14, borderRadius: 12, border: '1px solid rgba(255,70,85,.22)', background: 'linear-gradient(90deg, rgba(255,70,85,.12), rgba(12,12,12,.95))', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderBottom: '1px solid rgba(255,70,85,.15)', background: 'rgba(0,0,0,.22)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4655', boxShadow: '0 0 10px rgba(255,70,85,.8)', animation: 'liveNeonBlink 1.05s infinite' }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: '#ff95a0', textTransform: 'uppercase', letterSpacing: '.9px' }}>
          Live Ticker {loading ? '· senkronize ediliyor' : ''}
        </span>
      </div>

      <div style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'inline-flex', minWidth: 'max-content', animation: `tickerScroll ${speedSeconds}s linear infinite` }}>
          {[...lines, ...lines].map((line, idx) => (
            <button
              key={`${line.id}_${idx}`}
              onClick={event => handleLineClick(event, line, idx)}
              style={{
                position: 'relative',
                overflow: 'hidden',
                fontSize: 12,
                color: line.href ? '#ffe8ea' : '#f5d6da',
                padding: '9px 16px',
                borderRight: '1px solid rgba(255,255,255,.08)',
                borderTop: 'none',
                borderBottom: 'none',
                borderLeft: 'none',
                background: 'transparent',
                cursor: line.href ? 'pointer' : 'default',
                transition: 'background .16s, transform .16s, color .16s',
              }}
              onMouseEnter={e => {
                if (!line.href) return
                e.currentTarget.style.background = 'rgba(255,255,255,.08)'
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.color = '#fff4f6'
              }}
              onMouseLeave={e => {
                if (!line.href) return
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.color = '#ffe8ea'
              }}
            >
              {line.text}
              {ripple.key === `${line.id}_${idx}` && (
                <span
                  style={{
                    position: 'absolute',
                    left: ripple.x,
                    top: ripple.y,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,.55)',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                    animation: 'dashRipple .42s ease-out forwards',
                  }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})

const QuickAccessBar = memo(function QuickAccessBar({ entries, loading, onOpen }) {
  const [ripple, setRipple] = useState({ key: null, token: 0, x: 0, y: 0 })

  const handleEntryOpen = (event, entry) => {
    const key = `${entry.type}_${entry.id}`
    const rect = event.currentTarget.getBoundingClientRect()
    const token = Date.now()
    setRipple({
      key,
      token,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })

    window.setTimeout(() => {
      setRipple(prev => (prev.token === token ? { key: null, token: 0, x: 0, y: 0 } : prev))
    }, 420)

    onOpen(entry)
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', overflowX: 'auto', paddingBottom: 2 }}>
        {[1, 2, 3, 4, 5].map(i => <Sk key={i} w="42px" h="42px" r="999px" />)}
      </div>
    )
  }

  if (!entries?.length) return null

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#8f8f8f', letterSpacing: '.9px', textTransform: 'uppercase', marginBottom: 8 }}>
        Hızlı Erişim
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', overflowX: 'auto', paddingBottom: 3 }}>
        {entries.map(entry => (
          <button
            key={`${entry.type}_${entry.id}`}
            onClick={event => handleEntryOpen(event, entry)}
            title={entry.label}
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              flexShrink: 0,
              border: entry.isLive ? '1.5px solid rgba(255,70,85,.75)' : '1px solid #2a2a2a',
              boxShadow: entry.isLive ? '0 0 16px rgba(255,70,85,.42)' : 'none',
              background: '#101010',
              cursor: 'pointer',
              padding: 0,
              position: 'relative',
              overflow: 'hidden',
              transition: 'transform .16s, box-shadow .16s, border-color .16s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px) scale(1.04)'
              e.currentTarget.style.boxShadow = entry.isLive
                ? '0 0 20px rgba(255,70,85,.5)'
                : '0 0 14px rgba(255,255,255,.12)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0) scale(1)'
              e.currentTarget.style.boxShadow = entry.isLive ? '0 0 16px rgba(255,70,85,.42)' : 'none'
            }}
          >
            {entry.image
              ? <img src={entry.image} alt={entry.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 11, fontWeight: 800, color: '#d4d4d4' }}>{entry.fallback || '?'}</span>}

            {ripple.key === `${entry.type}_${entry.id}` && (
              <span
                style={{
                  position: 'absolute',
                  left: ripple.x,
                  top: ripple.y,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,.55)',
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                  animation: 'dashRipple .42s ease-out forwards',
                }}
              />
            )}

            {entry.isLive && (
              <span style={{
                position: 'absolute',
                right: 2,
                bottom: 2,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#ff4655',
                boxShadow: '0 0 10px rgba(255,70,85,.95)',
                animation: 'liveNeonBlink 1.05s infinite',
              }} />
            )}
          </button>
        ))}
      </div>
    </div>
  )
})

/* ── FavoritesBar ─────────────────────────────────────────────────────────── */
const FavoritesBar = memo(function FavoritesBar({ onMatchClick, showAllTournamentTiers }) {
  const { followedTeamIds, toggleTeamFollow, isTeamFollowed } = useUser()
  const favTeamIds = followedTeamIds
  const [matches,    setMatches]    = useState([])
  const [loading,    setLoading]    = useState(false)

  useEffect(() => {
    if (!favTeamIds.length) { setMatches([]); return }
    setLoading(true)
    const orFilter = favTeamIds
      .flatMap(id => [`team_a_id.eq.${id}`, `team_b_id.eq.${id}`])
      .join(',')
    supabase.from('matches').select(`
      id, status, scheduled_at, team_a_id, team_b_id, winner_id,
      team_a_score, team_b_score,
      ai_prediction, prediction_team_a, prediction_team_b, prediction_confidence,
      team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
      team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
      tournament:tournaments(id,name,tier), game:games(id,name)
    `).or(orFilter)
      .order('scheduled_at', { ascending: true })
      .limit(20)
      .then(({ data }) => {
        const tierFiltered = filterMatchesByTournamentTier(data || [], showAllTournamentTiers)
        setMatches(tierFiltered)
        setLoading(false)
      })
  }, [favTeamIds, showAllTournamentTiers])

  if (!favTeamIds.length) return null

  return (
    <div style={{ marginBottom: 24 }}>

      {/* ── Başlık satırı ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 12px', borderRadius: 20,
          background: 'linear-gradient(135deg,rgba(255,215,0,.15),rgba(255,165,0,.07))',
          border: '1px solid rgba(255,215,0,.4)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: '#ffe19a', border: '1px solid rgba(255,215,0,.45)', borderRadius: 999, padding: '1px 6px', background: 'rgba(255,215,0,.14)', letterSpacing: '.5px' }}>FAV</span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', color: '#FFD700', textTransform: 'uppercase' }}>
            Favorites Grid
          </span>
          <span style={{ padding: '1px 6px', borderRadius: 8, background: 'rgba(255,215,0,.25)', color: '#FFD700', fontSize: 10, fontWeight: 700 }}>
            {favTeamIds.length}
          </span>
        </div>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,215,0,.25),transparent)' }} />
      </div>

      {/* ── Yatay kart şeridi ── */}
      {loading ? (
        /* iskelet */
        <div style={{ display: 'flex', gap: 10, overflow: 'hidden' }}>
          {[1,2,3].map(i => <Sk key={i} w="200px" h="104px" r="14px" />)}
        </div>
      ) : matches.length === 0 ? (
        <div style={{
          padding: '14px 18px', borderRadius: 12,
          background: 'rgba(255,215,0,.04)', border: '1px dashed rgba(255,215,0,.18)',
          fontSize: 11, color: '#3a3a2a', textAlign: 'center',
        }}>
          Takip ettiğin takımların yaklaşan maçı yok
        </div>
      ) : (
        /* ← YATAY SCROLL — overflowX:auto + scrollbarWidth:none */
        <div style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',      /* yatay scroll aktif */
          overflowY: 'hidden',    /* dikey taşmayı kes   */
          paddingBottom: 6,
          scrollbarWidth: 'none', /* Firefox             */
          msOverflowStyle: 'none',/* IE / Edge           */
          WebkitOverflowScrolling: 'touch', /* iOS momentum */
        }}>
          {matches.map(m => {
            const isLive = m.status === 'running'
            const isFin  = m.status === 'finished'
            const aWon   = isFin && m.winner_id === (m.team_a_id || m.team_a?.id)
            const bWon   = isFin && m.winner_id === (m.team_b_id || m.team_b?.id)
            const favA   = isTeamFollowed(m.team_a_id || m.team_a?.id)
            const favB   = isTeamFollowed(m.team_b_id || m.team_b?.id)
            return (
              <div
                key={m.id}
                onClick={() => onMatchClick(m.id)}
                style={{
                  flexShrink: 0,          /* kartlar küçülmesin */
                  width: 200,
                  borderRadius: 14,
                  padding: '12px 12px 10px',
                  background: '#111',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  border: isLive
                    ? '1.5px solid rgba(255,70,85,.35)'
                    : '1.5px solid rgba(255,215,0,.15)',
                  transition: 'transform .15s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
              >
                {/* üst renk çizgisi */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: isLive
                    ? 'linear-gradient(90deg,#FF4655,#ff7043)'
                    : 'linear-gradient(90deg,#FFD700,#FF8C00)',
                }} />

                {/* oyun + durum */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.game?.name || '—'}
                    </span>
                    <MatchImpactPill match={m} compact />
                  </div>
                  {isLive  && <span style={{ fontSize: 9, fontWeight: 800, color: '#FF4655', animation: 'livePulse 1.2s infinite' }}>● LIVE</span>}
                  {!isLive && !isFin && <span style={{ fontSize: 9, color: '#444' }}>{fmtTime(m.scheduled_at)}</span>}
                  {isFin   && <span style={{ fontSize: 9, color: '#2a2a2a' }}>Bitti</span>}
                </div>

                {/* takımlar */}
                {[
                  { team: m.team_a, won: aWon, lost: bWon, fav: favA, score: m.team_a_score },
                  { team: m.team_b, won: bWon, lost: aWon, fav: favB, score: m.team_b_score },
                ].map((row, ri) => (
                  <div key={ri} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    marginBottom: ri === 0 ? 4 : 0,
                    opacity: isFin && row.lost ? 0.4 : 1,
                  }}>
                    {row.team?.logo_url
                      ? <img src={row.team.logo_url} alt="" style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} />
                      : <div style={{ width: 20, height: 20, background: '#1e1e1e', borderRadius: 4, flexShrink: 0 }} />
                    }
                    <span style={{
                      fontSize: 11, fontWeight: row.won ? 700 : 500,
                      color: row.won ? '#4CAF50' : row.fav ? '#FFD700' : '#ccc',
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {row.fav ? '◆ ' : ''}
                      {row.team?.name || '?'}
                    </span>
                    {(isLive || isFin) && (
                      <span style={{ fontSize: 12, fontWeight: 900, color: row.won ? '#4CAF50' : '#444', fontVariantNumeric: 'tabular-nums' }}>
                        {row.score ?? 0}
                      </span>
                    )}
                  </div>
                ))}

                {/* turnuva */}
                <div style={{ marginTop: 7, fontSize: 9, color: '#2a2a2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.tournament?.name || ''}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* webkit scrollbar gizle */}
      <style>{`
        .fav-scroll::-webkit-scrollbar { display: none }
        @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:.35} }
      `}</style>
    </div>
  )
})
/*
 * Kartı şişirmemek için:
 *  - Yükseklik minimal (bar 3px, yazılar 8px)
 *  - marginTop 6px (eski 8px → 6px)
 *  - Hot Pick badge kaldırıldı (badge Dashboard card'da değil UpcomingMatches'ta uygun)
 */
function WinBar({ predA, predB, confidence }) {
  if (predA == null || predB == null) return null
  const total = (predA + predB) || 1
  const pctA  = Math.round((predA / total) * 100)
  const pctB  = 100 - pctA
  const aFav  = pctA > pctB
  const isHot = confidence != null && confidence > 0.80

  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #1a1a1a' }}>
      {/* İnce progress bar */}
      <div style={{
        display: 'flex', height: 3, borderRadius: 2,
        overflow: 'hidden', background: '#1a1a1a',
        marginBottom: 3,
      }}>
        <div style={{ width: `${pctA}%`, background: aFav ? '#a78bfa' : '#333', transition: 'width .5s' }} />
        <div style={{ width: `${pctB}%`, background: !aFav ? '#a78bfa' : '#333', transition: 'width .5s' }} />
      </div>

      {/* Yüzde + AI etiketi */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 8, color: aFav ? '#a78bfa' : '#383838', fontWeight: aFav ? 700 : 400 }}>
          {pctA}%
        </span>
        <span style={{ fontSize: 8, color: isHot ? '#ff8c42' : '#2a2a2a', fontWeight: isHot ? 700 : 400 }}>
          {isHot ? '🔥 AI' : 'AI'}
        </span>
        <span style={{ fontSize: 8, color: !aFav ? '#a78bfa' : '#383838', fontWeight: !aFav ? 700 : 400 }}>
          {pctB}%
        </span>
      </div>
    </div>
  )
}

function MatchImpactPill({ match, compact = false }) {
  const label = getMatchImpactLabel(match)
  if (!label) return null

  return (
    <span
      title={`AI Guven: %${label.confidencePct}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        padding: compact ? '2px 7px' : '3px 8px',
        border: `1px solid ${label.border}`,
        background: label.bg,
        color: label.color,
        fontSize: compact ? 8 : 9,
        fontWeight: 800,
        letterSpacing: '.35px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label.text}
    </span>
  )
}

/* ── LiveMatchCard ────────────────────────────────────────────────────────── */
const LiveMatchCard = memo(function LiveMatchCard({ match: m, onMatchClick, favs, onToggleFav }) {
  const isLive     = m.status === 'running'
  const isFin      = m.status === 'finished'
  const aggressiveLiveMode = isLive && !isFin
  const aId        = m.team_a_id || m.team_a?.id
  const bId        = m.team_b_id || m.team_b?.id
  const aWon       = isFin && m.winner_id === aId
  const bWon       = isFin && m.winner_id === bId
  const favA       = favs.includes(aId)
  const favB       = favs.includes(bId)
  const turkA      = isTurkishTeam(m.team_a?.name ?? '')
  const turkB      = isTurkishTeam(m.team_b?.name ?? '')
  const hasTurkish = turkA || turkB

  return (
    <div
      onClick={() => onMatchClick(m.id)}
      style={{
        position: 'relative',
        borderRadius: 16,
        /* TR banner varsa üstten 22px fazla boşluk */
        padding: hasTurkish ? '30px 16px 14px' : '14px 16px',
        background: aggressiveLiveMode
          ? 'linear-gradient(165deg, rgba(33,6,9,.96), rgba(15,15,15,.98) 44%, rgba(37,13,17,.95))'
          : 'linear-gradient(160deg,#141414,#0e0e0e)',
        cursor: 'pointer',
        border: aggressiveLiveMode ? '1.5px solid rgba(255,70,85,.72)' : '1.5px solid rgba(255,70,85,.4)',
        boxShadow: aggressiveLiveMode
          ? '0 0 0 1px rgba(255,70,85,.3), 0 0 26px rgba(255,70,85,.3), 0 0 56px rgba(255,70,85,.18)'
          : isLive
            ? '0 0 0 1px rgba(255,70,85,.18), 0 0 24px rgba(255,70,85,.16), 0 0 42px rgba(255,70,85,.09)'
          : '0 0 16px rgba(255,70,85,.07)',
        transition: 'all .18s',
        /* kart yüksekliği içerikle büyüsün, min sabit */
        minHeight: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,70,85,.75)'; e.currentTarget.style.transform = 'translateY(-3px)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,70,85,.4)';  e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {/* Üst kırmızı çizgi */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: 'linear-gradient(90deg,#FF4655,#ff7043,transparent)',
        borderRadius: '14px 14px 0 0',
      }} />

      {/* TR banner */}
      {hasTurkish && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 22,
          borderRadius: '14px 14px 0 0',
          background: 'linear-gradient(90deg,#E30A17,#c40911)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: 'white', letterSpacing: '.8px', textTransform: 'uppercase' }}>
            🇹🇷 Turkish
          </span>
        </div>
      )}

      {/* Oyun + LIVE */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{
            padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700,
            letterSpacing: '.7px', textTransform: 'uppercase',
            background: 'rgba(255,70,85,.15)', color: '#FF4655',
            whiteSpace: 'nowrap',
          }}>
            {m.game?.name || '—'}
          </span>
          <MatchImpactPill match={m} />
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, color: '#ff7683' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#FF4655', boxShadow: '0 0 10px rgba(255,70,85,.9)', animation: 'liveNeonBlink 1.05s infinite' }} />
          LIVE
        </span>
      </div>

      {aggressiveLiveMode && (
        <div style={{
          marginBottom: 8,
          borderRadius: 9,
          border: '1px solid rgba(255,70,85,.55)',
          background: 'linear-gradient(120deg, rgba(255,70,85,.28), rgba(32,8,10,.95))',
          color: '#ffd8dd',
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '.55px',
          textTransform: 'uppercase',
          padding: '4px 7px',
          textAlign: 'center',
        }}>
          Agresif Canli Mod
        </div>
      )}

      {/* Teams + Score — 3 sütunlu grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,   /* WinBar için küçük boşluk */
      }}>
        {/* Team A */}
        <div style={{ textAlign: 'center', opacity: isFin && bWon ? 0.45 : 1 }}>
          {m.team_a?.logo_url
            ? <img src={m.team_a.logo_url} alt="" style={{ width: 36, height: 36, objectFit: 'contain', display: 'block', margin: '0 auto 4px' }} />
            : <div style={{ width: 36, height: 36, background: '#1a1a1a', borderRadius: 8, margin: '0 auto 4px' }} />
          }
          <div style={{
            fontSize: 10, fontWeight: 700, lineHeight: 1.2,
            color: aWon ? '#4CAF50' : favA ? '#FFD700' : '#ccc',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {m.team_a?.name || '?'}{turkA && ' 🇹🇷'}
          </div>
          {favA && (
            <button
              onClick={e => { e.stopPropagation(); onToggleFav(aId) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#FFD700', padding: '1px 0', display: 'block', margin: '0 auto' }}
            >⭐</button>
          )}
        </div>

        {/* Score */}
        <div style={{
          textAlign: 'center',
          flexShrink: 0,
          padding: aggressiveLiveMode ? '6px 8px' : '0 4px',
          borderRadius: aggressiveLiveMode ? 10 : 0,
          border: aggressiveLiveMode ? '1px solid rgba(255,70,85,.42)' : 'none',
          background: aggressiveLiveMode ? 'radial-gradient(circle at 50% 8%, rgba(255,70,85,.28), rgba(15,15,15,.96) 60%)' : 'transparent',
          boxShadow: aggressiveLiveMode ? 'inset 0 0 16px rgba(255,70,85,.16)' : 'none',
        }}>
          <div style={{
            fontSize: aggressiveLiveMode ? 30 : 20,
            fontWeight: 900,
            color: aggressiveLiveMode ? '#ffe5e8' : '#fff',
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px', lineHeight: 1,
            textShadow: aggressiveLiveMode ? '0 0 14px rgba(255,120,130,.35)' : 'none',
          }}>
            {m.team_a_score ?? 0}
            <span style={{ color: '#2a2a2a', margin: '0 3px' }}>:</span>
            {m.team_b_score ?? 0}
          </div>
          <div style={{
            fontSize: 8, color: '#2a2a2a', marginTop: 3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 72,
          }}>
            {m.tournament?.name || ''}
          </div>
        </div>

        {/* Team B */}
        <div style={{ textAlign: 'center', opacity: isFin && aWon ? 0.45 : 1 }}>
          {m.team_b?.logo_url
            ? <img src={m.team_b.logo_url} alt="" style={{ width: 36, height: 36, objectFit: 'contain', display: 'block', margin: '0 auto 4px' }} />
            : <div style={{ width: 36, height: 36, background: '#1a1a1a', borderRadius: 8, margin: '0 auto 4px' }} />
          }
          <div style={{
            fontSize: 10, fontWeight: 700, lineHeight: 1.2,
            color: bWon ? '#4CAF50' : favB ? '#FFD700' : '#ccc',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {m.team_b?.name || '?'}{turkB && ' 🇹🇷'}
          </div>
          {favB && (
            <button
              onClick={e => { e.stopPropagation(); onToggleFav(bId) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#FFD700', padding: '1px 0', display: 'block', margin: '0 auto' }}
            >⭐</button>
          )}
        </div>
      </div>

      {/* ── AI WinBar — kartın en altında ince şerit ── */}
      {!MVP_HIDE_PREDICTIONS && (
        <WinBar
          predA={m.prediction_team_a}
          predB={m.prediction_team_b}
          confidence={m.prediction_confidence}
        />
      )}
    </div>
  )
})

/* ── UpcomingRow ──────────────────────────────────────────────────────────── */
const UpcomingRow = memo(function UpcomingRow({ match: m, onMatchClick }) {
  const badge = getStatusBadge(m.status)
  const isLive = m.status === 'running'
  const turkA = isTurkishTeam(m.team_a?.name ?? '')
  const turkB = isTurkishTeam(m.team_b?.name ?? '')
  return (
    <div
      onClick={() => onMatchClick(m.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px', borderRadius: 12, cursor: 'pointer',
        background: '#0e0e0e',
        border: isLive ? '1px solid rgba(255,70,85,.52)' : '1px solid #181818',
        boxShadow: isLive ? '0 0 14px rgba(255,70,85,.18)' : 'none',
        transition: 'all .15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = '#141414'
        e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.8)' : '#2a2a2a'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = '#0e0e0e'
        e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.52)' : '#181818'
      }}
    >
      {/* Saat */}
      <div style={{ fontSize: 10, color: '#555', flexShrink: 0, width: 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {fmtTime(m.scheduled_at)}
      </div>

      {/* Oyun etiketi */}
      <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: '#181818', color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', flexShrink: 0 }}>
        {m.game?.name?.slice(0, 3).toUpperCase() || '—'}
      </span>

      {isLive && (
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#ff4655',
          boxShadow: '0 0 10px rgba(255,70,85,.95)',
          animation: 'liveNeonBlink 1.05s infinite',
          flexShrink: 0,
        }} />
      )}

      {/* Teams */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
        {m.team_a?.logo_url && (
          <img src={m.team_a.logo_url} alt="" style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }} />
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: turkA ? '#ff6b7a' : '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
          {m.team_a?.name || '?'}{turkA && ' 🇹🇷'}
        </span>
        <span style={{ fontSize: 9, color: '#2a2a2a', flexShrink: 0 }}>vs</span>
        {m.team_b?.logo_url && (
          <img src={m.team_b.logo_url} alt="" style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }} />
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: turkB ? '#ff6b7a' : '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
          {m.team_b?.name || '?'}{turkB && ' 🇹🇷'}
        </span>
      </div>

      {/* Turnuva */}
      <div style={{ fontSize: 9, color: '#2a2a2a', flexShrink: 0, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
        {m.tournament?.name || ''}
      </div>

      <MatchImpactPill match={m} compact />

      {/* Badge */}
      <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 8, fontWeight: 700, color: badge.color, background: badge.bg, flexShrink: 0 }}>
        {badge.text}
      </span>
    </div>
  )
})

/* ══════════════════════════════════════════════════════════════════════════════
   Dashboard — default export
══════════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const navigate       = useNavigate()
  const { activeGame } = useGame()
  const {
    followedTeamIds,
    followedPlayerIds,
    followedGames,
    toggleTeamFollow,
    setFollowedTeams,
    setFollowedGames,
  } = useUser()

  const [liveMatches,     setLiveMatches]     = useState([])
  const [upcomingMatches, setUpcomingMatches] = useState([])
  const [myFeedMatches,   setMyFeedMatches]   = useState([])
  const [liveFavCount,    setLiveFavCount]    = useState(0)
  const [showAllTournamentTiers, setShowAllTournamentTiers] = useState(false)
  const [quickAccess, setQuickAccess] = useState([])
  const [quickLoading, setQuickLoading] = useState(false)
  const [tickerItems, setTickerItems] = useState([])
  const [tickerLoading, setTickerLoading] = useState(false)
  const [dreamTeam, setDreamTeam] = useState([])
  const [dreamLoading, setDreamLoading] = useState(false)
  const [stats,           setStats]           = useState({ total: 0, live: 0, today: 0, teams: 0 })
  const [accuracyRows, setAccuracyRows] = useState([])
  const [accuracyLoading, setAccuracyLoading] = useState(false)
  const [loading,         setLoading]         = useState(true)
  const [globalError, setGlobalError] = useState('')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 920)
  const [showPreferenceWizard, setShowPreferenceWizard] = useState(false)
  const [popularTeams, setPopularTeams] = useState([])
  const [popularTeamsLoading, setPopularTeamsLoading] = useState(false)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 920)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const showGlobalConnectionWarning = useCallback((scope, error) => {
    console.error(`${scope}:`, error?.message || error)
    setGlobalError(DASHBOARD_GLOBAL_ERROR_TEXT)
  }, [])

  useEffect(() => {
    if (!globalError) return undefined
    const timer = window.setTimeout(() => setGlobalError(''), 5500)
    return () => window.clearTimeout(timer)
  }, [globalError])

  const markPreferenceWizardSeen = useCallback(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DASHBOARD_PREF_WIZARD_SEEN_KEY, '1')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const seen = window.localStorage.getItem(DASHBOARD_PREF_WIZARD_SEEN_KEY)
    if (!seen) setShowPreferenceWizard(true)
  }, [])

  useEffect(() => {
    if (!showPreferenceWizard) return

    let cancelled = false

    async function fetchPopularTeams() {
      setPopularTeamsLoading(true)
      try {
        const searchFilter = POPULAR_TEAM_SEARCH_TERMS.map(term => `name.ilike.%${term}%`).join(',')

        let { data, error } = await supabase
          .from('teams')
          .select('id,name,logo_url,game:games(name,slug)')
          .or(searchFilter)
          .limit(18)

        if (error) throw error

        if (!data || data.length === 0) {
          const fallbackRes = await supabase
            .from('teams')
            .select('id,name,logo_url,game:games(name,slug)')
            .order('name', { ascending: true })
            .limit(12)

          if (fallbackRes.error) throw fallbackRes.error
          data = fallbackRes.data || []
        }

        const rank = name => {
          const normalized = String(name || '').toLowerCase()
          const idx = POPULAR_TEAM_SEARCH_TERMS.findIndex(term => normalized.includes(term))
          return idx < 0 ? 99 : idx
        }

        const prepared = [...(data || [])]
          .sort((a, b) => {
            const diff = rank(a.name) - rank(b.name)
            if (diff !== 0) return diff
            return String(a.name || '').localeCompare(String(b.name || ''), 'tr')
          })
          .slice(0, 12)

        if (!cancelled) setPopularTeams(prepared)
      } catch (e) {
        if (!cancelled) setPopularTeams([])
        console.error('Dashboard preferences teams fetch:', e?.message || e)
      } finally {
        if (!cancelled) setPopularTeamsLoading(false)
      }
    }

    fetchPopularTeams()
    return () => { cancelled = true }
  }, [showPreferenceWizard])

  const handlePreferenceWizardClose = useCallback(() => {
    markPreferenceWizardSeen()
    setShowPreferenceWizard(false)
  }, [markPreferenceWizardSeen])

  const handlePreferenceWizardSave = useCallback(({ gameIds, teamIds }) => {
    setFollowedGames(gameIds || [])
    setFollowedTeams(teamIds || [])
    markPreferenceWizardSeen()
    setShowPreferenceWizard(false)
  }, [setFollowedGames, setFollowedTeams, markPreferenceWizardSeen])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const nowIso = new Date().toISOString()

      const selectStr = `
        id, status, scheduled_at,
        team_a_id, team_b_id, winner_id, team_a_score, team_b_score,
        ai_prediction, prediction_team_a, prediction_team_b, prediction_confidence,
        team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
        team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
        tournament:tournaments(id,name,tier),
        game:games(id,name)
      `
      const [liveRes, upcomingRes] = await Promise.all([
        supabase.from('matches').select(selectStr)
          .eq('status', 'running')
          .order('scheduled_at', { ascending: true })
          .limit(18),
        supabase.from('matches').select(selectStr)
          .eq('status', 'not_started')
          .gt('scheduled_at', nowIso)
          .order('scheduled_at', { ascending: true })
          .limit(30),
      ])

      if (liveRes.error) throw liveRes.error
      if (upcomingRes.error) throw upcomingRes.error

      const baseLive = (liveRes.data || []).filter(m => gameMatchesFilter(m.game?.name || '', activeGame))
      const baseUpcoming = (upcomingRes.data || []).filter(m => gameMatchesFilter(m.game?.name || '', activeGame))
      const live = filterMatchesByTournamentTier(baseLive, showAllTournamentTiers)
      const upcoming = filterMatchesByTournamentTier(baseUpcoming, showAllTournamentTiers)

      setLiveMatches(live)
      setUpcomingMatches(upcoming)
      setGlobalError('')
    } catch (e) { showGlobalConnectionWarning('Dashboard fetch', e) }
    finally     { setLoading(false) }
  }, [activeGame, showAllTournamentTiers, showGlobalConnectionWarning])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const timer = window.setInterval(() => { fetchData() }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [fetchData])

  useEffect(() => {
    setStats({
      live:  liveMatches.length,
      today: upcomingMatches.length,
      total: liveMatches.length + upcomingMatches.length,
      teams: new Set([...liveMatches, ...upcomingMatches].flatMap(m => [m.team_a_id, m.team_b_id]).filter(Boolean)).size,
    })
  }, [liveMatches, upcomingMatches])

  useEffect(() => {
    let cancelled = false

    async function fetchFinishedAccuracyRows() {
      setAccuracyLoading(true)
      try {
        let selectColumns = 'id,status,winner_id,team_a_id,team_b_id,ai_prediction,prediction_team_a,prediction_team_b,prediction_confidence'
        let retriedWithoutAiPrediction = false

        const runQuery = async () => {
          return supabase
            .from('matches')
            .select(selectColumns)
            .eq('status', 'finished')
            .not('winner_id', 'is', null)
            .order('scheduled_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(30)
        }

        let { data, error } = await runQuery()

        if (error) {
          const message = String(error.message || '').toLowerCase()
          if (!retriedWithoutAiPrediction && message.includes('ai_prediction')) {
            retriedWithoutAiPrediction = true
            selectColumns = 'id,status,winner_id,team_a_id,team_b_id,prediction_team_a,prediction_team_b,prediction_confidence'
            const fallbackResult = await runQuery()
            data = fallbackResult.data
            error = fallbackResult.error
          }
        }

        if (error) throw error
        if (!cancelled) {
          setAccuracyRows(data || [])
          setGlobalError('')
        }
      } catch (e) {
        showGlobalConnectionWarning('Dashboard accuracy fetch', e)
        if (!cancelled) setAccuracyRows([])
      } finally {
        if (!cancelled) setAccuracyLoading(false)
      }
    }

    fetchFinishedAccuracyRows()
    const timer = window.setInterval(fetchFinishedAccuracyRows, DASHBOARD_ACCURACY_REFRESH_MIN_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [showGlobalConnectionWarning])

  const handleToggleFav = useCallback((teamId) => {
    if (!teamId) return
    toggleTeamFollow(teamId)
  }, [toggleTeamFollow])

  const handleMatchOpen = useCallback((matchId) => {
    if (!matchId) return
    navigate(`/match/${matchId}`)
  }, [navigate])

  const handleQuickAccessOpen = useCallback((entry) => {
    if (!entry) return
    if (entry.matchId) {
      navigate(`/match/${entry.matchId}`)
      return
    }
    if (entry.type === 'team') {
      navigate(`/team/${entry.id}`)
      return
    }
    navigate(`/player/${entry.id}`)
  }, [navigate])

  const handleTickerItemOpen = useCallback((item) => {
    if (!item?.href) return
    navigate(item.href)
  }, [navigate])

  useEffect(() => {
    let active = true

    const unsubscribe = subscribeToMatchesUpdates(payload => {
      if (!active) return

      const nextRow = payload?.new
      const oldRow = payload?.old || {}
      if (!nextRow?.id) return

      const scoreChanged =
        oldRow.team_a_score !== nextRow.team_a_score ||
        oldRow.team_b_score !== nextRow.team_b_score ||
        oldRow.status !== nextRow.status ||
        oldRow.winner_id !== nextRow.winner_id

      if (!scoreChanged) return

      setLiveMatches(prev => patchMatchCollection(prev, nextRow).filter(match => match.status === 'running'))
      setUpcomingMatches(prev => patchMatchCollection(prev, nextRow).filter(match => match.status === 'not_started'))
      setMyFeedMatches(prev => {
        const patched = patchMatchCollection(prev, nextRow).filter(match => match.status === 'running' || match.status === 'not_started')
        setLiveFavCount(patched.filter(match => match.status === 'running').length)
        return patched
      })
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchMyFeed() {
      try {
        // Takip edilen oyunculardan takım ID'lerini topla.
        let teamIds = [...followedTeamIds]

        if (followedPlayerIds.length > 0) {
          const { data: playerRows } = await supabase
            .from('players')
            .select('id, team_pandascore_id')
            .in('id', followedPlayerIds)

          const playerTeamIds = (playerRows || [])
            .map(p => p.team_pandascore_id)
            .filter(Boolean)

          teamIds = [...new Set([...teamIds, ...playerTeamIds])]
        }

        if (teamIds.length === 0) {
          if (!cancelled) {
            setMyFeedMatches([])
            setLiveFavCount(0)
          }
          return
        }

        const orFilter = teamIds
          .flatMap(id => [`team_a_id.eq.${id}`, `team_b_id.eq.${id}`])
          .join(',')

        const now = new Date()
        const soon = new Date(now)
        soon.setDate(now.getDate() + 5)

        const { data } = await supabase
          .from('matches')
          .select(`
            id, status, scheduled_at,
            team_a_id, team_b_id, winner_id,
            team_a_score, team_b_score,
            ai_prediction, prediction_team_a, prediction_team_b, prediction_confidence,
            team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
            team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
            tournament:tournaments(id,name,tier),
            game:games(id,name)
          `)
          .or(orFilter)
          .in('status', ['not_started', 'running'])
          .gte('scheduled_at', now.toISOString())
          .lte('scheduled_at', soon.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(40)

        const baseFiltered = (data || []).filter(m => gameMatchesFilter(m.game?.name || '', activeGame))
        const filtered = filterMatchesByTournamentTier(baseFiltered, showAllTournamentTiers)

        if (!cancelled) {
          setMyFeedMatches(filtered)
          setLiveFavCount(filtered.filter(m => m.status === 'running').length)
          setGlobalError('')
        }
      } catch (e) {
        showGlobalConnectionWarning('Dashboard my-feed fetch', e)
      }
    }

    fetchMyFeed()
    const timer = window.setInterval(fetchMyFeed, 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [followedTeamIds, followedPlayerIds, activeGame, showAllTournamentTiers, showGlobalConnectionWarning])

  useEffect(() => {
    let cancelled = false

    async function buildQuickAccess() {
      const hasAnyFollow = followedTeamIds.length > 0 || followedPlayerIds.length > 0
      if (!hasAnyFollow) {
        setQuickAccess([])
        setQuickLoading(false)
        return
      }

      setQuickLoading(true)
      try {
        const [playersRes, teamsRes] = await Promise.all([
          followedPlayerIds.length
            ? supabase
              .from('players')
              .select('id,nickname,image_url,team_pandascore_id')
              .in('id', followedPlayerIds)
            : { data: [], error: null },
          supabase
            .from('teams')
            .select('id,name,logo_url')
            .in('id', [...new Set([...followedTeamIds, ...myFeedMatches.flatMap(m => [m.team_a_id, m.team_b_id]).filter(Boolean)])]),
        ])

        if (playersRes?.error) throw playersRes.error
        if (teamsRes?.error) throw teamsRes.error

        const teamsById = new Map((teamsRes.data || []).map(team => [String(team.id), team]))
        const teamMatchMap = new Map()
        const liveTeamSet = new Set()
        const teamFrequency = new Map()

        for (const m of myFeedMatches) {
          const ids = [m.team_a_id, m.team_b_id].filter(Boolean)
          ids.forEach(id => {
            const key = String(id)
            if (!teamMatchMap.has(key)) teamMatchMap.set(key, m.id)
            teamFrequency.set(key, (teamFrequency.get(key) || 0) + 1)
            if (m.status === 'running') liveTeamSet.add(key)
          })
        }

        const teamEntries = followedTeamIds.map(id => {
          const key = String(id)
          const team = teamsById.get(key)
          const freq = teamFrequency.get(key) || 0
          return {
            type: 'team',
            id,
            label: team?.name || `Team ${id}`,
            image: team?.logo_url || null,
            fallback: String(team?.name || 'T').slice(0, 2).toUpperCase(),
            isLive: liveTeamSet.has(key),
            matchId: teamMatchMap.get(key) || null,
            score: (liveTeamSet.has(key) ? 100 : 0) + (freq * 8) + 40,
          }
        })

        const playerEntries = (playersRes.data || []).map(player => {
          const teamKey = player.team_pandascore_id ? String(player.team_pandascore_id) : null
          const freq = teamKey ? (teamFrequency.get(teamKey) || 0) : 0
          return {
            type: 'player',
            id: player.id,
            label: player.nickname || 'Player',
            image: player.image_url || null,
            fallback: String(player.nickname || 'P').slice(0, 2).toUpperCase(),
            isLive: teamKey ? liveTeamSet.has(teamKey) : false,
            matchId: teamKey ? (teamMatchMap.get(teamKey) || null) : null,
            score: (teamKey && liveTeamSet.has(teamKey) ? 90 : 0) + (freq * 6) + 30,
          }
        })

        const merged = [...teamEntries, ...playerEntries]
          .sort((a, b) => b.score - a.score)
          .slice(0, 14)

        if (!cancelled) setQuickAccess(merged)
      } catch (e) {
        if (!cancelled) setQuickAccess([])
        console.error('Dashboard quick-access build:', e?.message || e)
      } finally {
        if (!cancelled) setQuickLoading(false)
      }
    }

    buildQuickAccess()
    return () => { cancelled = true }
  }, [followedTeamIds, followedPlayerIds, myFeedMatches])

  useEffect(() => {
    let cancelled = false
    const followScope = [...(followedTeamIds || [])].map(id => String(id)).sort().join('-') || 'none'
    const gameScope = [...(followedGames || [])].map(id => String(id)).sort().join('-') || 'none'
    const cacheScope = `${activeGame || 'all'}_${showAllTournamentTiers ? 'all' : 'hero'}_${followScope}_${gameScope}`

    // Stale-while-revalidate: show cached ticker/news immediately, then refresh in background.
    const cachedTicker = safeReadCache(DASHBOARD_TICKER_CACHE_KEY)
    if (isFreshCache(cachedTicker, cacheScope) && Array.isArray(cachedTicker?.items) && cachedTicker.items.length > 0) {
      setTickerItems(cachedTicker.items)
      setTickerLoading(false)
    } else {
      const cachedNews = safeReadCache(DASHBOARD_NEWS_CACHE_KEY)
      if (isFreshCache(cachedNews, cacheScope)) {
        const cachedLines = buildTickerLines([], cachedNews.finishedStories || [], cachedNews.upcomingStories || [], followedTeamIds, followedGames)
        if (cachedLines.length > 0) {
          setTickerItems(cachedLines.slice(0, 36))
          setTickerLoading(false)
        }
      }
    }

    async function fetchTickerFeed() {
      setTickerLoading(true)
      try {
        const nowIso = new Date().toISOString()
        const selectStr = `
          id, status, scheduled_at, winner_id,
          team_a_id, team_b_id, team_a_score, team_b_score,
          prediction_team_a, prediction_team_b,
          team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
          team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
          tournament:tournaments(id,name,tier),
          game:games(id,name,slug)
        `

        const [runningRes, finishedRes, upcomingRes] = await Promise.all([
          supabase
            .from('matches')
            .select(selectStr)
            .eq('status', 'running')
            .order('scheduled_at', { ascending: true })
            .limit(7),
          supabase
            .from('matches')
            .select(selectStr)
            .eq('status', 'finished')
            .order('scheduled_at', { ascending: false })
            .limit(8),
          supabase
            .from('matches')
            .select(selectStr)
            .eq('status', 'not_started')
            .gt('scheduled_at', nowIso)
            .order('scheduled_at', { ascending: true })
            .limit(8),
        ])

        if (runningRes.error) throw runningRes.error
        if (finishedRes.error) throw finishedRes.error
        if (upcomingRes.error) throw upcomingRes.error

        const running = filterMatchesByTournamentTier(
          (runningRes.data || []).filter(m => gameMatchesFilter(m.game?.name || m.game?.slug || '', activeGame)),
          showAllTournamentTiers
        )
        const finished = filterMatchesByTournamentTier(
          (finishedRes.data || []).filter(m => gameMatchesFilter(m.game?.name || m.game?.slug || '', activeGame)),
          showAllTournamentTiers
        )
        const upcoming = filterMatchesByTournamentTier(
          (upcomingRes.data || []).filter(m => gameMatchesFilter(m.game?.name || m.game?.slug || '', activeGame)),
          showAllTournamentTiers
        )

        let statsByMatch = new Map()
        const finishedIds = finished.map(match => match.id).filter(Boolean)
        if (finishedIds.length > 0) {
          const { data: statRows, error: statErr } = await supabase
            .from('match_stats')
            .select('match_id,team_id,stats')
            .in('match_id', finishedIds)

          if (statErr) throw statErr

          statsByMatch = new Map()
          for (const row of (statRows || [])) {
            if (!statsByMatch.has(row.match_id)) statsByMatch.set(row.match_id, [])
            statsByMatch.get(row.match_id).push(row)
          }
        }

        const finishedStories = prioritizeStoriesForYou(
          finished.slice(0, 6).map(match => buildFinishedStory(match, statsByMatch, isTurkishTeam)),
          followedTeamIds,
          followedGames,
        )
        const upcomingStories = prioritizeStoriesForYou(
          upcoming.slice(0, 5).map(match => buildUpcomingStory(match, isTurkishTeam)),
          followedTeamIds,
          followedGames,
        )
        const lines = buildTickerLines(running, finishedStories, upcomingStories, followedTeamIds, followedGames)

        if (!cancelled) {
          const prepared = lines.slice(0, 36)
          setTickerItems(prepared)

          safeWriteCache(DASHBOARD_TICKER_CACHE_KEY, {
            scope: cacheScope,
            updatedAt: Date.now(),
            items: prepared,
          })
          safeWriteCache(DASHBOARD_NEWS_CACHE_KEY, {
            scope: cacheScope,
            updatedAt: Date.now(),
            finishedStories,
            upcomingStories,
          })
        }
      } catch (e) {
        showGlobalConnectionWarning('Dashboard ticker feed', e)
        if (!cancelled) setTickerItems([])
      } finally {
        if (!cancelled) setTickerLoading(false)
      }
    }

    fetchTickerFeed()
    const timer = setInterval(fetchTickerFeed, 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activeGame, followedTeamIds, followedGames, showAllTournamentTiers, showGlobalConnectionWarning])

  useEffect(() => {
    if (MVP_HIDE_DREAM_TEAM) {
      setDreamTeam([])
      setDreamLoading(false)
      return
    }

    let cancelled = false

    async function fetchDreamTeam() {
      setDreamLoading(true)
      try {
        const dreamGameId = ['valorant', 'cs2', 'lol'].includes(activeGame) ? activeGame : 'valorant'
        const sinceIso = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString()

        const { data: recentMatches, error: matchesErr } = await supabase
          .from('matches')
          .select('id,scheduled_at,game:games(id,name,slug)')
          .eq('status', 'finished')
          .gte('scheduled_at', sinceIso)
          .order('scheduled_at', { ascending: false })
          .limit(1200)

        if (matchesErr) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const filteredMatchIds = (recentMatches || [])
          .filter(match => gameMatchesFilter(match.game?.name || match.game?.slug || '', dreamGameId))
          .map(match => match.id)

        if (filteredMatchIds.length === 0) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const { data: statRows, error: statErr } = await supabase
          .from('player_match_stats')
          .select('id,player_id,match_id,impact_score,stats,created_at')
          .in('match_id', filteredMatchIds)
          .limit(25000)

        if (statErr) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const getImpactScore = row => {
          if (typeof row?.impact_score === 'number' && Number.isFinite(row.impact_score)) return row.impact_score
          const nested = row?.stats || {}
          const fallback = Number(nested.impact_score ?? nested.impact ?? nested.rating ?? nested.mvp_score ?? 0)
          return Number.isFinite(fallback) ? fallback : 0
        }

        const getRowTs = row => {
          const ts = row?.created_at || row?.updated_at || row?.date || null
          if (!ts) return 0
          const ms = new Date(ts).getTime()
          return Number.isFinite(ms) ? ms : 0
        }

        const byPlayer = new Map()
        for (const row of (statRows || [])) {
          const playerId = row?.player_id
          if (!playerId) continue
          if (!byPlayer.has(playerId)) {
            byPlayer.set(playerId, { totalImpact: 0, sampleMatches: 0, latestTs: 0, lastImpact: 0 })
          }

          const impact = getImpactScore(row)
          const ts = getRowTs(row)
          const entry = byPlayer.get(playerId)
          entry.totalImpact += impact
          entry.sampleMatches += 1
          if (ts >= entry.latestTs) {
            entry.latestTs = ts
            entry.lastImpact = impact
          }
        }

        const playerIds = [...byPlayer.keys()]
        if (playerIds.length === 0) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const { data: playersRows, error: playersErr } = await supabase
          .from('players')
          .select('id,nickname,image_url,team_pandascore_id')
          .in('id', playerIds)

        if (playersErr) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const teamIds = [...new Set((playersRows || []).map(row => row.team_pandascore_id).filter(Boolean))]
        const { data: teamsRows } = teamIds.length
          ? await supabase.from('teams').select('id,name,logo_url').in('id', teamIds)
          : { data: [] }

        const playersMap = new Map((playersRows || []).map(row => [String(row.id), row]))
        const teamsMap = new Map((teamsRows || []).map(row => [String(row.id), row]))

        const ranked = [...byPlayer.entries()]
          .map(([playerId, agg]) => {
            const player = playersMap.get(String(playerId))
            if (!player || agg.sampleMatches <= 0) return null

            const avgImpact = agg.totalImpact / agg.sampleMatches
            const momentum = avgImpact > 0
              ? ((agg.lastImpact - avgImpact) / Math.max(Math.abs(avgImpact), 1)) * 100
              : 0

            const team = player.team_pandascore_id
              ? teamsMap.get(String(player.team_pandascore_id))
              : null

            return {
              id: player.id,
              nickname: player.nickname,
              image_url: player.image_url,
              team,
              avgImpact,
              sampleMatches: agg.sampleMatches,
              lastImpact: agg.lastImpact,
              momentum,
              score: avgImpact,
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.avgImpact - a.avgImpact)
          .slice(0, 5)

        if (!cancelled) setDreamTeam(ranked)
      } catch {
        if (!cancelled) setDreamTeam([])
      } finally {
        if (!cancelled) setDreamLoading(false)
      }
    }

    fetchDreamTeam()
    return () => { cancelled = true }
  }, [activeGame])

  const dreamGameLabel = activeGame === 'all'
    ? 'VAL'
    : activeGame === 'cs2'
      ? 'CS2'
      : activeGame === 'lol'
        ? 'LoL'
        : 'VAL'

  const accuracySummary = useMemo(
    () => calculatePredictionAccuracy(accuracyRows),
    [accuracyRows],
  )

  const trendSampleSize = useMemo(
    () => accuracyRows.length,
    [accuracyRows],
  )

  const preferredGameLabels = useMemo(
    () => PREFERENCE_GAMES
      .filter(game => followedGames.includes(game.id))
      .map(game => game.shortLabel),
    [followedGames],
  )

  const confidenceTone = useMemo(() => {
    const rate = accuracySummary.accuracyRate
    if (rate == null) return {
      accent: '#9aa0a6',
      border: 'rgba(120,120,120,.35)',
      bg: 'linear-gradient(120deg, rgba(120,120,120,.12), rgba(15,15,15,.95))',
      text: 'Veri toplanıyor',
    }
    if (rate >= 75) return {
      accent: '#4CAF50',
      border: 'rgba(76,175,80,.5)',
      bg: 'linear-gradient(120deg, rgba(76,175,80,.18), rgba(15,15,15,.96))',
      text: 'Model guvenli bantta',
    }
    if (rate >= 60) return {
      accent: '#FFB800',
      border: 'rgba(255,184,0,.5)',
      bg: 'linear-gradient(120deg, rgba(255,184,0,.15), rgba(15,15,15,.95))',
      text: 'Model dengeli bantta',
    }
    return {
      accent: '#FF4655',
      border: 'rgba(255,70,85,.5)',
      bg: 'linear-gradient(120deg, rgba(255,70,85,.16), rgba(15,15,15,.95))',
      text: 'Model risk bandinda',
    }
  }, [accuracySummary.accuracyRate])

  /* ── Stat tile tanımları ── */
  const statTiles = useMemo(() => [
    { icon: '🔴', value: loading ? '…' : stats.live,  label: 'Canli',    color: '#FF4655' },
    { icon: '⏳', value: loading ? '…' : stats.today, label: 'Bugun',    color: '#FFB800' },
    { icon: '🎮', value: loading ? '…' : stats.total, label: 'Toplam',   color: '#6366f1' },
    { icon: '🛡️', value: loading ? '…' : stats.teams, label: 'Takimlar', color: '#4CAF50' },
  ], [loading, stats.live, stats.today, stats.total, stats.teams])

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: isMobile ? '14px 12px 44px' : '20px 18px 60px', color: 'white' }}>

      {globalError && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 12,
          border: '1px solid rgba(255,140,154,.45)',
          background: 'linear-gradient(120deg, rgba(255,70,85,.18), rgba(15,15,15,.95))',
          color: '#ffd6dc',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '.15px',
        }}>
          ⚠️ {globalError}
        </div>
      )}

      <div style={{
        marginBottom: 12,
        padding: '10px 12px',
        borderRadius: 12,
        border: '1px solid rgba(255,70,85,.26)',
        background: 'linear-gradient(120deg, rgba(255,70,85,.1), rgba(15,15,15,.95))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#ff9aa5', letterSpacing: '.8px', textTransform: 'uppercase' }}>
            Takip Tercihleri
          </div>
          <div style={{ fontSize: 12, color: '#d6d6d6', marginTop: 3 }}>
            Oyunlar: {preferredGameLabels.length ? preferredGameLabels.join(', ') : 'Secilmedi'} · Takimlar: {followedTeamIds.length}
          </div>
        </div>
        <button
          onClick={() => setShowPreferenceWizard(true)}
          style={{
            borderRadius: 999,
            border: '1px solid rgba(255,70,85,.55)',
            background: 'rgba(255,70,85,.18)',
            color: '#ffe3e7',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '.3px',
            padding: '7px 12px',
            cursor: 'pointer',
          }}
        >
          Tercihleri Duzenle
        </button>
      </div>

      <div style={{
        marginBottom: 12,
        padding: isMobile ? '12px 12px' : '14px 14px',
        borderRadius: 14,
        border: `1px solid ${confidenceTone.border}`,
        background: confidenceTone.bg,
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1.3fr 1fr',
        gap: 12,
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: confidenceTone.accent, letterSpacing: '.9px', textTransform: 'uppercase' }}>
            Trend Guven Endeksi
          </div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 24, fontWeight: 900, color: '#f5f5f5', lineHeight: 1 }}>
              {accuracySummary.accuracyRate == null ? '--' : `%${accuracySummary.accuracyRate}`}
            </span>
            <span style={{ fontSize: 12, color: '#bebebe' }}>Son 30 Mac Tahmin Basarisi</span>
            {accuracyLoading && <span style={{ fontSize: 10, color: '#8b8b8b' }}>guncelleniyor...</span>}
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#a8a8a8' }}>
            {confidenceTone.text}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 10, color: '#8d8d8d' }}>Trend orneklem</span>
            <span style={{ fontSize: 11, color: '#f2f2f2', fontWeight: 700 }}>
              {accuracySummary.evaluatedCount}/{trendSampleSize}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ height: '100%', width: `${accuracySummary.accuracyRate ?? 0}%`, background: `linear-gradient(90deg, ${confidenceTone.accent}, #f5f5f5)`, transition: 'width .35s ease' }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: '#8b8b8b' }}>
            Dogru tahmin: {accuracySummary.correctCount}
          </div>
        </div>
      </div>

      <QuickAccessBar entries={quickAccess} loading={quickLoading} onOpen={handleQuickAccessOpen} />
      <LiveTicker items={tickerItems} loading={tickerLoading} onItemOpen={handleTickerItemOpen} />

      {/* ── Favorites Bar ── */}
      <FavoritesBar onMatchClick={handleMatchOpen} showAllTournamentTiers={showAllTournamentTiers} />

      <div style={{
        marginBottom: 18,
        padding: '10px 12px',
        borderRadius: 12,
        border: '1px solid #1f1f1f',
        background: '#0d0d0d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#c4c4c4', letterSpacing: '.8px', textTransform: 'uppercase' }}>
            Tournament Tier Filter
          </div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>
            Varsayilan: sadece S-Tier ve A-Tier
          </div>
        </div>
        <button
          onClick={() => setShowAllTournamentTiers(prev => !prev)}
          style={{
            border: `1px solid ${showAllTournamentTiers ? '#4CAF50' : '#2f2f2f'}`,
            background: showAllTournamentTiers ? 'rgba(76,175,80,.14)' : '#141414',
            color: showAllTournamentTiers ? '#9ee6a3' : '#c9c9c9',
            borderRadius: 999,
            padding: '7px 14px',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '.3px',
            cursor: 'pointer',
          }}
        >
          {showAllTournamentTiers ? 'Sadece S/A Goster' : 'Hepsini Goster'}
        </button>
      </div>

      {/* ── My Feed / Notification ── */}
      {(followedTeamIds.length > 0 || followedPlayerIds.length > 0) && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              fontSize: 11, fontWeight: 800, color: '#ff6b7a',
              letterSpacing: '1.5px', textTransform: 'uppercase',
            }}>
              🧠 My Feed
            </span>
            <span style={{
              padding: '1px 8px', borderRadius: 8,
              background: 'rgba(255,107,122,.12)', color: '#ff6b7a',
              fontSize: 10, fontWeight: 700,
            }}>
              {myFeedMatches.length}
            </span>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,107,122,.3),transparent)' }} />
          </div>

          {liveFavCount > 0 && (
            <div style={{
              marginBottom: 12,
              padding: '10px 14px', borderRadius: 12,
              background: 'radial-gradient(circle at 10% 50%, rgba(255,70,85,.25), rgba(255,70,85,.05) 45%, transparent 90%)',
              border: '1px solid rgba(255,70,85,.45)',
              boxShadow: '0 0 24px rgba(255,70,85,.25)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4655', animation: 'livePulse 1.2s infinite' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#FF4655' }}>
                {liveFavCount} takip edilen maç şu anda canlı!
              </span>
            </div>
          )}

          {myFeedMatches.length === 0 ? (
            <div style={{
              padding: '14px 16px', borderRadius: 12,
              background: '#0e0e0e', border: '1px solid #181818',
              fontSize: 11, color: '#3a3a3a', textAlign: 'center',
            }}>
              Takip ettiğin takımlar/oyuncular için yakın tarihli maç yok.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {myFeedMatches.slice(0, 8).map(m => (
                <UpcomingRow key={m.id} match={m} onMatchClick={handleMatchOpen} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Bento Grid — Hero (sol 2 sütun) + 4 Stat tile (sağ 2 sütun)
          Layout: [ Hero  | Stat1 | Stat2 ]  ← row-1
                  [ Hero  | Stat3 | Stat4 ]  ← row-2
          gridTemplateColumns: 2fr 1fr 1fr   (hero 2 birim, tile'lar 1'er birim)
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr',  /* ← 3 sütun: hero geniş, stat'lar dar */
        gridTemplateRows: isMobile ? 'auto' : '1fr 1fr',
        gap: 10,
        marginBottom: 24,
        minHeight: isMobile ? 'auto' : 160,
      }}>

        {/* ── Hero tile — 2 satır boyunca sol ── */}
        <div style={{
          gridColumn: '1 / 2',
          gridRow: isMobile ? 'auto' : '1 / 3',          /* her iki satırı kap */
          padding: isMobile ? '20px 16px' : '28px 24px',
          borderRadius: 20,
          background: 'linear-gradient(135deg,#141414,#0e0e0e)',
          border: '1px solid #1e1e1e',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>⚡</div>
          <h1 style={{
            margin: '0 0 8px', fontSize: 26, fontWeight: 900, letterSpacing: '-1px',
            background: 'linear-gradient(135deg,#FF4655,#F0A500,#fff)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>{BRANDING.shortName}</h1>
          <p style={{ margin: '0 0 16px', fontSize: 11, color: '#444', lineHeight: 1.6 }}>
            Canli sonuclar · PandaScore verileri
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { to: '/matches',  label: '📅 Takvim',      color: '#FF4655' },
              { to: '/tournaments', label: '🏟️ Turnuvalar', color: '#FFB800' },
            ].map(b => (
              <Link key={b.to} to={b.to} style={{ textDecoration: 'none' }}>
                <div style={{
                  padding: '6px 13px', borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: `${b.color}18`, border: `1px solid ${b.color}44`, color: b.color,
                  transition: 'all .15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${b.color}28`; e.currentTarget.style.borderColor = `${b.color}88` }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${b.color}18`; e.currentTarget.style.borderColor = `${b.color}44` }}
                >{b.label}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── 4 Stat tile — sağdaki 2 sütuna 2×2 grid ── */}
        {statTiles.map((s, i) => (
          <div key={s.label} style={{
            /* i=0→col2 row1 | i=1→col3 row1 | i=2→col2 row2 | i=3→col3 row2 */
            gridColumn: isMobile ? '1 / 2' : ((i % 2 === 0) ? '2 / 3' : '3 / 4'),
            gridRow:    isMobile ? 'auto' : ((i < 2) ? '1 / 2' : '2 / 3'),
            padding: '14px 12px',
            borderRadius: 16,
            textAlign: 'center',
            background: 'linear-gradient(135deg,#121212,#0e0e0e)',
            border: `1px solid ${s.color}1a`,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            transition: 'border-color .2s',
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = `${s.color}44`}
            onMouseLeave={e => e.currentTarget.style.borderColor = `${s.color}1a`}
          >
            <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {s.value}
            </div>
            <div style={{ fontSize: 9, color: '#383838', textTransform: 'uppercase', letterSpacing: '.6px', marginTop: 4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Weekly Dream Team Leaderboard ── */}
      {!MVP_HIDE_DREAM_TEAM && <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#ff9aa9', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            🧬 Dream Team (Week)
          </span>
          <span style={{ fontSize: 10, color: '#9e9e9e', padding: '2px 8px', borderRadius: 999, border: '1px solid #2c2c2c' }}>
            Son 7 Gun • {dreamGameLabel}
          </span>
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,154,169,.3),transparent)' }} />
        </div>

        <div style={{ border: '1px solid #222', borderRadius: 14, background: 'radial-gradient(circle at 8% 8%, rgba(200,16,46,.18), transparent 35%), #0f0f0f', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1.5fr 1fr .9fr .9fr .9fr', gap: 8, padding: '11px 14px', borderBottom: '1px solid #202020', fontSize: 10, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '.6px' }}>
            <div>Rank</div><div>Player</div><div>Team</div><div>Matches</div><div>Avg Impact</div><div>Momentum</div>
          </div>
          {dreamLoading && <div style={{ padding: 14, color: '#777', fontSize: 12 }}>Dream Team hesaplanıyor...</div>}
          {!dreamLoading && dreamTeam.length === 0 && <div style={{ padding: 14, color: '#777', fontSize: 12 }}>Haftalık oyuncu verisi bulunamadı.</div>}
          {!dreamLoading && dreamTeam.map((p, idx) => (
            <div key={p.id} onClick={() => navigate(`/player/${p.id}`)} style={{ display: 'grid', gridTemplateColumns: '60px 1.5fr 1fr .9fr .9fr .9fr', gap: 8, alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid #191919', cursor: 'pointer', background: idx === 0 ? 'linear-gradient(90deg, rgba(200,16,46,.22), transparent 62%)' : 'transparent' }}>
              <div style={{ fontWeight: 800, color: '#f4f4f4' }}>#{idx + 1}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {p.image_url
                  ? <img src={p.image_url} alt={p.nickname || ''} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', border: '1px solid #333' }} />
                  : <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#222' }} />}
                <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nickname || 'Unknown'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                {p.team?.logo_url ? <img src={p.team.logo_url} alt={p.team?.name || ''} style={{ width: 20, height: 20, objectFit: 'contain' }} /> : <div style={{ width: 20, height: 20, borderRadius: 6, background: '#222' }} />}
                <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team?.name || 'Free Agent'}</span>
              </div>
              <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.sampleMatches}</div>
              <div style={{ fontWeight: 800, color: '#ff9aa9', fontVariantNumeric: 'tabular-nums' }}>{p.avgImpact.toFixed(2)}</div>
              <div style={{ fontWeight: 700, color: p.momentum >= 0 ? '#7ee787' : '#ff9aa9', fontVariantNumeric: 'tabular-nums' }}>
                {p.momentum >= 0 ? '+' : ''}{p.momentum.toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
      </div>}

      {/* ── LIVE Section ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#FF4655', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            <span style={{ animation: 'livePulse 1.2s infinite', display: 'inline-block', marginRight: 4 }}>🔴</span>
            Live Now
          </span>
          {!loading && liveMatches.length > 0 && (
            <span style={{ padding: '1px 7px', borderRadius: 8, background: 'rgba(255,70,85,.15)', color: '#FF4655', fontSize: 10, fontWeight: 700 }}>
              {liveMatches.length}
            </span>
          )}
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,70,85,.3),transparent)' }} />
          <Link
            to="/matches"
            style={{ fontSize: 10, color: '#383838', textDecoration: 'none', transition: 'color .15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#888'}
            onMouseLeave={e => e.currentTarget.style.color = '#383838'}
          >Tümü →</Link>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(230px,1fr))', gap: 12 }}>
            {[1,2,3].map(i => <Sk key={i} h="150px" r="16px" />)}
          </div>
        ) : liveMatches.length === 0 ? (
          <div style={{ padding: '20px', borderRadius: 16, background: '#0e0e0e', border: '1px solid #181818', textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>😴</div>
            <div style={{ fontSize: 11, color: '#2a2a2a' }}>Şu an canlı maç yok</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(230px,1fr))', gap: 12 }}>
            {liveMatches.map(m => (
              <LiveMatchCard
                key={m.id}
                match={m}
                onMatchClick={handleMatchOpen}
                favs={followedTeamIds}
                onToggleFav={handleToggleFav}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Bugünün Maçları ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#4CAF50', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            ⏳ Upcoming
          </span>
          {!loading && (
            <span style={{ padding: '1px 7px', borderRadius: 8, background: 'rgba(76,175,80,.15)', color: '#4CAF50', fontSize: 10, fontWeight: 700 }}>
              {upcomingMatches.length}
            </span>
          )}
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(76,175,80,.3),transparent)' }} />
          <Link
            to="/matches"
            style={{ fontSize: 10, color: '#383838', textDecoration: 'none', transition: 'color .15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#888'}
            onMouseLeave={e => e.currentTarget.style.color = '#383838'}
          >Tümü →</Link>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[1,2,3,4,5].map(i => <Sk key={i} h="40px" r="12px" />)}
          </div>
        ) : upcomingMatches.length === 0 ? (
          <div style={{ padding: '16px', borderRadius: 14, background: '#0e0e0e', border: '1px solid #181818', textAlign: 'center', fontSize: 11, color: '#2a2a2a' }}>
            Yaklaşan maç bulunamadı
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {upcomingMatches.slice(0, 14).map(m => (
              <UpcomingRow key={m.id} match={m} onMatchClick={handleMatchOpen} />
            ))}
            {upcomingMatches.length > 14 && (
              <Link
                to="/matches"
                style={{
                  display: 'block', textAlign: 'center', padding: '9px',
                  borderRadius: 10, background: '#0a0a0a', border: '1px solid #181818',
                  fontSize: 10, color: '#383838', textDecoration: 'none', transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#888' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#181818'; e.currentTarget.style.color = '#383838' }}
              >
                +{upcomingMatches.length - 14} maç daha →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── Hızlı Linkler — 4 Bento tile ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,1fr)', gap: 10 }}>
        {[
          { to: '/matches',  icon: '📅', label: 'Maç Takvimi', sub: 'Yaklaşan & Biten',  color: '#FF4655' },
          { to: '/tournaments', icon: '🏟️', label: 'Turnuvalar', sub: 'Aktif ve Geçmiş',  color: '#FFB800' },
          { to: '/players',  icon: '🔍', label: 'Oyuncular',   sub: 'Scout Analytics',    color: '#6366f1' },
          { to: '/news',     icon: '📰', label: 'Haberler',    sub: 'Son gelişmeler',     color: '#4CAF50' },
        ].map(l => (
          <Link key={l.to} to={l.to} style={{ textDecoration: 'none' }}>
            <div style={{
              padding: '16px 14px', borderRadius: 16,
              background: 'linear-gradient(135deg,#121212,#0e0e0e)',
              border: `1px solid ${l.color}18`,
              transition: 'all .18s', cursor: 'pointer',
            }}
              onMouseEnter={e => {
                e.currentTarget.style.background    = `${l.color}0c`
                e.currentTarget.style.borderColor   = `${l.color}44`
                e.currentTarget.style.transform     = 'translateY(-3px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background    = 'linear-gradient(135deg,#121212,#0e0e0e)'
                e.currentTarget.style.borderColor   = `${l.color}18`
                e.currentTarget.style.transform     = 'translateY(0)'
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 7 }}>{l.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: l.color, marginBottom: 3 }}>{l.label}</div>
              <div style={{ fontSize: 10, color: '#2a2a2a' }}>{l.sub}</div>
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        @keyframes shimmer   { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes liveNeonBlink {
          0%, 100% { opacity: 1; box-shadow: 0 0 7px rgba(255,70,85,.7), 0 0 14px rgba(255,70,85,.35); }
          50% { opacity: .45; box-shadow: 0 0 2px rgba(255,70,85,.55), 0 0 4px rgba(255,70,85,.2); }
        }
        @keyframes tickerScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes dashRipple {
          0% { opacity: .8; transform: translate(-50%, -50%) scale(0.2); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(9); }
        }
        /* FavoritesBar scroll — webkit için de gizle */
        .fav-scroll::-webkit-scrollbar { display: none }
      `}</style>

      <PreferencePickerModal
        open={showPreferenceWizard}
        onClose={handlePreferenceWizardClose}
        onSave={handlePreferenceWizardSave}
        gameIds={followedGames}
        teamIds={followedTeamIds}
        popularTeams={popularTeams}
        loading={popularTeamsLoading}
      />
    </div>
  )
}

