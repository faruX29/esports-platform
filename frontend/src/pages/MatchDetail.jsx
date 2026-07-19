/**
 * MatchDetail.jsx
 * Hero + Skor | AI Win Probability | Live Scoreboard | Harita istatistikleri | H2H | Kadro | MVP Oylama
 * Follow state -> UserContext
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, Link }             from 'react-router-dom'
import { supabase }                                 from '../supabaseClient'
import { isTurkishTeam }                           from '../constants'
import { useUser }                                 from '../context/UserContext'
import InitialsImage                               from '../components/InitialsImage'
import LiquipediaCredit                            from '../components/LiquipediaCredit'
import PredictionAccuracyBadge                     from '../components/PredictionAccuracyBadge'
import { DeepScoutBadge, StatsCoverageNotice }     from '../components/ScoutSignals'
import {
  Brain, Vote, Map as MapIcon, Target, Swords, Award, Compass, Star, User,
  Crown, TriangleAlert, PartyPopper, Trophy, Gamepad2, CalendarDays, BarChart3,
  Radio, CircleCheck, Clock, MousePointerClick, Info, Hash,
} from 'lucide-react'
import { getBOFormat }                              from '../utils/matchFormat'
import { deriveWinnerTeamId, correctedScores }      from '../utils/matchResult'
import { FEXT }                                     from '../theme'

// MVP Oylaması şimdilik GİZLİ (kurucu kararı 2026-07-16): gerçek oyuncu istatistiği
// altyapısı olmadan oy "en popüler oyuncu" yarışına dönüşüyor (düşük performanslı ama
// sevilen oyuncu MVP seçilebiliyor). İstatistik motoru olgunlaşınca true yap.
const MVP_VOTING_ENABLED = false

/* ─── Voter fingerprint ─────────────────────────────────────────────────────── */
const VOTER_KEY = 'esports_voter_id'
const VOTED_KEY = 'esports_mvp_voted'
const COMMUNITY_VOTE_TABLE = 'match_community_votes'
const LOCAL_COMMUNITY_VOTE_KEY = 'esports_match_community_votes_v1'
function getVoterId() {
  let id = localStorage.getItem(VOTER_KEY)
  if (!id) { id = 'v_' + Math.random().toString(36).slice(2) + '_' + Date.now(); localStorage.setItem(VOTER_KEY, id) }
  return id
}
function getVotedMap()  { try { return JSON.parse(localStorage.getItem(VOTED_KEY) || '{}') } catch { return {} } }
function setVotedLocal(matchId, playerId) { const m = getVotedMap(); m[matchId] = playerId; localStorage.setItem(VOTED_KEY, JSON.stringify(m)) }

function isMissingTableError(error, tableName) {
  const code = String(error?.code || '').trim()
  const msg = String(error?.message || '').toLowerCase()
  const table = String(tableName || '').toLowerCase()
  return code === '42P01' || msg.includes(table) || (msg.includes('relation') && msg.includes('does not exist'))
}

function readLocalCommunityVotes() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_COMMUNITY_VOTE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeLocalCommunityVotes(payload) {
  localStorage.setItem(LOCAL_COMMUNITY_VOTE_KEY, JSON.stringify(payload || {}))
}

function getLocalCommunityVoteState(matchId, voterId) {
  const all = readLocalCommunityVotes()
  const key = String(matchId || '')
  const entry = all[key] || { votes: { teamA: 0, teamB: 0 }, byVoter: {} }
  const myVote = entry.byVoter?.[voterId] || null

  return {
    votes: {
      teamA: Number(entry?.votes?.teamA || 0),
      teamB: Number(entry?.votes?.teamB || 0),
    },
    myVote,
  }
}

function setLocalCommunityVote(matchId, voterId, side) {
  const all = readLocalCommunityVotes()
  const key = String(matchId || '')
  if (!all[key]) all[key] = { votes: { teamA: 0, teamB: 0 }, byVoter: {} }

  const entry = all[key]
  const prev = entry.byVoter?.[voterId] || null
  if (prev === side) {
    writeLocalCommunityVotes(all)
    return getLocalCommunityVoteState(matchId, voterId)
  }

  if (prev === 'teamA') entry.votes.teamA = Math.max(0, Number(entry.votes.teamA || 0) - 1)
  if (prev === 'teamB') entry.votes.teamB = Math.max(0, Number(entry.votes.teamB || 0) - 1)

  entry.byVoter[voterId] = side
  if (side === 'teamA') entry.votes.teamA = Number(entry.votes.teamA || 0) + 1
  if (side === 'teamB') entry.votes.teamB = Number(entry.votes.teamB || 0) + 1

  writeLocalCommunityVotes(all)
  return getLocalCommunityVoteState(matchId, voterId)
}

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

function normalizeGameAlias(value = '') {
  const s = String(value || '').toLowerCase()
  if (!s) return ''
  if (s.includes('counter') || s.includes('cs2') || s.includes('csgo') || s.includes('cs-go')) return 'cs2'
  if (s.includes('valorant')) return 'valorant'
  if (s.includes('league') || s === 'lol') return 'lol'
  return s
}

function getGameSlugCandidates(value = '') {
  const normalized = normalizeGameAlias(value)
  if (!normalized) return []
  if (normalized === 'cs2') return ['cs2', 'csgo', 'cs-go', 'counter-strike-global-offensive']
  if (normalized === 'lol') return ['lol', 'league-of-legends']
  if (normalized === 'valorant') return ['valorant']
  return [normalized]
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

function pickScoutMvpCandidate(liveBoard, teamAName, teamBName) {
  const pool = [
    ...(liveBoard?.teamA || []).map(player => ({ ...player, teamName: teamAName })),
    ...(liveBoard?.teamB || []).map(player => ({ ...player, teamName: teamBName })),
  ]
  if (!pool.length) return null

  const score = player => Number(player.kills || 0) * 1.1 + Number(player.assists || 0) * 0.45 - Number(player.deaths || 0) * 0.35
  return [...pool].sort((left, right) => score(right) - score(left))[0] || null
}

function asPct(value) {
  const num = toNum(value)
  if (num == null) return null
  if (num <= 1) return Math.round(clamp(num * 100, 0, 100))
  return Math.round(clamp(num, 0, 100))
}

function normalizeMapRowsFromExtraMetadata(extraMetadata) {
  const raw = extraMetadata || {}
  const buckets = [
    raw?.map_stats,
    raw?.mapStats,
    raw?.maps,
    raw?.statistics?.maps,
    raw?.stats?.maps,
    raw?.analysis?.maps,
    raw?.scout?.maps,
  ]

  const rows = []
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      rows.push(...bucket)
      continue
    }
    if (bucket && typeof bucket === 'object') {
      for (const [mapName, value] of Object.entries(bucket)) {
        if (value && typeof value === 'object') {
          rows.push({ map_name: mapName, ...value })
        }
      }
    }
  }

  return rows
}

function normalizeMapInsight(entry) {
  if (!entry || typeof entry !== 'object') return null
  const map = String(entry.map_name || entry.map?.name || entry.map || entry.name || '').trim()
  if (!map) return null

  let teamAWinRate = asPct(
    entry.team_a_win_rate ?? entry.teamAWinRate ?? entry.a_win_rate ??
    entry.team_a?.win_rate ?? entry.team_a?.winRate
  )
  let teamBWinRate = asPct(
    entry.team_b_win_rate ?? entry.teamBWinRate ?? entry.b_win_rate ??
    entry.team_b?.win_rate ?? entry.team_b?.winRate
  )

  const teamAWins = toNum(entry.team_a_wins ?? entry.teamAWins)
  const teamBWins = toNum(entry.team_b_wins ?? entry.teamBWins)
  const total = toNum(entry.total ?? entry.games ?? entry.match_count ?? entry.sample_size)

  if ((teamAWinRate == null || teamBWinRate == null) && total && total > 0 && teamAWins != null && teamBWins != null) {
    teamAWinRate = Math.round(clamp((teamAWins / total) * 100, 0, 100))
    teamBWinRate = Math.round(clamp((teamBWins / total) * 100, 0, 100))
  }

  if (teamAWinRate != null && teamBWinRate == null) teamBWinRate = 100 - teamAWinRate
  if (teamBWinRate != null && teamAWinRate == null) teamAWinRate = 100 - teamBWinRate

  if (teamAWinRate == null || teamBWinRate == null) return null

  return {
    map,
    teamAWinRate,
    teamBWinRate,
    sample: Math.max(0, Math.round(total || 0)),
  }
}

