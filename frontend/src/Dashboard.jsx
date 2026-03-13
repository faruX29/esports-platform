/**
 * Dashboard.jsx — Bento Grid Layout
 * FavoritesBar → Stats Bento → Live Grid → Today List → Quick Links
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link }                from 'react-router-dom'
import { supabase }                         from './supabaseClient'
import { useGame, gameMatchesFilter }       from './GameContext'
import { isTurkishTeam }                   from './constants'
import { useUser }                          from './context/UserContext'
import { summarizePlayerMatchStats, pickRowTimestamp } from './utils/playerMetrics'

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

/* ── FavoritesBar ─────────────────────────────────────────────────────────── */
function FavoritesBar({ navigate }) {
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
      team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
      team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
      tournament:tournaments(id,name), game:games(id,name)
    `).or(orFilter)
      .order('scheduled_at', { ascending: true })
      .limit(20)
      .then(({ data }) => { setMatches(data || []); setLoading(false) })
  }, [favTeamIds])

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
          <span style={{ fontSize: 12 }}>⭐</span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', color: '#FFD700', textTransform: 'uppercase' }}>
            My Favorites
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
                onClick={() => navigate(`/match/${m.id}`)}
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
                  <span style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700 }}>
                    {m.game?.name || '—'}
                  </span>
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
}

/* ── AI Win Bar ───────────────────────────────────────────────────────────── */
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

/* ── LiveMatchCard ────────────────────────────────────────────────────────── */
function LiveMatchCard({ match: m, onClick, favs, onToggleFav }) {
  const isFin      = m.status === 'finished'
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
      onClick={onClick}
      style={{
        position: 'relative',
        borderRadius: 16,
        /* TR banner varsa üstten 22px fazla boşluk */
        padding: hasTurkish ? '30px 16px 14px' : '14px 16px',
        background: 'linear-gradient(160deg,#141414,#0e0e0e)',
        cursor: 'pointer',
        border: '1.5px solid rgba(255,70,85,.4)',
        boxShadow: '0 0 20px rgba(255,70,85,.07)',
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
        <span style={{
          padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700,
          letterSpacing: '.7px', textTransform: 'uppercase',
          background: 'rgba(255,70,85,.15)', color: '#FF4655',
        }}>
          {m.game?.name || '—'}
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#FF4655', animation: 'livePulse 1.2s infinite' }}>
          🔴 LIVE
        </span>
      </div>

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
        <div style={{ textAlign: 'center', flexShrink: 0, padding: '0 4px' }}>
          <div style={{
            fontSize: 20, fontWeight: 900, color: '#fff',
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px', lineHeight: 1,
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
      <WinBar
        predA={m.prediction_team_a}
        predB={m.prediction_team_b}
        confidence={m.prediction_confidence}
      />
    </div>
  )
}

/* ── UpcomingRow ──────────────────────────────────────────────────────────── */
function UpcomingRow({ match: m, onClick }) {
  const badge = getStatusBadge(m.status)
  const turkA = isTurkishTeam(m.team_a?.name ?? '')
  const turkB = isTurkishTeam(m.team_b?.name ?? '')
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px', borderRadius: 12, cursor: 'pointer',
        background: '#0e0e0e', border: '1px solid #181818', transition: 'all .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#141414'; e.currentTarget.style.borderColor = '#2a2a2a' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#0e0e0e'; e.currentTarget.style.borderColor = '#181818' }}
    >
      {/* Saat */}
      <div style={{ fontSize: 10, color: '#555', flexShrink: 0, width: 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {fmtTime(m.scheduled_at)}
      </div>

      {/* Oyun etiketi */}
      <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: '#181818', color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', flexShrink: 0 }}>
        {m.game?.name?.slice(0, 3).toUpperCase() || '—'}
      </span>

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

      {/* Badge */}
      <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 8, fontWeight: 700, color: badge.color, background: badge.bg, flexShrink: 0 }}>
        {badge.text}
      </span>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
   Dashboard — default export
══════════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const navigate       = useNavigate()
  const { activeGame } = useGame()
  const {
    followedTeamIds,
    followedPlayerIds,
    toggleTeamFollow,
  } = useUser()

  const [liveMatches,     setLiveMatches]     = useState([])
  const [upcomingMatches, setUpcomingMatches] = useState([])
  const [myFeedMatches,   setMyFeedMatches]   = useState([])
  const [liveFavCount,    setLiveFavCount]    = useState(0)
  const [dreamTeam, setDreamTeam] = useState([])
  const [dreamLoading, setDreamLoading] = useState(false)
  const [stats,           setStats]           = useState({ total: 0, live: 0, today: 0, teams: 0 })
  const [loading,         setLoading]         = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999)

      const selectStr = `
        id, status, scheduled_at,
        team_a_id, team_b_id, winner_id, team_a_score, team_b_score,
        prediction_team_a, prediction_team_b, prediction_confidence,
        team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
        team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
        tournament:tournaments(id,name),
        game:games(id,name)
      `
      const [liveRes, upcomingRes] = await Promise.all([
        supabase.from('matches').select(selectStr)
          .eq('status', 'running')
          .order('scheduled_at', { ascending: true })
          .limit(18),
        supabase.from('matches').select(selectStr)
          .eq('status', 'not_started')
          .gte('scheduled_at', todayStart.toISOString())
          .lte('scheduled_at', todayEnd.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(30),
      ])

      const live     = (liveRes.data     || []).filter(m => gameMatchesFilter(m.game?.name || '', activeGame))
      const upcoming = (upcomingRes.data || []).filter(m => gameMatchesFilter(m.game?.name || '', activeGame))

      setLiveMatches(live)
      setUpcomingMatches(upcoming)
      setStats({
        live:  live.length,
        today: upcoming.length,
        total: live.length + upcoming.length,
        teams: new Set([...live, ...upcoming].flatMap(m => [m.team_a_id, m.team_b_id]).filter(Boolean)).size,
      })
    } catch (e) { console.error('Dashboard fetch:', e.message) }
    finally     { setLoading(false) }
  }, [activeGame])

  useEffect(() => { fetchData() }, [fetchData])

  function handleToggleFav(teamId) {
    if (!teamId) return
    toggleTeamFollow(teamId)
  }

  useEffect(() => {
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
          setMyFeedMatches([])
          setLiveFavCount(0)
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
            team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
            team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
            tournament:tournaments(id,name),
            game:games(id,name)
          `)
          .or(orFilter)
          .in('status', ['not_started', 'running'])
          .gte('scheduled_at', now.toISOString())
          .lte('scheduled_at', soon.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(40)

        const filtered = (data || [])
          .filter(m => gameMatchesFilter(m.game?.name || '', activeGame))

        setMyFeedMatches(filtered)
        setLiveFavCount(filtered.filter(m => m.status === 'running').length)
      } catch (e) {
        console.error('Dashboard my-feed fetch:', e.message)
      }
    }

    fetchMyFeed()
  }, [followedTeamIds, followedPlayerIds, activeGame])

  useEffect(() => {
    let cancelled = false

    async function fetchDreamTeam() {
      setDreamLoading(true)
      try {
        const [statsRes, playersRes, teamsRes] = await Promise.all([
          supabase.from('player_match_stats').select('*').limit(12000),
          supabase.from('players').select('id,nickname,image_url,team_pandascore_id').limit(2000),
          supabase.from('teams').select('id,name,logo_url').limit(800),
        ])

        if (statsRes.error || playersRes.error || teamsRes.error) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
        const rows = (statsRes.data || []).filter(row => {
          const ts = pickRowTimestamp(row)
          if (!ts) return true
          const d = new Date(ts).getTime()
          return Number.isFinite(d) ? d >= weekAgo : true
        })

        const byPlayer = new Map()
        for (const row of rows) {
          const pid = row?.player_id
          if (!pid) continue
          if (!byPlayer.has(pid)) byPlayer.set(pid, [])
          byPlayer.get(pid).push(row)
        }

        const playersMap = new Map((playersRes.data || []).map(p => [String(p.id), p]))
        const teamsMap = new Map((teamsRes.data || []).map(t => [String(t.id), t]))

        const ranked = [...byPlayer.entries()].map(([pid, list]) => {
          const p = playersMap.get(String(pid))
          if (!p) return null
          const summary = summarizePlayerMatchStats(list)
          const team = p.team_pandascore_id ? teamsMap.get(String(p.team_pandascore_id)) : null
          const score = (summary.impact * 0.6) + (summary.kd * 20) + (summary.winRate * 0.2)
          return {
            id: p.id,
            nickname: p.nickname,
            image_url: p.image_url,
            team,
            score,
            ...summary,
          }
        }).filter(Boolean)
          .filter(x => x.sampleMatches > 0)
          .sort((a, b) => b.score - a.score)
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
  }, [])

  /* ── Stat tile tanımları ── */
  const statTiles = [
    { icon: '🔴', value: loading ? '…' : stats.live,  label: 'Canlı',    color: '#FF4655' },
    { icon: '⏳', value: loading ? '…' : stats.today, label: 'Bugün',    color: '#FFB800' },
    { icon: '🎮', value: loading ? '…' : stats.total, label: 'Toplam',   color: '#6366f1' },
    { icon: '🛡️', value: loading ? '…' : stats.teams, label: 'Takımlar', color: '#4CAF50' },
  ]

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: '20px 18px 60px', color: 'white' }}>

      {/* ── Favorites Bar ── */}
      <FavoritesBar navigate={navigate} />

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
                <UpcomingRow key={m.id} match={m} onClick={() => navigate(`/match/${m.id}`)} />
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
        gridTemplateColumns: '2fr 1fr 1fr',  /* ← 3 sütun: hero geniş, stat'lar dar */
        gridTemplateRows: '1fr 1fr',
        gap: 10,
        marginBottom: 24,
        minHeight: 160,
      }}>

        {/* ── Hero tile — 2 satır boyunca sol ── */}
        <div style={{
          gridColumn: '1 / 2',
          gridRow: '1 / 3',          /* her iki satırı kap */
          padding: '28px 24px',
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
          }}>EsportsHub</h1>
          <p style={{ margin: '0 0 16px', fontSize: 11, color: '#444', lineHeight: 1.6 }}>
            Canlı sonuçlar · AI tahminleri · PandaScore verileri
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { to: '/matches',  label: '📅 Takvim',      color: '#FF4655' },
              { to: '/rankings', label: '🏆 Sıralamalar', color: '#FFB800' },
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
            gridColumn: (i % 2 === 0) ? '2 / 3' : '3 / 4',
            gridRow:    (i < 2)       ? '1 / 2' : '2 / 3',
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
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#ff9aa9', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            🧬 Dream Team (Week)
          </span>
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,154,169,.3),transparent)' }} />
        </div>

        <div style={{ border: '1px solid #222', borderRadius: 14, background: 'radial-gradient(circle at 8% 8%, rgba(200,16,46,.18), transparent 35%), #0f0f0f', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1.3fr 1fr .7fr .7fr .7fr .7fr', gap: 8, padding: '11px 14px', borderBottom: '1px solid #202020', fontSize: 10, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '.6px' }}>
            <div>Rank</div><div>Player</div><div>Team</div><div>K/D</div><div>HS%</div><div>Impact</div><div>Score</div>
          </div>
          {dreamLoading && <div style={{ padding: 14, color: '#777', fontSize: 12 }}>Dream Team hesaplanıyor...</div>}
          {!dreamLoading && dreamTeam.length === 0 && <div style={{ padding: 14, color: '#777', fontSize: 12 }}>Haftalık oyuncu verisi bulunamadı.</div>}
          {!dreamLoading && dreamTeam.map((p, idx) => (
            <div key={p.id} onClick={() => navigate(`/player/${p.id}`)} style={{ display: 'grid', gridTemplateColumns: '60px 1.3fr 1fr .7fr .7fr .7fr .7fr', gap: 8, alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid #191919', cursor: 'pointer', background: idx === 0 ? 'linear-gradient(90deg, rgba(200,16,46,.22), transparent 62%)' : 'transparent' }}>
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
              <div style={{ fontWeight: 700 }}>{p.kd.toFixed(2)}</div>
              <div style={{ fontWeight: 700 }}>{Math.round(p.hsPct)}%</div>
              <div style={{ fontWeight: 800, color: '#ff9aa9' }}>{Math.round(p.impact)}</div>
              <div style={{ fontWeight: 800, color: '#fff' }}>{Math.round(p.score)}</div>
            </div>
          ))}
        </div>
      </div>

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 12 }}>
            {[1,2,3].map(i => <Sk key={i} h="150px" r="16px" />)}
          </div>
        ) : liveMatches.length === 0 ? (
          <div style={{ padding: '20px', borderRadius: 16, background: '#0e0e0e', border: '1px solid #181818', textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>😴</div>
            <div style={{ fontSize: 11, color: '#2a2a2a' }}>Şu an canlı maç yok</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 12 }}>
            {liveMatches.map(m => (
              <LiveMatchCard
                key={m.id}
                match={m}
                onClick={() => navigate(`/match/${m.id}`)}
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
            ⏳ Bugün
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
            Bugün için planlanmış maç bulunamadı
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {upcomingMatches.slice(0, 14).map(m => (
              <UpcomingRow key={m.id} match={m} onClick={() => navigate(`/match/${m.id}`)} />
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {[
          { to: '/matches',  icon: '📅', label: 'Maç Takvimi', sub: 'Yaklaşan & Biten',  color: '#FF4655' },
          { to: '/rankings', icon: '🏆', label: 'Sıralamalar', sub: 'Rating Puanlaması',  color: '#FFB800' },
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
        /* FavoritesBar scroll — webkit için de gizle */
        .fav-scroll::-webkit-scrollbar { display: none }
      `}</style>
    </div>
  )
}

