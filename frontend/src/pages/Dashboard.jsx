/**
 * Dashboard.jsx — Bento Grid Layout
 * Ticker → Live Grid → Son Sonuçlar → Maç Programı → Takip Ettiklerim → Quick Links
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link }                from 'react-router-dom'
import { supabase, subscribeToMatchesUpdates } from '../supabaseClient'
import { useGame, gameMatchesFilter, GAMES } from '../context/GameContext'
import { isTurkishTeam }                   from '../constants'
import { useUser }                          from '../context/UserContext'
import { useAuth }                          from '../context/AuthContext'
import BRANDING                             from '../branding.config'
import { Radio, Flag, CalendarDays, Sparkles, Zap, SlidersHorizontal, Clock, Gamepad2, Shield, Trophy, FlaskConical, Newspaper, Flame, Star, TriangleAlert, Moon } from 'lucide-react'
import { buildFinishedStory, buildUpcomingStory } from '../utils/newsStories'
import { isStoryFollowedTeam, prioritizeStoriesForYou } from '../utils/newsPersonalization'
import { calculatePredictionAccuracy, getMatchImpactLabel } from '../utils/accuracyTracker'
import { memo }                             from 'react'
import InitialsImage                        from '../components/InitialsImage'
import { normalizeGameId }                  from '../utils/gameUtils'
import { getBOFormat }                       from '../utils/matchFormat'
import { correctedScores }                   from '../utils/matchResult'
import PredictionAccuracyBadge              from '../components/PredictionAccuracyBadge'

const MVP_HIDE_DREAM_TEAM = true
const MVP_HIDE_PREDICTIONS = false
const DASHBOARD_TICKER_CACHE_KEY = 'dashboard_live_ticker_cache_v1'
const DASHBOARD_NEWS_CACHE_KEY = 'dashboard_news_cache_v1'
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000
const DASHBOARD_PREF_WIZARD_SEEN_KEY = 'dashboard_pref_wizard_seen_v1'
const DASHBOARD_ACCURACY_REFRESH_MIN_INTERVAL_MS = 45 * 1000
const DASHBOARD_GLOBAL_ERROR_TEXT = 'Sunucuyla bağlantı kesildi, tekrar deneniyor...'
const POPULAR_TEAM_SEARCH_TERMS = ['galatasaray', 'eternal fire', 'fut', 'bbl', 'fenerbahce', 'sangal', 'g2', 'fnatic', 'navi']
const PREFERENCE_GAMES = GAMES.filter(game => ['valorant', 'cs2', 'lol'].includes(game.id))
const UPCOMING_WINDOW_DAYS = 7

/* ── FormStrip ────────────────────────────────────────────────────────────── */
function FormStrip({ form }) {
  if (!form?.length) return null
  return (
    <div style={{ display: 'flex', gap: 2, marginTop: 3 }}>
      {form.map((r, i) => (
        <span key={i} style={{
          width: 13, height: 13, borderRadius: 3, flexShrink: 0,
          background: r === 'W' ? 'rgba(76,175,80,.85)' : 'rgba(255,70,85,.75)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 7, fontWeight: 900, color: '#fff', letterSpacing: 0,
        }}>{r}</span>
      ))}
    </div>
  )
}

