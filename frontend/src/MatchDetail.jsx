/**
 * MatchDetail.jsx
 * Hero + Skor | AI Win Probability | Live Scoreboard | Harita istatistikleri | H2H | Kadro | MVP Oylama
 * Follow state -> UserContext
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link }             from 'react-router-dom'
import { supabase }                                 from './supabaseClient'
import { isTurkishTeam }                           from './constants'
import { useUser }                                 from './context/UserContext'

/* ─── Voter fingerprint ─────────────────────────────────────────────────────── */
const VOTER_KEY = 'esports_voter_id'
const VOTED_KEY = 'esports_mvp_voted'
function getVoterId() {
  let id = localStorage.getItem(VOTER_KEY)
  if (!id) { id = 'v_' + Math.random().toString(36).slice(2) + '_' + Date.now(); localStorage.setItem(VOTER_KEY, id) }
  return id
}
function getVotedMap()  { try { return JSON.parse(localStorage.getItem(VOTED_KEY) || '{}') } catch { return {} } }
function setVotedLocal(matchId, playerId) { const m = getVotedMap(); m[matchId] = playerId; localStorage.setItem(VOTED_KEY, JSON.stringify(m)) }

/* ─── Yardımcılar ───────────────────────────────────────────────────────────── */
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('tr-TR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '—'
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—'
const fmtDur  = s   => s   ? `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}` : null

function gameColor(n = '') {
  const s = n.toLowerCase()
  if (s.includes('valorant'))                     return '#FF4655'
  if (s.includes('counter') || s.includes('cs')) return '#F0A500'
  if (s.includes('league'))                       return '#C89B3C'
  return '#6366f1'
}
function gameShort(n = '') {
  const s = n.toLowerCase()
  if (s.includes('valorant'))                     return 'VAL'
  if (s.includes('counter') || s.includes('cs')) return 'CS2'
  if (s.includes('league'))                       return 'LoL'
  return n.slice(0, 4).toUpperCase() || '?'
}

const toNum = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const clamp = (v, min, max) => Math.min(Math.max(v, min), max)
const idEq = (a, b) => Number(a) === Number(b)

function buildMapWinStats(h2hMatches, teamAId, teamBId) {
  const agg = {}
  for (const m of (h2hMatches || [])) {
    const games = m?.raw_data?.games || []
    for (const g of games) {
      const rawName = g?.map?.name || g?.map || 'Unknown'
      const name = String(rawName).trim() || 'Unknown'
      if (!agg[name]) agg[name] = { map: name, total: 0, teamAWins: 0, teamBWins: 0 }
      const wId = g?.winner?.id ?? g?.winner_id
      if (wId == null) continue
      agg[name].total += 1
      if (idEq(wId, teamAId)) agg[name].teamAWins += 1
      if (idEq(wId, teamBId)) agg[name].teamBWins += 1
    }
  }

  return Object.values(agg)
    .map(x => ({
      ...x,
      teamAWinRate: x.total > 0 ? Math.round((x.teamAWins / x.total) * 100) : 0,
      teamBWinRate: x.total > 0 ? Math.round((x.teamBWins / x.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
}

function buildAIWinModel(matchStatsRows, teamAId, teamBId, directPredictionA) {
  function teamSignals(teamId) {
    let sample = 0
    let wins = 0
    let kills = 0
    let deaths = 0

    for (const row of (matchStatsRows || [])) {
      if (!idEq(row.team_id, teamId)) continue
      const s = row.stats || {}
      const score = toNum(s.score)
      const opp = toNum(s.opponent_score)
      if (score != null && opp != null) {
        sample += 1
        if (score > opp) wins += 1
      } else if (typeof s.result === 'string') {
        sample += 1
        const r = s.result.toLowerCase()
        if (r.includes('win')) wins += 1
      }

      const k = toNum(s.kills ?? s.total_kills ?? s?.kda?.kills)
      const d = toNum(s.deaths ?? s.total_deaths ?? s?.kda?.deaths)
      if (k != null) kills += k
      if (d != null) deaths += d
    }

    const winRate = sample > 0 ? wins / sample : 0.5
    const kd = deaths > 0 ? kills / deaths : (kills > 0 ? 2 : 1)
    const kdSignal = clamp(kd / 2.2, 0.1, 1)
    const strength = (winRate * 0.75) + (kdSignal * 0.25)
    return { sample, strength }
  }

  const a = teamSignals(teamAId)
  const b = teamSignals(teamBId)
  let byStats = 0.5
  if ((a.strength + b.strength) > 0) byStats = a.strength / (a.strength + b.strength)

  const blendedA = directPredictionA != null
    ? clamp((byStats * 0.8) + (directPredictionA * 0.2), 0.05, 0.95)
    : clamp(byStats, 0.05, 0.95)

  const sampleFactor = clamp((a.sample + b.sample) / 30, 0, 1)
  const diffFactor = Math.abs(blendedA - 0.5) * 2
  const confidence = Math.round(clamp((diffFactor * 0.7) + (sampleFactor * 0.3), 0.35, 0.95) * 100)

  return {
    teamA: Math.round(blendedA * 100),
    teamB: 100 - Math.round(blendedA * 100),
    confidence,
    samples: a.sample + b.sample,
  }
}

function buildLivePlayerBoard(matchRaw, rosters, teamAId, teamBId) {
  const acc = {}
  const upsert = (teamId, source) => {
    if (teamId == null || !source) return
    const pid = source.player_id ?? source.id ?? source?.player?.id ?? source?.slug ?? source?.nickname
    if (pid == null) return
    const key = `${teamId}:${pid}`
    if (!acc[key]) {
      acc[key] = {
        player_id: pid,
        team_id: teamId,
        nickname: source.nickname || source.name || source?.player?.name || source?.player?.slug || 'Unknown',
        kills: 0,
        deaths: 0,
        assists: 0,
      }
    }
    acc[key].kills += toNum(source.kills ?? source.k) || 0
    acc[key].deaths += toNum(source.deaths ?? source.d) || 0
    acc[key].assists += toNum(source.assists ?? source.a) || 0
  }

  const games = matchRaw?.games || []
  for (const g of games) {
    const lists = []
    if (Array.isArray(g?.players)) lists.push(g.players)
    if (Array.isArray(g?.player_stats)) lists.push(g.player_stats)
    if (Array.isArray(g?.teams)) {
      for (const t of g.teams) {
        if (Array.isArray(t?.players)) {
          lists.push(t.players.map(p => ({ ...p, team_id: p.team_id ?? t.id ?? t.team_id })))
        }
      }
    }
    for (const lst of lists) {
      for (const p of lst) {
        const teamId = p.team_id ?? p?.team?.id ?? p.opponent_id
        upsert(teamId, p)
      }
    }
  }

  const withFallback = (teamId, roster) => {
    const rows = Object.values(acc).filter(r => idEq(r.team_id, teamId))
    if (rows.length > 0) return rows.sort((x, y) => y.kills - x.kills)
    return (roster || []).map(p => ({
      player_id: p.id,
      team_id: teamId,
      nickname: p.nickname || 'Unknown',
      kills: 0,
      deaths: 0,
      assists: 0,
    }))
  }

  return {
    teamA: withFallback(teamAId, rosters.teamA),
    teamB: withFallback(teamBId, rosters.teamB),
  }
}

/* ─── Skeleton ──────────────────────────────────────────────────────────────── */
function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: 'linear-gradient(90deg,#111 25%,#1a1a1a 50%,#111 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite', flexShrink: 0 }} />
}

/* ─── SectionTitle ──────────────────────────────────────────────────────────── */
function ST({ icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.5px', color: '#444', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#1e1e1e,transparent)' }} />
    </div>
  )
}

/* ─── RoleBadge ─────────────────────────────────────────────────────────────── */
const ROLES = {
  igl:    { c: '#a78bfa', bg: 'rgba(139,92,246,.2)',   l: 'IGL'   },
  awp:    { c: '#38bdf8', bg: 'rgba(56,189,248,.15)',  l: 'AWP'   },
  sniper: { c: '#38bdf8', bg: 'rgba(56,189,248,.15)',  l: 'AWP'   },
  support:{ c: '#4ade80', bg: 'rgba(74,222,128,.15)',  l: 'Supp'  },
  entry:  { c: '#fb923c', bg: 'rgba(251,146,60,.15)',  l: 'Entry' },
  lurker: { c: '#e879f9', bg: 'rgba(232,121,249,.15)', l: 'Lurk'  },
  carry:  { c: '#facc15', bg: 'rgba(250,204,21,.15)',  l: 'Carry' },
  mid:    { c: '#34d399', bg: 'rgba(52,211,153,.15)',  l: 'Mid'   },
  jungle: { c: '#fb7185', bg: 'rgba(251,113,133,.15)', l: 'Jgl'   },
  top:    { c: '#60a5fa', bg: 'rgba(96,165,250,.15)',  l: 'Top'   },
  bot:    { c: '#f9a8d4', bg: 'rgba(249,168,212,.15)', l: 'Bot'   },
}
function RoleBadge({ role }) {
  if (!role) return null
  const s = ROLES[role.toLowerCase()] || { c: '#555', bg: 'rgba(80,80,80,.2)', l: role }
  return <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, flexShrink: 0, color: s.c, background: s.bg, border: `1px solid ${s.c}44`, textTransform: 'uppercase', letterSpacing: '.5px' }}>{s.l}</span>
}

/* ─── FavButton ─────────────────────────────────────────────────────────────── */
function FavButton({ teamId, active, onToggle }) {
  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(teamId) }}
      style={{
        background: 'none',
        border: `1px solid ${active ? 'rgba(255,215,0,.5)' : '#1e1e1e'}`,
        borderRadius: 7, color: active ? '#FFD700' : '#333',
        fontSize: 11, padding: '4px 10px', cursor: 'pointer',
        transition: 'all .18s', display: 'flex', alignItems: 'center', gap: 4,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = active ? '#FFD700' : '#333'; e.currentTarget.style.color = active ? '#FFD700' : '#888' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = active ? 'rgba(255,215,0,.5)' : '#1e1e1e'; e.currentTarget.style.color = active ? '#FFD700' : '#333' }}
    >
      <span style={{ fontSize: 13 }}>{active ? '⭐' : '☆'}</span>
      <span>{active ? 'Takip Ediliyor' : 'Takip Et'}</span>
    </button>
  )
}

