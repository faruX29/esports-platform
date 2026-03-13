import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate }           from 'react-router-dom'
import { supabase }                         from './supabaseClient'
import { getRoleBadge }                     from './roleHelper'
import { isTurkishTeam }                   from './constants'
import { useUser }                          from './context/UserContext'

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function calcTeamRating(wins, total) {
  if (total === 0) return 0
  const wr = wins / total
  return Math.round(wr * 100 * 0.6 + Math.min(total, 100) * 0.4)
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// skeleton
function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: 'linear-gradient(90deg,#111 25%,#1a1a1a 50%,#111 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
}

// ── Form pill ─────────────────────────────────────────────────────────────────
function FormPill({ result }) {
  const cfg = {
    W: { bg: 'rgba(76,175,80,.25)',  border: '#4CAF50', color: '#4CAF50', label: 'W' },
    L: { bg: 'rgba(255,70,85,.2)',   border: '#FF4655', color: '#FF4655', label: 'L' },
    D: { bg: 'rgba(150,150,150,.15)',border: '#555',    color: '#777',    label: 'D' },
  }[result] ?? { bg: '#111', border: '#333', color: '#555', label: '?' }

  return (
    <div style={{
      width: 30, height: 30, borderRadius: 8,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: cfg.bg, border: `1.5px solid ${cfg.border}`,
      color: cfg.color, fontSize: 12, fontWeight: 900,
      boxShadow: `0 0 8px ${cfg.border}44`,
    }}>{cfg.label}</div>
  )
}

// ── Stat chip ─────────────────────────────────────────────────────────────────
function StatBox({ icon, value, label, color = '#fff' }) {
  return (
    <div style={{
      textAlign: 'center', padding: '16px 20px', minWidth: 90,
      background: '#0d0d0d', borderRadius: 14,
      border: '1px solid #1e1e1e',
    }}>
      <div style={{ fontSize: 22, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#444', marginTop: 4 }}>{label}</div>
    </div>
  )
}

// ── WinRate bar ───────────────────────────────────────────────────────────────
function WinRateBar({ wins, total }) {
  const pct = total > 0 ? Math.round((wins / total) * 100) : 0
  const color = pct >= 60 ? '#4CAF50' : pct >= 45 ? '#FFB800' : '#FF4655'
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
        <span style={{ color: '#555' }}>Win Rate</span>
        <span style={{ color, fontWeight: 800 }}>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: '#111', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 3,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          transition: 'width .6s cubic-bezier(.34,1.56,.64,1)',
        }} />
      </div>
    </div>
  )
}