function buildStreak(matches, teamId) {
  let type = null
  let count = 0

  for (const match of (matches || [])) {
    let result = 'D'
    if (match?.winner_id != null) {
      result = idEq(match.winner_id, teamId) ? 'W' : 'L'
    }

    if (result === 'D') break
    if (!type) {
      type = result
      count = 1
      continue
    }
    if (result === type) {
      count += 1
    } else {
      break
    }
  }

  return { type, count }
}

function buildTacticalScoutReport({
  extraMetadata,
  mapStats,
  h2hMatches,
  teamAId,
  teamBId,
  teamAName,
  teamBName,
}) {
  const mapRows = normalizeMapRowsFromExtraMetadata(extraMetadata)
    .map(normalizeMapInsight)
    .filter(Boolean)

  const fallbackRows = (mapStats || []).map(row => ({
    map: row.map,
    teamAWinRate: row.teamAWinRate,
    teamBWinRate: row.teamBWinRate,
    sample: Math.round(toNum(row.total) || 0),
  }))

  const mapByName = new Map()
  for (const row of [...fallbackRows, ...mapRows]) {
    const key = String(row.map || '').toLowerCase()
    if (!key) continue
    const current = mapByName.get(key)
    if (!current || row.sample >= current.sample) {
      mapByName.set(key, row)
    }
  }

  const normalizedMaps = [...mapByName.values()].sort((a, b) => b.sample - a.sample)
  const bestA = normalizedMaps.length ? [...normalizedMaps].sort((a, b) => b.teamAWinRate - a.teamAWinRate)[0] : null
  const worstA = normalizedMaps.length ? [...normalizedMaps].sort((a, b) => a.teamAWinRate - b.teamAWinRate)[0] : null
  const bestB = normalizedMaps.length ? [...normalizedMaps].sort((a, b) => b.teamBWinRate - a.teamBWinRate)[0] : null
  const worstB = normalizedMaps.length ? [...normalizedMaps].sort((a, b) => a.teamBWinRate - b.teamBWinRate)[0] : null

  const recent = (h2hMatches || []).slice(0, 5)
  let teamAWins = 0
  let teamBWins = 0
  let draws = 0

  for (const match of recent) {
    if (match?.winner_id == null) {
      draws += 1
      continue
    }
    if (idEq(match.winner_id, teamAId)) teamAWins += 1
    if (idEq(match.winner_id, teamBId)) teamBWins += 1
  }

  const recentSample = recent.length
  const teamAWinRate = recentSample > 0 ? Math.round((teamAWins / recentSample) * 100) : null
  const teamBWinRate = recentSample > 0 ? Math.round((teamBWins / recentSample) * 100) : null
  const teamALossRate = recentSample > 0 ? Math.round((teamBWins / recentSample) * 100) : null
  const teamBLossRate = recentSample > 0 ? Math.round((teamAWins / recentSample) * 100) : null

  const streakA = buildStreak(recent, teamAId)
  const streakB = buildStreak(recent, teamBId)

  const teamAStrengths = []
  const teamAWeaknesses = []
  const teamBStrengths = []
  const teamBWeaknesses = []

  if (bestA && bestA.teamAWinRate >= 55) {
    teamAStrengths.push(`${bestA.map} haritasinda %${bestA.teamAWinRate} kazaniyor`)
  }
  if (bestB && bestB.teamBWinRate >= 55) {
    teamBStrengths.push(`${bestB.map} haritasinda %${bestB.teamBWinRate} kazaniyor`)
  }

  if (worstA && worstA.teamAWinRate <= 45) {
    teamAWeaknesses.push(`${worstA.map} haritasinda zayif (%${worstA.teamAWinRate})`)
  }
  if (worstB && worstB.teamBWinRate <= 45) {
    teamBWeaknesses.push(`${worstB.map} haritasinda zayif (%${worstB.teamBWinRate})`)
  }

  if (teamAWinRate != null && teamAWinRate >= 55) {
    teamAStrengths.push(`Son ${recentSample} mac formu guclu (%${teamAWinRate} galibiyet)`)
  }
  if (teamBWinRate != null && teamBWinRate >= 55) {
    teamBStrengths.push(`Son ${recentSample} mac formu guclu (%${teamBWinRate} galibiyet)`)
  }

  if (teamALossRate != null && teamALossRate >= 45) {
    teamAWeaknesses.push(`Son ${recentSample} mac kayip orani yuksek (%${teamALossRate})`)
  }
  if (teamBLossRate != null && teamBLossRate >= 45) {
    teamBWeaknesses.push(`Son ${recentSample} mac kayip orani yuksek (%${teamBLossRate})`)
  }

  if (streakA.type === 'W' && streakA.count >= 2) {
    teamAStrengths.push(`${streakA.count} maclik galibiyet serisi`)
  }
  if (streakA.type === 'L' && streakA.count >= 2) {
    teamAWeaknesses.push(`${streakA.count} maclik maglubiyet serisi`)
  }
  if (streakB.type === 'W' && streakB.count >= 2) {
    teamBStrengths.push(`${streakB.count} maclik galibiyet serisi`)
  }
  if (streakB.type === 'L' && streakB.count >= 2) {
    teamBWeaknesses.push(`${streakB.count} maclik maglubiyet serisi`)
  }

  if (teamAStrengths.length === 0) teamAStrengths.push('Denge modu: belirgin ustunluk sinyali sinirli')
  if (teamAWeaknesses.length === 0) teamAWeaknesses.push('Kritik zayiflik sinyali tespit edilmedi')
  if (teamBStrengths.length === 0) teamBStrengths.push('Denge modu: belirgin ustunluk sinyali sinirli')
  if (teamBWeaknesses.length === 0) teamBWeaknesses.push('Kritik zayiflik sinyali tespit edilmedi')

  return {
    mapsUsed: normalizedMaps.length,
    formSample: recentSample,
    teamA: { name: teamAName, strengths: teamAStrengths.slice(0, 3), weaknesses: teamAWeaknesses.slice(0, 3) },
    teamB: { name: teamBName, strengths: teamBStrengths.slice(0, 3), weaknesses: teamBWeaknesses.slice(0, 3) },
  }
}