/* ── TodaySchedule ────────────────────────────────────────────────────────── */
const TodaySchedule = memo(function TodaySchedule({ matches, liveMatches, onMatchClick }) {
  const now   = new Date()
  const today = matches => (matches || []).filter(m => {
    if (!m.scheduled_at) return false
    const d = new Date(m.scheduled_at)
    return d.getFullYear() === now.getFullYear() &&
           d.getMonth()    === now.getMonth()    &&
           d.getDate()     === now.getDate()
  })

  const todayUpcoming = today(matches)
  const todayLive     = (liveMatches || [])
  const all           = [...todayLive, ...todayUpcoming]

  if (all.length === 0) return null

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 12px', borderRadius: 20,
          background: 'linear-gradient(135deg,rgba(76,175,80,.15),rgba(76,175,80,.07))',
          border: '1px solid rgba(76,175,80,.35)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: '#9ee6a3', letterSpacing: '.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CalendarDays size={11} /> Bugün
          </span>
          <span style={{ padding: '1px 6px', borderRadius: 8, background: 'rgba(76,175,80,.25)', color: '#9ee6a3', fontSize: 10, fontWeight: 700 }}>
            {all.length}
          </span>
        </div>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(76,175,80,.25),transparent)' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {all.map(m => {
          const isLive = m.status === 'running'
          const gameShort = (m.game?.name || '—').slice(0, 3).toUpperCase()
          const tA = m.team_a?.name || '?'
          const tB = m.team_b?.name || '?'
          return (
            <div
              key={m.id}
              onClick={() => onMatchClick(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                background: isLive ? 'rgba(255,70,85,.07)' : '#131b2b',
                border: isLive ? '1px solid rgba(255,70,85,.3)' : '1px solid #232f47',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = isLive ? 'rgba(255,70,85,.12)' : '#172032'; e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.5)' : '#2a2a2a' }}
              onMouseLeave={e => { e.currentTarget.style.background = isLive ? 'rgba(255,70,85,.07)' : '#131b2b'; e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.3)' : '#232f47' }}
            >
              {/* Saat */}
              <span style={{ fontSize: 11, color: '#555', fontVariantNumeric: 'tabular-nums', flexShrink: 0, width: 38, textAlign: 'center' }}>
                {isLive
                  ? <span style={{ color: '#FF4655', fontWeight: 800, animation: 'livePulse 1.2s infinite' }}>● LIVE</span>
                  : fmtTime(m.scheduled_at)
                }
              </span>
              {/* Game */}
              <span style={{ fontSize: 8, padding: '2px 5px', borderRadius: 4, background: '#232f47', color: '#444', fontWeight: 700, letterSpacing: '.4px', flexShrink: 0 }}>
                {gameShort}
              </span>
              {/* Teams */}
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tA} <span style={{ color: '#333' }}>vs</span> {tB}
              </span>
              {/* Tournament */}
              <span style={{ fontSize: 9, color: '#2a2a2a', flexShrink: 0, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {m.tournament?.name || ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(90deg,#131b2b 25%,#232f47 50%,#131b2b 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
    }} />
  )
}

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

// Upcoming maçlar günler sonra olabildiği için sadece saat kafa karıştırıyordu.
// Bugün → saat; yarın → "Yarın HH:MM"; sonrası → "14 Tem HH:MM".
function fmtWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const dayStart = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((dayStart(d) - dayStart(now)) / 86400000)
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  if (dayDiff === 0) return time
  if (dayDiff === 1) return `Yarın ${time}`
  return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} ${time}`
}

function normalizeMatchStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'upcoming') return 'not_started'
  return normalized
}

function isUpcomingStatus(status) {
  const normalized = normalizeMatchStatus(status)
  return normalized === 'not_started'
}

function matchesDashboardGame(matchRow, activeGameId) {
  const gameName = String(matchRow?.game?.name || '')
  const gameSlug = String(matchRow?.game?.slug || '')
  const combined = `${gameName} ${gameSlug}`.trim()
  return gameMatchesFilter(combined, activeGameId)
}

function getStatusBadge(status) {
  const normalized = normalizeMatchStatus(status)
  return {
    not_started: { text: 'Upcoming', color: '#FFB800', bg: 'rgba(255,184,0,.12)' },
    running:     { text: 'LIVE',     color: '#FF4655', bg: 'rgba(255,70,85,.18)' },
    finished:    { text: 'Bitti',    color: '#4CAF50', bg: 'rgba(76,175,80,.12)' },
  }[normalized] || { text: normalized || 'unknown', color: '#555', bg: 'transparent' }
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
  if (rawTier == null) return true
  const key = normalizeTierKey(rawTier)
  return key === null || key === 'S' || key === 'A'
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
      status: normalizeMatchStatus(incoming.status ?? match.status),
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
    const forYou = isStoryFollowedTeam(story, followedTeamIds)
    lines.push({
      id: `finished_${story.id}`,
      text: `${forYou ? '⭐ FOR YOU' : '📰'} ${story.title}`,
      href: story?.id ? `/news/${story.id}` : null,
    })
    const scout = scoutSignalLine(story)
    if (scout) lines.push({ id: `finished_scout_${story.id}`, text: scout, href: null })
  })
  ;orderedUpcoming.forEach(story => {
    const forYou = isStoryFollowedTeam(story, followedTeamIds)
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
  const [teamSearch, setTeamSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  // Görülen tüm takım objelerini sakla (arama temizlense de seçili takım görünür/kaydedilebilir kalsın).
  const [seenTeams, setSeenTeams] = useState({})
  const searchDebounceRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setSelectedGames(gameIds || [])
    setSelectedTeams(teamIds || [])
    setTeamSearch('')
    setSearchResults([])
  }, [open, gameIds, teamIds])

  // Popüler takımları "görülenler"e ekle.
  useEffect(() => {
    if (!open) return
    setSeenTeams(prev => {
      const next = { ...prev }
      for (const team of (popularTeams || [])) if (team?.id != null) next[team.id] = team
      return next
    })
  }, [open, popularTeams])

  // Canlı Supabase araması — tüm takımlar (yalnızca popülerler değil) takip edilebilsin.
  useEffect(() => {
    if (!open) return
    const q = String(teamSearch || '').trim()
    if (q.length < 2) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('teams')
        .select('id,name,acronym,logo_url,game_id,game:games(id,name,slug)')
        .or(`name.ilike.%${q}%,acronym.ilike.%${q}%`)
        .order('name', { ascending: true })
        .limit(14)
      setSearchResults(data || [])
      setSeenTeams(prev => {
        const next = { ...prev }
        for (const team of (data || [])) if (team?.id != null) next[team.id] = team
        return next
      })
      setSearching(false)
    }, 250)
    return () => clearTimeout(searchDebounceRef.current)
  }, [teamSearch, open])

  if (!open) return null

  const searchActive = String(teamSearch || '').trim().length >= 2
  const baseList = searchActive ? searchResults : (popularTeams || [])
  // Seçili olup listede olmayan takımları da başa ekle (arama temizlense bile görünsün).
  const selectedNotInList = selectedTeams
    .filter(id => !baseList.some(team => team.id === id))
    .map(id => seenTeams[id])
    .filter(Boolean)
  const displayedTeams = [...selectedNotInList, ...baseList]

  const toggleGame = gameId => {
    setSelectedGames(prev => prev.includes(gameId)
      ? prev.filter(id => id !== gameId)
      : [...prev, gameId])
  }

  const toggleTeam = team => {
    const teamId = team?.id
    if (teamId == null) return
    setSeenTeams(prev => ({ ...prev, [teamId]: team }))
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
        border: '1px solid #2b3a58',
        background: 'radial-gradient(circle at 14% 12%, rgba(255,70,85,.2), transparent 42%), #131b2b',
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
                    background: active ? `${game.color}2b` : '#172032',
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

          <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>
            {searchActive ? 'Arama Sonuclari' : 'Populer Takimlar'}
          </div>
          <div style={{ marginBottom: 10 }}>
            <input
              value={teamSearch}
              onChange={event => setTeamSearch(event.target.value)}
              placeholder='Tum takimlarda ara... (min 2 harf)'
              style={{
                width: '100%',
                borderRadius: 9,
                border: '1px solid #2a2a2a',
                background: '#172032',
                color: '#f1f1f1',
                fontSize: 12,
                padding: '8px 10px',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
            {displayedTeams.map(team => {
              const active = selectedTeams.includes(team.id)
              const teamGameId = normalizeGameId(team?.game?.slug ?? team?.game?.name ?? team?.game_id)
              const gameMeta = PREFERENCE_GAMES.find(game => game.id === teamGameId)
              return (
                <button
                  key={team.id}
                  onClick={() => toggleTeam(team)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: 11,
                    border: `1px solid ${active ? '#ff6f7e' : '#262626'}`,
                    background: active ? 'rgba(255,70,85,.18)' : '#172032',
                    color: active ? '#ffd9de' : '#cdcdcd',
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  <InitialsImage
                    src={team.logo_url}
                    alt={team.name || ''}
                    name={team.name}
                    width={22}
                    height={22}
                    borderRadius={6}
                    objectFit='contain'
                  />
                  <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
                    <span style={{ fontSize: 10, color: active ? '#ffb2bc' : '#8e8e8e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: gameMeta?.color || '#64748b', flexShrink: 0 }} /> {gameMeta?.label || team?.game?.name || 'Unknown Game'}
                    </span>
                  </span>
                </button>
              )
            })}
            {searchActive && searching && displayedTeams.length === 0 && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
                {[1, 2, 3].map(i => <Sk key={i} h="36px" r="10px" />)}
              </div>
            )}
            {searchActive && !searching && displayedTeams.length === 0 && (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#777', border: '1px dashed #262626', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                "{teamSearch.trim()}" icin takim bulunamadi.
              </div>
            )}
            {!searchActive && !loading && (!popularTeams || popularTeams.length === 0) && (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#777', border: '1px dashed #262626', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                Takim onerileri yuklenemedi. Yukaridan arayarak takim ekleyebilirsin.
              </div>
            )}
            {!searchActive && loading && (
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
              background: '#172032',
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
            onClick={() => {
              const teamGameMap = {}
              for (const teamId of selectedTeams) {
                const team = seenTeams[teamId]
                const gameId = normalizeGameId(team?.game?.slug ?? team?.game?.name ?? team?.game_id)
                if (gameId) teamGameMap[String(teamId)] = gameId
              }

              const mergedGameIds = [...new Set([
                ...(selectedGames || []),
                ...Object.values(teamGameMap),
              ])]

              onSave({ gameIds: mergedGameIds, teamIds: selectedTeams, teamGameMap })
            }}
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
    <div style={{ marginBottom: 18, borderRadius: 12, border: '1px solid #26324a', background: '#131b2b', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderBottom: '1px solid #26324a', background: 'rgba(255,255,255,.02)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff4655', animation: 'liveNeonBlink 1.05s infinite' }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Son Haberler &amp; Canlı Akış {loading ? '· senkronize ediliyor' : ''}
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
                fontSize: 13.5,
                fontWeight: 500,
                color: line.href ? '#e2e8f0' : '#94a3b8',
                padding: '13px 20px',
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
                e.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={e => {
                if (!line.href) return
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.color = '#e2e8f0'
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
              background: '#131b2b',
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

function WinBar({ predA, predB, confidence }) {
  if (predA == null || predB == null) return null
  const total = (predA + predB) || 1
  const pctA  = Math.round((predA / total) * 100)
  const pctB  = 100 - pctA
  const aFav  = pctA > pctB
  const isHot = confidence != null && confidence > 0.80

  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #232f47' }}>
      {/* İnce progress bar */}
      <div style={{
        display: 'flex', height: 3, borderRadius: 2,
        overflow: 'hidden', background: '#232f47',
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
        <span style={{ fontSize: 8, color: isHot ? '#ff8c42' : '#2a2a2a', fontWeight: isHot ? 700 : 400, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {isHot && <Flame size={9} strokeWidth={2.5} />}AI
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
const LiveMatchCard = memo(function LiveMatchCard({ match: m, onMatchClick, favs, onToggleFav, teamForms }) {
  const isLive     = m.status === 'running'
  const isFin      = m.status === 'finished'
  const aggressiveLiveMode = isLive && !isFin
  const aId        = m.team_a_id || m.team_a?.id
  const bId        = m.team_b_id || m.team_b?.id
  const formA      = teamForms?.get(aId) || []
  const formB      = teamForms?.get(bId) || []
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
        background: 'linear-gradient(160deg,#172032,#131b2b)',
        cursor: 'pointer',
        border: '1px solid #26324a',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        transition: 'border-color .18s, transform .18s',
        /* üst vurgu şeridi köşe yarıçapına göre kırpılsın (sol-üst kayma fix) */
        overflow: 'hidden',
        /* kart yüksekliği içerikle büyüsün, min sabit */
        minHeight: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,70,85,.55)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#26324a';  e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {/* Üst ince kırmızı vurgu — yavaş süzülen soft hareket (glow yok) */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg, transparent, rgba(255,70,85,.85) 30%, rgba(255,70,85,.35) 55%, transparent)',
        backgroundSize: '220% 100%',
        animation: 'liveAccentDrift 5.5s ease-in-out infinite alternate',
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
          {getBOFormat(m.team_a_score, m.team_b_score, m.number_of_games) && (
            <span style={{ fontSize: 8, fontWeight: 700, color: '#555', background: 'rgba(255,255,255,.05)', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
              {getBOFormat(m.team_a_score, m.team_b_score, m.number_of_games)}
            </span>
          )}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, color: '#ff7683' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF4655', animation: 'liveNeonBlink 1.05s infinite' }} />
          LIVE
        </span>
      </div>

      {aggressiveLiveMode && (
        <div style={{
          marginBottom: 8,
          borderRadius: 7,
          borderLeft: '2px solid rgba(255,70,85,.6)',
          background: 'rgba(255,70,85,.06)',
          color: '#94a3b8',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '.5px',
          textTransform: 'uppercase',
          padding: '4px 9px',
          textAlign: 'left',
        }}>
          Canlı takip
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
        <div style={{ textAlign: 'center', minWidth: 0, opacity: isFin && bWon ? 0.45 : 1 }}>
          <InitialsImage
            src={m.team_a?.logo_url}
            alt={m.team_a?.name || ''}
            name={m.team_a?.name}
            width={36}
            height={36}
            borderRadius={8}
            objectFit='contain'
            style={{ margin: '0 auto 4px' }}
          />
          <div style={{
            fontSize: 10, fontWeight: 700, lineHeight: 1.2,
            color: aWon ? '#4CAF50' : favA ? '#FFD700' : '#ccc',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {m.team_a?.name || '?'}{turkA && ' 🇹🇷'}
          </div>
          {formA.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <FormStrip form={formA} />
            </div>
          )}
          {favA && (
            <button
              onClick={e => { e.stopPropagation(); onToggleFav(aId) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFD700', padding: '1px 0', display: 'flex', justifyContent: 'center', margin: '0 auto' }}
            ><Star size={11} strokeWidth={2} fill="#FFD700" /></button>
          )}
        </div>

        {/* Score */}
        <div style={{
          textAlign: 'center',
          flexShrink: 0,
          padding: aggressiveLiveMode ? '5px 10px' : '0 4px',
          borderRadius: aggressiveLiveMode ? 9 : 0,
          border: aggressiveLiveMode ? '1px solid #26324a' : 'none',
          background: aggressiveLiveMode ? 'rgba(255,255,255,.03)' : 'transparent',
          boxShadow: 'none',
        }}>
          <div style={{
            fontSize: aggressiveLiveMode ? 28 : 20,
            fontWeight: 900,
            color: '#fff',
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px', lineHeight: 1,
            textShadow: 'none',
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
        <div style={{ textAlign: 'center', minWidth: 0, opacity: isFin && aWon ? 0.45 : 1 }}>
          <InitialsImage
            src={m.team_b?.logo_url}
            alt={m.team_b?.name || ''}
            name={m.team_b?.name}
            width={36}
            height={36}
            borderRadius={8}
            objectFit='contain'
            style={{ margin: '0 auto 4px' }}
          />
          <div style={{
            fontSize: 10, fontWeight: 700, lineHeight: 1.2,
            color: bWon ? '#4CAF50' : favB ? '#FFD700' : '#ccc',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {m.team_b?.name || '?'}{turkB && ' 🇹🇷'}
          </div>
          {formB.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <FormStrip form={formB} />
            </div>
          )}
          {favB && (
            <button
              onClick={e => { e.stopPropagation(); onToggleFav(bId) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFD700', padding: '1px 0', display: 'flex', justifyContent: 'center', margin: '0 auto' }}
            ><Star size={11} strokeWidth={2} fill="#FFD700" /></button>
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

      {/* ── Stream linki ── */}
      {m.stream_url && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,70,85,.15)' }}>
          <a
            href={m.stream_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '5px 0', borderRadius: 7,
              background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)',
              color: '#c4b5fd', fontSize: 10, fontWeight: 700,
              textDecoration: 'none', transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(167,139,250,.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(167,139,250,.12)'}
          >
            ▶ Canlı İzle
          </a>
        </div>
      )}
    </div>
  )
})

/* ── UpcomingRow ──────────────────────────────────────────────────────────── */
const UpcomingRow = memo(function UpcomingRow({ match: m, onMatchClick, teamForms, showDate }) {
  const badge = getStatusBadge(m.status)
  const isLive = m.status === 'running'
  const turkA = isTurkishTeam(m.team_a?.name ?? '')
  const turkB = isTurkishTeam(m.team_b?.name ?? '')
  const aId   = m.team_a_id || m.team_a?.id
  const bId   = m.team_b_id || m.team_b?.id
  const formA = teamForms?.get(aId) || []
  const formB = teamForms?.get(bId) || []
  return (
    <div
      onClick={() => onMatchClick(m.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px', borderRadius: 12, cursor: 'pointer',
        background: '#131b2b',
        border: isLive ? '1px solid rgba(255,70,85,.5)' : '1px solid #26324a',
        boxShadow: 'none',
        transition: 'background .15s, border-color .15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = '#172032'
        e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.7)' : '#33415d'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = '#131b2b'
        e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.5)' : '#26324a'
      }}
    >
      {/* Saat (My Feed'de tarih de görünsün — grup başlığı yok) */}
      <div style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0, width: showDate ? 66 : 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>
        {showDate ? fmtWhen(m.scheduled_at) : fmtTime(m.scheduled_at)}
      </div>

      {/* Oyun etiketi */}
      <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: '#232f47', color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', flexShrink: 0 }}>
        {m.game?.name?.slice(0, 3).toUpperCase() || '—'}
      </span>

      {isLive && (
        <span style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#ff4655',
          animation: 'liveNeonBlink 1.05s infinite',
          flexShrink: 0,
        }} />
      )}

      {/* Teams */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
        <InitialsImage
          src={m.team_a?.logo_url}
          alt={m.team_a?.name || ''}
          name={m.team_a?.name}
          width={18}
          height={18}
          borderRadius={4}
          objectFit='contain'
        />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: turkA ? '#ff6b7a' : '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
            {m.team_a?.name || '?'}{turkA && ' 🇹🇷'}
          </span>
          {formA.length > 0 && <FormStrip form={formA} />}
        </div>
        <span style={{ fontSize: 9, color: '#2a2a2a', flexShrink: 0 }}>vs</span>
        <InitialsImage
          src={m.team_b?.logo_url}
          alt={m.team_b?.name || ''}
          name={m.team_b?.name}
          width={18}
          height={18}
          borderRadius={4}
          objectFit='contain'
        />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: turkB ? '#ff6b7a' : '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
            {m.team_b?.name || '?'}{turkB && ' 🇹🇷'}
          </span>
          {formB.length > 0 && <FormStrip form={formB} />}
        </div>
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

/* ── ResultRow — biten maç, skor odaklı (Son Sonuçlar) ────────────────────── */
const ResultRow = memo(function ResultRow({ match: m, onMatchClick }) {
  const cs   = correctedScores(m)
  const aId  = Number(m.team_a_id || m.team_a?.id)
  const bId  = Number(m.team_b_id || m.team_b?.id)
  const aWon = m.winner_id != null && Number(m.winner_id) === aId
  const bWon = m.winner_id != null && Number(m.winner_id) === bId
  const turkA = isTurkishTeam(m.team_a?.name ?? '')
  const turkB = isTurkishTeam(m.team_b?.name ?? '')
  const tierLetter = String(m.tournament?.tier || '').toUpperCase().replace(/[^SABCDE]/g, '').charAt(0)
  const isHero = tierLetter === 'S' || tierLetter === 'A'
  return (
    <div
      onClick={() => onMatchClick(m.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 12px', borderRadius: 12, cursor: 'pointer',
        background: '#131b2b', border: '1px solid #26324a', transition: 'background .15s, border-color .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#172032'; e.currentTarget.style.borderColor = '#33415d' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#131b2b'; e.currentTarget.style.borderColor = '#26324a' }}
    >
      {/* Tarih/saat — bugünse sadece saat, öncesi "13 Tem HH:MM" */}
      <span style={{ fontSize: 9.5, color: '#64748b', flexShrink: 0, width: 62, textAlign: 'center', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {fmtWhen(m.scheduled_at)}
      </span>

      <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: '#232f47', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', flexShrink: 0 }}>
        {m.game?.name?.slice(0, 3).toUpperCase() || '—'}
      </span>

      {/* Team A (sağa hizalı, merkeze doğru) */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: aWon ? 800 : 600, color: aWon ? '#eaeaea' : '#6f6f6f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130, textAlign: 'right' }}>
          {m.team_a?.name || '?'}{turkA && ' 🇹🇷'}
        </span>
        <InitialsImage src={m.team_a?.logo_url} alt={m.team_a?.name || ''} name={m.team_a?.name} width={18} height={18} borderRadius={4} objectFit='contain' />
      </div>

      {/* Skor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontWeight: 900, fontSize: 15 }}>
        <span style={{ color: aWon ? '#4CAF50' : '#666' }}>{cs.team_a_score ?? '–'}</span>
        <span style={{ color: '#333', fontSize: 11 }}>:</span>
        <span style={{ color: bWon ? '#4CAF50' : '#666' }}>{cs.team_b_score ?? '–'}</span>
      </div>

      {/* Team B */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <InitialsImage src={m.team_b?.logo_url} alt={m.team_b?.name || ''} name={m.team_b?.name} width={18} height={18} borderRadius={4} objectFit='contain' />
        <span style={{ fontSize: 12, fontWeight: bWon ? 800 : 600, color: bWon ? '#eaeaea' : '#6f6f6f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
          {m.team_b?.name || '?'}{turkB && ' 🇹🇷'}
        </span>
      </div>

      {/* Tier rozeti (S/A vurgusu) */}
      {tierLetter && (
        <span style={{
          flexShrink: 0, fontSize: 9, fontWeight: 800, borderRadius: 5, padding: '2px 6px',
          color: isHero ? '#f0c040' : '#555',
          background: isHero ? 'rgba(240,192,64,.12)' : '#172032',
          border: isHero ? '1px solid rgba(240,192,64,.35)' : '1px solid #2b3a58',
        }}>{tierLetter}</span>
      )}
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
  const { isAuthenticated } = useAuth()

  const [liveMatches,     setLiveMatches]     = useState([])
  const [upcomingMatches, setUpcomingMatches] = useState([])
  const [teamFormMap,          setTeamFormMap]          = useState(new Map())
  const [expandedScheduleGroups, setExpandedScheduleGroups] = useState(new Set())
  const [myFeedMatches,   setMyFeedMatches]   = useState([])
  const [liveFavCount,    setLiveFavCount]    = useState(0)
  const [showAllTournamentTiers, setShowAllTournamentTiers] = useState(true)
  const [quickAccess, setQuickAccess] = useState([])
  const [quickLoading, setQuickLoading] = useState(false)
  const [tickerItems, setTickerItems] = useState([])
  const [tickerLoading, setTickerLoading] = useState(false)
  const [recentResults, setRecentResults] = useState([])  // Son Sonuçlar (biten maçlar, skorlu)
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
    // Prompt'u SADECE giriş yapmış kullanıcıya aç (kayıt sonrası onboarding anı).
    // Anonim ilk ziyaretçi bloke edilmez → içeriği hemen görür (bounce↓, kayıt teşviki↑).
    // Anonim yine de üstteki "Tercihleri Düzenle" ile manuel açabilir.
    if (!isAuthenticated) return
    const seen = window.localStorage.getItem(DASHBOARD_PREF_WIZARD_SEEN_KEY)
    if (!seen) setShowPreferenceWizard(true)
  }, [isAuthenticated])

  useEffect(() => {
    if (!showPreferenceWizard) return

    let cancelled = false

    async function fetchPopularTeams() {
      setPopularTeamsLoading(true)
      try {
        const searchFilter = POPULAR_TEAM_SEARCH_TERMS.map(term => `name.ilike.%${term}%`).join(',')

        let { data, error } = await supabase
          .from('teams')
          .select('id,name,logo_url,game_id,game:games(id,name,slug)')
          .or(searchFilter)
          .limit(18)

        if (error) throw error

        if (!data || data.length === 0) {
          const fallbackRes = await supabase
            .from('teams')
            .select('id,name,logo_url,game_id,game:games(id,name,slug)')
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

  const handlePreferenceWizardSave = useCallback(({ gameIds, teamIds, teamGameMap }) => {
    setFollowedTeams(teamIds || [], { teamGameMap })
    setFollowedGames(gameIds || [], { teamIds, teamGameMap })
    markPreferenceWizardSeen()
    setShowPreferenceWizard(false)
  }, [setFollowedGames, setFollowedTeams, markPreferenceWizardSeen])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const nowIso = new Date().toISOString()
      const upcomingFloorIso = new Date(Date.now() - (6 * 60 * 60 * 1000)).toISOString()
      const upcomingCeilIso = new Date(Date.now() + (UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000)).toISOString()

      const selectStr = `
        id, status, scheduled_at,
        team_a_id, team_b_id, winner_id, team_a_score, team_b_score,
        number_of_games, stream_url,
        prediction_team_a, prediction_team_b, prediction_confidence,
        team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
        team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
        tournament:tournaments(id,name,tier),
        game:games(id,name,slug)
      `
      const [liveRes, upcomingRes] = await Promise.all([
        supabase.from('matches').select(selectStr)
          .eq('status', 'running')
          .order('scheduled_at', { ascending: true })
          .limit(18),
        supabase.from('matches').select(selectStr)
          .in('status', ['not_started', 'upcoming'])
          .gte('scheduled_at', upcomingFloorIso)
          .lte('scheduled_at', upcomingCeilIso)
          .order('scheduled_at', { ascending: true })
          .limit(30),
      ])

      if (liveRes.error) throw liveRes.error
      if (upcomingRes.error) throw upcomingRes.error

      const baseLive = (liveRes.data || []).filter(m => matchesDashboardGame(m, activeGame))
      const baseUpcoming = (upcomingRes.data || []).filter(m => matchesDashboardGame(m, activeGame))
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
    const allMatches = [...liveMatches, ...upcomingMatches]
    if (allMatches.length === 0) { setTeamFormMap(new Map()); return }

    const teamIds = [...new Set(allMatches.flatMap(m => [m.team_a_id, m.team_b_id].filter(Boolean)))]
    if (teamIds.length === 0) return

    let cancelled = false
    const idsStr = teamIds.join(',')

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('matches')
          .select('winner_id,team_a_id,team_b_id')
          .eq('status', 'finished')
          .or(`team_a_id.in.(${idsStr}),team_b_id.in.(${idsStr})`)
          .order('scheduled_at', { ascending: false })
          .limit(300)

        if (error || cancelled) return

        const map = new Map()
        for (const row of data || []) {
          const { winner_id, team_a_id, team_b_id } = row
          if (!winner_id) continue
          for (const tid of [team_a_id, team_b_id]) {
            if (!tid) continue
            const form = map.get(tid) || []
            if (form.length < 5) {
              form.push(Number(winner_id) === Number(tid) ? 'W' : 'L')
              map.set(tid, form)
            }
          }
        }
        if (!cancelled) setTeamFormMap(map)
      } catch { /* non-critical */ }
    })()

    return () => { cancelled = true }
  }, [liveMatches, upcomingMatches])

  useEffect(() => {
    let cancelled = false

    async function fetchFinishedAccuracyRows() {
      setAccuracyLoading(true)
      try {
        const selectColumns = 'id,status,winner_id,team_a_id,team_b_id,prediction_team_a,prediction_team_b,prediction_confidence'

        const { data, error } = await supabase
          .from('matches')
          .select(selectColumns)
          .eq('status', 'finished')
          .not('winner_id', 'is', null)
          .order('scheduled_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(30)

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
      const oldRow  = payload?.old || {}
      if (!nextRow?.id) return

      const isInsert = payload.eventType === 'INSERT'
      const nextStatus = normalizeMatchStatus(nextRow.status)
      const prevStatus = normalizeMatchStatus(oldRow.status)

      // INSERT: yeni live maç — sadece running ise listeye ekle
      if (isInsert) {
        if (nextStatus === 'running') {
          setLiveMatches(prev => prev.some(m => m.id === nextRow.id) ? prev : [...prev, nextRow])
        } else if (isUpcomingStatus(nextStatus)) {
          setUpcomingMatches(prev => prev.some(m => m.id === nextRow.id) ? prev : [...prev, nextRow])
        }
        return
      }

      // UPDATE: sadece anlamlı değişiklikler
      const changed =
        prevStatus !== nextStatus ||
        oldRow.team_a_score !== nextRow.team_a_score ||
        oldRow.team_b_score !== nextRow.team_b_score ||
        oldRow.winner_id    !== nextRow.winner_id

      if (!changed) return

      setLiveMatches(prev =>
        patchMatchCollection(prev, nextRow)
          .filter(m => normalizeMatchStatus(m.status) === 'running')
      )
      setUpcomingMatches(prev =>
        patchMatchCollection(prev, nextRow)
          .filter(m => isUpcomingStatus(normalizeMatchStatus(m.status)))
      )
      setMyFeedMatches(prev => {
        const patched = patchMatchCollection(prev, nextRow).filter(m => {
          const s = normalizeMatchStatus(m.status)
          return s === 'running' || isUpcomingStatus(s)
        })
        setLiveFavCount(patched.filter(m => normalizeMatchStatus(m.status) === 'running').length)
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
        const recentUpcomingFloor = new Date(now.getTime() - (6 * 60 * 60 * 1000))
        const soon = new Date(now)
        soon.setDate(now.getDate() + UPCOMING_WINDOW_DAYS)

        const { data } = await supabase
          .from('matches')
          .select(`
            id, status, scheduled_at,
            team_a_id, team_b_id, winner_id,
            team_a_score, team_b_score,
            prediction_team_a, prediction_team_b, prediction_confidence,
            team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
            team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
            tournament:tournaments(id,name,tier),
            game:games(id,name,slug)
          `)
          .or(orFilter)
          .in('status', ['not_started', 'upcoming', 'running'])
          .gte('scheduled_at', recentUpcomingFloor.toISOString())
          .lte('scheduled_at', soon.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(40)

        const baseFiltered = (data || []).filter(m => matchesDashboardGame(m, activeGame))
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
        const upcomingFloorIso = new Date(Date.now() - (6 * 60 * 60 * 1000)).toISOString()
        const upcomingCeilIso = new Date(Date.now() + (UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000)).toISOString()
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
            .limit(40),
          supabase
            .from('matches')
            .select(selectStr)
            .in('status', ['not_started', 'upcoming'])
            .gte('scheduled_at', upcomingFloorIso)
            .lte('scheduled_at', upcomingCeilIso)
            .order('scheduled_at', { ascending: true })
            .limit(8),
        ])

        if (runningRes.error) throw runningRes.error
        if (finishedRes.error) throw finishedRes.error
        if (upcomingRes.error) throw upcomingRes.error

        const running = filterMatchesByTournamentTier(
          (runningRes.data || []).filter(m => matchesDashboardGame(m, activeGame)),
          showAllTournamentTiers
        )
        const finished = filterMatchesByTournamentTier(
          (finishedRes.data || []).filter(m => matchesDashboardGame(m, activeGame)),
          showAllTournamentTiers
        )
        const upcoming = filterMatchesByTournamentTier(
          (upcomingRes.data || []).filter(m => matchesDashboardGame(m, activeGame)),
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
          // Son Sonuçlar sıralaması: FAVORİ takım maçları en üstte → sonra hero-tier (S/A)
          // → sonra tarih (finished zaten tarih-desc, stable sort korunur).
          const favSet = new Set((followedTeamIds || []).map(String))
          const involvesFav = (m) =>
            favSet.has(String(m?.team_a_id)) || favSet.has(String(m?.team_b_id)) ||
            favSet.has(String(m?.team_a?.id)) || favSet.has(String(m?.team_b?.id))
          // Son Sonuçlar sadece üst-tier (kesin S / A) maçları göstersin — alt-tier gürültüsü olmasın.
          const topTierOnly = (m) => {
            const k = normalizeTierKey(m?.tournament?.tier)
            return k === 'S' || k === 'A'
          }
          const orderedResults = [...finished]
            .filter(topTierOnly)
            .sort((a, b) => {
              // Favori takım maçları en üstte; sonrası tarih-desc (finished zaten öyle sıralı, stable).
              return (involvesFav(b) ? 1 : 0) - (involvesFav(a) ? 1 : 0)
            })
            .slice(0, 8)
          setRecentResults(orderedResults)

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
    { Icon: Radio,    value: loading ? '…' : stats.live,  label: 'Canli',    color: '#FF4655' },
    { Icon: Clock,    value: loading ? '…' : stats.today, label: 'Bugun',    color: '#FFB800' },
    { Icon: Gamepad2, value: loading ? '…' : stats.total, label: 'Toplam',   color: '#6366f1' },
    { Icon: Shield,   value: loading ? '…' : stats.teams, label: 'Takimlar', color: '#4CAF50' },
  ], [loading, stats.live, stats.today, stats.total, stats.teams])

  return (
    <div style={{ background: '#0b0f19', minHeight: 'calc(100vh - 58px)' }}>
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
          display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <TriangleAlert size={14} /> {globalError}
        </div>
      )}

      {/* Kompakt tercih butonu — eskiden tam satır kaplayan banttı; sağ üste alındı. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          onClick={() => setShowPreferenceWizard(true)}
          title="Akışını kişiselleştir — favori oyun ve takımlarını seç"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            borderRadius: 999,
            border: '1px solid rgba(255,70,85,.4)',
            background: 'rgba(255,70,85,.1)',
            color: '#ffd7dc',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.2px',
            padding: '6px 12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,70,85,.18)'; e.currentTarget.style.borderColor = 'rgba(255,70,85,.6)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,70,85,.1)'; e.currentTarget.style.borderColor = 'rgba(255,70,85,.4)' }}
        >
          <SlidersHorizontal size={13} strokeWidth={2.2} />
          {(preferredGameLabels.length > 0 || followedTeamIds.length > 0)
            ? `Tercihlerin · ${followedTeamIds.length} takım`
            : 'Kişiselleştir'}
        </button>
      </div>

      {/* AI güven metrikleri birleştirildi ve aşağı alındı (bkz. AI Güven Paneli) */}

      <QuickAccessBar entries={quickAccess} loading={quickLoading} onOpen={handleQuickAccessOpen} />
      <LiveTicker items={tickerItems} loading={tickerLoading} onItemOpen={handleTickerItemOpen} />

      <div style={{
        marginBottom: 18,
        padding: '10px 12px',
        borderRadius: 12,
        border: '1px solid #232f47',
        background: '#131b2b',
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
            {showAllTournamentTiers ? 'Tüm turnuvalar gösteriliyor' : 'Sadece S-Tier ve A-Tier'}
          </div>
        </div>
        <button
          onClick={() => setShowAllTournamentTiers(prev => !prev)}
          style={{
            border: `1px solid ${showAllTournamentTiers ? '#4CAF50' : '#2f2f2f'}`,
            background: showAllTournamentTiers ? 'rgba(76,175,80,.14)' : '#172032',
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

      {/* ── Takip Ettiklerim (takip edilen takım/oyuncu maçları) ── */}
      {(followedTeamIds.length > 0 || followedPlayerIds.length > 0) && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{
              fontSize: 11, fontWeight: 800, color: '#f0c040',
              letterSpacing: '1.5px', textTransform: 'uppercase',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Star size={13} strokeWidth={2.2} fill="#f0c040" /> Takip Ettiklerim
            </span>
            <span style={{
              padding: '1px 8px', borderRadius: 8,
              background: 'rgba(240,192,64,.12)', color: '#f0c040',
              fontSize: 10, fontWeight: 700,
            }}>
              {myFeedMatches.length}
            </span>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(240,192,64,.3),transparent)' }} />
          </div>

          {liveFavCount > 0 && (
            <div style={{
              marginBottom: 12,
              padding: '10px 14px', borderRadius: 12,
              background: 'rgba(255,70,85,.08)',
              border: '1px solid rgba(255,70,85,.28)',
              boxShadow: 'none',
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
              background: '#131b2b', border: '1px solid #232f47',
              fontSize: 11, color: '#3a3a3a', textAlign: 'center',
            }}>
              Takip ettiğin takımlar/oyuncular için yakın tarihli maç yok.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {myFeedMatches.slice(0, 8).map(m => (
                <UpcomingRow key={m.id} match={m} onMatchClick={handleMatchOpen} teamForms={teamFormMap} showDate />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Weekly Dream Team Leaderboard ── */}
      {!MVP_HIDE_DREAM_TEAM && <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#ff9aa9', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={13} /> Dream Team (Week)
          </span>
          <span style={{ fontSize: 10, color: '#9e9e9e', padding: '2px 8px', borderRadius: 999, border: '1px solid #2c2c2c' }}>
            Son 7 Gun • {dreamGameLabel}
          </span>
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,154,169,.3),transparent)' }} />
        </div>

        <div style={{ border: '1px solid #2b3a58', borderRadius: 14, background: 'radial-gradient(circle at 8% 8%, rgba(200,16,46,.18), transparent 35%), #131b2b', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1.5fr 1fr .9fr .9fr .9fr', gap: 8, padding: '11px 14px', borderBottom: '1px solid #202020', fontSize: 10, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '.6px' }}>
            <div>Rank</div><div>Player</div><div>Team</div><div>Matches</div><div>Avg Impact</div><div>Momentum</div>
          </div>
          {dreamLoading && <div style={{ padding: 14, color: '#777', fontSize: 12 }}>Dream Team hesaplanıyor...</div>}
          {!dreamLoading && dreamTeam.length === 0 && <div style={{ padding: 14, color: '#777', fontSize: 12 }}>Haftalık oyuncu verisi bulunamadı.</div>}
          {!dreamLoading && dreamTeam.map((p, idx) => (
            <div key={p.id} onClick={() => navigate(`/player/${p.id}`)} style={{ display: 'grid', gridTemplateColumns: '60px 1.5fr 1fr .9fr .9fr .9fr', gap: 8, alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid #232f47', cursor: 'pointer', background: idx === 0 ? 'linear-gradient(90deg, rgba(200,16,46,.22), transparent 62%)' : 'transparent' }}>
              <div style={{ fontWeight: 800, color: '#f4f4f4' }}>#{idx + 1}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <InitialsImage
                  src={p.image_url}
                  alt={p.nickname || ''}
                  name={p.nickname}
                  width={28}
                  height={28}
                  borderRadius='50%'
                  objectFit='cover'
                  style={{ border: '1px solid #333' }}
                />
                <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nickname || 'Unknown'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <InitialsImage
                  src={p.team?.logo_url}
                  alt={p.team?.name || ''}
                  name={p.team?.name}
                  width={20}
                  height={20}
                  borderRadius={6}
                  objectFit='contain'
                />
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
          <span style={{ fontSize: 11, fontWeight: 800, color: '#FF4655', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Radio size={13} color="#FF4655" style={{ animation: 'livePulse 1.2s infinite' }} />
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
          <div style={{ padding: '20px', borderRadius: 16, background: '#131b2b', border: '1px solid #232f47', textAlign: 'center' }}>
            <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center' }}><Moon size={22} color="#334155" /></div>
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
                teamForms={teamFormMap}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Son Sonuçlar (biten maçlar, skorlu — ana sayfada kalıcı) ───────── */}
      {recentResults.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#f0c040', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Flag size={13} /> Son Sonuçlar
            </span>
            <span style={{ padding: '1px 7px', borderRadius: 8, background: 'rgba(240,192,64,.14)', color: '#f0c040', fontSize: 10, fontWeight: 700 }}>
              {recentResults.length}
            </span>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(240,192,64,.3),transparent)' }} />
            <Link
              to="/matches?tab=past"
              style={{ fontSize: 10, color: '#383838', textDecoration: 'none', transition: 'color .15s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#888'}
              onMouseLeave={e => e.currentTarget.style.color = '#383838'}
            >Tümü →</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentResults.map(m => <ResultRow key={m.id} match={m} onMatchClick={handleMatchOpen} />)}
          </div>
        </div>
      )}

      {/* ── Maç Programı ─────────────────────────────────────────────────── */}
      {(() => {
        const now = new Date()
        const todayStr = now.toDateString()
        const tomorrowStr = new Date(now.getTime() + 86400000).toDateString()

        // Live maçlar zaten yukarıda gösteriliyor — burada yalnızca non-live
        // Ayrıca: scheduled_at geçmiş ama hâlâ not_started olanlar stale veri (sync gecikmesi)
        const staleThreshold = now.getTime() - 20 * 60 * 1000   // 20 dk önce başlamış ama güncellenmemiş
        const scheduled = upcomingMatches.filter(m =>
          m.status !== 'running' &&
          (!m.scheduled_at || new Date(m.scheduled_at).getTime() >= staleThreshold)
        )
        const stale = upcomingMatches.filter(m =>
          m.status !== 'running' &&
          m.scheduled_at && new Date(m.scheduled_at).getTime() < staleThreshold
        )

        // Tarihe göre grupla
        const groups = []
        const seen = new Map()
        for (const m of scheduled) {
          const d = m.scheduled_at ? new Date(m.scheduled_at) : null
          const key = d ? d.toDateString() : '__unknown'
          if (!seen.has(key)) {
            seen.set(key, groups.length)
            let label
            if      (key === todayStr)    label = 'Bugün'
            else if (key === tomorrowStr) label = 'Yarın'
            else if (d) label = d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })
            else         label = '—'
            groups.push({ key, label, matches: [] })
          }
          groups[seen.get(key)].matches.push(m)
        }

        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#4CAF50', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CalendarDays size={13} /> Maç Programı
              </span>
              {!loading && scheduled.length > 0 && (
                <span style={{ padding: '1px 7px', borderRadius: 8, background: 'rgba(76,175,80,.15)', color: '#4CAF50', fontSize: 10, fontWeight: 700 }}>
                  {scheduled.length}
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
            ) : groups.length === 0 ? (
              <div style={{ padding: '16px', borderRadius: 14, background: '#131b2b', border: '1px solid #232f47', textAlign: 'center', fontSize: 11, color: '#2a2a2a' }}>
                Yaklaşan maç bulunamadı
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {groups.map((g, gi) => (
                  <div key={g.key}>
                    {/* Gün ayırıcı */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginTop: gi > 0 ? 14 : 0, marginBottom: 6,
                    }}>
                      <span style={{
                        fontSize: 9, fontWeight: 900, letterSpacing: '.8px',
                        textTransform: 'uppercase', color: g.key === todayStr ? '#4CAF50' : '#333',
                        background: g.key === todayStr ? 'rgba(76,175,80,.1)' : 'transparent',
                        border: g.key === todayStr ? '1px solid rgba(76,175,80,.25)' : '1px solid transparent',
                        padding: '2px 8px', borderRadius: 6, flexShrink: 0,
                      }}>
                        {g.label}
                      </span>
                      <div style={{ flex: 1, height: 1, background: g.key === todayStr ? 'rgba(76,175,80,.15)' : '#232f47' }} />
                      <span style={{ fontSize: 9, color: '#2a2a2a', flexShrink: 0 }}>{g.matches.length} maç</span>
                    </div>

                    {(() => {
                      const isExpanded = expandedScheduleGroups.has(g.key)
                      const defaultLimit = gi === 0 ? 8 : 4
                      const visible = isExpanded ? g.matches : g.matches.slice(0, defaultLimit)
                      const hidden  = g.matches.length - defaultLimit
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {visible.map(m => (
                            <UpcomingRow key={m.id} match={m} onMatchClick={handleMatchOpen} teamForms={teamFormMap} />
                          ))}
                          {!isExpanded && hidden > 0 && (
                            <button
                              onClick={() => setExpandedScheduleGroups(prev => new Set([...prev, g.key]))}
                              style={{
                                background: 'none', border: '1px solid #232f47', borderRadius: 8,
                                color: '#3a3a3a', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                padding: '7px 0', width: '100%', transition: 'all .15s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#888' }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = '#232f47'; e.currentTarget.style.color = '#3a3a3a' }}
                            >
                              +{hidden} maç daha göster
                            </button>
                          )}
                          {isExpanded && g.matches.length > defaultLimit && (
                            <button
                              onClick={() => setExpandedScheduleGroups(prev => { const s = new Set(prev); s.delete(g.key); return s })}
                              style={{
                                background: 'none', border: '1px solid #232f47', borderRadius: 8,
                                color: '#3a3a3a', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                padding: '7px 0', width: '100%', transition: 'all .15s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#888' }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = '#232f47'; e.currentTarget.style.color = '#3a3a3a' }}
                            >
                              Daralt ↑
                            </button>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                ))}

                {scheduled.length > 0 && (
                  <Link
                    to="/matches"
                    style={{
                      display: 'block', textAlign: 'center', padding: '9px',
                      borderRadius: 10, background: '#0b0f19', border: '1px solid #232f47',
                      fontSize: 10, color: '#383838', textDecoration: 'none',
                      transition: 'all .15s', marginTop: 10,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#888' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#232f47'; e.currentTarget.style.color = '#383838' }}
                  >
                    Tüm program →
                  </Link>
                )}

                {/* Stale maçlar — başlamış olabilir ama DB henüz güncellenemedi */}
                {stale.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase',
                        color: '#3a3a3a', padding: '2px 8px', borderRadius: 6,
                        border: '1px solid #2b3a58',
                      }}>
                        ⟳ Sonuç Bekleniyor
                      </span>
                      <div style={{ flex: 1, height: 1, background: '#232f47' }} />
                      <span style={{ fontSize: 9, color: '#252525' }}>veri gecikmesi</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0.45 }}>
                      {stale.map(m => (
                        <UpcomingRow key={m.id} match={m} onMatchClick={handleMatchOpen} teamForms={teamFormMap} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── AI Güven Paneli — birleşik (net isabet + son-30 trend), tek satır ── */}
      <div style={{
        marginBottom: 24, padding: '12px 16px', borderRadius: 14,
        border: '1px solid rgba(148,163,184,.1)', background: '#131b2b',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <PredictionAccuracyBadge variant="inline" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 220, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, color: '#8d8d8d', whiteSpace: 'nowrap' }}>Son 30 maç trend</span>
          <div style={{ flex: 1, maxWidth: 160, height: 6, borderRadius: 999, overflow: 'hidden', background: 'rgba(0,0,0,.35)' }}>
            <div style={{ height: '100%', width: `${accuracySummary.accuracyRate ?? 0}%`, background: confidenceTone.accent, transition: 'width .35s ease' }} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#f5f5f5', fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
            {accuracySummary.accuracyRate == null ? '--' : `%${accuracySummary.accuracyRate}`}
          </span>
        </div>
      </div>

      {/* ── Marka + Özet İstatistikler (Bento) — canlı içerik yukarıda, bu blok alta alındı ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr',
        gridTemplateRows: isMobile ? 'auto' : '1fr 1fr',
        gap: 10,
        marginBottom: 24,
        minHeight: isMobile ? 'auto' : 160,
      }}>

        {/* ── Hero tile — 2 satır boyunca sol ── */}
        <div style={{
          gridColumn: '1 / 2',
          gridRow: isMobile ? 'auto' : '1 / 3',
          padding: isMobile ? '20px 16px' : '28px 24px',
          borderRadius: 20,
          background: 'linear-gradient(135deg,#172032,#131b2b)',
          border: '1px solid #232f47',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <Zap size={28} color="#FF4655" style={{ marginBottom: 8 }} />
          <h1 style={{
            margin: '0 0 8px', fontSize: 26, fontWeight: 900, letterSpacing: '-.5px', color: '#f3f5f8',
          }}>{BRANDING.shortName}</h1>
          <p style={{ margin: '0 0 16px', fontSize: 11, color: '#444', lineHeight: 1.6 }}>
            Canli sonuclar · PandaScore verileri
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { to: '/matches',  Icon: CalendarDays, label: 'Takvim',      color: '#FF4655' },
              { to: '/tournaments', Icon: Trophy, label: 'Turnuvalar', color: '#FFB800' },
            ].map(b => (
              <Link key={b.to} to={b.to} style={{ textDecoration: 'none' }}>
                <div style={{
                  padding: '6px 13px', borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: `${b.color}18`, border: `1px solid ${b.color}44`, color: b.color,
                  transition: 'all .15s', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${b.color}28`; e.currentTarget.style.borderColor = `${b.color}88` }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${b.color}18`; e.currentTarget.style.borderColor = `${b.color}44` }}
                ><b.Icon size={13} strokeWidth={2.2} />{b.label}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── 4 Stat tile — sağdaki 2 sütuna 2×2 grid ── */}
        {statTiles.map((s, i) => (
          <div key={s.label} style={{
            gridColumn: isMobile ? '1 / 2' : ((i % 2 === 0) ? '2 / 3' : '3 / 4'),
            gridRow:    isMobile ? 'auto' : ((i < 2) ? '1 / 2' : '2 / 3'),
            padding: '14px 12px',
            borderRadius: 16,
            textAlign: 'center',
            background: 'linear-gradient(135deg,#172032,#131b2b)',
            border: `1px solid ${s.color}1a`,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            transition: 'border-color .2s',
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = `${s.color}44`}
            onMouseLeave={e => e.currentTarget.style.borderColor = `${s.color}1a`}
          >
            <s.Icon size={18} strokeWidth={2} color={s.color} style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 22, fontWeight: 900, color: s.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {s.value}
            </div>
            <div style={{ fontSize: 9, color: '#383838', textTransform: 'uppercase', letterSpacing: '.6px', marginTop: 4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Hızlı Linkler — 4 Bento tile ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,1fr)', gap: 10 }}>
        {[
          { to: '/matches',  Icon: CalendarDays, label: 'Maç Takvimi', sub: 'Yaklaşan & Biten',  color: '#FF4655' },
          { to: '/tournaments', Icon: Trophy, label: 'Turnuvalar', sub: 'Aktif ve Geçmiş',  color: '#FFB800' },
          { to: '/scout',    Icon: FlaskConical, label: 'Scout Engine', sub: 'B2B · Private Beta', color: '#5eead4' },
          { to: '/news',     Icon: Newspaper, label: 'Haberler',    sub: 'Son gelişmeler',     color: '#4CAF50' },
        ].map(l => (
          <Link key={l.to} to={l.to} style={{ textDecoration: 'none' }}>
            <div style={{
              padding: '16px 14px', borderRadius: 16,
              background: 'linear-gradient(135deg,#172032,#131b2b)',
              border: `1px solid ${l.color}18`,
              transition: 'all .18s', cursor: 'pointer',
            }}
              onMouseEnter={e => {
                e.currentTarget.style.background    = `${l.color}0c`
                e.currentTarget.style.borderColor   = `${l.color}44`
                e.currentTarget.style.transform     = 'translateY(-3px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background    = 'linear-gradient(135deg,#172032,#131b2b)'
                e.currentTarget.style.borderColor   = `${l.color}18`
                e.currentTarget.style.transform     = 'translateY(0)'
              }}
            >
              <l.Icon size={20} strokeWidth={2} color={l.color} style={{ marginBottom: 7 }} />
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
          0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(255,70,85,.55); }
          50% { opacity: .5; box-shadow: 0 0 1px rgba(255,70,85,.4); }
        }
        /* Canlı kart üst vurgusu — kırmızı yavaş & soft sağa-sola süzülür */
        @keyframes liveAccentDrift {
          0%   { background-position: 0% 0;   opacity: .8; }
          50%  { opacity: 1; }
          100% { background-position: 100% 0; opacity: .8; }
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
    </div>
  )
}