// ── Avatar placeholder ────────────────────────────────────────────────────────
function PlayerAvatar({ src, name, size = 64 }) {
  const [err, setErr] = useState(false)
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  if (src && !err) {
    return (
      <img
        src={src} alt={name}
        onError={() => setErr(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid #2a2a2a', display: 'block' }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg,#1e1e1e,#2a2a2a)',
      border: '2px solid #333', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size * 0.3, fontWeight: 800,
      color: '#555', flexShrink: 0,
    }}>{initials}</div>
  )
}

// ── PlayerCard ────────────────────────────────────────────────────────────────
function PlayerCard({ player }) {
  const navigate = useNavigate()          // ← navigate hook ekle
  const badge    = getRoleBadge(player.role)

  return (
    <div
      onClick={() => player.id && navigate(`/player/${player.id}`)}  // ← tıklanabilir
      style={{
        background: '#111', borderRadius: 14,
        border: '1px solid #1e1e1e', padding: '18px 14px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        transition: 'border-color .2s, transform .2s',
        cursor: player.id ? 'pointer' : 'default',   // ← cursor
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = player.id ? badge.border : '#1e1e1e'
        e.currentTarget.style.transform   = player.id ? 'translateY(-4px)' : 'none'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#1e1e1e'
        e.currentTarget.style.transform   = 'none'
      }}
    >
      <PlayerAvatar src={player.image_url} name={player.nickname} size={64} />

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#eee', lineHeight: 1.3 }}>{player.nickname}</div>
        {player.real_name && (
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{player.real_name}</div>
        )}
      </div>

      {player.role ? (
        <div style={{
          padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: badge.bg, border: `1px solid ${badge.border}`,
          color: badge.color, letterSpacing: '.5px', textTransform: 'capitalize',
        }}>{badge.label}</div>
      ) : (
        <div style={{ fontSize: 11, color: '#333' }}>—</div>
      )}

      {/* Profil linki göstergesi */}
      {player.id && (
        <div style={{ fontSize: 9, color: '#383838', marginTop: -4 }}>profili gör →</div>
      )}
    </div>
  )
}

// ── MatchCard ─────────────────────────────────────────────────────────────────
function MatchCard({ match, teamId, navigate }) {
  const tid      = parseInt(teamId)
  const isTeamA  = match.team_a?.id === tid
  const myTeam   = isTeamA ? match.team_a : match.team_b
  const opp      = isTeamA ? match.team_b : match.team_a
  const myScore  = isTeamA ? match.team_a_score  : match.team_b_score
  const oppScore = isTeamA ? match.team_b_score  : match.team_a_score
  const isFin    = match.status === 'finished'
  const isLive   = match.status === 'running'
  const isWin    = isFin && match.winner_id === tid
  const isLoss   = isFin && match.winner_id && match.winner_id !== tid
  const hasPred  = match.prediction_team_a != null && match.prediction_team_b != null
  const myPred   = hasPred ? (isTeamA ? match.prediction_team_a : match.prediction_team_b) : null
  const oppPred  = hasPred ? (isTeamA ? match.prediction_team_b : match.prediction_team_a) : null

  return (
    <div
      onClick={() => navigate(`/match/${match.id}`)}
      style={{
        background: '#111', borderRadius: 14, padding: '14px 16px',
        border: isWin  ? '1.5px solid rgba(76,175,80,.5)'
              : isLoss ? '1.5px solid rgba(255,70,85,.35)'
              : isLive ? '1.5px solid rgba(255,70,85,.6)'
              : '1.5px solid #1e1e1e',
        boxShadow: isLive ? '0 0 14px rgba(255,70,85,.18)' : 'none',
        cursor: 'pointer',
        transition: 'transform .2s, border-color .2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = '#FF4655' }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.borderColor = isWin ? 'rgba(76,175,80,.5)' : isLoss ? 'rgba(255,70,85,.35)' : isLive ? 'rgba(255,70,85,.6)' : '#1e1e1e'
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#444', letterSpacing: '.5px' }}>
          {match.game?.name === 'Counter-Strike 2' ? 'CS2' : match.game?.name === 'League of Legends' ? 'LoL' : (match.game?.name ?? '?')}
        </span>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isLive && (
            <span style={{ fontSize: 10, fontWeight: 800, color: '#FF4655', animation: 'pulse 1.5s infinite' }}>🔴 LIVE</span>
          )}
          {isFin && (
            <span style={{
              fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 6,
              background: isWin ? 'rgba(76,175,80,.2)' : isLoss ? 'rgba(255,70,85,.2)' : 'rgba(100,100,100,.15)',
              color: isWin ? '#4CAF50' : isLoss ? '#FF4655' : '#888',
              border: `1px solid ${isWin ? 'rgba(76,175,80,.4)' : isLoss ? 'rgba(255,70,85,.4)' : '#333'}`,
            }}>
              {isWin ? '✅ WIN' : isLoss ? '❌ LOSS' : '— DRAW'}
            </span>
          )}
        </div>
      </div>

      {/* Teams + score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {/* My team */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {myTeam?.logo_url
            ? <img src={myTeam.logo_url} alt="" style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }} />
            : <div style={{ width: 32, height: 32, background: '#1e1e1e', borderRadius: 6, flexShrink: 0 }} />
          }
          <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isWin ? '#4CAF50' : '#eee' }}>
            {myTeam?.name}
          </span>
        </div>

        {/* Score */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          {isFin ? (
            <div style={{ fontSize: 18, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: '#eee' }}>
              <span style={{ color: isWin ? '#4CAF50' : isLoss ? '#FF4655' : '#888' }}>{myScore ?? 0}</span>
              <span style={{ color: '#2a2a2a', margin: '0 4px' }}>:</span>
              <span style={{ color: isLoss ? '#4CAF50' : isWin ? '#888' : '#888' }}>{oppScore ?? 0}</span>
            </div>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#333' }}>VS</span>
          )}
        </div>

        {/* Opponent */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#777', textAlign: 'right' }}>
            {opp?.name}
          </span>
          {opp?.logo_url
            ? <img src={opp.logo_url} alt="" style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }} />
            : <div style={{ width: 32, height: 32, background: '#1e1e1e', borderRadius: 6, flexShrink: 0 }} />
          }
        </div>
      </div>

      {/* AI Win bar */}
      {hasPred && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 4, borderRadius: 2, background: '#0d0d0d', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(myPred * 100)}%`, height: '100%', background: 'linear-gradient(90deg,#667eea,#764ba2)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 3, color: '#444' }}>
            <span style={{ color: myPred >= oppPred ? '#818cf8' : '#444' }}>{Math.round(myPred * 100)}%</span>
            <span style={{ color: '#444' }}>AI</span>
            <span style={{ color: oppPred > myPred ? '#818cf8' : '#444' }}>{Math.round(oppPred * 100)}%</span>
          </div>
        </div>
      )}

      {/* Bottom */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #181818', paddingTop: 8, gap: 8 }}>
        <div style={{ fontSize: 10, color: '#383838', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          🏆 {match.tournament?.name ?? '—'}
        </div>
        <div style={{ fontSize: 10, color: '#444', flexShrink: 0 }}>
          {new Date(match.scheduled_at).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

// ── TeamPage (default export) ─────────────────────────────────────────────────
export default function TeamPage() {
  const { teamId } = useParams()
  const navigate   = useNavigate()
  const { toggleTeamFollow, isTeamFollowed } = useUser()

  const [team,     setTeam]     = useState(null)
  const [matches,  setMatches]  = useState([])
  const [players,  setPlayers]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [activeTab, setActiveTab] = useState('roster')

  // ── Veri çekme ──────────────────────────────────────────────────
  const fetchTeamData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [teamRes, matchRes, playerRes] = await Promise.all([
        supabase.from('teams').select('*').eq('id', teamId).single(),

        supabase.from('matches').select(`
          id, status, scheduled_at,
          team_a_id, team_b_id, winner_id,
          team_a_score, team_b_score,
          prediction_team_a, prediction_team_b, prediction_confidence,
          team_a:teams!matches_team_a_id_fkey(id, name, logo_url),
          team_b:teams!matches_team_b_id_fkey(id, name, logo_url),
          tournament:tournaments(id, name),
          game:games(id, name)
        `)
          .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
          .order('scheduled_at', { ascending: false })
          .limit(200),

        supabase.from('players')
          .select('id, nickname, real_name, role, image_url, nationality')
          .eq('team_pandascore_id', parseInt(teamId))
          .order('role'),
      ])

      if (teamRes.error)   throw teamRes.error
      if (matchRes.error)  throw matchRes.error

      setTeam(teamRes.data)
      setMatches(matchRes.data || [])
      setPlayers(playerRes.data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => { fetchTeamData() }, [fetchTeamData])

  // ── Türevler ──────────────────────────────────────────────────
  const upcomingMatches = matches.filter(m => ['not_started', 'running'].includes(m.status))
  const pastMatches     = matches.filter(m => m.status === 'finished')
  const wins            = pastMatches.filter(m => m.winner_id === parseInt(teamId)).length
  const losses          = pastMatches.filter(m => m.winner_id && m.winner_id !== parseInt(teamId)).length
  const rating          = calcTeamRating(wins, wins + losses)
  const isTR            = isTurkishTeam(team?.name ?? '')

  // Last 10 matches form
  const form = [...pastMatches]
    .slice(0, 10)
    .map(m => {
      if (!m.winner_id) return 'D'
      return m.winner_id === parseInt(teamId) ? 'W' : 'L'
    })

  // Streak
  const streak = (() => {
    if (form.length === 0) return null
    const type = form[0]
    let count = 0
    for (const r of form) { if (r === type) count++; else break }
    return { type, count }
  })()

  // ── Toggle Favorite ────────────────────────────────────────────
  const parsedTeamId = parseInt(teamId)
  const isFav = isTeamFollowed(parsedTeamId)
  function handleToggleFav() {
    toggleTeamFollow(parsedTeamId)
  }

  // ── Loading ────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px' }}>
      <Sk h="200px" r="20px" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginTop: 20 }}>
        {[1,2,3,4,5].map(i => <Sk key={i} h="130px" r="14px" />)}
      </div>
    </div>
  )

  if (error || !team) return (
    <div style={{ textAlign: 'center', padding: '60px', color: '#FF4655' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>❌</div>
      <div style={{ fontSize: 16, marginBottom: 20 }}>{error ?? 'Takım bulunamadı'}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '10px 24px', background: '#FF4655', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
        ← Geri
      </button>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 80px', color: 'white' }}>

      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.5} }
      `}</style>

      {/* ═══ HEADER KAPAK ═══════════════════════════════════════════ */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(160deg, #0d0d0d 0%, #111 100%)',
        borderBottom: isTR ? '1px solid rgba(200,16,46,.4)' : '1px solid #1a1a1a',
        padding: '36px 28px 28px',
        marginBottom: 28,
      }}>
        {/* Turkish pride accent */}
        {isTR && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 50% 0%, rgba(200,16,46,.12) 0%, transparent 70%)',
          }} />
        )}

        {/* Back button */}
        <button
          onClick={() => navigate(-1)}
          style={{
            position: 'absolute', top: 16, left: 20,
            background: 'rgba(255,255,255,.06)', border: '1px solid #222',
            borderRadius: 8, color: '#888', padding: '6px 12px',
            fontSize: 12, cursor: 'pointer', transition: 'all .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = '#888'}
        >← Geri</button>

        {/* Fav button */}
        <button
          onClick={handleToggleFav}
          style={{
            position: 'absolute', top: 16, right: 20,
            background: isFav ? 'rgba(255,215,0,.15)' : 'rgba(255,255,255,.06)',
            border: isFav ? '1px solid rgba(255,215,0,.5)' : '1px solid #222',
            borderRadius: 8, color: isFav ? '#FFD700' : '#777',
            padding: '6px 14px', fontSize: 13, cursor: 'pointer',
            transition: 'all .15s', fontWeight: isFav ? 700 : 400,
          }}
        >{isFav ? '⭐ Favori' : '☆ Favoriye Ekle'}</button>

        {/* Team identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, mt: 8, marginTop: 24 }}>
          {/* Logo */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {team.logo_url
              ? <img src={team.logo_url} alt={team.name} style={{ width: 100, height: 100, objectFit: 'contain', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.7))' }} />
              : (
                <div style={{ width: 100, height: 100, background: '#1e1e1e', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, border: '2px solid #2a2a2a' }}>
                  🛡️
                </div>
              )
            }
            {isTR && (
              <span style={{ position: 'absolute', bottom: -2, right: -2, fontSize: 20 }}>🇹🇷</span>
            )}
          </div>

          {/* Name + meta */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{
                margin: 0, fontSize: 34, fontWeight: 900, lineHeight: 1.1,
                background: isTR
                  ? 'linear-gradient(135deg,#fff,#ff6b7a)'
                  : 'linear-gradient(135deg,#fff,#888)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>{team.name}</h1>
              {team.acronym && (
                <span style={{ fontSize: 16, color: '#555', fontWeight: 700 }}>({team.acronym})</span>
              )}
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {team.location && (
                <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#888' }}>
                  📍 {team.location}
                </span>
              )}
              {isTR && (
                <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800, background: 'rgba(200,16,46,.2)', border: '1px solid rgba(200,16,46,.5)', color: '#ff6b7a' }}>
                  🇹🇷 Turkish Team
                </span>
              )}
              <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.4)', color: '#818cf8' }}>
                ⭐ Rating {rating}
              </span>
            </div>

            {/* Form strip */}
            {form.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, color: '#444', marginBottom: 6, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
                  Son Form ({form.length} maç)
                  {streak && streak.count >= 3 && (
                    <span style={{
                      marginLeft: 10, fontSize: 10, fontWeight: 800,
                      color: streak.type === 'W' ? '#4CAF50' : '#FF4655',
                      padding: '2px 8px', borderRadius: 6,
                      background: streak.type === 'W' ? 'rgba(76,175,80,.15)' : 'rgba(255,70,85,.15)',
                    }}>
                      🔥 {streak.count} {streak.type === 'W' ? 'Galibiyet' : 'Mağlubiyet'} serisi
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {form.map((r, i) => <FormPill key={i} result={r} />)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
          <StatBox icon="⚔️"  value={wins + losses}      label="Total Maç"   color="#fff"     />
          <StatBox icon="✅"  value={wins}               label="Galibiyet"   color="#4CAF50"  />
          <StatBox icon="❌"  value={losses}             label="Mağlubiyet" color="#FF4655"  />
          <StatBox icon="⏳" value={upcomingMatches.length} label="Yaklaşan"  color="#FFB800" />
          <StatBox icon="👥" value={players.length}      label="Oyuncu"     color="#818cf8"  />
        </div>

        {/* Win rate bar */}
        <div style={{ maxWidth: 360, marginTop: 8 }}>
          <WinRateBar wins={wins} total={wins + losses} />
        </div>
      </div>

      {/* ═══ TABS ════════════════════════════════════════════════════ */}
      <div style={{ padding: '0 20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #1a1a1a', paddingBottom: 12 }}>
          {[
            { key: 'roster',   label: `👥 Kadro`,                   count: players.length },
            { key: 'upcoming', label: '⏳ Upcoming',                 count: upcomingMatches.length },
            { key: 'past',     label: '✅ Geçmiş',                  count: pastMatches.length },
          ].map(t => {
            const active = activeTab === t.key
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 18px', borderRadius: 10,
                border: active ? '1.5px solid #FF4655' : '1.5px solid #1e1e1e',
                background: active ? 'rgba(255,70,85,.15)' : '#0d0d0d',
                color: active ? '#FF4655' : '#666',
                fontSize: 13, fontWeight: active ? 800 : 500,
                cursor: 'pointer', transition: 'all .18s',
              }}>
                {t.label}
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: active ? 'rgba(255,70,85,.2)' : '#1a1a1a', color: active ? '#FF4655' : '#555' }}>
                  {t.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ═══ TAB CONTENT ════════════════════════════════════════════ */}
      <div style={{ padding: '0 20px' }}>

        {/* ── ROSTER ── */}
        {activeTab === 'roster' && (
          players.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#444' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
              <div>Kadro verisi henüz senkronize edilmedi</div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
                {players.map((p, i) => <PlayerCard key={p.id ?? i} player={p} />)}
              </div>
              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: '#0d0d0d', border: '1px solid #1a1a1a', fontSize: 12, color: '#383838', textAlign: 'center' }}>
                ℹ️ Bireysel K/D/A istatistikleri PandaScore premium API erişimi gerektirir
              </div>
            </div>
          )
        )}

        {/* ── UPCOMING & PAST ── */}
        {(activeTab === 'upcoming' || activeTab === 'past') && (() => {
          const list = activeTab === 'upcoming' ? upcomingMatches : pastMatches
          if (list.length === 0) return (
            <div style={{ textAlign: 'center', padding: '60px', color: '#444' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{activeTab === 'upcoming' ? '📅' : '📋'}</div>
              <div>{activeTab === 'upcoming' ? 'Planlanmış maç yok' : 'Geçmiş maç yok'}</div>
            </div>
          )
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {list.map(m => <MatchCard key={m.id} match={m} teamId={teamId} navigate={navigate} />)}
            </div>
          )
        })()}
      </div>
    </div>
  )
}