/* ─── TwitchEmbed ───────────────────────────────────────────────────────────── */
function TwitchEmbed({ channel }) {
  const parent = window.location.hostname || 'localhost'
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: '2px solid rgba(145,70,255,.5)', boxShadow: '0 0 32px rgba(145,70,255,.15)', marginBottom: 24, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 16, background: 'rgba(145,70,255,.9)', fontSize: 10, fontWeight: 800, color: '#fff' }}>
        <span style={{ animation: 'pulse 1.2s infinite' }}>●</span> CANLI
      </div>
      <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
        <iframe src={`https://player.twitch.tv/?channel=${channel}&parent=${parent}&autoplay=false&muted=true`} title={`Twitch:${channel}`} allowFullScreen style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }} />
      </div>
    </div>
  )
}

/* ─── PlayerCard ────────────────────────────────────────────────────────────── */
function PlayerCard({ player, side = 'left' }) {
  const r = side === 'right'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: '#0d0d0d', border: '1px solid #181818', flexDirection: r ? 'row-reverse' : 'row', transition: 'border-color .15s,background .15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#111' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#181818'; e.currentTarget.style.background = '#0d0d0d' }}
    >
      {player.image_url
        ? <img src={player.image_url} alt={player.nickname} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid #1e1e1e' }} />
        : <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#1a1a1a', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, border: '2px solid #222' }}>👤</div>
      }
      <div style={{ minWidth: 0, flex: 1, textAlign: r ? 'right' : 'left' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.nickname}</div>
        {player.real_name && <div style={{ fontSize: 10, color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.real_name}</div>}
      </div>
      <RoleBadge role={player.role} />
    </div>
  )
}

/* ─── MapRow ────────────────────────────────────────────────────────────────── */
function MapRow({ map, index, teamAId }) {
  const aWon = map.winner_id === teamAId
  const bWon = map.winner_id !== null && !aWon
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 10, background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
      <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: aWon ? '#4CAF50' : bWon ? '#333' : '#aaa' }}>{map.team_a_score ?? '—'}</div>
      <div style={{ textAlign: 'center', minWidth: 80 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2 }}>Harita {index + 1}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>{map.map_name || '—'}</div>
        {map.length_seconds && <div style={{ fontSize: 9, color: '#333', marginTop: 2 }}>⏱ {fmtDur(map.length_seconds)}</div>}
      </div>
      <div style={{ textAlign: 'left', fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: bWon ? '#4CAF50' : aWon ? '#333' : '#aaa' }}>{map.team_b_score ?? '—'}</div>
    </div>
  )
}