function TacticalScoutReport({ report }) {
  const teams = [report?.teamA, report?.teamB].filter(Boolean)
  if (teams.length === 0) return null

  return (
    <div style={{ marginTop: 14, background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--surface-2)', padding: 14 }}>
      <ST Icon={Brain} label="Scout Analiz" />
      <div style={{ marginBottom: 10, fontSize: 11, color: '#9da3af' }}>
        Map kaynaklari: {report.mapsUsed} · Form ornegi: {report.formSample}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
        {teams.map(team => (
          <div key={team.name} style={{ borderRadius: 10, border: '1px solid var(--surface-2)', background: 'var(--bg)', padding: '10px 11px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-1)', marginBottom: 8 }}>{team.name}</div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#86efac', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 4 }}>
                Strengths
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {team.strengths.map((item, idx) => (
                  <div key={`s_${idx}`} style={{ fontSize: 11, color: '#c8f5d4' }}>+ {item}</div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#fda4af', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 4 }}>
                Weaknesses
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {team.weaknesses.map((item, idx) => (
                  <div key={`w_${idx}`} style={{ fontSize: 11, color: '#ffd6db' }}>- {item}</div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Skeleton ──────────────────────────────────────────────────────────────── */
function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: 'linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite', flexShrink: 0 }} />
}

/* ─── SectionTitle ──────────────────────────────────────────────────────────── */
function ST({ Icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      {Icon && <Icon size={15} color="var(--text-3)" />}
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.5px', color: 'var(--text-5)', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,var(--surface-2),transparent)' }} />
    </div>
  )
}

/* ── Oyuncu KDA tablosu (hybrid v3 verisi — enriched maçlarda) ── */
function KdaColumn({ rows, teamName, gc }) {
  const sorted = [...rows].sort((a, b) => (b.kills || 0) - (a.kills || 0))
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: gc, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamName}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sorted.map((r, i) => {
          const acs = r.stats?.acs_avg
          const kd = r.deaths > 0 ? (r.kills / r.deaths) : r.kills
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 8, padding: '6px 9px' }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.player?.nickname || '?'}</span>
              {acs != null && <span title="ACS" style={{ fontSize: 10, color: '#5eead4', fontWeight: 700, minWidth: 30, textAlign: 'right' }}>{acs}</span>}
              <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)', minWidth: 62, textAlign: 'right' }}>
                {r.kills}<span style={{ color: 'var(--text-5)' }}>/</span>{r.deaths}<span style={{ color: 'var(--text-5)' }}>/</span>{r.assists}
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, color: kd >= 1 ? '#4ade80' : '#ff6a7f', minWidth: 32, textAlign: 'right' }}>{kd.toFixed(2)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CommunityPredictionPool({ matchId, teamAName, teamBName, aiWin, isFinished }) {
  const voterIdRef = useRef(getVoterId())
  const [votes, setVotes] = useState({ teamA: 0, teamB: 0 })
  const [myVote, setMyVote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [fallbackLocal, setFallbackLocal] = useState(false)
  const [voteError, setVoteError] = useState('')

  const applyRemoteRows = useCallback((rows = []) => {
    const aggregated = { teamA: 0, teamB: 0 }
    let mine = null

    for (const row of (rows || [])) {
      const side = row?.team_side
      if (side === 'teamA') aggregated.teamA += 1
      if (side === 'teamB') aggregated.teamB += 1
      if (String(row?.voter_id || '') === String(voterIdRef.current)) mine = side
    }

    setVotes(aggregated)
    setMyVote(mine)
  }, [])

  const hydrateVotes = useCallback(async () => {
    if (!matchId) return

    setLoading(true)
    try {
      const { data, error } = await supabase
        .from(COMMUNITY_VOTE_TABLE)
        .select('team_side,voter_id')
        .eq('match_id', matchId)

      if (error) {
        if (isMissingTableError(error, COMMUNITY_VOTE_TABLE)) {
          const local = getLocalCommunityVoteState(matchId, voterIdRef.current)
          setFallbackLocal(true)
          setVotes(local.votes)
          setMyVote(local.myVote)
          setVoteError('')
          return
        }
        throw error
      }

      setFallbackLocal(false)
      setVoteError('')
      applyRemoteRows(data || [])
    } catch (e) {
      setVoteError('Community vote verisi alinamadi.')
      const local = getLocalCommunityVoteState(matchId, voterIdRef.current)
      setFallbackLocal(true)
      setVotes(local.votes)
      setMyVote(local.myVote)
    } finally {
      setLoading(false)
    }
  }, [applyRemoteRows, matchId])

  useEffect(() => {
    hydrateVotes()
  }, [hydrateVotes])

  useEffect(() => {
    if (!matchId || fallbackLocal) return undefined

    let active = true

    const channel = supabase
      .channel(`community_votes_${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: COMMUNITY_VOTE_TABLE, filter: `match_id=eq.${matchId}` },
        () => {
          if (active) hydrateVotes()
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [fallbackLocal, hydrateVotes, matchId])

  const handleVote = async side => {
    if (!matchId || isFinished || submitting) return
    setSubmitting(true)
    setVoteError('')

    try {
      if (fallbackLocal) {
        const localState = setLocalCommunityVote(matchId, voterIdRef.current, side)
        setVotes(localState.votes)
        setMyVote(localState.myVote)
        return
      }

      const payload = {
        match_id: matchId,
        voter_id: voterIdRef.current,
        team_side: side,
      }

      let { error } = await supabase
        .from(COMMUNITY_VOTE_TABLE)
        .upsert(payload, { onConflict: 'match_id,voter_id' })

      if (error && String(error.code || '') === '42P10') {
        const removeRes = await supabase
          .from(COMMUNITY_VOTE_TABLE)
          .delete()
          .eq('match_id', matchId)
          .eq('voter_id', voterIdRef.current)

        if (removeRes.error) throw removeRes.error

        const insertRes = await supabase
          .from(COMMUNITY_VOTE_TABLE)
          .insert(payload)

        error = insertRes.error
      }

      if (error) {
        if (isMissingTableError(error, COMMUNITY_VOTE_TABLE)) {
          const localState = setLocalCommunityVote(matchId, voterIdRef.current, side)
          setFallbackLocal(true)
          setVotes(localState.votes)
          setMyVote(localState.myVote)
          return
        }
        throw error
      }

      await hydrateVotes()
    } catch (e) {
      setVoteError('Oy kaydedilemedi. Lutfen tekrar dene.')
    } finally {
      setSubmitting(false)
    }
  }

  const totalVotes = Number(votes.teamA || 0) + Number(votes.teamB || 0)
  const communityTeamAPct = totalVotes > 0 ? Math.round((Number(votes.teamA || 0) / totalVotes) * 100) : 50
  const communityTeamBPct = 100 - communityTeamAPct
  const aiTeamAPct = Math.max(0, Math.min(100, Number(aiWin?.teamA || 0)))
  const aiTeamBPct = 100 - aiTeamAPct
  const communityFavorite = communityTeamAPct >= communityTeamBPct ? teamAName : teamBName
  const aiFavorite = aiTeamAPct >= aiTeamBPct ? teamAName : teamBName
  const sameDirection = communityFavorite === aiFavorite

  return (
    <div style={{ marginTop: 14, background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--surface-2)', padding: 14 }}>
      <ST Icon={Vote} label="Senin Tahminin (Community Vote)" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
        {[{ key: 'teamA', name: teamAName }, { key: 'teamB', name: teamBName }].map(team => {
          const selected = myVote === team.key
          return (
            <button
              key={team.key}
              onClick={() => handleVote(team.key)}
              disabled={isFinished || submitting || loading}
              style={{
                borderRadius: 10,
                border: `1px solid ${selected ? 'rgba(124,58,237,.65)' : 'var(--line)'}`,
                background: selected ? 'linear-gradient(130deg, rgba(124,58,237,.2), rgba(17,17,17,.95))' : 'var(--surface)',
                color: selected ? '#e8d9ff' : 'var(--text-1)',
                padding: '9px 10px',
                cursor: isFinished ? 'default' : 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 800 }}>{team.name}</div>
              <div style={{ marginTop: 3, fontSize: 10, color: selected ? '#c8b4ff' : 'var(--text-4)' }}>
                {selected ? 'Secimin bu takim' : 'Tahminini sec'}
              </div>
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#8be9dd', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 4 }}>
            Topluluk Fav.
          </div>
          <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--surface-2)', display: 'flex' }}>
            <div style={{ width: `${communityTeamAPct}%`, background: 'linear-gradient(90deg,#4ade80,#22c55e)' }} />
            <div style={{ width: `${communityTeamBPct}%`, background: 'linear-gradient(90deg,#fb7185,#FF4655)' }} />
          </div>
          <div style={{ marginTop: 3, display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
            <span style={{ color: '#86efac' }}>{teamAName} %{communityTeamAPct}</span>
            <span style={{ color: '#fda4af' }}>%{communityTeamBPct} {teamBName}</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#c8b4ff', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 4 }}>
            AI Fav.
          </div>
          <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--surface-2)', display: 'flex' }}>
            <div style={{ width: `${aiTeamAPct}%`, background: 'linear-gradient(90deg,#4ade80,#22c55e)' }} />
            <div style={{ width: `${aiTeamBPct}%`, background: 'linear-gradient(90deg,#fb7185,#FF4655)' }} />
          </div>
          <div style={{ marginTop: 3, display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
            <span style={{ color: '#86efac' }}>{teamAName} %{aiTeamAPct}</span>
            <span style={{ color: '#fda4af' }}>%{aiTeamBPct} {teamBName}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 9, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 10 }}>
        <span style={{ color: '#9ba7b4' }}>Toplam oy: {totalVotes}</span>
        <span style={{ color: sameDirection ? '#86efac' : '#ffd39a' }}>
          {sameDirection ? `Topluluk ve AI ayni tarafta (${aiFavorite})` : `Topluluk: ${communityFavorite} · AI: ${aiFavorite}`}
        </span>
      </div>

      {fallbackLocal && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-3)' }}>
          Community tablosu ulasilamaz durumda. Local fallback aktif.
        </div>
      )}
      {isFinished && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-3)' }}>
          Mac tamamlandi. Yeni community oy kabul edilmiyor.
        </div>
      )}
      {voteError && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#ff9aa5' }}>
          {voteError}
        </div>
      )}
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
  const s = ROLES[role.toLowerCase()] || { c: 'var(--text-4)', bg: 'rgba(80,80,80,.2)', l: role }
  return <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, flexShrink: 0, color: s.c, background: s.bg, border: `1px solid ${s.c}44`, textTransform: 'uppercase', letterSpacing: '.5px' }}>{s.l}</span>
}

/* ─── FavButton ─────────────────────────────────────────────────────────────── */
function FavButton({ teamId, active, onToggle }) {
  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(teamId) }}
      style={{
        background: 'none',
        border: `1px solid ${active ? 'rgba(255,215,0,.5)' : 'var(--surface-2)'}`,
        borderRadius: 7, color: active ? '#FFD700' : 'var(--text-6)',
        fontSize: 11, padding: '4px 10px', cursor: 'pointer',
        transition: 'all .18s', display: 'flex', alignItems: 'center', gap: 4,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = active ? '#FFD700' : 'var(--text-6)'; e.currentTarget.style.color = active ? '#FFD700' : 'var(--text-3)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = active ? 'rgba(255,215,0,.5)' : 'var(--surface-2)'; e.currentTarget.style.color = active ? '#FFD700' : 'var(--text-6)' }}
    >
      <Star size={13} fill={active ? '#FFD700' : 'none'} color={active ? '#FFD700' : 'currentColor'} />
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
  const navigate = useNavigate()
  const clickable = !!player.id
  return (
    <div
      onClick={() => clickable && navigate(`/player/${player.id}`)}
      title={clickable ? `${player.nickname} profilini gör` : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--surface-2)', flexDirection: r ? 'row-reverse' : 'row', transition: 'border-color .15s,background .15s', cursor: clickable ? 'pointer' : 'default' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = clickable ? FEXT.accent : 'var(--line)'; e.currentTarget.style.background = clickable ? 'var(--surface-2)' : 'var(--surface)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--surface-2)'; e.currentTarget.style.background = 'var(--surface)' }}
    >
      {player.image_url
        ? <img src={player.image_url} alt={player.nickname} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--surface-2)' }} />
        : <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--line)' }}><User size={17} color="var(--text-4)" /></div>
      }
      <div style={{ minWidth: 0, flex: 1, textAlign: r ? 'right' : 'left' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.nickname}</div>
        {player.real_name && <div style={{ fontSize: 10, color: 'var(--text-5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.real_name}</div>}
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--surface-2)' }}>
      <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: aWon ? '#4CAF50' : bWon ? 'var(--text-6)' : 'var(--text-2)' }}>{map.team_a_score ?? '—'}</div>
      <div style={{ textAlign: 'center', minWidth: 80 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-5)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2 }}>Harita {index + 1}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-4)' }}>{map.map_name || '—'}</div>
        {map.length_seconds && <div style={{ fontSize: 9, color: 'var(--text-5)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={9} /> {fmtDur(map.length_seconds)}</div>}
      </div>
      <div style={{ textAlign: 'left', fontSize: 20, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: bWon ? '#4CAF50' : aWon ? 'var(--text-6)' : 'var(--text-2)' }}>{map.team_b_score ?? '—'}</div>
    </div>
  )
}

function WinProbabilityBar({ teamAName, teamBName, teamAPct, teamBPct }) {
  const normalizedA = clamp(Number(teamAPct) || 0, 0, 100)
  const normalizedB = clamp(Number(teamBPct) || 0, 0, 100)
  const total = normalizedA + normalizedB
  const safeA = total > 0 ? Math.round((normalizedA / total) * 100) : 50
  const safeB = 100 - safeA
  const [animatedA, setAnimatedA] = useState(50)

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedA(safeA), 70)
    return () => clearTimeout(timer)
  }, [safeA])

  return (
    <div style={{ border: '1px solid rgba(94,234,212,.24)', borderRadius: 10, background: 'linear-gradient(130deg, rgba(20,184,166,.12), rgba(12,12,12,.9))', padding: '10px 11px' }}>
      <div style={{ fontSize: 10, color: '#8be9dd', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 6 }}>
        Win Probability
      </div>

      <div style={{ position: 'relative', height: 14, borderRadius: 999, overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--surface-2)', marginBottom: 7 }}>
        <div style={{ width: `${animatedA}%`, height: '100%', background: 'linear-gradient(90deg,#4ade80,#22c55e)', transition: 'width .7s cubic-bezier(.22,.61,.36,1)' }} />
        <div style={{ position: 'absolute', top: -1, left: `${animatedA}%`, width: 2, height: 16, background: '#fff', boxShadow: '0 0 10px rgba(255,255,255,.6)', transform: 'translateX(-1px)', animation: 'winBoundaryPulse 1.4s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          <div style={{ width: `${100 - animatedA}%`, marginLeft: 'auto', background: 'linear-gradient(90deg,#fb7185,#FF4655)', opacity: .88, transition: 'width .7s cubic-bezier(.22,.61,.36,1)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, fontWeight: 800 }}>
        <span style={{ color: '#86efac', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamAName} %{animatedA}</span>
        <span style={{ color: '#fda4af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamBName} %{safeB}</span>
      </div>
    </div>
  )
}

function getH2HBadge(match, refTeamAId) {
  if (!match?.winner_id) {
    return {
      text: 'D',
      color: 'var(--text-2)',
      bg: 'rgba(120,120,120,.2)',
      border: 'rgba(120,120,120,.45)',
      label: 'Berabere',
    }
  }

  const isWin = idEq(match.winner_id, refTeamAId)
  if (isWin) {
    return {
      text: 'W',
      color: '#b3ffd4',
      bg: 'rgba(76,175,80,.22)',
      border: 'rgba(76,175,80,.55)',
      label: 'Galibiyet',
    }
  }

  return {
    text: 'L',
    color: '#ffd2d8',
    bg: 'rgba(255,70,85,.22)',
    border: 'rgba(255,70,85,.55)',
    label: 'Maglubiyet',
  }
}

/* ─── H2HRow ────────────────────────────────────────────────────────────────── */
function H2HRow({ match, refTeamAId }) {
  const isALeft = idEq(match.team_a_id, refTeamAId)
  const aScore  = isALeft ? match.team_a_score : match.team_b_score
  const bScore  = isALeft ? match.team_b_score : match.team_a_score
  const isDraw   = match.winner_id == null
  const leftWon  = !isDraw && idEq(match.winner_id, refTeamAId)
  const rightWon = !isDraw && !leftWon
  // W/L rozeti kaldırıldı (referans takıma göreydi, hangi taraftan girdiğine göre
  // kafa karıştırıyordu). Bunun yerine kazananın adı yeşil, kaybedenin kırmızı.
  const WIN = '#4CAF50', LOSE = '#ff6b72', DRAW = 'var(--text-3)'
  const leftColor  = isDraw ? DRAW : (leftWon ? WIN : LOSE)
  const rightColor = isDraw ? DRAW : (rightWon ? WIN : LOSE)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--surface)', fontSize: 11 }}>
      <div style={{ textAlign: 'right', fontWeight: leftWon ? 800 : 600, color: leftColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isALeft ? (match.team_a?.name || '?') : (match.team_b?.name || '?')}
      </div>
      <div style={{ textAlign: 'center', minWidth: 52, fontWeight: 800, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
        {aScore ?? '?'}:{bScore ?? '?'}
        <div style={{ fontSize: 8, color: 'var(--line)', marginTop: 1 }}>
          {new Date(match.scheduled_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit' })}
        </div>
      </div>
      <div style={{ fontWeight: rightWon ? 800 : 600, color: rightColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

    let active = true

    const channel = supabase
      .channel(`mvp_votes_${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_mvp_votes', filter: `match_id=eq.${matchId}` },
        () => {
          if (active) fetchVotes()
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
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
    <div style={{ background: 'linear-gradient(160deg,#110d1a,var(--surface))', borderRadius: 18, border: '1px solid rgba(167,139,250,.2)', padding: 20, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Award size={16} color="#fff" /></div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)' }}>Maçın Adamı</div>
            <div style={{ fontSize: 9, color: '#3a3a5a' }}>Her maç için 1 oy hakkı</div>
          </div>
        </div>
        {loadingV ? <Sk w="50px" h="20px" r="6px" /> : (
          <div style={{ textAlign: 'right' }}><div style={{ fontSize: 18, fontWeight: 900, color: '#a78bfa' }}>{totalVotes}</div><div style={{ fontSize: 8, color: 'var(--line)', textTransform: 'uppercase', letterSpacing: '.5px' }}>oy</div></div>
        )}
      </div>
      {justVoted && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 9, background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.3)', display: 'flex', alignItems: 'center', gap: 8 }}><PartyPopper size={14} color="#4ade80" /><span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80' }}>Oyunuz kaydedildi!</span></div>}
      {voteError && <div style={{ marginBottom: 10, padding: '7px 10px', borderRadius: 8, background: 'rgba(255,70,85,.08)', border: '1px solid rgba(255,70,85,.2)', fontSize: 11, color: '#FF4655', display: 'flex', alignItems: 'center', gap: 6 }}><TriangleAlert size={12} /> {voteError}</div>}
      {!loadingV && topV > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: 'rgba(167,139,250,.08)', border: '1px solid rgba(167,139,250,.2)' }}>
          {top.image_url ? <img src={top.image_url} alt={top.nickname} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(167,139,250,.4)', flexShrink: 0 }} /> : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={18} color="var(--text-4)" /></div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}><Crown size={12} color="#FFD700" /> {top.nickname}</div>
            <div style={{ fontSize: 9, color: 'var(--text-5)' }}>Şu an lider · {topV} oy</div>
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
                <div key={player.id} onClick={() => !hasVoted && castVote(player)} style={{ position: 'relative', overflow: 'hidden', padding: '9px 12px', borderRadius: 11, border: my ? '1.5px solid rgba(167,139,250,.55)' : '1.5px solid var(--surface-2)', background: my ? 'rgba(167,139,250,.07)' : 'var(--surface)', cursor: hasVoted ? 'default' : voting ? 'wait' : 'pointer', transition: 'all .18s', userSelect: 'none' }}
                  onMouseEnter={e => { if (!hasVoted) { e.currentTarget.style.borderColor = 'rgba(167,139,250,.35)'; e.currentTarget.style.background = 'rgba(167,139,250,.04)' } }}
                  onMouseLeave={e => { if (!hasVoted) { e.currentTarget.style.borderColor = my ? 'rgba(167,139,250,.55)' : 'var(--surface-2)'; e.currentTarget.style.background = my ? 'rgba(167,139,250,.07)' : 'var(--surface)' } }}
                >
                  {hasVoted && pct > 0 && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: my ? 'linear-gradient(90deg,rgba(167,139,250,.2),transparent)' : 'linear-gradient(90deg,var(--hover),transparent)', borderRadius: 11, transition: 'width .8s cubic-bezier(.4,0,.2,1)', pointerEvents: 'none' }} />}
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: idx === 0 && totalVotes > 0 ? 'rgba(167,139,250,.2)' : 'var(--surface-2)', fontSize: 10, fontWeight: 800, color: idx === 0 && totalVotes > 0 ? '#a78bfa' : 'var(--text-6)', border: `1px solid ${idx === 0 && totalVotes > 0 ? 'rgba(167,139,250,.3)' : 'var(--line)'}` }}>{idx === 0 && totalVotes > 0 ? <Crown size={11} color="#a78bfa" /> : idx + 1}</div>
                    {player.image_url ? <img src={player.image_url} alt={player.nickname} style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: my ? '2px solid rgba(167,139,250,.4)' : '2px solid var(--surface-2)' }} /> : <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--surface-2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--line)' }}><User size={15} color="var(--text-4)" /></div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: my ? 800 : 600, color: my ? '#c4b5fd' : 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{player.nickname}</span>
                        {my && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 4, background: 'rgba(167,139,250,.2)', color: '#a78bfa', fontWeight: 700 }}>senin oyun</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <RoleBadge role={player.role} />
                        <span style={{ fontSize: 8, fontWeight: 800, color: isA ? '#60a5fa' : '#FF4655' }}>{isA ? 'A' : 'B'}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 60 }}>
                      {hasVoted ? (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 900, color: pct > 0 ? '#a78bfa' : 'var(--line)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</div>
                          <div style={{ fontSize: 8, color: 'var(--line)' }}>{pV} oy</div>
                          <div style={{ height: 3, borderRadius: 2, background: 'var(--surface-2)', marginTop: 3, width: 50, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: my ? 'linear-gradient(90deg,#a78bfa,#7c3aed)' : '#2d2d4e', transition: 'width .8s cubic-bezier(.4,0,.2,1)' }} />
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '4px 8px', borderRadius: 7, fontSize: 10, fontWeight: 700, background: 'rgba(167,139,250,.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,.2)', opacity: voting ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {voting ? <Clock size={11} /> : <Vote size={11} />} Oy Ver
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
      <div style={{ marginTop: 10, fontSize: 9, color: 'var(--text-4)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
        {hasVoted ? <><CircleCheck size={11} color="#4ade80" /> Oy kullandınız · {totalVotes} toplam oy</> : <><MousePointerClick size={11} /> Bir oyuncuya tıklayarak oy verin</>}
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
  const [matchPlayerStats, setMatchPlayerStats] = useState([])

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
    } catch (e) { console.error('MatchDetail fetch:', e?.message || e); setError('Maç bulunamadı.') }
    finally { setLoadingMatch(false) }
  }, [id])

  /* ── Detaylar ── */
  const fetchDetails = useCallback(async (m) => {
    if (!m) return
    setLoadingDetails(true)
    const aId = m.team_a_id||m.team_a?.id
    const bId = m.team_b_id||m.team_b?.id
    try {
      const slugCandidates = getGameSlugCandidates(m.game?.slug || m.game?.name || '')
      let aliasGameIds = [m.game_id, m.game?.id].map(Number).filter(Number.isFinite)

      if (slugCandidates.length > 0) {
        const { data: gameRows } = await supabase
          .from('games')
          .select('id,slug')
          .in('slug', slugCandidates)

        const ids = (gameRows || []).map(row => Number(row.id)).filter(Number.isFinite)
        aliasGameIds = Array.from(new Set([...aliasGameIds, ...ids]))
      }

      let h2hQuery = supabase.from('matches')
        .select('id,game_id,winner_id,status,team_a_id,team_b_id,team_a_score,team_b_score,scheduled_at,raw_data,team_a:teams!matches_team_a_id_fkey(id,name,logo_url),team_b:teams!matches_team_b_id_fkey(id,name,logo_url)')
        .eq('status','finished')
        .or(`and(team_a_id.eq.${aId},team_b_id.eq.${bId}),and(team_a_id.eq.${bId},team_b_id.eq.${aId})`)
        .order('scheduled_at',{ascending:false})
        .limit(8)

      if (aliasGameIds.length > 0) {
        h2hQuery = h2hQuery.in('game_id', aliasGameIds)
      }

      const [plA, plB, h2hRes, statsRes, pmsRes] = await Promise.all([
        supabase.from('players').select('id,nickname,real_name,role,image_url').eq('team_pandascore_id', aId).order('role'),
        supabase.from('players').select('id,nickname,real_name,role,image_url').eq('team_pandascore_id', bId).order('role'),
        h2hQuery,
        supabase.from('match_stats')
          .select('team_id,stats')
          .in('team_id', [aId, bId])
          .limit(220),
        // Hybrid v3 oyuncu KDA (bu maç için, varsa) → 5v5 tablo
        supabase.from('player_match_stats')
          .select('team_id,kills,deaths,assists,stats,player:players(nickname,image_url,role)')
          .eq('match_id', parseInt(id, 10)),
      ])
      setMatchPlayerStats(pmsRes.data || [])
      const rosters = { teamA:plA.data||[], teamB:plB.data||[] }
      setPlayers(rosters)
      const h = (h2hRes.data||[]).filter(x=>x.id!==parseInt(id, 10)).slice(0, 5)
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

  /* ── Hook-safe derivations — must stay before any early return ── */
  const aId   = match?.team_a_id || match?.team_a?.id
  const bId   = match?.team_b_id || match?.team_b?.id
  const aName = match?.team_a?.name || '?'
  const bName = match?.team_b?.name || '?'
  const extraMetadata = match?.extra_metadata || match?.raw_data?.extra_metadata || null

  const scoutMvp = useMemo(
    () => pickScoutMvpCandidate(liveBoard, aName, bName),
    [liveBoard, aName, bName],
  )

  const h2hRecentForm = useMemo(
    () => (h2h.matches || []).slice(0, 5).map(matchItem => getH2HBadge(matchItem, h2h.teamAId)),
    [h2h.matches, h2h.teamAId],
  )

  const tacticalScoutReport = useMemo(
    () => buildTacticalScoutReport({
      extraMetadata,
      mapStats,
      h2hMatches: h2h.matches,
      teamAId: h2h.teamAId || aId,
      teamBId: h2h.teamBId || bId,
      teamAName: aName,
      teamBName: bName,
    }),
    [extraMetadata, mapStats, h2h.matches, h2h.teamAId, h2h.teamBId, aId, bId, aName, bName],
  )

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
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><TriangleAlert size={44} color="#FF4655" /></div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-4)', marginBottom: 24 }}>{error || 'Maç bulunamadı.'}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '10px 24px', background: FEXT.accentGrad, border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>← Geri</button>
    </div>
  )

  /* ── Türevler (match guaranteed non-null below) ── */
  const aLogo = match.team_a?.logo_url
  const bLogo = match.team_b?.logo_url
  const gName = match.game?.name || ''
  const gc    = gameColor(gName)
  const isLive= match.status === 'running'
  const isFin = match.status === 'finished'
  const hasTR = isTurkishTeam(aName) || isTurkishTeam(bName)
  const pctA  = aiWin.teamA
  const pctB  = aiWin.teamB
  // Seri kazananı winner_id ÖNCELİKLİ (güvenilir alan); skorlar ~%1.2 maçta ters-atanmış.
  const seriesWinner = isFin ? deriveWinnerTeamId(match) : null
  const aWon  = seriesWinner != null && seriesWinner === Number(aId)
  const bWon  = seriesWinner != null && seriesWinner === Number(bId)
  // Gösterim için skorları winner_id ile tutarlı hale getir
  const dispScores = correctedScores(match)
  const favA  = isTeamFollowed(aId)
  const favB  = isTeamFollowed(bId)
  const boFormat = getBOFormat(match.team_a_score, match.team_b_score, match.number_of_games)

  const twitchCh = (() => {
    const s = streams.find(s => (s.embed_url || s.raw_url || '').toLowerCase().includes('twitch.tv'))
    if (!s) return null
    return (s.embed_url || s.raw_url || '').split('twitch.tv/').pop()?.split(/[/?]/)[0] || null
  })()

  return (
    <div style={{ color: 'white', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 60px' }}>

        {/* Geri */}
        <button onClick={() => navigate(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, padding: '7px 14px', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 9, color: 'var(--text-4)', fontSize: 12, cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-6)'; e.currentTarget.style.color = 'var(--text-2)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-4)' }}
        >← Geri</button>

        {/* TR banner */}
        {hasTR && (
          <div style={{ background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)', borderRadius: '16px 16px 0 0', padding: 6, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <span>🇹🇷</span><span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: '#fff', textTransform: 'uppercase' }}>Turkish Pride</span><span>🇹🇷</span>
          </div>
        )}

        {/* ── Hero ── */}
        <div style={{ background: 'linear-gradient(135deg,var(--surface),var(--surface))', borderRadius: hasTR ? '0 0 20px 20px' : '20px', border: `2px solid ${isLive ? '#FF4655' : hasTR ? 'rgba(212,175,55,.3)' : gc + '33'}`, padding: '28px 24px 20px', marginBottom: 8, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: '25%', right: '25%', height: 1, background: `linear-gradient(90deg,transparent,${gc}44,transparent)` }} />

          {/* Badges */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            <span style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 700, background: `${gc}22`, color: gc, border: `1px solid ${gc}44` }}>{gameShort(gName)} · {gName}</span>
            {match.tournament && <Link to={`/tournament/${match.tournament.id}`} style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 600, background: 'rgba(255,184,0,.1)', color: '#FFB800', border: '1px solid rgba(255,184,0,.3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Trophy size={11} /> {match.tournament.name}</Link>}
            {boFormat && <span style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 700, background: 'rgba(96,165,250,.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,.3)' }}>{boFormat}</span>}
            {isLive && <span style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 800, background: 'rgba(255,70,85,.2)', color: '#FF4655', border: '1px solid rgba(255,70,85,.4)', animation: 'pulse 1.2s infinite' }}>● LIVE</span>}
            {isFin  && <span style={{ padding: '3px 10px', borderRadius: 16, fontSize: 10, fontWeight: 700, background: 'rgba(76,175,80,.1)', color: '#4CAF50', border: '1px solid rgba(76,175,80,.3)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><CircleCheck size={11} /> Tamamlandı</span>}
          </div>

          {/* Teams + Score */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12 }}>

            {/* Team A */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <div onClick={() => navigate(`/team/${aId}`)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, cursor: 'pointer', opacity: isFin && bWon ? 0.45 : 1, transition: 'opacity .2s' }}>
                <InitialsImage
                  src={aLogo}
                  name={aName}
                  width={72} height={72}
                  borderRadius={12}
                  imgStyle={{ objectFit: 'contain', filter: isFin && bWon ? 'grayscale(80%)' : 'none' }}
                />
                <div style={{ fontSize: 16, fontWeight: 900, color: isFin ? (aWon ? '#4CAF50' : 'var(--text-4)') : '#fff' }}>{aName}{isTurkishTeam(aName) && ' 🇹🇷'}</div>
              </div>
              <FavButton teamId={aId} active={favA} onToggle={toggleTeamFollow} />
            </div>

            {/* Skor */}
            <div style={{ textAlign: 'center', minWidth: 100, flexShrink: 0 }}>
              {(isLive || isFin)
                ? <div style={{ fontSize: 36, fontWeight: 900, color: isLive ? '#FF4655' : 'var(--text-2)', letterSpacing: 4, fontVariantNumeric: 'tabular-nums', textShadow: isLive ? '0 0 20px rgba(255,70,85,.4)' : 'none' }}>{dispScores.team_a_score ?? 0}:{dispScores.team_b_score ?? 0}</div>
                : <div style={{ fontSize: 26, fontWeight: 900, color: FEXT.accentText, letterSpacing: 3 }}>VS</div>
              }
              <div style={{ fontSize: 12, fontWeight: 700, color: isLive ? '#FF4655' : '#4CAF50', marginTop: 4 }}>{isLive ? '● Canlı' : fmtTime(match.scheduled_at)}</div>
              <div style={{ fontSize: 10, color: 'var(--text-6)', marginTop: 2 }}>{fmtDate(match.scheduled_at)}</div>
              <div style={{ marginTop: 10, padding: '0 6px', minWidth: 170 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 4 }}>AI Win Probability</div>
                <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', border: '1px solid var(--line)' }}>
                  <div style={{ flex: pctA, background: 'linear-gradient(90deg,#4ade80,#22c55e)', borderRadius: '4px 0 0 4px' }} />
                  <div style={{ flex: pctB, background: 'linear-gradient(90deg,#60a5fa,#3b82f6)', borderRadius: '0 4px 4px 0' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 10, fontWeight: 800 }}>
                  <span style={{ color: '#4ade80' }}>{aName}: {pctA}%</span>
                  <span style={{ color: '#60a5fa' }}>{pctB}% :{bName}</span>
                </div>
                <div style={{ marginTop: 2, fontSize: 9, color: 'var(--text-6)' }}>Confidence Score: %{aiWin.confidence} · sample: {aiWin.samples}</div>
                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center' }}>
                  <PredictionAccuracyBadge variant="inline" />
                </div>
              </div>
            </div>

            {/* Team B */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <div onClick={() => navigate(`/team/${bId}`)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, cursor: 'pointer', opacity: isFin && aWon ? 0.45 : 1, transition: 'opacity .2s' }}>
                <InitialsImage
                  src={bLogo}
                  name={bName}
                  width={72} height={72}
                  borderRadius={12}
                  imgStyle={{ objectFit: 'contain', filter: isFin && aWon ? 'grayscale(80%)' : 'none' }}
                />
                <div style={{ fontSize: 16, fontWeight: 900, color: isFin ? (bWon ? '#4CAF50' : 'var(--text-4)') : '#fff' }}>{isTurkishTeam(bName) && '🇹🇷 '}{bName}</div>
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

        {/* ── Turnuva bağlamı — bracket & tüm maçlara köprü ── */}
        {match.tournament && (
          <Link
            to={`/tournament/${match.tournament.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, padding: '12px 16px',
              borderRadius: 14, background: 'linear-gradient(135deg, rgba(255,184,0,.08), var(--surface))',
              border: '1px solid rgba(255,184,0,.25)', textDecoration: 'none',
            }}
          >
            <Trophy size={22} color="#f0c040" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#f0e0b0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {match.tournament.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Bracket, puan durumu &amp; turnuvanın tüm maçları</div>
            </div>
            <span style={{ fontSize: 13, color: '#FFB800', fontWeight: 700, flexShrink: 0 }}>Git →</span>
          </Link>
        )}

        {/* ── İçerik Grid — mobilde tek kolon (auto-fit + min(100%,340px)) ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 18, marginTop: 20 }}>

          {/* Sol */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Harita Skorları */}
            <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--surface-2)', padding: 18 }}>
              <ST Icon={MapIcon} label="Harita Skorları" />
              {loadingDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{[1,2,3].map(i => <Sk key={i} h="44px" r="10px" />)}</div>
                : maps.length === 0 ? <StatsCoverageNotice compact message="Bu maç için harita bazlı skorlar ve tur detayları yalnızca Tier S/A kapsamındaki maçlarda mevcut." />

                : (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, marginBottom: 6, padding: '0 14px' }}>
                      <div style={{ textAlign: 'right', fontSize: 9, fontWeight: 700, color: 'var(--line)' }}>{aName}</div>
                      <div style={{ minWidth: 80 }} />
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--line)' }}>{bName}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {maps.map((map, i) => <MapRow key={i} map={map} index={i} teamAId={aId} />)}
                    </div>
                    <div style={{ marginTop: 8, padding: '8px 14px', borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--surface-2)', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}>
                      <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 900, color: aWon ? '#4CAF50' : 'var(--line)', fontVariantNumeric: 'tabular-nums' }}>{dispScores.team_a_score ?? '—'}</div>
                      <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--line)', minWidth: 50 }}>TOPLAM</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: bWon ? '#4CAF50' : 'var(--line)', fontVariantNumeric: 'tabular-nums' }}>{dispScores.team_b_score ?? '—'}</div>
                    </div>
                    {mapStats.length > 0 && (
                      <div style={{ marginTop: 12, background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--surface-2)', padding: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-5)', marginBottom: 8, textTransform: 'uppercase' }}>Harita Kazanma Oranları</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {mapStats.map(m => (
                            <div key={m.map} style={{ background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--surface-2)', padding: '7px 8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10 }}>
                                <span style={{ color: '#9ca3af', fontWeight: 700 }}>{m.map}</span>
                                <span style={{ color: 'var(--text-5)' }}>{m.total} map</span>
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
              <LiquipediaCredit compact />
            </div>

            {/* Oyuncu KDA (hybrid v3 — enriched maçlarda) */}
            {matchPlayerStats.length > 0 && (
              <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--surface-2)', padding: 18 }}>
                <ST Icon={Target} label="Oyuncu Performansı (K/D/A)" />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <DeepScoutBadge />
                </div>
                <div style={{ display: 'flex', gap: 14 }}>
                  <KdaColumn rows={matchPlayerStats.filter(r => Number(r.team_id) === Number(aId))} teamName={aName} gc="#4ade80" />
                  <KdaColumn rows={matchPlayerStats.filter(r => Number(r.team_id) === Number(bId))} teamName={bName} gc="#60a5fa" />
                </div>
                <LiquipediaCredit compact />
              </div>
            )}

            {/* H2H */}
            <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--surface-2)', padding: 18 }}>
              <ST Icon={Swords} label="Rekabet Geçmişi (H2H)" />
              {loadingDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{[1,2,3].map(i => <Sk key={i} h="36px" r="8px" />)}</div>
                : h2h.total === 0 ? <div style={{ textAlign: 'center', padding: 18, color: 'var(--line)', fontSize: 12 }}>İlk karşılaşmaları</div>
                : (
                  <div>
                    <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ flex: h2h.teamAWins, background: '#4CAF50', minWidth: h2h.teamAWins > 0 ? 4 : 0 }} />
                      {h2h.draws > 0 && <div style={{ flex: h2h.draws, background: 'var(--text-4)' }} />}
                      <div style={{ flex: h2h.teamBWins, background: '#FF4655', minWidth: h2h.teamBWins > 0 ? 4 : 0 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 10 }}>
                      <span style={{ color: h2h.teamAWins >= h2h.teamBWins ? '#4CAF50' : 'var(--text-5)', fontWeight: 700 }}>{aName} {h2h.teamAWins}G</span>
                      <span style={{ color: h2h.teamBWins > h2h.teamAWins ? '#4CAF50' : 'var(--text-5)', fontWeight: 700 }}>{h2h.teamBWins}G {bName}</span>
                    </div>
                    <div style={{ marginBottom: 10, background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: 8, padding: '7px 9px', display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                      <span style={{ color: 'var(--text-4)' }}>Rekabet Skoru</span>
                      <span style={{ color: 'var(--text-1)', fontWeight: 800 }}>{aName} {h2h.teamAWins} - {h2h.teamBWins} {bName}</span>
                    </div>
                    <div style={{ marginBottom: 10, background: 'var(--bg)', border: '1px solid var(--surface-2)', borderRadius: 8, padding: '7px 9px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-4)', fontSize: 10 }}>Son 5 Form</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {h2hRecentForm.map((badge, idx) => (
                          <span
                            key={`${badge.text}_${idx}`}
                            title={badge.label}
                            style={{
                              minWidth: 22,
                              textAlign: 'center',
                              borderRadius: 999,
                              border: `1px solid ${badge.border}`,
                              background: badge.bg,
                              color: badge.color,
                              fontSize: 10,
                              fontWeight: 900,
                              padding: '2px 6px',
                              letterSpacing: '.6px',
                            }}
                          >
                            {badge.text}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {h2h.matches.slice(0, 5).map(m => (
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
            <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--surface-2)', padding: 18 }}>
              <ST Icon={Info} label="Maç Bilgisi" />
              {[
                [Gamepad2,     'Oyun',   gName || '—'],
                [CalendarDays, 'Tarih',  fmtDate(match.scheduled_at)],
                [Clock,        'Saat',   fmtTime(match.scheduled_at)],
                [BarChart3,    'Durum',  isFin ? 'Tamamlandı' : isLive ? 'Canlı' : 'Yakında'],
                [Hash,         'ID',     String(match.id)],
              ].map(([Icon, label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--surface)' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-6)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon size={11} /> {label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-4)', textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: label === 'ID' ? 'monospace' : 'inherit' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sağ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Team A Kadro */}
            <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--surface-2)', padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {aLogo && <img src={aLogo} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />}
                <ST icon="" label={aName + ' Kadro'} />
              </div>
              {loadingDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[1,2,3,4,5].map(i => <Sk key={i} h="50px" r="10px" />)}</div>
                : players.teamA.length === 0 ? <div style={{ textAlign: 'center', padding: 18, color: 'var(--line)', fontSize: 12 }}>Kadro verisi yok</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{players.teamA.map((p, i) => <PlayerCard key={i} player={p} side="left" />)}</div>
              }
            </div>

            {/* Team B Kadro */}
            <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--surface-2)', padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {bLogo && <img src={bLogo} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />}
                <ST icon="" label={bName + ' Kadro'} />
              </div>
              {loadingDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{[1,2,3,4,5].map(i => <Sk key={i} h="50px" r="10px" />)}</div>
                : players.teamB.length === 0 ? <div style={{ textAlign: 'center', padding: 18, color: 'var(--line)', fontSize: 12 }}>Kadro verisi yok</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{players.teamB.map((p, i) => <PlayerCard key={i} player={p} side="right" />)}</div>
              }
            </div>

            {/* MVP Oylaması — MVP_VOTING_ENABLED ile gizli (istatistik altyapısı bekleniyor) */}
            {MVP_VOTING_ENABLED && isFin && (
              <div style={{ background: 'var(--surface)', borderRadius: 16, border: '1px solid rgba(167,139,250,.15)', padding: 18 }}>
                <ST Icon={Award} label="MVP Oylaması" />
                <MVPVoting matchId={parseInt(id)} players={players} isFinished={isFin} />
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 18, background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--surface-2)', padding: 14 }}>
          <ST Icon={Compass} label="Gozcu Notu" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <div>
              <WinProbabilityBar
                teamAName={aName}
                teamBName={bName}
                teamAPct={pctA}
                teamBPct={pctB}
              />
              <div style={{ marginTop: 5, fontSize: 11, color: '#9bc4bf' }}>Confidence: %{aiWin.confidence} (sample {aiWin.samples})</div>
            </div>

            <div style={{ border: '1px solid rgba(196,181,253,.24)', borderRadius: 10, background: 'linear-gradient(130deg, rgba(124,58,237,.12), rgba(12,12,12,.9))', padding: '10px 11px' }}>
              <div style={{ fontSize: 10, color: '#c8b4ff', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 5 }}>Map Profile</div>
              <div style={{ fontSize: 12, color: '#efeaff' }}>{mapStats.length > 0 ? `${mapStats[0].map} en fazla oynanan harita` : 'Yeterli map tarihi yok'}</div>
              <div style={{ marginTop: 4, fontSize: 11, color: '#b6acd6' }}>{mapStats.length > 0 ? `${mapStats[0].total} ornek uzerinden ${aName} ${mapStats[0].teamAWinRate}% - ${mapStats[0].teamBWinRate}% ${bName}` : 'Tahmin neutral modda'}</div>
            </div>

            <div style={{ border: '1px solid rgba(255,184,0,.24)', borderRadius: 10, background: 'linear-gradient(130deg, rgba(255,184,0,.12), rgba(12,12,12,.9))', padding: '10px 11px' }}>
              <div style={{ fontSize: 10, color: '#ffd67d', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 5 }}>MVP Projection</div>
              <div style={{ fontSize: 12, color: '#fff0cb' }}>{scoutMvp ? `${scoutMvp.nickname} (${scoutMvp.teamName})` : 'Canli board verisi bekleniyor'}</div>
              <div style={{ marginTop: 4, fontSize: 11, color: '#d2bf8f' }}>{scoutMvp ? `K/D/A: ${scoutMvp.kills || 0}/${scoutMvp.deaths || 0}/${scoutMvp.assists || 0}` : 'Model sadece takim seviyesinde calisiyor'}</div>
            </div>
          </div>
        </div>

        <CommunityPredictionPool
          matchId={parseInt(id, 10)}
          teamAName={aName}
          teamBName={bName}
          aiWin={aiWin}
          isFinished={isFin}
        />

        <TacticalScoutReport report={tacticalScoutReport} />
      </div>

      <style>{`
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes winBoundaryPulse {
          0%, 100% { opacity: .95; }
          50% { opacity: .45; }
        }
      `}</style>
    </div>
  )
}

function LiveScoreboard({ teamAName, teamBName, teamABoard, teamBBoard, isLive }) {
  if (!isLive) return null

  const table = (title, rows, accent) => (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 12, padding: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: accent, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.8px' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 40px 40px', gap: 6, fontSize: 9, color: 'var(--text-5)', marginBottom: 6, padding: '0 4px' }}>
        <span>Oyuncu</span><span style={{ textAlign: 'right' }}>K</span><span style={{ textAlign: 'right' }}>D</span><span style={{ textAlign: 'right' }}>A</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(rows || []).slice(0, 6).map(p => (
          <div key={`${title}_${p.player_id}`} style={{ display: 'grid', gridTemplateColumns: '1fr 40px 40px 40px', gap: 6, alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 8, padding: '6px 8px' }}>
            <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</span>
            <span style={{ textAlign: 'right', fontSize: 11, color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>{p.kills ?? 0}</span>
            <span style={{ textAlign: 'right', fontSize: 11, color: '#fb7185', fontVariantNumeric: 'tabular-nums' }}>{p.deaths ?? 0}</span>
            <span style={{ textAlign: 'right', fontSize: 11, color: '#93c5fd', fontVariantNumeric: 'tabular-nums' }}>{p.assists ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ marginTop: 16, marginBottom: 4, background: 'linear-gradient(160deg,#170d0f,var(--surface))', borderRadius: 16, border: '1px solid rgba(255,70,85,.25)', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: '#FF4655', textTransform: 'uppercase', letterSpacing: '1px' }}>Canlı Skor Tablosu</div>
        <div style={{ fontSize: 10, color: '#7a3038' }}>K/D/A anlik performans</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {table(teamAName, teamABoard, '#4ade80')}
        {table(teamBName, teamBBoard, '#60a5fa')}
      </div>
    </div>
  )
}