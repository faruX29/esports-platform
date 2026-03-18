/**
 * PlayerPage.jsx  —  /player/:id
 * Oyuncu profil sayfası
 *  • Hero kapak (fotoğraf / placeholder + milli glow)
 *  • Scout Analytics (match_stats JSONB'den)
 *  • Rol bazlı stat kutucukları
 *  • Son maç tablosu
 *  • Takım linki
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate }           from 'react-router-dom'
import { supabase }                         from './supabaseClient'
import { getRoleBadge }                     from './roleHelper'
import { isTurkishTeam } from './constants'
import { useUser } from './context/UserContext'
import { summarizePlayerMatchStats, metricBars } from './utils/playerMetrics'

// ─── Yardımcılar ────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(sec) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(90deg,#111 25%,#1c1c1c 50%,#111 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  )
}

// ─── Stat kutucuğu ───────────────────────────────────────────────────────────
function StatBox({ icon, value, label, color = '#fff', sub }) {
  return (
    <div style={{
      textAlign: 'center', padding: '14px 18px', minWidth: 90,
      background: '#0d0d0d', borderRadius: 14,
      border: '1px solid #1e1e1e', flex: '1 1 90px',
    }}>
      <div style={{ fontSize: 20, marginBottom: 3 }}>{icon}</div>
      <div style={{
        fontSize: 24, fontWeight: 900, color, lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#333', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ─── Progress bar ────────────────────────────────────────────────────────────
function ProgressBar({ pct, color = '#FF4655', label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: '#555' }}>{label}</span>
        <span style={{ color, fontWeight: 800 }}>{value}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: '#111', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%',
          background: `linear-gradient(90deg,${color}88,${color})`,
          borderRadius: 3, transition: 'width .6s cubic-bezier(.34,1.56,.64,1)',
        }} />
      </div>
    </div>
  )
}

// ─── Oyuncu avatar ───────────────────────────────────────────────────────────
function PlayerHeroAvatar({ src, name, size = 120, isTR }) {
  const [err, setErr] = useState(false)
  const initials = (name || '?').split(/[\s_]/).map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const borderColor = isTR ? '#C8102E' : '#FF4655'

  if (src && !err) {
    return (
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <img
          src={src} alt={name}
          onError={() => setErr(true)}
          style={{
            width: size, height: size, borderRadius: '50%', objectFit: 'cover',
            border: `3px solid ${borderColor}`,
            boxShadow: `0 0 28px ${borderColor}55`,
            display: 'block',
          }}
        />
        {isTR && (
          <span style={{ position: 'absolute', bottom: 2, right: 2, fontSize: 18 }}>🇹🇷</span>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'linear-gradient(135deg,#1a1a1a,#2a2a2a)',
        border: `3px solid ${borderColor}`,
        boxShadow: `0 0 28px ${borderColor}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.28, fontWeight: 900, color: '#444',
      }}>
        {initials}
      </div>
      {isTR && (
        <span style={{ position: 'absolute', bottom: 2, right: 2, fontSize: 18 }}>🇹🇷</span>
      )}
    </div>
  )
}

// ─── Maç satırı ──────────────────────────────────────────────────────────────
function MatchRow({ match, teamId }) {
  const navigate = useNavigate()
  const isA      = match.team_a_id === teamId
  const myTeam   = isA ? match.team_a : match.team_b
  const opp      = isA ? match.team_b : match.team_a
  const myScore  = isA ? match.team_a_score  : match.team_b_score
  const oppScore = isA ? match.team_b_score  : match.team_a_score
  const isWin    = match.winner_id && match.winner_id === teamId
  const isLoss   = match.winner_id && match.winner_id !== teamId

  return (
    <div
      onClick={() => navigate(`/match/${match.id}`)}
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr auto auto auto',
        gap: 10, alignItems: 'center',
        padding: '10px 14px', borderRadius: 10,
        background: '#0d0d0d', border: '1px solid #181818',
        cursor: 'pointer', transition: 'border-color .15s, background .15s',
        marginBottom: 6,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.background = '#111' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#181818'; e.currentTarget.style.background = '#0d0d0d' }}
    >
      {/* W/L */}
      <div style={{
        width: 28, height: 28, borderRadius: 8, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 900,
        background: isWin  ? 'rgba(76,175,80,.2)'  : isLoss ? 'rgba(255,70,85,.2)'  : '#1e1e1e',
        border:     isWin  ? '1.5px solid #4CAF50' : isLoss ? '1.5px solid #FF4655' : '1.5px solid #333',
        color:      isWin  ? '#4CAF50'             : isLoss ? '#FF4655'             : '#555',
      }}>
        {isWin ? 'W' : isLoss ? 'L' : '—'}
      </div>

      {/* Opponent */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {opp?.logo_url
          ? <img src={opp.logo_url} alt="" style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }} />
          : <div style={{ width: 22, height: 22, background: '#1e1e1e', borderRadius: 4, flexShrink: 0 }} />
        }
        <span style={{ fontSize: 12, fontWeight: 600, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          vs {opp?.name ?? '?'}
        </span>
      </div>

      {/* Score */}
      <div style={{ fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: '#eee', whiteSpace: 'nowrap' }}>
        {myScore ?? '–'} : {oppScore ?? '–'}
      </div>

      {/* Game */}
      <div style={{ fontSize: 10, color: '#444', whiteSpace: 'nowrap', textAlign: 'right' }}>
        {match.game?.name === 'Counter-Strike 2' ? 'CS2'
          : match.game?.name === 'League of Legends' ? 'LoL'
          : match.game?.name?.includes?.('alorant') ? 'VAL'
          : (match.game?.name ?? '?')}
      </div>

      {/* Date */}
      <div style={{ fontSize: 10, color: '#383838', whiteSpace: 'nowrap', textAlign: 'right' }}>
        {new Date(match.scheduled_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}
      </div>
    </div>
  )
}

// ─── Scout Metrik Paneli ─────────────────────────────────────────────────────
function ScoutPanel({ analytics, individual }) {
  if (!analytics) return null

  const {
    totalMatches, wonMatches, lostMatches,
    overallWinRate, mapWinRates, avgWinLen, avgLossLen, impactScore,
  } = analytics

  const impactColor = impactScore >= 70 ? '#4CAF50' : impactScore >= 45 ? '#FFB800' : '#FF4655'
  const mapLabels   = { 1: 'Game 1', 2: 'Game 2', 3: 'Decider' }
  const individualBars = individual ? metricBars(individual) : null

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionTitle icon="📋" label="Scout Analytics" />

      {/* Impact + W/L */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {/* Impact gauge */}
        <div style={{
          flex: '1 1 130px', background: '#0d0d0d', borderRadius: 14,
          border: `1px solid ${impactColor}33`, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
        }}>
          <div style={{ fontSize: 11, color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
            Impact Score
          </div>
          <div style={{
            fontSize: 38, fontWeight: 900, color: impactColor,
            lineHeight: 1, fontVariantNumeric: 'tabular-nums',
          }}>
            {Math.round(impactScore)}
          </div>
          <div style={{ width: '100%', height: 4, borderRadius: 2, background: '#1a1a1a', overflow: 'hidden' }}>
            <div style={{
              width: `${impactScore}%`, height: '100%',
              background: `linear-gradient(90deg,${impactColor}77,${impactColor})`,
              transition: 'width .7s cubic-bezier(.34,1.56,.64,1)',
            }} />
          </div>
        </div>

        {/* W/L record */}
        <div style={{ flex: '1 1 130px', background: '#0d0d0d', borderRadius: 14, border: '1px solid #1e1e1e', padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Record</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#4CAF50' }}>{wonMatches}</div>
              <div style={{ fontSize: 10, color: '#444' }}>W</div>
            </div>
            <div style={{ fontSize: 20, color: '#2a2a2a', alignSelf: 'center' }}>/</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#FF4655' }}>{lostMatches}</div>
              <div style={{ fontSize: 10, color: '#444' }}>L</div>
            </div>
          </div>
          <ProgressBar
            pct={overallWinRate}
            color={overallWinRate >= 60 ? '#4CAF50' : overallWinRate >= 45 ? '#FFB800' : '#FF4655'}
            label="" value={`${Math.round(overallWinRate)}% WR`}
          />
        </div>
      </div>

      {individual && (
        <div style={{ background: '#0d0d0d', borderRadius: 14, border: '1px solid #1e1e1e', padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#444', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
            🎯 Individual Performance (Player Match Stats)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: 10, marginBottom: 12 }}>
            <StatBox icon="⚔️" value={individual.totalKills} label="Kills" color="#ff6a7f" />
            <StatBox icon="☠️" value={individual.totalDeaths} label="Deaths" color="#f3f3f3" />
            <StatBox icon="🤝" value={individual.totalAssists} label="Assists" color="#93c5fd" />
            <StatBox icon="📌" value={`${Math.round(individual.hsPct)}%`} label="HS%" color="#fff" />
          </div>
          <ProgressBar pct={individualBars.kdBar} color="#ff6a7f" label="K/D Ratio" value={individual.kd.toFixed(2)} />
          <ProgressBar pct={individualBars.hsBar} color="#f1f1f1" label="Headshot Rate" value={`${Math.round(individual.hsPct)}%`} />
          <ProgressBar pct={individualBars.winBar} color="#4CAF50" label="Win Rate" value={`${Math.round(individual.winRate)}%`} />
          <ProgressBar pct={individualBars.impactBar} color="#ff9aa9" label="Impact Score" value={`${Math.round(individual.impact)}`} />
        </div>
      )}

      {/* Map win rates */}
      <div style={{ background: '#0d0d0d', borderRadius: 14, border: '1px solid #1e1e1e', padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#444', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
          🗺️ Oyun Bazı Performans
        </div>
        {[1, 2, 3].map(pos => {
          const d = mapWinRates[pos]
          if (!d || d.total === 0) return (
            <div key={pos} style={{ marginBottom: 10 }}>
              <ProgressBar pct={0} color="#2a2a2a" label={mapLabels[pos]} value="—" />
            </div>
          )
          return (
            <ProgressBar
              key={pos} pct={d.rate}
              color={d.rate >= 60 ? '#4CAF50' : d.rate >= 45 ? '#FFB800' : '#FF4655'}
              label={`${mapLabels[pos]} (${d.total} maç)`}
              value={`${Math.round(d.rate)}%`}
            />
          )
        })}
      </div>

      {/* Avg durations */}
      {(avgWinLen || avgLossLen) && (
        <div style={{ display: 'flex', gap: 10 }}>
          {avgWinLen && (
            <div style={{ flex: 1, background: '#0d0d0d', borderRadius: 10, border: '1px solid rgba(76,175,80,.2)', padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 4 }}>⏱ Ortalama Galibiyet</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#4CAF50' }}>{fmtDuration(Math.round(avgWinLen))}</div>
            </div>
          )}
          {avgLossLen && (
            <div style={{ flex: 1, background: '#0d0d0d', borderRadius: 10, border: '1px solid rgba(255,70,85,.2)', padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#444', marginBottom: 4 }}>⏱ Ortalama Mağlubiyet</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#FF4655' }}>{fmtDuration(Math.round(avgLossLen))}</div>
            </div>
          )}
        </div>
      )}

      {!individual && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,184,0,.05)', border: '1px solid rgba(255,184,0,.15)', fontSize: 11, color: '#555' }}>
          ℹ️ Bireysel oyuncu satiri bulunamadi; takim bazli scout verisi gosteriliyor.
        </div>
      )}
    </div>
  )
}

// ─── Bölüm başlığı ───────────────────────────────────────────────────────────
function SectionTitle({ icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: '#1a1a1a' }} />
    </div>
  )
}

// ─── Scout Analytics Hesaplayıcı (local copy) ────────────────────────────────
function computeScoutAnalytics(statsRows, teamId) {
  let totalMatches = 0, wonMatches = 0
  const mapStats   = { 1: { won: 0, total: 0 }, 2: { won: 0, total: 0 }, 3: { won: 0, total: 0 } }
  const winLengths = [], lossLengths = []

  for (const row of statsRows) {
    const games = row.stats?.games_detail || []
    if (games.length === 0) {
      totalMatches++
      if (row.stats?.score && row.team_id === teamId) wonMatches++
      continue
    }
    totalMatches++
    let matchWon = false
    games.forEach((g, idx) => {
      const pos = idx + 1
      if (pos > 3) return
      mapStats[pos].total++
      const gWon = Number(g.winner_id) === Number(teamId)
      if (gWon) { mapStats[pos].won++; matchWon = true }
      if (g.length_seconds) {
        if (gWon) winLengths.push(g.length_seconds)
        else      lossLengths.push(g.length_seconds)
      }
    })
    if (matchWon) wonMatches++
  }

  const overallWinRate = totalMatches > 0 ? (wonMatches / totalMatches) * 100 : 0
  const mapWinRates    = {}
  for (const [pos, s] of Object.entries(mapStats)) {
    mapWinRates[pos] = s.total > 0 ? { rate: (s.won / s.total) * 100, total: s.total, won: s.won } : null
  }
  const avgWinLen  = winLengths.length  > 0 ? winLengths.reduce((a,b)=>a+b,0)  / winLengths.length  : null
  const avgLossLen = lossLengths.length > 0 ? lossLengths.reduce((a,b)=>a+b,0) / lossLengths.length : null
  const impactScore = overallWinRate * 0.5 + Math.min(totalMatches, 100) * 0.3 + (mapWinRates[3]?.rate ?? overallWinRate) * 0.2

  return { totalMatches, wonMatches, lostMatches: totalMatches - wonMatches, overallWinRate, mapWinRates, avgWinLen, avgLossLen, impactScore }
}

// ─── Nationality etiketi ─────────────────────────────────────────────────────
const NAT_FLAGS = {
  TR: '🇹🇷', US: '🇺🇸', DE: '🇩🇪', FR: '🇫🇷', BR: '🇧🇷',
  KR: '🇰🇷', CN: '🇨🇳', RU: '🇷🇺', GB: '🇬🇧', SE: '🇸🇪',
  DK: '🇩🇰', FI: '🇫🇮', NO: '🇳🇴', PL: '🇵🇱', PT: '🇵🇹',
}

const SOCIAL_ICON_MAP = {
  twitter: { icon: '𝕏', label: 'X/Twitter' },
  twitch: { icon: '🎮', label: 'Twitch' },
  youtube: { icon: '▶', label: 'YouTube' },
  instagram: { icon: '◎', label: 'Instagram' },
  tiktok: { icon: '♪', label: 'TikTok' },
  steam: { icon: 'S', label: 'Steam' },
}

// ─── Ana Bileşen ─────────────────────────────────────────────────────────────
export default function PlayerPage() {
  const { id }   = useParams()        // players.id (UUID)
  const navigate = useNavigate()
  const { togglePlayerFollow, isPlayerFollowed } = useUser()

  const [player,    setPlayer]    = useState(null)
  const [team,      setTeam]      = useState(null)
  const [matches,   setMatches]   = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [individualStats, setIndividualStats] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // 1) Oyuncu bilgisi
      const { data: p, error: pErr } = await supabase
        .from('players')
        .select('id, nickname, real_name, role, image_url, nationality, team_pandascore_id, extra_metadata')
        .eq('id', id)
        .single()
      if (pErr) throw pErr
      setPlayer(p)

      // Paralel: takım + istatistikler + maçlar
      const [teamRes, statsRes, playerStatsRes] = await Promise.all([
        p.team_pandascore_id
          ? supabase.from('teams').select('id, name, logo_url, acronym, location').eq('id', p.team_pandascore_id).single()
          : { data: null, error: null },

        supabase.from('match_stats')
          .select('match_id, team_id, stats')
          .eq('team_id', p.team_pandascore_id)
          .limit(60),
        supabase
          .from('player_match_stats')
          .select('*')
          .eq('player_id', p.id)
          .limit(500),
      ])

      if (teamRes.data) setTeam(teamRes.data)

      const rows = statsRes.data || []
      if (rows.length > 0) {
        setAnalytics(computeScoutAnalytics(rows, p.team_pandascore_id))

        // Son 15 maçı çek
        const matchIds = [...new Set(rows.map(r => r.match_id).filter(Boolean))].slice(0, 15)
        if (matchIds.length > 0) {
          const { data: mData } = await supabase
            .from('matches')
            .select(`
              id, status, scheduled_at, winner_id,
              team_a_id, team_b_id, team_a_score, team_b_score,
              team_a:teams!matches_team_a_id_fkey(id, name, logo_url),
              team_b:teams!matches_team_b_id_fkey(id, name, logo_url),
              game:games(id, name)
            `)
            .in('id', matchIds)
            .eq('status', 'finished')
            .order('scheduled_at', { ascending: false })
          setMatches(mData || [])
        }
      }

      if (!playerStatsRes.error) {
        const summary = summarizePlayerMatchStats(playerStatsRes.data || [])
        if (summary.sampleMatches > 0) {
          setIndividualStats(summary)
        } else {
          setIndividualStats(null)
        }
      } else {
        setIndividualStats(null)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchAll() }, [fetchAll])

  function handleToggleFollow() {
    if (!player) return
    togglePlayerFollow(player.id)
  }

  // ── Loading ────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px' }}>
      <Sk h="220px" r="20px" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginTop: 20 }}>
        {[1,2,3,4].map(i => <Sk key={i} h="90px" r="14px" />)}
      </div>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[1,2,3].map(i => <Sk key={i} h="44px" r="10px" />)}
      </div>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  )

  if (error || !player) return (
    <div style={{ textAlign: 'center', padding: 80, color: '#FF4655' }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>❌</div>
      <div style={{ fontSize: 16, marginBottom: 20 }}>{error ?? 'Oyuncu bulunamadı'}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '10px 24px', background: '#FF4655', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
        ← Geri
      </button>
    </div>
  )

  const badge   = getRoleBadge(player.role)
  const isTR    = player.nationality === 'TR' || player.nationality === 'TUR' || isTurkishTeam(team?.name ?? '')
  const flag    = NAT_FLAGS[player.nationality] ?? (isTR ? '🇹🇷' : null)
  const followed = isPlayerFollowed(player.id)
  const liquipediaMeta = player?.extra_metadata?.liquipedia || {}
  const socials = Object.entries(liquipediaMeta.social_links || {}).filter(([_, href]) => typeof href === 'string' && href.trim())
  const formerTeams = Array.isArray(liquipediaMeta.former_teams) ? liquipediaMeta.former_teams.slice(0, 6) : []

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 0 80px', color: 'white' }}>

      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes glow    { 0%,100%{box-shadow:0 0 20px #C8102E44} 50%{box-shadow:0 0 40px #C8102E88} }
      `}</style>

      {/* ══ HEADER KAPAK ══════════════════════════════════════════ */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(160deg,#0d0d0d 0%,#111 100%)',
        borderBottom: isTR ? '1px solid rgba(200,16,46,.4)' : '1px solid #1a1a1a',
        padding: '36px 28px 28px',
        marginBottom: 28,
      }}>
        {/* Turkish radial glow */}
        {isTR && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 20% 50%, rgba(200,16,46,.14) 0%, transparent 65%)',
          }} />
        )}

        {/* Geri & Takip et */}
        <div style={{ position: 'absolute', top: 16, left: 20, right: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: 'rgba(255,255,255,.06)', border: '1px solid #222', borderRadius: 8, color: '#888', padding: '6px 12px', fontSize: 12, cursor: 'pointer', transition: 'color .15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#888'}
          >← Geri</button>

          <button
            onClick={handleToggleFollow}
            style={{
              background: followed ? 'rgba(255,215,0,.15)' : 'rgba(255,255,255,.06)',
              border: followed ? '1px solid rgba(255,215,0,.5)' : '1px solid #222',
              borderRadius: 8, color: followed ? '#FFD700' : '#777',
              padding: '6px 14px', fontSize: 13, cursor: 'pointer', transition: 'all .15s', fontWeight: followed ? 700 : 400,
            }}
          >{followed ? '⭐ Takip Ediliyor' : '☆ Takip Et'}</button>
        </div>

        {/* Oyuncu kimliği */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 30, flexWrap: 'wrap' }}>
          <PlayerHeroAvatar src={player.image_url} name={player.nickname} size={110} isTR={isTR} />

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Handle */}
            <h1 style={{
              margin: '0 0 4px', fontSize: 32, fontWeight: 900, lineHeight: 1.1,
              background: isTR
                ? 'linear-gradient(135deg,#fff 40%,#ff8a8a)'
                : 'linear-gradient(135deg,#fff,#777)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>{player.nickname}</h1>

            {/* Gerçek isim */}
            {player.real_name && (
              <div style={{ fontSize: 14, color: '#555', marginBottom: 8 }}>{player.real_name}</div>
            )}

            {/* Badge satırı */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              {player.role && (
                <span style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                  background: badge.bg, border: `1px solid ${badge.border}`,
                  color: badge.color, boxShadow: `0 0 8px ${badge.border}55`,
                }}>{badge.label}</span>
              )}
              {flag && (
                <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#888' }}>
                  {flag} {player.nationality}
                </span>
              )}
              {isTR && (
                <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800, background: 'rgba(200,16,46,.2)', border: '1px solid rgba(200,16,46,.5)', color: '#ff6b7a' }}>
                  🇹🇷 Turkish Pro
                </span>
              )}
            </div>

            {/* Takım linki */}
            {team ? (
              <div
                onClick={() => navigate(`/team/${team.id}`)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  padding: '8px 14px', borderRadius: 12, cursor: 'pointer',
                  background: '#111', border: '1.5px solid #222',
                  transition: 'border-color .15s', maxWidth: 280,
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#FF4655'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#222'}
              >
                {team.logo_url
                  ? <img src={team.logo_url} alt={team.name} style={{ width: 28, height: 28, objectFit: 'contain' }} />
                  : <div style={{ width: 28, height: 28, background: '#1e1e1e', borderRadius: 6 }} />
                }
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#ddd' }}>{team.name}</div>
                  {team.location && <div style={{ fontSize: 10, color: '#555' }}>📍 {team.location}</div>}
                </div>
                <span style={{ fontSize: 11, color: '#444', marginLeft: 'auto' }}>→</span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#383838', fontStyle: 'italic' }}>Takım bilgisi yok (Free Agent?)</div>
            )}

            {socials.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {socials.map(([network, href]) => {
                  const meta = SOCIAL_ICON_MAP[network] || { icon: '●', label: network }
                  return (
                    <a
                      key={network}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      title={meta.label}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        textDecoration: 'none',
                        borderRadius: 999, padding: '5px 10px',
                        border: '1px solid rgba(200,16,46,.42)',
                        background: 'radial-gradient(circle at 20% 20%, rgba(200,16,46,.44), rgba(0,0,0,.88))',
                        color: '#fff', fontSize: 11, fontWeight: 700,
                      }}
                    >
                      <span>{meta.icon}</span>
                      <span>{meta.label}</span>
                    </a>
                  )
                })}
              </div>
            )}

            {formerTeams.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {formerTeams.map(teamName => (
                  <span key={teamName} style={{ fontSize: 10, color: '#f0c2c8', border: '1px solid rgba(200,16,46,.3)', borderRadius: 8, padding: '3px 7px', background: 'rgba(200,16,46,.08)' }}>
                    {teamName}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Hızlı istatistikler */}
        {analytics && (
          <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
            <StatBox icon="⚔️" value={analytics.totalMatches}   label="Maç"        color="#fff"     />
            <StatBox icon="✅" value={analytics.wonMatches}     label="Galibiyet"  color="#4CAF50"  />
            <StatBox icon="❌" value={analytics.lostMatches}    label="Mağ."       color="#FF4655"  />
            <StatBox
              icon="📊"
              value={`${Math.round(analytics.overallWinRate)}%`}
              label="Win Rate"
              color={analytics.overallWinRate >= 60 ? '#4CAF50' : analytics.overallWinRate >= 45 ? '#FFB800' : '#FF4655'}
            />
            <StatBox
              icon="🎯"
              value={Math.round(individualStats?.impact ?? analytics.impactScore)}
              label="Impact"
              color={(individualStats?.impact ?? analytics.impactScore) >= 70 ? '#4CAF50' : (individualStats?.impact ?? analytics.impactScore) >= 45 ? '#818cf8' : '#FF4655'}
            />
            {individualStats && <StatBox icon="📌" value={`${Math.round(individualStats.hsPct)}%`} label="HS%" color="#f4f4f4" />}
            {individualStats && <StatBox icon="⚡" value={individualStats.kd.toFixed(2)} label="K/D" color="#ff6a7f" />}
          </div>
        )}
      </div>

      {/* ══ İÇERİK ════════════════════════════════════════════════ */}
      <div style={{ padding: '0 20px' }}>

        {/* Scout Analytics */}
        <ScoutPanel analytics={analytics} individual={individualStats} />

        {/* Maç geçmişi */}
        {matches.length > 0 && (
          <div>
            <SectionTitle icon="🏆" label={`Son ${matches.length} Maç`} />
            {matches.map(m => (
              <MatchRow
                key={m.id} match={m}
                teamId={player.team_pandascore_id}
              />
            ))}
          </div>
        )}

        {/* Hiç veri yoksa */}
        {!analytics && matches.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#383838' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 14 }}>Bu oyuncu için henüz istatistik verisi yok</div>
            <div style={{ fontSize: 12, marginTop: 6, color: '#2a2a2a' }}>
              Maç istatistikleri ETL sonrası güncellenir
            </div>
          </div>
        )}
      </div>
    </div>
  )
}