/* ─── H2HRow ────────────────────────────────────────────────────────────────── */
function H2HRow({ match, refTeamAId }) {
  const isALeft = match.team_a_id === refTeamAId
  const aScore  = isALeft ? match.team_a_score : match.team_b_score
  const bScore  = isALeft ? match.team_b_score : match.team_a_score
  const leftWon = match.winner_id === refTeamAId
  const rightWon= match.winner_id !== null && !leftWon
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#0a0a0a', border: '1px solid #161616', fontSize: 11 }}>
      <div style={{ textAlign: 'right', fontWeight: leftWon ? 700 : 400, color: leftWon ? '#4CAF50' : '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isALeft ? (match.team_a?.name || '?') : (match.team_b?.name || '?')}
      </div>
      <div style={{ textAlign: 'center', minWidth: 52, fontWeight: 800, color: '#666', fontVariantNumeric: 'tabular-nums' }}>
        {aScore ?? '?'}:{bScore ?? '?'}
        <div style={{ fontSize: 8, color: '#282828', marginTop: 1 }}>
          {new Date(match.scheduled_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit' })}
        </div>
      </div>
      <div style={{ fontWeight: rightWon ? 700 : 400, color: rightWon ? '#4CAF50' : '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isALeft ? (match.team_b?.name || '?') : (match.team_a?.name || '?')}
      </div>
    </div>
  )
}

/* ─── MVPVoting ─────────────────────────────────────────────────────────────── */
function MVPVoting({ matchId, players, isFinished }) {
  const voterId = useRef(getVoterId())
  const [votes,      setVotes]      = useState({})
  const [totalVotes, setTotalVotes] = useState(0)
  const [votedFor,   setVotedFor]   = useState(null)
  const [voting,     setVoting]     = useState(false)
  const [voteError,  setVoteError]  = useState(null)
  const [justVoted,  setJustVoted]  = useState(false)
  const [loadingV,   setLoadingV]   = useState(true)

  const allPlayers = [...(players.teamA || []), ...(players.teamB || [])]

  const fetchVotes = useCallback(async () => {
    if (!matchId) return
    try {
      const { data, error } = await supabase.from('match_mvp_votes').select('player_id').eq('match_id', matchId)
      if (error) throw error
      const map = {}
      for (const r of (data || [])) map[r.player_id] = (map[r.player_id] || 0) + 1
      setVotes(map); setTotalVotes((data || []).length)
    } catch (e) { console.warn('mvp votes:', e.message) }
    finally { setLoadingV(false) }
  }, [matchId])

  useEffect(() => {
    const m = getVotedMap(); if (m[matchId]) setVotedFor(m[matchId])
    fetchVotes()
  }, [matchId, fetchVotes])

  useEffect(() => {
    if (!matchId) return undefined

    const channel = supabase
      .channel(`mvp_votes_${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_mvp_votes', filter: `match_id=eq.${matchId}` },
        () => { fetchVotes() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [matchId, fetchVotes])

  async function castVote(player) {
    if (votedFor || voting || !isFinished) return
    setVoting(true); setVoteError(null)
    try {
      const { error } = await supabase.from('match_mvp_votes').insert({ match_id: matchId, player_id: player.id, voter_id: voterId.current })
      if (error) {
        if (error.code === '23505') { setVotedFor(player.id); setVotedLocal(matchId, player.id); setVoteError('Bu maç için zaten oy kullandınız.') }
        else throw error
      } else {
        setVotedFor(player.id); setVotedLocal(matchId, player.id)
        setJustVoted(true); setTimeout(() => setJustVoted(false), 2500)
        await fetchVotes()
      }
    } catch (e) { setVoteError('Hata: ' + e.message) }
    finally { setVoting(false) }
  }

  if (!isFinished || allPlayers.length === 0) return null
  const hasVoted = !!votedFor
  const ranked   = [...allPlayers].sort((a, b) => (votes[b.id] || 0) - (votes[a.id] || 0))
  const top      = ranked[0]
  const topV     = votes[top?.id] || 0

  return (
    <div style={{ background: 'linear-gradient(160deg,#110d1a,#0d0d0d)', borderRadius: 18, border: '1px solid rgba(167,139,250,.2)', padding: 20, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>🏅</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>Maçın Adamı</div>
            <div style={{ fontSize: 9, color: '#3a3a5a' }}>Her maç için 1 oy hakkı</div>
          </div>
        </div>
        {loadingV ? <Sk w="50px" h="20px" r="6px" /> : (
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 18, fontWeight: 900, color: '#a78bfa' }}>{totalVotes}</div><div style={{ fontSize: 8, color: '#2a2a2a', textTransform: 'uppercase', letterSpacing: '.5px' }}>oy</div></div>
        )}
      </div>
      {justVoted && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 9, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.3)', display: 'flex', alignItems: 'center', gap: 8 }}><span>🎉</span><span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80' }}>Oyunuz kaydedildi!</span></div>}
      {voteError && <div style={{ marginBottom: 10, padding: '7px 10px', borderRadius: 8, background: 'rgba(255,70,85,.08)', border: '1px solid rgba(255,70,85,.2)', fontSize: 11, color: '#FF4655' }}>⚠️ {voteError}</div>}
      {!loadingV && topV > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: 'rgba(167,139,250,.08)', border: '1px solid rgba(167,139,250,.2)' }}>
          {top.image_url ? <img src={top.image_url} alt={top.nickname} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(167,139,250,.4)', flexShrink: 0 }} /> : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1a1a1a', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>👤</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>👑 {top.nickname}</div>
            <div style={{ fontSize: 9, color: '#444' }}>Şu an lider · {topV} oy</div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#a78bfa' }}>{totalVotes > 0 ? Math.round(topV / totalVotes * 100) : 0}%</div>
        </div>
      )}
      {loadingV
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{[1, 2, 3, 4, 5].map(i => <Sk key={i} h="54px" r="10px" />)}</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ranked.map((player, idx) => {
              const pV  = votes[player.id] || 0
              const pct = totalVotes > 0 ? Math.round(pV / totalVotes * 100) : 0
              const my  = player.id === votedFor
              const isA = (players.teamA || []).some(p => p.id === player.id)
              return (
                <div key={player.id} onClick={() => !hasVoted && castVote(player)} style={{ position: 'relative', overflow: 'hidden', padding: '9px 12px', borderRadius: 11, border: my ? '1.5px solid rgba(167,139,250,.55)' : '1.5px solid #1a1a1a', background: my ? 'rgba(167,139,250,.07)' : '#0d0d0d', cursor: hasVoted ? 'default' : voting ? 'wait' : 'pointer', transition: 'all .18s', userSelect: 'none' }}
                  onMouseEnter={e => { if (!hasVoted) { e.currentTarget.style.borderColor = 'rgba(167,139,250,.35)'; e.currentTarget.style.background = 'rgba(167,139,250,.04)' } }}
                  onMouseLeave={e => { if (!hasVoted) { e.currentTarget.style.borderColor = my ? 'rgba(167,139,250,.55)' : '#1a1a1a'; e.currentTarget.style.background = my ? 'rgba(167,139,250,.07)' : '#0d0d0d' } }}
                >
                  {hasVoted && pct > 0 && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: my ? 'linear-gradient(90deg,rgba(167,139,250,.2),transparent)' : 'linear-gradient(90deg,rgba(255,255,255,.03),transparent)', borderRadius: 11, transition: 'width .8s cubic-bezier(.4,0,.2,1)', pointerEvents: 'none' }} />}
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: idx === 0 && totalVotes > 0 ? 'rgba(167,139,250,.2)' : '#1a1a1a', fontSize: 10, fontWeight: 800, color: idx === 0 && totalVotes > 0 ? '#a78bfa' : '#333', border: `1px solid ${idx === 0 && totalVotes > 0 ? 'rgba(167,139,250,.3)' : '#222'}` }}>{idx === 0 && totalVotes > 0 ? '👑' : idx + 1}</div>
                    {player.image_url ? <img src={player.image_url} alt={player.nickname} style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: my ? '2px solid rgba(167,139,250,.4)' : '2px solid #1e1e1e' }} /> : <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#1a1a1a', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, border: '2px solid #222' }}>👤</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: my ? 800 : 600, color: my ? '#c4b5fd' : '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{player.nickname}</span>
                        {my && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 4, background: 'rgba(167,139,250,.2)', color: '#a78bfa', fontWeight: 700 }}>senin oyun</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <RoleBadge role={player.role} />
                        <span style={{ fontSize: 8, color: '#222', fontWeight: 600 }}>{isA ? '🔵A' : '🔴B'}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 60 }}>
                      {hasVoted ? (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 900, color: pct > 0 ? '#a78bfa' : '#222', fontVariantNumeric: 'tabular-nums' }}>{pct}%</div>
                          <div style={{ fontSize: 8, color: '#282828' }}>{pV} oy</div>
                          <div style={{ height: 3, borderRadius: 2, background: '#1a1a1a', marginTop: 3, width: 50, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: my ? 'linear-gradient(90deg,#a78bfa,#7c3aed)' : '#2d2d4e', transition: 'width .8s cubic-bezier(.4,0,.2,1)' }} />
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '4px 8px', borderRadius: 7, fontSize: 10, fontWeight: 700, background: 'rgba(167,139,250,.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,.2)', opacity: voting ? 0.5 : 1 }}>
                          {voting ? '⏳' : '🗳️'} Oy Ver
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      }
      <div style={{ marginTop: 10, fontSize: 9, color: '#1a1a1a', textAlign: 'center' }}>
        {hasVoted ? `✅ Oy kullandınız · ${totalVotes} toplam oy` : '👆 Bir oyuncuya tıklayarak oy verin'}
      </div>
    </div>
  )
}

/* ─── MatchDetail — default export ─────────────────────────────────────────── */
export default function MatchDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { isTeamFollowed, toggleTeamFollow } = useUser()

  const [match,   setMatch]   = useState(null)
  const [players, setPlayers] = useState({ teamA: [], teamB: [] })
  const [maps,    setMaps]    = useState([])
  const [mapStats, setMapStats] = useState([])
  const [h2h,     setH2h]     = useState({ matches: [], teamAWins: 0, teamBWins: 0, draws: 0, total: 0, teamAId: null, teamBId: null })
  const [streams, setStreams]  = useState([])
  const [aiWin, setAiWin] = useState({ teamA: 50, teamB: 50, confidence: 50, samples: 0 })
  const [liveBoard, setLiveBoard] = useState({ teamA: [], teamB: [] })

  const [loadingMatch,   setLoadingMatch]   = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(true)
  const [error,          setError]          = useState(null)

  /* ── Maç yükle ── */
  const fetchMatch = useCallback(async () => {
    setLoadingMatch(true); setError(null)
    try {
      const { data, error: e } = await supabase.from('matches').select(`
        *, raw_data,
        team_a:teams!matches_team_a_id_fkey(id,name,logo_url,acronym),
        team_b:teams!matches_team_b_id_fkey(id,name,logo_url,acronym),
        tournament:tournaments(id,name,tier),
        game:games(id,name,slug)
      `).eq('id', id).single()
      if (e) throw e
      setMatch(data)
      setStreams((data?.raw_data?.streams_list||[]).filter(s=>s?.embed_url||s?.raw_url))
    } catch (e) { setError(e.message) }
    finally { setLoadingMatch(false) }
  }, [id])

  /* ── Detaylar ── */
  const fetchDetails = useCallback(async (m) => {
    if (!m) return
    setLoadingDetails(true)
    const aId = m.team_a_id||m.team_a?.id
    const bId = m.team_b_id||m.team_b?.id
    try {
      const [plA, plB, h2hRes, statsRes] = await Promise.all([
        supabase.from('players').select('id,nickname,real_name,role,image_url').eq('team_pandascore_id', aId).order('role'),
        supabase.from('players').select('id,nickname,real_name,role,image_url').eq('team_pandascore_id', bId).order('role'),
        supabase.from('matches')
          .select('id,winner_id,status,team_a_id,team_b_id,team_a_score,team_b_score,scheduled_at,raw_data,team_a:teams!matches_team_a_id_fkey(id,name,logo_url),team_b:teams!matches_team_b_id_fkey(id,name,logo_url)')
          .eq('status','finished')
          .or(`and(team_a_id.eq.${aId},team_b_id.eq.${bId}),and(team_a_id.eq.${bId},team_b_id.eq.${aId})`)
          .order('scheduled_at',{ascending:false}).limit(5000),
        supabase.from('match_stats')
          .select('team_id,stats')
          .in('team_id', [aId, bId])
          .limit(220),
      ])
      const rosters = { teamA:plA.data||[], teamB:plB.data||[] }
      setPlayers(rosters)
      const h = (h2hRes.data||[]).filter(x=>x.id!==parseInt(id))
      setH2h({ matches:h, teamAWins:h.filter(x=>idEq(x.winner_id, aId)).length, teamBWins:h.filter(x=>idEq(x.winner_id, bId)).length, draws:h.filter(x=>!x.winner_id).length, total:h.length, teamAId:aId, teamBId:bId })
      const games = m.raw_data?.games||[]
      setMaps(games.map(g=>({
        map_name:     g.map?.name||g.map||null,
        winner_id:    g.winner?.id||null,
        team_a_score: g.results?.find(r=>r.team_id===aId)?.score??null,
        team_b_score: g.results?.find(r=>r.team_id===bId)?.score??null,
        length_seconds: g.length||null,
      })))
      setMapStats(buildMapWinStats(h, aId, bId))
      setAiWin(buildAIWinModel(statsRes.data || [], aId, bId, m.prediction_team_a))
      setLiveBoard(buildLivePlayerBoard(m.raw_data, rosters, aId, bId))
    } catch (e) { console.warn('details:', e.message) }
    finally { setLoadingDetails(false) }
  }, [id])

  useEffect(() => { fetchMatch() }, [fetchMatch])
  useEffect(() => { if (match) fetchDetails(match) }, [match, fetchDetails])
  useEffect(() => {
    if (match?.status !== 'running') return undefined
    const timer = setInterval(() => { fetchMatch() }, 15000)
    return () => clearInterval(timer)
  }, [match?.status, fetchMatch])

  /* ── Loading / error ── */
  if (loadingMatch) return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px', color: '#fff' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Sk h="200px" r="20px" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}><Sk h="300px" r="18px" /><Sk h="300px" r="18px" /></div>
      </div>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  )
  if (error || !match) return (
    <div style={{ textAlign: 'center', padding: '80px 20px', color: '#fff' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#666', marginBottom: 24 }}>Maç bulunamadı — {error}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '10px 24px', background: '#FF4655', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>← Geri</button>
    </div>
  )

  /* ── Türevler ── */
  const aId   = match.team_a_id || match.team_a?.id
  const bId   = match.team_b_id || match.team_b?.id
  const aName = match.team_a?.name || '?'
  const bName = match.team_b?.name || '?'
  const aLogo = match.team_a?.logo_url
  const bLogo = match.team_b?.logo_url
  const gName = match.game?.name || ''
  const gc    = gameColor(gName)
  const isLive= match.status === 'running'
  const isFin = match.status === 'finished'
  const hasTR = isTurkishTeam(aName) || isTurkishTeam(bName)
  const pctA  = aiWin.teamA
  const pctB  = aiWin.teamB
  const aWon  = isFin && (match.winner_id === aId || match.winner_id === parseInt(aId))
  const bWon  = isFin && !aWon && !!match.winner_id
  const favA  = isTeamFollowed(aId)
  const favB  = isTeamFollowed(bId)

  const twitchCh = (() => {
    const s = streams.find(s => (s.embed_url || s.raw_url || '').toLowerCase().includes('twitch.tv'))
    if (!s) return null
    return (s.embed_url || s.raw_url || '').split('twitch.tv/').pop()?.split(/[/?]/)[0] || null
  })()

  return (
    <div style={{ color: 'white', minHeight: '100vh', background: '#0a0a0a' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 60px' }}>

        {/* Geri */}
        <button onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, padding: '7px 14px', background: '#111', border: '1px solid #1e1e1e', borderRadius: 9, color: '#555', fontSize: 12, cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#aaa' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e1e1e'; e.currentTarget.style.color = '#555' }}
        >← Geri</button>

        {/* TR banner */}
        {hasTR && (
          <div style={{ background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)', borderRadius: '16px 16px 0 0', padding: 6, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <span>🇹🇷</span><span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: '#fff', textTransform: 'uppercase' }}>Turkish Pride</span><span>🇹🇷</span>
          </div>
        )}

        {/* ── Hero ── */}
        <div style={{ background: 'linear-gradient(135deg,#111,#0f0f0f)', borderRadius: hasTR ? '0 0 20px 20px' : '20px', border: `2px solid ${isLive ? '#FF4655' : hasTR ? 'rgba(212,175,55,.3)' : gc + '33'}`, padding: '28px 24px 20px', marginBottom: 8, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 1, background: `linear-gradient(90deg,transparent,${gc}44,transparent)` }} />

          {/* Badges */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            <span style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 700, background: `${gc}22`, color: gc, border: `1px solid ${gc}44` }}>{gameShort(gName)} · {gName}</span>
            {match.tournament && <Link to={`/tournament/${match.tournament.id}`} style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 600, background: 'rgba(255,184,0,.1)', color: '#FFB800', border: '1px solid rgba(255,184,0,.3)', textDecoration: 'none' }}>🏆 {match.tournament.name}</Link>}
            {isLive && <span style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 800, background: 'rgba(255,70,85,.2)', color: '#FF4655', border: '1px solid rgba(255,70,85,.4)', animation: 'pulse 1.2s infinite' }}>● LIVE</span>}
            {isFin  && <span style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 700, background: 'rgba(76,175,80,.1)', color: '#4CAF50', border: '1px solid rgba(76,175,80,.3)' }}>✅ Tamamlandı</span>}
          </div>

          {/* Teams + Score */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12 }}>

            {/* Team A */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <div onClick={() => navigate(`/team/${aId}`)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, cursor: 'pointer', opacity: isFin && bWon ? 0.45 : 1, transition: 'opacity .2s' }}>
                {aLogo ? <img src={aLogo} alt={aName} style={{ width: 72, height: 72, objectFit: 'contain', filter: isFin && bWon ? 'grayscale(80%)' : 'none' }} /> : <div style={{ width: 72, height: 72, background: '#1a1a1a', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🛡️</div>}
                <div style={{ fontSize: 16, fontWeight: 900, color: isFin ? (aWon ? '#4CAF50' : '#555') : '#fff' }}>{aName}{isTurkishTeam(aName) && ' 🇹🇷'}</div>
              </div>
              <FavButton teamId={aId} active={favA} onToggle={toggleTeamFollow} />
            </div>

            {/* Skor */}
            <div style={{ textAlign: 'center', minWidth: 100, flexShrink: 0 }}>
              {(isLive || isFin)
                ? <div style={{ fontSize: 36, fontWeight: 900, color: isLive ? '#FF4655' : '#aaa', letterSpacing: 4, fontVariantNumeric: 'tabular-nums', textShadow: isLive ? '0 0 20px rgba(255,70,85,.4)' : 'none' }}>{match.team_a_score ?? 0}:{match.team_b_score ?? 0}</div>
                : <div style={{ fontSize: 26, fontWeight: 900, color: '#FF4655', letterSpacing: 3 }}>VS</div>
              }
              <div style={{ fontSize: 12, fontWeight: 700, color: isLive ? '#FF4655' : '#4CAF50', marginTop: 4 }}>{isLive ? '● Canlı' : fmtTime(match.scheduled_at)}</div>
              <div style={{ fontSize: 10, color: '#383838', marginTop: 2 }}>{fmtDate(match.scheduled_at)}</div>
              <div style={{ marginTop: 10, padding: '0 6px', minWidth: 170 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>AI Win Probability</div>
                <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', border: '1px solid #222' }}>
                  <div style={{ flex: pctA, background: 'linear-gradient(90deg,#4ade80,#22c55e)', borderRadius: '4px 0 0 4px' }} />
                  <div style={{ flex: pctB, background: 'linear-gradient(90deg,#60a5fa,#3b82f6)', borderRadius: '0 4px 4px 0' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 10, fontWeight: 800 }}>
                  <span style={{ color: '#4ade80' }}>{aName}: {pctA}%</span>
                  <span style={{ color: '#60a5fa' }}>{pctB}% :{bName}</span>
                </div>
                <div style={{ marginTop: 2, fontSize: 9, color: '#3b3b3b' }}>Confidence Score: %{aiWin.confidence} · sample: {aiWin.samples}</div>
              </div>
            </div>

            {/* Team B */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <div onClick={() => navigate(`/team/${bId}`)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, cursor: 'pointer', opacity: isFin && aWon ? 0.45 : 1, transition: 'opacity .2s' }}>
                {bLogo ? <img src={bLogo} alt={bName} style={{ width: 72, height: 72, objectFit: 'contain', filter: isFin && aWon ? 'grayscale(80%)' : 'none' }} /> : <div style={{ width: 72, height: 72, background: '#1a1a1a', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🛡️</div>}
                <div style={{ fontSize: 16, fontWeight: 900, color: isFin ? (bWon ? '#4CAF50' : '#555') : '#fff' }}>{isTurkishTeam(bName) && '🇹🇷 '}{bName}</div>
              </div>
              <FavButton teamId={bId} active={favB} onToggle={toggleTeamFollow} />
            </div>
          </div>
        </div>

        <LiveScoreboard
          isLive={isLive}
          teamAName={aName}
          teamBName={bName}
          teamABoard={liveBoard.teamA}
          teamBBoard={liveBoard.teamB}
        />

        {/* Twitch */}
        {twitchCh && isLive && <div style={{ marginTop: 20 }}><TwitchEmbed channel={twitchCh} /></div>}

        {/* ── İçerik Grid ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 18, marginTop: 20 }}>

          {/* Sol */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Harita Skorları */}
            <div style={{ background: '#111', borderRadius: 16, border: '1px solid #1a1a1a', padding: 18 }}>
              <ST icon="🗺️" label="Harita Skorları" />
              {loadingDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{[1,2,3].map(i => <Sk key={i} h="44px" r="10px" />)}</div>
                : maps.length === 0 ? <div style={{ textAlign: 'center', padding: 20, color: '#282828', fontSize: 12 }}>Harita verisi yok</div>
                : (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, marginBottom: 6, padding: '0 14px' }}>
                      <div style={{ textAlign: 'right', fontSize: 9, fontWeight: 700, color: '#2a2a2a' }}>{aName}</div>
                      <div style={{ minWidth: 80 }} />
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#2a2a2a' }}>{bName}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {maps.map((map, i) => <MapRow key={i} map={map} index={i} teamAId={aId} />)}
                    </div>
                    <div style={{ marginTop: 8, padding: '8px 14px', borderRadius: 9, background: '#0a0a0a', border: '1px solid #1a1a1a', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}>
                      <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 900, color: aWon ? '#4CAF50' : '#2a2a2a', fontVariantNumeric: 'tabular-nums' }}>{match.team_a_score ?? '—'}</div>
                      <div style={{ textAlign: 'center', fontSize: 10, color: '#282828', minWidth: 50 }}>TOPLAM</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: bWon ? '#4CAF50' : '#2a2a2a', fontVariantNumeric: 'tabular-nums' }}>{match.team_b_score ?? '—'}</div>
                    </div>
                    {mapStats.length > 0 && (
                      <div style={{ marginTop: 12, background: '#0a0a0a', borderRadius: 10, border: '1px solid #191919', padding: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#4a4a4a', marginBottom: 8, textTransform: 'uppercase' }}>Map Win Rates</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {mapStats.map(m => (
                            <div key={m.map} style={{ background: '#101010', borderRadius: 8, border: '1px solid #1b1b1b', padding: '7px 8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10 }}>
                                <span style={{ color: '#9ca3af', fontWeight: 700 }}>{m.map}</span>
                                <span style={{ color: '#3d3d3d' }}>{m.total} map</span>
                              </div>
                              <div style={{ height: 6, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                                <div style={{ width: `${m.teamAWinRate}%`, background: '#4ade80' }} />
                                <div style={{ width: `${m.teamBWinRate}%`, background: '#60a5fa' }} />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 9, fontWeight: 700 }}>
                                <span style={{ color: '#4ade80' }}>{aName} {m.teamAWinRate}%</span>
                                <span style={{ color: '#60a5fa' }}>{m.teamBWinRate}% {bName}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              }
            </div>

            {/* H2H */}
            <div style={{ background: '#111', borderRadius: 16, border: '1px solid #1a1a1a', padding: 18 }}>
              <ST icon="⚔️" label="H2H Geçmiş" />
              {loadingDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{[1,2,3].map(i => <Sk key={i} h="36px" r="8px" />)}</div>
                : h2h.total === 0 ? <div style={{ textAlign: 'center', padding: 18, color: '#282828', fontSize: 12 }}>İlk karşılaşmaları</div>
                : (
                  <div>
                    <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ flex: h2h.teamAWins, background: '#4CAF50', minWidth: h2h.teamAWins > 0 ? 4 : 0 }} />
                      {h2h.draws > 0 && <div style={{ flex: h2h.draws, background: '#555' }} />}
                      <div style={{ flex: h2h.teamBWins, background: '#FF4655', minWidth: h2h.teamBWins > 0 ? 4 : 0 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 10 }}>
                      <span style={{ color: h2h.teamAWins >= h2h.teamBWins ? '#4CAF50' : '#444', fontWeight: 700 }}>{aName} {h2h.teamAWins}G</span>
                      <span style={{ color: h2h.teamBWins > h2h.teamAWins ? '#4CAF50' : '#444', fontWeight: 700 }}>{h2h.teamBWins}G {bName}</span>
                    </div>
                    <div style={{ marginBottom: 10, background: '#0a0a0a', border: '1px solid #191919', borderRadius: 8, padding: '7px 9px', display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                      <span style={{ color: '#666' }}>Rekabet Skoru</span>
                      <span style={{ color: '#ddd', fontWeight: 800 }}>{aName} {h2h.teamAWins} - {h2h.teamBWins} {bName}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {h2h.matches.slice(0, 12).map(m => (
                        <div key={m.id} onClick={() => navigate(`/match/${m.id}`)} style={{ cursor: 'pointer' }}>
                          <H2HRow match={m} refTeamAId={h2h.teamAId} />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }
            </div>

            {/* Maç Bilgisi */}
            <div style={{ background: '#111', borderRadius: 16, border: '1px solid #1a1a1a', padding: 18 }}>
              <ST icon="ℹ️" label="Maç Bilgisi" />
              {[
                ['🎮', 'Oyun',   gName || '—'],
                ['📅', 'Tarih',  fmtDate(match.scheduled_at)],
                ['⏰', 'Saat',   fmtTime(match.scheduled_at)],
                ['📊', 'Durum',  isFin ? '✅ Tamamlandı' : isLive ? '🔴 Canlı' : '⏳ Yakında'],
                ['🆔', 'ID',     String(match.id)],
              ].map(([icon, label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #141414' }}>
                  <span style={{ fontSize: 10, color: '#333' }}>{icon} {label}</span>
                  <span style={{ fontSize: 11, color: '#555', textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: label === 'ID' ? 'monospace' : 'inherit' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sağ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Team A Kadro */}
            <div style={{ background: '#111', borderRadius: 16, border: '1px solid #1a1a1a', padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {aLogo && <img src={aLogo} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />}
                <ST icon="" label={aName + ' Kadro'} />
              </div>
              {loadingDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[1,2,3,4,5].map(i => <Sk key={i} h="50px" r="10px" />)}</div>
                : players.teamA.length === 0 ? <div style={{ textAlign: 'center', padding: 18, color: '#282828', fontSize: 12 }}>Kadro verisi yok</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{players.teamA.map((p, i) => <PlayerCard key={i} player={p} side="left" />)}</div>
              }
            </div>

            {/* Team B Kadro */}
            <div style={{ background: '#111', borderRadius: 16, border: '1px solid #1a1a1a', padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {bLogo && <img src={bLogo} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />}
                <ST icon="" label={bName + ' Kadro'} />
              </div>
              {loadingDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[1,2,3,4,5].map(i => <Sk key={i} h="50px" r="10px" />)}</div>
                : players.teamB.length === 0 ? <div style={{ textAlign: 'center', padding: 18, color: '#282828', fontSize: 12 }}>Kadro verisi yok</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{players.teamB.map((p, i) => <PlayerCard key={i} player={p} side="right" />)}</div>
              }
            </div>

            {/* MVP */}
            {isFin && (
              <div style={{ background: '#111', borderRadius: 16, border: '1px solid rgba(167,139,250,.15)', padding: 18 }}>
                <ST icon="🏅" label="MVP Oylaması" />
                <MVPVoting matchId={parseInt(id)} players={players} isFinished={isFin} />
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </div>
  )
}

function LiveScoreboard({ teamAName, teamBName, teamABoard, teamBBoard, isLive }) {
  if (!isLive) return null

  const table = (title, rows, accent) => (
    <div style={{ background: '#0d0d0d', border: '1px solid #1b1b1b', borderRadius: 12, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: accent, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.8px' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 40px 40px', gap: 6, fontSize: 9, color: '#444', marginBottom: 6, padding: '0 4px' }}>
        <span>Oyuncu</span><span style={{ textAlign: 'right' }}>K</span><span style={{ textAlign: 'right' }}>D</span><span style={{ textAlign: 'right' }}>A</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(rows || []).slice(0, 6).map(p => (
          <div key={`${title}_${p.player_id}`} style={{ display: 'grid', gridTemplateColumns: '1fr 40px 40px 40px', gap: 6, alignItems: 'center', background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '6px 8px' }}>
            <span style={{ fontSize: 11, color: '#cfcfcf', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</span>
            <span style={{ textAlign: 'right', fontSize: 11, color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>{p.kills ?? 0}</span>
            <span style={{ textAlign: 'right', fontSize: 11, color: '#fb7185', fontVariantNumeric: 'tabular-nums' }}>{p.deaths ?? 0}</span>
            <span style={{ textAlign: 'right', fontSize: 11, color: '#93c5fd', fontVariantNumeric: 'tabular-nums' }}>{p.assists ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ marginTop: 16, marginBottom: 4, background: 'linear-gradient(160deg,#170d0f,#0d0d0d)', borderRadius: 16, border: '1px solid rgba(255,70,85,.25)', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: '#FF4655', textTransform: 'uppercase', letterSpacing: '1px' }}>Canli Scoreboard</div>
        <div style={{ fontSize: 10, color: '#7a3038' }}>K/D/A anlik performans</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {table(teamAName, teamABoard, '#4ade80')}
        {table(teamBName, teamBBoard, '#60a5fa')}
      </div>
    </div>
  )
}