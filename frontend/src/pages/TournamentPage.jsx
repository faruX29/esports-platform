/**
 * TournamentPage.jsx
 * /tournament/:tournamentId
 *
 * • Header     — turnuva adı, oyun, tier, tarih, prize pool, radial glow
 * • Standings  — round-robin: W/L/winrate tablosu
 * • Brackets   — elimination: QF → SF → Final ağacı
 * • Match List — Upcoming / Past sekmeleri
 * • Turkish Pride efekti
 */
import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react'
import { useParams, useNavigate }                     from 'react-router-dom'
import { supabase }                                   from '../supabaseClient'
import { isTurkishTeam }                              from '../constants'
import { cleanDisplayName }                           from '../utils/nameCleaner'
import { getBOFormat }                                from '../utils/matchFormat'
import { DeepScoutBadge }                             from '../components/ScoutSignals'
import { deriveWinnerTeamId }                         from '../utils/matchResult'
import { normalizeGameId }                            from '../utils/gameUtils'
import { GAMES }                                      from '../context/GameContext'
import {
  Swords, Flame, Trophy, Crown, Route, Flag, Gamepad2, Medal, CalendarDays,
  MapPin, Compass, Wallet, RefreshCw, CircleCheck, BarChart3, ClipboardList,
  Radio, Star, TriangleAlert, Zap, Target,
} from 'lucide-react'
import { FEXT } from '../theme'
import Mascot from '../components/Mascot'
import SeoHead from '../components/SeoHead'

// ─── Sabitler ────────────────────────────────────────────────────────────────

const TIER_META = {
  S: { color: '#FFD700', bg: 'rgba(255,215,0,.15)',   border: 'rgba(255,215,0,.4)',   label: 'S-Tier · Premier'     },
  A: { color: '#FF4655', bg: 'rgba(255,70,85,.15)',   border: 'rgba(255,70,85,.4)',   label: 'A-Tier · Major'       },
  B: { color: '#FF8C00', bg: 'rgba(255,140,0,.15)',   border: 'rgba(255,140,0,.4)',   label: 'B-Tier · Regional'    },
  C: { color: '#818cf8', bg: 'rgba(129,140,248,.15)', border: 'rgba(129,140,248,.4)', label: 'C-Tier · Challenger'  },
}

const TOURNAMENT_DEBUG = false

function gameColor(name = '') {
  const n = name.toLowerCase()
  if (n.includes('valorant'))                              return '#FF4655'
  if (n.includes('counter') || n.includes('cs'))          return '#F0A500'
  if (n.includes('league')  || n.includes('legends'))     return '#C89B3C'
  if (n.includes('dota'))                                  return '#9d2226'
  return '#818cf8'
}

function normalizeTierKey(value) {
  if (!value) return null

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')

  const token = normalized
    .replace(/tier/g, '')
    .replace(/[^a-z]/g, '')

  switch (token.charAt(0)) {
    case 's': return 'S'
    case 'a': return 'A'
    case 'b': return 'B'
    case 'c': return 'C'
    default: return null
  }
}

function getTierMeta(rawTier) {
  const key = normalizeTierKey(rawTier)
  if (key && TIER_META[key]) return { ...TIER_META[key], key }
  if (!rawTier) return null
  const fallbackKey = String(rawTier || '').trim().toUpperCase()
  return {
    key: fallbackKey,
    color: 'var(--text-2)',
    bg: 'var(--hover-strong)',
    border: 'rgba(170,170,170,.35)',
    label: `${fallbackKey}-Tier`,
  }
}

function cleanName(value, fallback = '') {
  const cleaned = cleanDisplayName(value)
  if (cleaned) return cleaned
  return String(fallback || value || '').trim()
}

function toInteger(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const int = Math.trunc(parsed)
  return Number.isFinite(int) ? int : null
}

function getStructuredRound(match) {
  return toInteger(match?.round ?? match?.round_number ?? match?.bracket_round)
}

function getStructuredPosition(match) {
  const pos = toInteger(match?.position ?? match?.bracket_position ?? match?.slot)
  if (pos == null || pos < 1) return null
  return pos
}

function getStructuredNextMatchId(match) {
  const raw = match?.next_match_id ?? match?.next_match?.id ?? null
  if (raw == null) return null
  return String(raw)
}

function stageFromStructuredRound(roundNo, bracketSide = 'upper') {
  if (!Number.isFinite(roundNo)) return null

  if (bracketSide === 'lower') {
    if (roundNo <= 1) return 'Lower Round 1'
    if (roundNo === 2) return 'Lower Round 2'
    if (roundNo === 3) return 'Lower Semifinals'
    return 'Lower Finals'
  }

  if (roundNo <= 1) return 'Quarter-finals'
  if (roundNo === 2) return 'Semi-finals'
  if (roundNo === 3) return 'Upper Finals'
  return 'Grand final'
}

function getMatchTimestamp(match) {
  return match?.begin_at || match?.scheduled_at || null
}

function inferBracketStageFromText(text = '', bracketSide = 'upper') {
  const s = String(text || '').toLowerCase().trim()
  if (!s) return null

  if (/(3rd|third|bronze|decider|placement)/.test(s)) return 'Third Place Decider'

  // Grand final must be matched before the bracket-keyword block to avoid conflict
  if (/(grand[\s_-]*final|\bgf\b)/.test(s)) return 'Grand final'

  const isLower = /(lower|lb|loser)/.test(s) || bracketSide === 'lower'

  // ── PandaScore "[side] bracket [stage]" format ──────────────────────────
  // e.g. "upper bracket final" → 'Upper Finals'
  //      "lower bracket quarterfinal" → 'Lower Round 2'  (PandaScore convention)
  //      "lower bracket round 1" → 'Lower Round 1'
  const bracketStageM = s.match(/\bbracket[\s_-]+(.+)/)
  if (bracketStageM) {
    const stage = bracketStageM[1].trim()
    const rn = stage.match(/(?:round|r)[\s_-]*(\d+)/)
    if (rn?.[1]) {
      if (isLower) {
        const n = parseInt(rn[1], 10)
        if (n >= 4) return 'Lower Finals'
        if (n === 3) return 'Lower Semifinals'
        return `Lower Round ${n}`
      }
      return `Upper Round ${rn[1]}`
    }
    if (/(round[\s_-]*of[\s_-]*16|ro16|\br16\b|1\/8)/.test(stage)) return 'Round of 16'
    if (/(quarter[\s_-]*final|quarterfinal|\bqf\b|1\/4)/.test(stage)) {
      return isLower ? 'Lower Round 2' : 'Quarter-finals'
    }
    if (/(semi[\s_-]*final|semifinal|\bsf\b|1\/2)/.test(stage)) {
      return isLower ? 'Lower Semifinals' : 'Semi-finals'
    }
    if (/\bfinals?/.test(stage)) {
      return isLower ? 'Lower Finals' : 'Upper Finals'
    }
  }

  // ── Non-bracket-keyword patterns ────────────────────────────────────────
  // Round of 16 — must come before QF to avoid overlap
  if (/(round[\s_-]*of[\s_-]*16|ro16|round[\s_-]*16|\br16\b|1\/8\s*final|1\/8)/.test(s)) return 'Round of 16'

  if (isLower) {
    const roundNum = s.match(/(?:lower|lb|losers?)[\s_-]*(?:round|r)?[\s_-]*(\d+)/)
    if (roundNum?.[1]) {
      const n = parseInt(roundNum[1], 10)
      if (n >= 4) return 'Lower Finals'
      if (n === 3) return 'Lower Semifinals'
      return `Lower Round ${n}`
    }
    if (/(lower[\s_-]*semi|losers?[\s_-]*semi|lb[\s_-]*semi|semi[\s_-]*final|semifinal|\bsf\b)/.test(s)) return 'Lower Semifinals'
    if (/(lower[\s_-]*finals?|losers?[\s_-]*finals?|lb[\s_-]*finals?|\blf\b|\bfinals?\b)/.test(s)) return 'Lower Finals'
    return 'Lower Round 1'
  }

  const ubRound = s.match(/(?:(?:upper[\s_-]*)?(?:bracket|winner|ub)[\s_-]*)(?:round|r)[\s_-]*(\d+)/)
  if (ubRound?.[1]) return `Upper Round ${ubRound[1]}`
  if (/(semi[\s_-]*final|semifinal|\bsf\b|round[\s_-]*of[\s_-]*4|round[\s_-]*4|ro4|1\/2)/.test(s)) return 'Semi-finals'
  if (/(quarter[\s_-]*final|quarterfinal|\bqf\b|round[\s_-]*of[\s_-]*8|round[\s_-]*8|ro8|1\/4)/.test(s)) return 'Quarter-finals'
  if (/(upper[\s_-]*finals?|winners?[\s_-]*finals?|\bub[\s_-]*finals?\b|\bwf\b)/.test(s)) return 'Upper Finals'
  if (/\bfinals?\b/.test(s)) return 'Semi-finals'

  return null
}

function inferBracketSide(match) {
  const raw = [match?.bracket_type, match?.stage_name, match?.round_info, match?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (!raw) return 'upper'
  if (/(lower|lb|loser)/.test(raw)) return 'lower'
  if (/(upper|ub|winner|quarter|semi|grand\s*final|\bqf\b|\bsf\b)/.test(raw)) return 'upper'
  return 'upper'
}

// Matches whose round_info clearly indicates a group/swiss/league stage (not a bracket).
const GROUP_STAGE_ROUND_RE = /^group[\s_]?[a-z0-9]|\bswiss[\s_]*(?:round|stage)?(?:\s*\d)|\bgame[\s_]*week\s*\d|\bweek\s*\d+\s*$/i

// Within each resolved bracket stage, deduplicate by:
//   1. same matchup (team pair) — rematches keep only the latest
//   2. same team in the stage column — keeps only the latest match per team (safety net)
// Sorted desc so the first match we see per pair/team is the most recent.
function deduplicateStageDuplicates(resolved) {
  const byStage = new Map()
  for (const m of resolved) {
    if (!byStage.has(m.__stage)) byStage.set(m.__stage, [])
    byStage.get(m.__stage).push(m)
  }

  const kept = []
  for (const [, stageMatches] of byStage) {
    const sortedDesc = [...stageMatches].sort((a, b) => {
      const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
      const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
      return tb - ta
    })

    const seenPairs = new Set()
    const seenTeams = new Set()
    for (const m of sortedDesc) {
      const aId = String(m.team_a?.id || m.team_a_id || '').trim()
      const bId = String(m.team_b?.id || m.team_b_id || '').trim()
      if (aId && bId) {
        // Skip duplicate matchup (same two teams already in this stage column)
        const pairKey = [aId, bId].sort().join('|')
        if (seenPairs.has(pairKey)) continue
        seenPairs.add(pairKey)
        // Skip if either team is already represented in this stage column
        if (seenTeams.has(aId) || seenTeams.has(bId)) continue
        seenTeams.add(aId)
        seenTeams.add(bId)
      }
      kept.push(m)
    }
  }
  return kept
}

function buildBracketStages(matches = []) {
  // Strip group/swiss/league-stage matches so they don't bleed into bracket columns.
  const bracketCandidates = (matches || []).filter(m => {
    const ri = String(m.round_info || '').trim()
    return ri ? !GROUP_STAGE_ROUND_RE.test(ri) : true
  })

  const sortedByTime = [...bracketCandidates].sort((a, b) => {
    const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
    const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
    return ta - tb
  })

  const resolved = sortedByTime.map(m => {
    const bracketSide = inferBracketSide(m)
    const structuredRound = getStructuredRound(m)
    const structuredPosition = getStructuredPosition(m)
    const structuredNextMatchId = getStructuredNextMatchId(m)

    const computedStageFromRound = stageFromStructuredRound(structuredRound, bracketSide)
    if (computedStageFromRound) {
      return {
        ...m,
        __stage: computedStageFromRound,
        __stageSource: 'round',
        __bracketSide: bracketSide,
        __roundNo: structuredRound,
        __positionNo: structuredPosition,
        __nextMatchId: structuredNextMatchId,
      }
    }

    const stageFromRound = inferBracketStageFromText(m?.round_info, bracketSide)
    if (stageFromRound) {
      return {
        ...m,
        __stage: stageFromRound,
        __stageSource: 'round_info',
        __bracketSide: bracketSide,
        __roundNo: structuredRound,
        __positionNo: structuredPosition,
        __nextMatchId: structuredNextMatchId,
      }
    }

    const stageFromName = inferBracketStageFromText(m?.name, bracketSide)
    if (stageFromName) {
      return {
        ...m,
        __stage: stageFromName,
        __stageSource: 'name',
        __bracketSide: bracketSide,
        __roundNo: structuredRound,
        __positionNo: structuredPosition,
        __nextMatchId: structuredNextMatchId,
      }
    }

    const fallbackStage = bracketSide === 'lower' ? 'Lower Round 1' : 'Quarter-finals'
    if (TOURNAMENT_DEBUG) {
      console.warn('[TournamentPage][Bracket][InferredStage]', {
        matchId: m?.id,
        round_info: m?.round_info ?? null,
        name: m?.name ?? null,
        bracket_type: m?.bracket_type ?? null,
        stage_name: m?.stage_name ?? null,
        reason: 'No stage keyword, using bracket-side default stage',
        assignedSide: bracketSide,
        assignedStage: fallbackStage,
      })
    }

    return {
      ...m,
      __stage: fallbackStage,
      __stageSource: 'side-default',
      __bracketSide: bracketSide,
      __roundNo: structuredRound,
      __positionNo: structuredPosition,
      __nextMatchId: structuredNextMatchId,
    }
  })

  return deduplicateStageDuplicates(resolved)
}

function toFloatTime(value) {
  if (!value) return 0
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : 0
}

function makeLiquipediaTeamId(teamName = '') {
  const normalized = String(teamName || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return normalized ? `lp-team-${normalized}` : null
}

function parseTemplateSampleParams(sampleParams = {}) {
  const matchMap = new Map()
  const entries = Object.entries(sampleParams || {})

  for (const [rawKey, rawVal] of entries) {
    const key = String(rawKey || '').toLowerCase()
    const val = String(rawVal || '').trim()
    if (!val) continue

    const m = key.match(/^r(\d+)m(\d+)(t1|t2|win)$/)
    if (!m) continue
    const round = Number(m[1])
    const match = Number(m[2])
    const field = m[3]
    const id = `r${round}m${match}`

    if (!matchMap.has(id)) {
      matchMap.set(id, {
        id,
        round,
        match,
        team_a_name: null,
        team_b_name: null,
        winner_name: null,
      })
    }

    const item = matchMap.get(id)
    if (field === 't1') item.team_a_name = val
    if (field === 't2') item.team_b_name = val
    if (field === 'win') {
      item.winner_name = val === '1' ? item.team_a_name : val === '2' ? item.team_b_name : val
    }
  }

  return [...matchMap.values()]
}

function extractLiquipediaBracketMatches(tournament) {
  const rows = tournament?.extra_metadata?.liquipedia?.brackets
  if (!Array.isArray(rows) || rows.length === 0) return []

  const fromCargo = rows
    .map((row, idx) => ({
      id: row?.MatchId ? `lp-cargo-${row.MatchId}` : `lp-cargo-${idx}`,
      team_a_name: row?.Team1 || row?.Opponent1 || null,
      team_b_name: row?.Team2 || row?.Opponent2 || null,
      winner_name: row?.Winner || null,
      begin_at: row?.DateTime_UTC || row?.Date || null,
      best_of: row?.BestOf || null,
      source: row?.source || 'cargo',
    }))
    .filter(m => m.team_a_name || m.team_b_name)

  if (fromCargo.length > 0) {
    return fromCargo.sort((a, b) => toFloatTime(a.begin_at) - toFloatTime(b.begin_at))
  }

  const fromTemplates = []
  rows.forEach((row, idx) => {
    const parsed = parseTemplateSampleParams(row?.sample_params || {})
    parsed.forEach(item => {
      fromTemplates.push({
        id: `lp-tpl-${idx}-${item.id}`,
        team_a_name: item.team_a_name,
        team_b_name: item.team_b_name,
        winner_name: item.winner_name,
        begin_at: null,
        best_of: null,
        source: row?.source || 'wikitext_template',
        inferred_round: item.round,
      })
    })
  })

  return fromTemplates.filter(m => m.team_a_name || m.team_b_name)
}

function buildLiquipediaBracketStages(tournament) {
  const raw = extractLiquipediaBracketMatches(tournament)
  if (raw.length === 0) return []

  const focus = raw.length > 7 ? raw.slice(-7) : raw
  const count = focus.length
  let qfCount = 0
  let sfCount = 0
  let gfCount = 0

  if (count >= 7) {
    qfCount = 4; sfCount = 2; gfCount = 1
  } else if (count === 6) {
    qfCount = 3; sfCount = 2; gfCount = 1
  } else if (count === 5) {
    qfCount = 2; sfCount = 2; gfCount = 1
  } else if (count === 4) {
    qfCount = 2; sfCount = 1; gfCount = 1
  } else if (count === 3) {
    qfCount = 1; sfCount = 1; gfCount = 1
  } else if (count === 2) {
    qfCount = 0; sfCount = 1; gfCount = 1
  } else {
    qfCount = 0; sfCount = 0; gfCount = 1
  }

  return focus.map((m, idx) => {
    const stage = idx < qfCount
      ? 'Quarter-finals'
      : idx < qfCount + sfCount
      ? 'Semi-finals'
      : 'Grand final'

    const aName = m.team_a_name || 'TBD'
    const bName = m.team_b_name || 'TBD'
    const aId = makeLiquipediaTeamId(aName) || `${m.id}-a`
    const bId = makeLiquipediaTeamId(bName) || `${m.id}-b`
    const winnerRaw = (m.winner_name || '').toLowerCase()
    const winnerId = winnerRaw && winnerRaw === aName.toLowerCase()
      ? aId
      : winnerRaw && winnerRaw === bName.toLowerCase()
      ? bId
      : null

    return {
      id: m.id,
      status: winnerId ? 'finished' : 'not_started',
      begin_at: m.begin_at,
      round_info: stage,
      team_a: { id: aId, name: aName, logo_url: null },
      team_b: { id: bId, name: bName, logo_url: null },
      team_a_id: aId,
      team_b_id: bId,
      winner_id: winnerId,
      team_a_score: null,
      team_b_score: null,
      __stage: stage,
      __stageSource: 'liquipedia',
      __bracketSide: 'upper',
      __clickable: false,
      __source: 'liquipedia',
    }
  })
}

// round-robin mi elimination mı?
function detectFormat(matches) {
  if (!matches?.length) return 'unknown'
  // round_info alanı varsa kullan
  const rounds = [...new Set(matches.map(m => m.round_info || m.name).filter(Boolean))]
  if (rounds.some(r => /final|semi|quarter|bracket/i.test(r))) return 'elimination'
  if (rounds.some(r => /group|round|week/i.test(r)))           return 'roundrobin'
  // Structured bracket alanları varsa elimination.
  if (matches.some(m =>
    m.bracket_position != null ||
    m.next_match_id != null ||
    m.round != null ||
    m.position != null
  )) return 'elimination'
  // fallback: maç sayısı az + tekrar eden takım çiftleri az → elimination
  return rounds.length > 0 ? 'roundrobin' : 'elimination'
}

function detectStageMode(tournament, matches, format) {
  const rootStageText = [tournament?.stage_type, tournament?.stage_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const stageText = [
    tournament?.stage_type,
    tournament?.stage_name,
    ...(matches || []).flatMap(m => [m?.stage_type, m?.stage_name, m?.round_info]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const hasLeagueStyle = /(swiss|groups?|round\s*robin|\brr\b)/.test(stageText)
  const hasBracketSignals = /(play[\s_-]*offs?|elimination|knockout|bracket|quarter|semi|grand\s*final|lower|upper)/.test(stageText)
  const hasStageHints = Boolean(rootStageText) || (matches || []).some(m => Boolean(m?.stage_type || m?.stage_name))
  const stageUndetermined = !hasStageHints && !hasLeagueStyle && !hasBracketSignals

  // Güvenli varsayılan: stage tipi belirlenemiyorsa liste görünümü.
  const bracketEnabled = !hasLeagueStyle && hasBracketSignals && !stageUndetermined

  return {
    hasLeagueStyle,
    hasBracketSignals,
    hasStageHints,
    stageUndetermined,
    format,
    bracketEnabled,
  }
}

function getRoundDisplayLabel(match) {
  return match?.round_info || match?.stage_name || 'Round'
}

function StageListView({ matches, navigate, gc }) {
  const [visibleDates, setVisibleDates] = useState(8)
  const grouped = useMemo(() => {
    const sorted = [...(matches || [])].sort((a, b) => {
      const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
      const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
      return ta - tb
    })

    const bucket = {}
    for (const m of sorted) {
      const ts = getMatchTimestamp(m)
      const d = ts ? new Date(ts) : null
      const dateKey = d && !Number.isNaN(d.getTime())
        ? d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'Tarih Bilinmiyor'

      const roundKey = getRoundDisplayLabel(m)
      if (!bucket[dateKey]) bucket[dateKey] = {}
      if (!bucket[dateKey][roundKey]) bucket[dateKey][roundKey] = []
      bucket[dateKey][roundKey].push(m)
    }
    return bucket
  }, [matches])

  const dateKeys = Object.keys(grouped)
  if (dateKeys.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-4)' }}>
        Bu aşamada listelenecek maç bulunamadı.
      </div>
    )
  }

  const shownKeys = dateKeys.slice(0, visibleDates)
  const remainingDays = dateKeys.length - shownKeys.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {shownKeys.map(dateKey => (
        <div key={dateKey} style={{ border: '1px solid var(--surface-2)', borderRadius: 12, background: 'var(--surface)', padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: gc, letterSpacing: '.9px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
            <CalendarDays size={12} /> {dateKey}
          </div>

          {Object.entries(grouped[dateKey]).map(([roundKey, list]) => (
            <div key={`${dateKey}-${roundKey}`} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.8px' }}>
                {roundKey}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 10 }}>
                {list.map(m => (
                  <MatchListCard key={m.id} m={m} navigate={navigate} gc={gc} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {remainingDays > 0 && (
        <button
          onClick={() => setVisibleDates(v => v + 12)}
          style={{
            alignSelf: 'center', marginTop: 4, padding: '10px 20px', borderRadius: 10,
            border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Daha fazla göster (+{remainingDays} gün)
        </button>
      )}
    </div>
  )
}

// ─── Utility ────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Sk({ w = '100%', h = '16px', r = '8px', style = {} }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
      ...style,
    }} />
  )
}

// ─── Section title ────────────────────────────────────────────────────────────

function ST({ Icon, label, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      {Icon && <Icon size={15} color="var(--text-3)" />}
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)',
        letterSpacing: '1.5px', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--surface-2)' }} />
      {right}
    </div>
  )
}

// ─── Team Logo / Avatar ───────────────────────────────────────────────────────

const TeamAv = memo(function TeamAv({ src, name, size = 36 }) {
  const [err, setErr] = useState(false)
  useEffect(() => {
    setErr(false)
  }, [src])
  const initials = (name || '?').split(/[\s_]/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  if (src && !err) {
    return (
      <img src={src} alt={name} loading='lazy' onError={() => setErr(true)}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, borderRadius: 8,
      background: 'linear-gradient(135deg,var(--surface-2),var(--line))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.32, fontWeight: 800, color: 'var(--text-5)',
    }}>{initials}</div>
  )
})

// ─── Standings Table ─────────────────────────────────────────────────────────

/* ── Top Performers: oyuncu KDA agregasyonu (hybrid v3) ── */
function aggregateTopPerformers(rows) {
  const acc = {}
  for (const r of rows) {
    const pid = r.player_id
    if (!pid) continue
    if (!acc[pid]) acc[pid] = {
      pid, nickname: r.player?.nickname || '?', image: r.player?.image_url || null,
      k: 0, d: 0, a: 0, n: 0, wins: 0, winCountable: 0, acsSum: 0, acsN: 0,
    }
    const p = acc[pid]
    p.k += Number(r.kills) || 0
    p.d += Number(r.deaths) || 0
    p.a += Number(r.assists) || 0
    p.n += 1
    if (r.is_win != null) { p.winCountable += 1; if (r.is_win) p.wins += 1 }
    const acs = r.stats?.acs_avg
    if (acs != null) { p.acsSum += Number(acs); p.acsN += 1 }
  }
  return Object.values(acc)
    .map(p => ({
      ...p,
      kd: p.d > 0 ? p.k / p.d : p.k,
      winRate: p.winCountable > 0 ? Math.round((p.wins / p.winCountable) * 100) : null,
      acs: p.acsN > 0 ? Math.round(p.acsSum / p.acsN) : null,
    }))
    .filter(p => p.n >= 1)
    .sort((x, y) => y.kd - x.kd)
    .slice(0, 8)
}

function TopPerformers({ rows, navigate }) {
  if (!rows?.length) return null
  return (
    <div style={{ background: 'var(--bg)', borderRadius: 16, border: '1px solid var(--surface-2)', padding: '16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 44px 60px 44px', gap: 8, padding: '0 8px 8px', fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '.6px', borderBottom: '1px solid var(--surface-2)' }}>
        <div>#</div><div>Oyuncu</div><div style={{ textAlign: 'right' }}>K/D</div><div style={{ textAlign: 'right' }}>K/D/A</div><div style={{ textAlign: 'right' }}>ACS</div>
      </div>
      {rows.map((p, i) => (
        <div key={p.pid} style={{ display: 'grid', gridTemplateColumns: '20px 1fr 44px 60px 44px', gap: 8, alignItems: 'center', padding: '8px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--surface)', fontSize: 12 }}>
          <div style={{ color: i < 3 ? '#FFD700' : 'var(--text-4)', fontWeight: 800 }}>{i + 1}</div>
          <div style={{ color: 'var(--text-1)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</div>
          <div style={{ textAlign: 'right', fontWeight: 800, color: p.kd >= 1 ? '#4ade80' : '#ff6a7f', fontVariantNumeric: 'tabular-nums' }}>{p.kd.toFixed(2)}</div>
          <div style={{ textAlign: 'right', color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{p.k}/{p.d}/{p.a}</div>
          <div style={{ textAlign: 'right', color: p.acs != null ? '#C25CD0' : 'var(--text-6)', fontWeight: 700 }}>{p.acs ?? '—'}</div>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-5)', textAlign: 'right' }}>
        Data powered by <a href="https://liquipedia.net" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-4)' }}>Liquipedia</a>
      </div>
    </div>
  )
}

function StandingsTable({ matches, navigate }) {
  // Katılımcı takımları maçlardan türet
  const table = useMemo(() => {
    const map = {}
    const ensure = (team) => {
      if (!team?.id) return
      if (!map[team.id]) map[team.id] = {
        id: team.id, name: team.name, logo: team.logo_url,
        w: 0, l: 0, mw: 0, ml: 0,  // match wins/losses, map wins/losses
      }
    }
    for (const m of matches) {
      if (m.status !== 'finished') continue
      ensure(m.team_a); ensure(m.team_b)
      if (!m.team_a?.id || !m.team_b?.id) continue
      // Skor-öncelikli kazanan (winner_id ~%1.2 maçta skorla çelişir). Beraberlik (Bo2 1:1)
      // → W/L SAYMA (eski kod her 'aWon değil'i team_b galibiyeti sayıyordu = beraberlik bug'ı).
      const winner = deriveWinnerTeamId(m)
      if (winner != null) {
        if (winner === Number(m.team_a.id) || winner === Number(m.team_a_id)) {
          map[m.team_a.id].w++; map[m.team_b.id].l++
        } else {
          map[m.team_b.id].w++; map[m.team_a.id].l++
        }
      }
      // map scores
      if (m.team_a_score != null) map[m.team_a.id].mw += m.team_a_score
      if (m.team_b_score != null) map[m.team_a.id].ml += m.team_b_score
      if (m.team_b_score != null) map[m.team_b.id].mw += m.team_b_score
      if (m.team_a_score != null) map[m.team_b.id].ml += m.team_a_score
    }
    return Object.values(map)
      .sort((a, b) => b.w - a.w || a.l - b.l)
  }, [matches])

  if (table.length < 2) return null

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
        <thead>
          <tr>
            {['#', 'Takım', 'W', 'L', 'W%', 'Map W', 'Map L'].map(h => (
              <th key={h} style={{
                padding: '7px 12px', textAlign: h === 'Takım' ? 'left' : 'center',
                fontSize: 10, color: 'var(--text-5)', fontWeight: 700,
                letterSpacing: '1px', textTransform: 'uppercase',
                borderBottom: '1px solid var(--surface-2)',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.map((t, i) => {
            const total  = t.w + t.l
            const pct    = total > 0 ? Math.round((t.w / total) * 100) : 0
            const isTR   = isTurkishTeam(t.name)
            const isTop3 = i < 3
            const medalColors = ['#f0c040', 'var(--text-2)', '#cd7f32']
            return (
              <tr
                key={t.id}
                onClick={() => navigate(`/team/${t.id}`)}
                style={{ cursor: 'pointer' }}
              >
                {/* Rank */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: 'var(--surface)', borderRadius: '10px 0 0 10px',
                  borderLeft: isTop3 ? `3px solid ${['#FFD700','var(--text-2)','#CD7F32'][i]}` : '3px solid transparent',
                }}>
                  {isTop3 ? <Medal size={16} color={medalColors[i]} strokeWidth={2.2} /> : <span style={{ fontSize: 14 }}>{i + 1}</span>}
                </td>

                {/* Team */}
                <td style={{ padding: '10px 12px', background: 'var(--surface)', minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TeamAv src={t.logo} name={t.name} size={28} />
                    <span style={{ fontSize: 13, fontWeight: 700,
                      color: isTR ? '#FFD700' : 'var(--text-1)' }}>
                      {t.name}{isTR && ' 🇹🇷'}
                    </span>
                  </div>
                </td>

                {/* W */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: 'var(--surface)',
                  fontSize: 14, fontWeight: 800, color: '#4CAF50' }}>{t.w}</td>

                {/* L */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: 'var(--surface)',
                  fontSize: 14, fontWeight: 800, color: '#FF4655' }}>{t.l}</td>

                {/* W% */}
                <td style={{ padding: '10px 12px', background: 'var(--surface)', minWidth: 100 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 5, borderRadius: 3,
                      background: 'var(--surface-2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`,
                        background: pct >= 60 ? '#4CAF50' : pct >= 40 ? '#FF8C00' : '#FF4655',
                        transition: 'width .6s ease', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 28 }}>{pct}%</span>
                  </div>
                </td>

                {/* Map W / L */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: 'var(--surface)', fontSize: 12, color: '#4CAF50' }}>{t.mw}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: 'var(--surface)', borderRadius: '0 10px 10px 0',
                  fontSize: 12, color: '#FF4655' }}>{t.ml}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Bracket ─────────────────────────────────────────────────────────────────

const UPPER_ROUND_ORDER = [
  'Round of 16',
  'Upper Round 1', 'Upper Round 2', 'Upper Round 3', 'Upper Round 4',
  'Quarter-finals', 'Semi-finals', 'Upper Finals', 'Grand final',
]
// Single-elimination bracket order — no 'Upper Finals' column
const SE_UPPER_ROUND_ORDER = [
  'Round of 16',
  'Upper Round 1', 'Upper Round 2', 'Upper Round 3', 'Upper Round 4',
  'Quarter-finals', 'Semi-finals', 'Grand final',
]
const LOWER_ROUND_ORDER = [
  'Lower Round 1', 'Lower Round 2', 'Lower Semifinals', 'Lower Finals',
]
const ROUND_LABELS = {
  'Round of 16':     { Icon: Swords, color: 'var(--text-4)', short: 'R16'    },
  'Upper Round 1':   { Icon: Swords, color: '#6b7280', short: 'UBR1'   },
  'Upper Round 2':   { Icon: Swords, color: '#6b7280', short: 'UBR2'   },
  'Upper Round 3':   { Icon: Swords, color: '#6b7280', short: 'UBR3'   },
  'Upper Round 4':   { Icon: Swords, color: '#6b7280', short: 'UBR4'   },
  'Quarter-finals':  { Icon: Swords, color: '#818cf8', short: 'QF'     },
  'Semi-finals':     { Icon: Flame,  color: '#FF8C00', short: 'SF'     },
  'Upper Finals':    { Icon: Trophy, color: '#f59e0b', short: 'UBF'    },
  'Grand final':     { Icon: Crown,  color: '#FFD700', short: 'GF'     },
  'Lower Round 1':    { Icon: Route, color: 'var(--text-3)', short: 'LB R1'  },
  'Lower Round 2':    { Icon: Route, color: 'var(--text-3)', short: 'LB R2'  },
  'Lower Semifinals': { Icon: Swords, color: '#60a5fa', short: 'LB SF'  },
  'Lower Finals':     { Icon: Flag,  color: '#38bdf8', short: 'LB F'   },
}

// Expected match count per stage for virtual TBD injection.
// Stages absent from this map (e.g. Upper Round 1-4) are left as-is.
const STAGE_EXPECTED_COUNTS = {
  'Round of 16':      8,
  'Quarter-finals':   4,
  'Semi-finals':      2,
  'Upper Finals':     1,
  'Grand final':      1,
  'Lower Round 1':    2,
  'Lower Round 2':    2,
  'Lower Semifinals': 1,
  'Lower Finals':     1,
}

const BRACKET_CARD_H   = 88   // px — BracketMatchCard yüksekliği
const BRACKET_CARD_GAP = 10   // px — kartlar arası gap
const BRACKET_HEADER_H = 44   // px — round header yüksekliği
const BRACKET_CARD_W   = 214
const BRACKET_COL_GAP  = 94
const BRACKET_TOP_PAD  = 8
const CONNECTOR_MODE = 'orthogonal'
const BRACKET_MIN_ZOOM = 0.65
const BRACKET_MAX_ZOOM = 1.2

function buildConnectorPath(from, to) {
  if (!from || !to) return ''
  const midX = Math.round(from.x + (to.x - from.x) * 0.5)
  if (Math.abs(to.y - from.y) <= 1) {
    return `M ${from.x} ${from.y} H ${to.x}`
  }
  // 90° step path: horizontal → vertical → horizontal
  return `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`
}

function clampBracketZoom(value) {
  return Math.min(BRACKET_MAX_ZOOM, Math.max(BRACKET_MIN_ZOOM, value))
}

const BracketMatchCard = memo(function BracketMatchCard({ m, navigate, gc, highlightPath = false }) {
  const isVirtual = m?.is_virtual === true
  const aId   = m.team_a?.id || m.team_a_id
  const bId   = m.team_b?.id || m.team_b_id
  const aWon  = m.status === 'finished' && (m.winner_id === aId)
  const bWon  = m.status === 'finished' && (m.winner_id === bId)
  const aName = m.team_a?.name || 'TBD'
  const bName = m.team_b?.name || 'TBD'
  const aLogo = m.team_a?.logo_url
  const bLogo = m.team_b?.logo_url
  const isTRA = !isVirtual && isTurkishTeam(aName)
  const isTRB = !isVirtual && isTurkishTeam(bName)
  const [hov, setHov] = useState(false)
  const canNavigate = !isVirtual && m?.__clickable !== false && Boolean(m?.team_a && m?.id)
  const structuredBits = [
    Number.isFinite(m?.__roundNo) ? `R${m.__roundNo}` : null,
    Number.isFinite(m?.__positionNo) ? `P${m.__positionNo}` : null,
    m?.__nextMatchId ? `Next ${m.__nextMatchId}` : null,
  ].filter(Boolean)

  return (
    <div
      onClick={() => canNavigate && navigate(`/match/${m.id}`)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative',
        borderRadius: 10, overflow: 'hidden',
        border: m.status === 'running'
          ? '1.5px solid rgba(255,70,85,.6)'
          : highlightPath
          ? '1.5px solid rgba(255,70,85,.55)'
          : hov ? `1.5px solid ${gc}88` : '1.5px solid var(--line)',
        boxShadow: m.status === 'running'
          ? '0 0 14px rgba(255,70,85,.2)'
          : highlightPath
          ? '0 0 16px rgba(255,70,85,.18)'
          : hov ? `0 4px 16px ${gc}20` : 'none',
        cursor: canNavigate ? 'pointer' : 'default',
        background: isVirtual
          ? 'linear-gradient(162deg, var(--surface) 0%, var(--bg) 100%)'
          : 'linear-gradient(162deg, var(--surface) 0%, var(--bg) 100%)',
        transition: 'all .18s',
        width: BRACKET_CARD_W,
        height: BRACKET_CARD_H,
        display: 'flex', flexDirection: 'column',
        opacity: isVirtual ? 0.48 : 1,
      }}
    >
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: m.status === 'running'
          ? 'linear-gradient(90deg, rgba(255,70,85,.85), rgba(255,120,140,.35))'
          : highlightPath
          ? 'linear-gradient(90deg, rgba(255,70,85,.6), rgba(255,170,185,.2))'
          : 'linear-gradient(90deg, rgba(255,255,255,.16), rgba(255,255,255,0))',
      }} />

      {/* LIVE pulse */}
      {m.status === 'running' && (
        <div style={{
          position: 'absolute', top: 7, right: 8,
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 9, color: '#FF4655', fontWeight: 800,
          letterSpacing: '.6px', textTransform: 'uppercase',
          zIndex: 3,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#FF4655', boxShadow: '0 0 0 0 rgba(255,70,85,.7)',
            animation: 'livePulse 1.2s infinite',
          }} />
          Live
        </div>
      )}

      {highlightPath && m.status !== 'running' && (
        <div style={{
          position: 'absolute', bottom: 4, right: 8,
          zIndex: 3, fontSize: 7, fontWeight: 800,
          letterSpacing: '.5px', textTransform: 'uppercase',
          color: '#FF9AA5', background: 'rgba(255,70,85,.13)',
          border: '1px solid rgba(255,70,85,.32)', borderRadius: 6,
          padding: '1px 5px', pointerEvents: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 3,
        }}>
          <Star size={8} fill="#FF9AA5" /> Path
        </div>
      )}

      {structuredBits.length > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 4,
          left: 8,
          zIndex: 3,
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '.35px',
          color: 'var(--text-3)',
          background: 'rgba(0,0,0,.34)',
          border: '1px solid rgba(120,120,120,.25)',
          borderRadius: 6,
          padding: '1px 5px',
        }}>
          {structuredBits.join(' · ')}
        </div>
      )}

      {/* Team rows */}
      {[
        { name: aName, logo: aLogo, score: m.team_a_score, won: aWon, isTR: isTRA },
        { name: bName, logo: bLogo, score: m.team_b_score, won: bWon, isTR: isTRB },
      ].map((side, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '0 10px',
            background: side.won ? 'rgba(76,175,80,.08)' : 'transparent',
            borderBottom: i === 0 ? '1px solid var(--surface)' : 'none',
            minHeight: 0,
          }}
        >
          {/* Logo */}
          <div style={{ width: 20, height: 20, flexShrink: 0 }}>
            {side.name === 'TBD'
              ? <div style={{ width: 20, height: 20, borderRadius: 4,
                  border: '1px dashed var(--line)', background: 'var(--surface)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 8, color: 'var(--surface-2)', fontWeight: 700 }}>?</span>
                </div>
              : side.logo
                ? <img src={side.logo} alt={side.name}
                    style={{ width: 20, height: 20, objectFit: 'contain' }} />
                : <div style={{ width: 20, height: 20, borderRadius: 4,
                    background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 9, color: 'var(--text-5)' }}>?</div>
            }
          </div>

          {/* Name */}
          <span style={{
            flex: 1, fontSize: 11, fontWeight: side.won ? 800 : 400,
            color: side.won ? 'var(--text-1)' : side.name === 'TBD' ? 'var(--text-6)' : 'var(--text-3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {side.isTR && '🇹🇷 '}{side.name}
          </span>

          {/* Score */}
          {m.status === 'finished' && (
            <span style={{
              fontSize: 14, fontWeight: 900, flexShrink: 0,
              color: side.won ? '#4CAF50' : 'var(--text-6)',
              minWidth: 14, textAlign: 'right',
            }}>
              {side.score ?? 0}
            </span>
          )}

          {/* Won checkmark */}
          {side.won && (
            <span style={{ fontSize: 9, color: '#4CAF50', flexShrink: 0 }}>✓</span>
          )}
        </div>
      ))}
    </div>
  )
})

function BracketView({ matches, resolvedMatches, navigate, gc, bracketSide = 'upper', zoom = 1, isDoubleElim = false }) {
  const scrollRef = useRef(null)
  const dragRef = useRef({ isDown: false, moved: false, startX: 0, scrollLeft: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const prepared = useMemo(() => {
    const source = (resolvedMatches || buildBracketStages(matches))
      .filter(m => m.__bracketSide === bracketSide)

    const roundOrder = bracketSide === 'lower'
      ? LOWER_ROUND_ORDER
      : (isDoubleElim ? UPPER_ROUND_ORDER : SE_UPPER_ROUND_ORDER)
    const main = Object.fromEntries(roundOrder.map(k => [k, []]))
    let thirdPlace = null

    for (const m of source) {
      if (m.__stage === 'Third Place Decider') {
        if (!thirdPlace) thirdPlace = m
        continue
      }
      // If __stage is not in this bracket's round order (e.g. lower bracket match
      // assigned an upper-bracket stage name), fall back to the bracket's default
      // first stage so it still renders rather than silently disappearing.
      const stage = (main[m.__stage] !== undefined)
        ? m.__stage
        : (bracketSide === 'lower' ? 'Lower Round 1' : 'Quarter-finals')
      if (main[stage]) main[stage].push(m)
    }

    for (const key of Object.keys(main)) {
      main[key] = main[key].sort((a, b) => {
        const posA = Number.isFinite(a?.__positionNo) ? a.__positionNo : Number.MAX_SAFE_INTEGER
        const posB = Number.isFinite(b?.__positionNo) ? b.__positionNo : Number.MAX_SAFE_INTEGER
        if (posA !== posB) return posA - posB

        const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
        const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
        return ta - tb
      })
    }

    // ── Virtual TBD injection ────────────────────────────────────────────────
    // If there are any real matches in this bracket, pad every stage from the
    // first active stage to the final with virtual TBD cards so the bracket
    // tree is always visually complete (VLR.gg / Liquipedia style).
    const firstRealIdx = roundOrder.findIndex(k => main[k]?.some(m => !m.is_virtual))
    if (firstRealIdx >= 0) {
      for (let i = firstRealIdx; i < roundOrder.length; i++) {
        const stage = roundOrder[i]
        const expected = STAGE_EXPECTED_COUNTS[stage] ?? 0
        if (expected === 0) continue
        const realCount = (main[stage] || []).filter(m => !m.is_virtual).length
        const currentCount = (main[stage] || []).length
        const needed = Math.max(0, expected - currentCount)
        for (let j = 0; j < needed; j++) {
          main[stage].push({
            id: `virtual-tbd-${stage.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${realCount + j}`,
            team_a: { name: 'TBD', id: null, logo_url: null },
            team_b: { name: 'TBD', id: null, logo_url: null },
            team_a_id: null, team_b_id: null,
            team_a_score: null, team_b_score: null,
            winner_id: null, status: 'not_started',
            round_info: stage, scheduled_at: null,
            __stage: stage, __bracketSide: bracketSide,
            __stageSource: 'virtual',
            __roundNo: null, __positionNo: null, __nextMatchId: null,
            is_virtual: true, __clickable: false,
          })
        }
      }
    }

    return { main, thirdPlace, roundOrder }
  }, [matches, resolvedMatches, bracketSide, isDoubleElim])

  const roundKeys = prepared.roundOrder.filter(k => prepared.main[k]?.length > 0)

  const layout = useMemo(() => {
    const STEP = BRACKET_CARD_H + BRACKET_CARD_GAP

    // Sort column matches so that matches whose teams came from earlier
    // (higher-indexed / top-of-column) previous-round cards appear first.
    // This eliminates SVG connector crossings without any DOM measurement.
    function topoSort(colMatches, prevCards) {
      if (!prevCards?.length || colMatches.length <= 1) return colMatches

      // Build: winner_id → prevCard index (strongest signal)
      // Build: any real team id → minimum prevCard index (fallback for future matches)
      // Virtual prev-cards carry no winner/team signal — skip them.
      const winnerToIdx = new Map()
      const teamToIdx   = new Map()
      for (let i = 0; i < prevCards.length; i++) {
        const pm = prevCards[i].m
        if (pm?.is_virtual) continue
        const wId = pm?.winner_id ? String(pm.winner_id) : null
        if (wId) winnerToIdx.set(wId, i)
        const aId = String(pm?.team_a?.id || pm?.team_a_id || '')
        const bId = String(pm?.team_b?.id || pm?.team_b_id || '')
        if (aId) teamToIdx.set(aId, Math.min(teamToIdx.get(aId) ?? Infinity, i))
        if (bId) teamToIdx.set(bId, Math.min(teamToIdx.get(bId) ?? Infinity, i))
      }

      const minSrcIdx = (m) => {
        // Virtual current-cards have no source — sort them after all real cards.
        if (m?.is_virtual) return Number.MAX_SAFE_INTEGER
        const aId = String(m?.team_a?.id || m?.team_a_id || '')
        const bId = String(m?.team_b?.id || m?.team_b_id || '')
        const aW = aId ? (winnerToIdx.get(aId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
        const bW = bId ? (winnerToIdx.get(bId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
        if (aW < Number.MAX_SAFE_INTEGER || bW < Number.MAX_SAFE_INTEGER) {
          return Math.min(aW, bW)
        }
        const aT = aId ? (teamToIdx.get(aId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
        const bT = bId ? (teamToIdx.get(bId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
        return Math.min(aT, bT)
      }

      return [...colMatches].sort((a, b) => minSrcIdx(a) - minSrcIdx(b))
    }

    // Build columns with proper midpoint-based Y positioning so each card
    // sits centred between the pair of source cards it draws from.
    const columns = []
    for (let colIdx = 0; colIdx < roundKeys.length; colIdx++) {
      const rk = roundKeys[colIdx]
      const prevCards = colIdx > 0 ? columns[colIdx - 1].cards : null
      // Topologically sort so matches connecting to higher prev-cards come first
      const colMatches = colIdx === 0
        ? prepared.main[rk]
        : topoSort(prepared.main[rk], prevCards)
      const x = colIdx * (BRACKET_CARD_W + BRACKET_COL_GAP)

      const cards = colMatches.map((m, idx) => {
        let y
        if (colIdx === 0) {
          // First column: pack tightly from top
          y = BRACKET_TOP_PAD + BRACKET_HEADER_H + idx * STEP
        } else {
          const prevCount = prevCards.length
          const curCount = colMatches.length

          if (prevCount === 0) {
            y = BRACKET_TOP_PAD + BRACKET_HEADER_H + idx * STEP
          } else if (curCount === 1) {
            // Single card: centre between all prev cards
            const top = prevCards[0].centerY
            const bot = prevCards[prevCount - 1].centerY
            y = (top + bot) / 2 - BRACKET_CARD_H / 2
          } else {
            // Card i maps to the midpoint of its source pair in the prev column
            const ratio = prevCount / curCount
            const fromIdx = Math.min(Math.floor(idx * ratio), prevCount - 1)
            const toIdx   = Math.min(Math.ceil((idx + 1) * ratio) - 1, prevCount - 1)
            const topCenter = prevCards[fromIdx].centerY
            const botCenter = prevCards[toIdx].centerY
            y = (topCenter + botCenter) / 2 - BRACKET_CARD_H / 2
          }
        }

        return {
          m, idx, x,
          y: Math.round(y),
          centerY: Math.round(y + BRACKET_CARD_H / 2),
          winnerId: m?.winner_id || null,
        }
      })

      columns.push({ rk, colIdx, x, yOffset: 0, cards })
    }

    const edges = []
    const cardsById = new Map()
    for (const col of columns) {
      for (const card of col.cards) {
        cardsById.set(String(card.m?.id), { ...card, colIdx: col.colIdx })
      }
    }

    for (let c = 0; c < columns.length - 1; c++) {
      const leftCards = columns[c].cards
      const rightCards = columns[c + 1].cards

      leftCards.forEach((srcCard) => {
        const src = srcCard.m
        const winnerId = src?.winner_id || null
        const structuredNextMatchId = src?.__nextMatchId ? String(src.__nextMatchId) : null

        let dstCard = null

        // 1. Explicit Liquipedia next-match link
        if (structuredNextMatchId) {
          const linked = cardsById.get(structuredNextMatchId)
          if (linked && linked.colIdx > c) dstCard = linked
        }

        // 2. Winner appears in a right-column match
        if (!dstCard && winnerId && rightCards.length > 0) {
          dstCard = rightCards.find(card => {
            const t = card.m
            return winnerId === (t?.team_a?.id || t?.team_a_id)
                || winnerId === (t?.team_b?.id || t?.team_b_id)
          }) ?? null
        }

        // 3. Fallback: nearest right card by vertical distance (avoids wrong index math)
        if (!dstCard && rightCards.length > 0) {
          dstCard = rightCards.reduce((best, card) => {
            const distBest = Math.abs((best?.centerY ?? Infinity) - srcCard.centerY)
            const distCand = Math.abs(card.centerY - srcCard.centerY)
            return distCand < distBest ? card : best
          }, null)
        }

        if (!dstCard) return

        edges.push({
          key: `edge-${src?.id ?? c}-${dstCard.m?.id ?? dstCard.idx}`,
          from: { x: srcCard.x + BRACKET_CARD_W, y: srcCard.centerY },
          to:   { x: dstCard.x,                  y: dstCard.centerY },
          highlight: Boolean(winnerId || structuredNextMatchId),
          sourceId: src?.id,
          targetId: dstCard.m?.id,
        })
      })
    }

    const width = Math.max(BRACKET_CARD_W,
      columns.length * BRACKET_CARD_W + Math.max(0, columns.length - 1) * BRACKET_COL_GAP)
    const maxCardBottom = columns
      .flatMap(col => col.cards.map(card => card.y + BRACKET_CARD_H))
      .reduce((acc, v) => Math.max(acc, v), BRACKET_TOP_PAD + BRACKET_HEADER_H)
    const height = maxCardBottom + BRACKET_TOP_PAD

    return { columns, edges, width, height }
  }, [roundKeys, prepared])

  const highlightedSourceIds = useMemo(
    () => new Set(layout.edges.filter(e => e.highlight).map(e => e.sourceId).filter(Boolean)),
    [layout.edges]
  )

  const onMouseDown = (e) => {
    if (e.button !== 0) return
    const el = scrollRef.current
    if (!el) return
    dragRef.current = {
      isDown: true,
      moved: false,
      startX: e.clientX,
      scrollLeft: el.scrollLeft,
    }
    setIsDragging(true)
  }

  const onMouseMove = (e) => {
    if (!dragRef.current.isDown) return
    const el = scrollRef.current
    if (!el) return
    const dx = e.clientX - dragRef.current.startX
    if (Math.abs(dx) > 3) dragRef.current.moved = true
    el.scrollLeft = dragRef.current.scrollLeft - dx
  }

  const endDrag = () => {
    dragRef.current.isDown = false
    setIsDragging(false)
  }

  if (roundKeys.length === 0) return (
    <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-6)', fontSize: 13 }}>
      Playoff verisi bulunamadı.
    </div>
  )

  const connectorGradientId = bracketSide === 'lower' ? 'bracketFlowLower' : 'bracketFlowUpper'
  const connectorGlowId = bracketSide === 'lower' ? 'bracketGlowLower' : 'bracketGlowUpper'

  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-5)', marginBottom: 8, textAlign: 'right' }}>
        Drag to scroll →
      </div>
      <div style={{
        overflowX: 'auto',
        overflowY: 'auto',
        maxWidth: '100%',
        paddingBottom: 12,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: isDragging ? 'none' : 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
      ref={scrollRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      >
        <div style={{
          position: 'relative',
          width: layout.width * zoom,
          height: layout.height * zoom,
          minWidth: 'max-content',
        }}>
          <div style={{
            position: 'relative',
            width: layout.width,
            height: layout.height,
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
          }}>
          {/* Connector layer */}
          <svg
            width={layout.width}
            height={layout.height}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
          >
            <defs>
              <filter id={connectorGlowId} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id={connectorGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(255,70,85,.45)" />
                <stop offset="40%" stopColor="rgba(255,92,124,.72)" />
                <stop offset="100%" stopColor="rgba(255,158,178,.88)" />
              </linearGradient>
            </defs>

            {layout.edges.map(edge => {
              const { from, to, highlight, key } = edge
              const d = CONNECTOR_MODE === 'orthogonal'
                ? buildConnectorPath(from, to)
                : `M ${from.x} ${from.y} C ${from.x + 26} ${from.y}, ${to.x - 26} ${to.y}, ${to.x} ${to.y}`

              return (
                <g key={key}>
                  <path
                    d={d}
                    fill="none"
                    stroke={highlight ? 'rgba(255,70,85,.16)' : 'rgba(36,36,36,.72)'}
                    strokeWidth={highlight ? 6 : 4}
                    strokeLinecap="round"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={highlight ? `url(#${connectorGradientId})` : 'rgba(94,94,94,.78)'}
                    strokeWidth={highlight ? 2.1 : 1.25}
                    strokeLinecap="round"
                    strokeDasharray={highlight ? undefined : '5 6'}
                    filter={highlight ? `url(#${connectorGlowId})` : undefined}
                  />
                  <circle
                    cx={from.x}
                    cy={from.y}
                    r={highlight ? 3.6 : 2.7}
                    fill={highlight ? 'rgba(255,120,150,.95)' : 'rgba(106,106,106,.78)'}
                    stroke='rgba(11,11,11,.9)'
                    strokeWidth={1.2}
                  />
                  <circle
                    cx={to.x}
                    cy={to.y}
                    r={highlight ? 3.8 : 3}
                    fill={highlight ? 'rgba(255,142,170,.94)' : 'rgba(118,118,118,.8)'}
                    stroke='rgba(11,11,11,.9)'
                    strokeWidth={1.2}
                  />
                </g>
              )
            })}
          </svg>

          {/* Columns */}
          {layout.columns.map(col => {
            const meta = ROUND_LABELS[col.rk] || { Icon: Gamepad2, color: gc, short: col.rk }

            return (
              <div key={col.rk} style={{ position: 'absolute', left: col.x, top: 0, width: BRACKET_CARD_W }}>
                {/* Round header — pinned at its own top */}
                <div style={{
                  position: 'absolute',
                  top: BRACKET_TOP_PAD,
                  left: 0, right: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 20,
                  background: `linear-gradient(135deg, ${meta.color}1f, rgba(9,9,9,.9))`,
                  border: `1px solid ${meta.color}45`,
                  boxShadow: `0 5px 18px ${meta.color}22`,
                  height: BRACKET_HEADER_H - 10,
                }}>
                  {meta.Icon && <meta.Icon size={12} color={meta.color} />}
                  <span style={{
                    fontSize: 10, fontWeight: 800,
                    color: meta.color, letterSpacing: '1px', textTransform: 'uppercase',
                  }}>{col.rk}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-5)' }}>({col.cards.length})</span>
                </div>

                {/* Cards — each absolutely placed at its computed Y */}
                {col.cards.map(card => (
                  <div key={card.m.id} style={{ position: 'absolute', top: card.y, left: 0 }}>
                    <BracketMatchCard
                      m={card.m}
                      navigate={navigate}
                      gc={gc}
                      highlightPath={highlightedSourceIds.has(card.m.id)}
                    />
                  </div>
                ))}
              </div>
            )
          })}
          </div>
        </div>
      </div>

      {bracketSide === 'upper' && prepared.thirdPlace && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 8, letterSpacing: '.8px', textTransform: 'uppercase' }}>
            3rd Place Decider
          </div>
          <div style={{ width: BRACKET_CARD_W }}>
            <BracketMatchCard
              m={prepared.thirdPlace}
              navigate={navigate}
              gc={gc}
              highlightPath={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Match List Card ──────────────────────────────────────────────────────────

const MatchListCard = memo(function MatchListCard({ m, navigate, gc }) {
  const aId   = m.team_a?.id || m.team_a_id
  const bId   = m.team_b?.id || m.team_b_id
  const aWon  = m.status === 'finished' && m.winner_id === aId
  const bWon  = m.status === 'finished' && m.winner_id === bId
  const isLive= m.status === 'running'
  const isTRA = isTurkishTeam(m.team_a?.name ?? '')
  const isTRB = isTurkishTeam(m.team_b?.name ?? '')
  const hasTR = isTRA || isTRB

  return (
    <div
      onClick={() => navigate(`/match/${m.id}`)}
      style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 14, cursor: 'pointer',
        background: 'var(--surface)',
        border: isLive
          ? '1.5px solid rgba(255,70,85,.6)'
          : hasTR
          ? '1.5px solid rgba(200,16,46,.4)'
          : '1.5px solid var(--surface-2)',
        boxShadow: isLive ? '0 0 16px rgba(255,70,85,.18)' : 'none',
        transition: 'all .18s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = isLive ? '#FF4655' : gc
        e.currentTarget.style.transform   = 'translateY(-2px)'
        e.currentTarget.style.boxShadow   = `0 8px 24px ${gc}25`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = isLive
          ? 'rgba(255,70,85,.6)'
          : hasTR ? 'rgba(200,16,46,.4)' : 'var(--surface-2)'
        e.currentTarget.style.transform   = 'none'
        e.currentTarget.style.boxShadow   = isLive ? '0 0 16px rgba(255,70,85,.18)' : 'none'
      }}
    >
      {isLive && (
        <div style={{
          position: 'absolute', top: 8, right: 10,
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 9, fontWeight: 800, color: '#FF4655',
          letterSpacing: '.6px', textTransform: 'uppercase', zIndex: 3,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#FF4655', boxShadow: '0 0 0 0 rgba(255,70,85,.7)',
            animation: 'livePulse 1.2s infinite',
          }} />
          Live
        </div>
      )}

      {/* TR stripe */}
      {hasTR && (
        <div style={{
          background: 'linear-gradient(90deg,#DF4888,#8B3AA0 55%,#6A297F)',
          padding: '3px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#fff',
            letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            🇹🇷 Turkish Pride
          </span>
        </div>
      )}

      <div style={{ padding: hasTR ? '12px 16px 14px' : '14px 16px' }}>
        {/* Top: game + status + round */}
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
            {m.game?.name ?? ''}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {getBOFormat(m.team_a_score, m.team_b_score, m.number_of_games) && (
              <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8,
                background: 'rgba(96,165,250,.12)', border: '1px solid rgba(96,165,250,.3)',
                color: '#60a5fa', fontWeight: 700 }}>
                {getBOFormat(m.team_a_score, m.team_b_score, m.number_of_games)}
              </span>
            )}
            {m.round_info && (
              <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8,
                background: `${gc}18`, border: `1px solid ${gc}44`, color: gc,
                fontWeight: 700 }}>
                {m.round_info}
              </span>
            )}
          </div>
        </div>

        {/* Teams + Score */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Team A */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center',
            gap: 8, justifyContent: 'flex-end', overflow: 'hidden' }}>
            <span style={{
              fontSize: 13, fontWeight: aWon ? 800 : 500,
              color: aWon ? 'var(--text-1)' : 'var(--text-4)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {isTRA && '🇹🇷 '}{m.team_a?.name ?? '?'}
            </span>
            <TeamAv src={m.team_a?.logo_url} name={m.team_a?.name} size={28} />
          </div>

          {/* Score / VS */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center',
            gap: 4, minWidth: 60, justifyContent: 'center' }}>
            {m.status === 'finished' ? (
              <>
                <span style={{ fontSize: 18, fontWeight: 900,
                  color: aWon ? '#4CAF50' : 'var(--text-4)' }}>
                  {m.team_a_score ?? '—'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-6)' }}>:</span>
                <span style={{ fontSize: 18, fontWeight: 900,
                  color: bWon ? '#4CAF50' : 'var(--text-4)' }}>
                  {m.team_b_score ?? '—'}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700,
                color: isLive ? '#FF4655' : 'var(--text-5)' }}>
                {isLive ? 'LIVE' : 'VS'}
              </span>
            )}
          </div>

          {/* Team B */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center',
            gap: 8, overflow: 'hidden' }}>
            <TeamAv src={m.team_b?.logo_url} name={m.team_b?.name} size={28} />
            <span style={{
              fontSize: 13, fontWeight: bWon ? 800 : 500,
              color: bWon ? 'var(--text-1)' : 'var(--text-4)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {isTRB && '🇹🇷 '}{m.team_b?.name ?? '?'}
            </span>
          </div>
        </div>

        {/* Date */}
        <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-6)',
          textAlign: 'center', borderTop: '1px solid var(--surface)', paddingTop: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <CalendarDays size={11} /> {fmtDateTime(getMatchTimestamp(m))}
        </div>
      </div>
    </div>
  )
})

// ─── Ana Bileşen ──────────────────────────────────────────────────────────────

export default function TournamentPage() {
  const { tournamentId } = useParams()
  const navigate          = useNavigate()

  const [tournament,  setTournament]  = useState(null)
  const [matches,     setMatches]     = useState([])
  const [topPerformers, setTopPerformers] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [activeTab,   setActiveTab]   = useState('upcoming')
  const [viewOverride, setViewOverride] = useState('auto') // auto | list | bracket
  const [bracketZoom, setBracketZoom] = useState(1)

  // ── Veri çekme ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const fetchMatchesWithRoundHints = () => (
        supabase
          .from('matches')
          .select(`
            *,
            team_a:teams!matches_team_a_id_fkey(id, name, logo_url, acronym),
            team_b:teams!matches_team_b_id_fkey(id, name, logo_url, acronym),
            game:games(id, name)
          `)
          .eq('tournament_id', tournamentId)
          .order('scheduled_at', { ascending: true })
          .limit(400)
      )

      const [tourRes, matchRes] = await Promise.all([
        supabase
          .from('tournaments')
          .select('*, game:games(id, name, slug)')
          .eq('id', tournamentId)
          .single(),
        fetchMatchesWithRoundHints(),
      ])

      if (tourRes.error)  throw tourRes.error
      if (matchRes.error) throw matchRes.error

      if (TOURNAMENT_DEBUG) {
        console.log('[TournamentPage][Fetch]', {
          tournamentId,
          tournamentFound: Boolean(tourRes.data),
          matchCount: (matchRes.data || []).length,
        })
      }

      const normalizedTournament = {
        ...tourRes.data,
        name: cleanName(tourRes.data?.name, 'Tournament'),
      }

      const normalizedMatches = (matchRes.data || []).map(row => {
        // Detect and fix score inversion: PandaScore results[] is not guaranteed
        // to be ordered the same as opponents[], so winner may show the lower score.
        // When winner's score < loser's score, swap to display correctly.
        let aScore = row?.team_a_score ?? null
        let bScore = row?.team_b_score ?? null
        const wId = row?.winner_id
        if (wId != null && aScore != null && bScore != null && aScore !== bScore) {
          const aWon = wId === row?.team_a_id
          const bWon = wId === row?.team_b_id
          if ((aWon && aScore < bScore) || (bWon && bScore < aScore)) {
            ;[aScore, bScore] = [bScore, aScore]
          }
        }

        return {
          ...row,
          team_a_score: aScore,
          team_b_score: bScore,
          // Fallback chain: DB column → raw_data.round_info → match name before ":"
          // PandaScore stores bracket stage in name: "Upper bracket final: PRV vs VIT"
          round_info: cleanName(
            row?.round_info
            || row?.raw_data?.round_info
            || (row?.name ? row.name.split(':')[0]?.trim() : null)
            || null,
            row?.round_info || '',
          ),
          tournament: row?.tournament
            ? {
                ...row.tournament,
                name: cleanName(row.tournament?.name, row.tournament?.name || ''),
              }
            : row?.tournament,
        }
      })

      setTournament(normalizedTournament)
      setMatches(normalizedMatches)

      // ── Top Performers: turnuvanın enriched maçlarından oyuncu KDA agregasyonu (hybrid v3) ──
      const finishedIds = normalizedMatches.filter(m => m.status === 'finished').map(m => m.id)
      if (finishedIds.length > 0) {
        const { data: pms } = await supabase
          .from('player_match_stats')
          .select('player_id,kills,deaths,assists,is_win,stats,player:players(nickname,image_url)')
          .in('match_id', finishedIds)
        setTopPerformers(aggregateTopPerformers(pms || []))
      } else {
        setTopPerformers([])
      }
    } catch (e) {
      console.error('TournamentPage fetch error:', e)
      setError('Turnuva bulunamadı.')
    } finally {
      setLoading(false)
    }
  }, [tournamentId])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Türevler ─────────────────────────────────────────────────
  const upcomingMatches = useMemo(() =>
    matches.filter(m => ['not_started', 'running'].includes(m.status))
      .sort((a, b) => {
        const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
        const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
        return ta - tb
      }),
    [matches]
  )
  const pastMatches = useMemo(() =>
    matches.filter(m => m.status === 'finished')
      .sort((a, b) => {
        const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
        const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
        return tb - ta
      }),
    [matches]
  )

  // ── Format algılama ───────────────────────────────────────────
  const format = detectFormat(matches)
  const stageMode = useMemo(() => detectStageMode(tournament, matches, format), [tournament, matches, format])
  const liquipediaBracketMatches = useMemo(() => buildLiquipediaBracketStages(tournament), [tournament])
  const hasLiquipediaBracket = liquipediaBracketMatches.length > 0

  // Guard: if <15% of matches carry any bracket signal, fall back to list view instead of
  // piling all cards into the 'Quarter-finals' column (happens when round_info is all NULL).
  const hasSufficientBracketData = useMemo(() => {
    if (!matches.length) return false
    const signalCount = matches.filter(m => m.round_info || m.bracket_type || m.stage_name).length
    return signalCount / matches.length > 0.15
  }, [matches])

  const effectiveViewMode = useMemo(() => {
    if (viewOverride === 'list') return 'list'
    if (viewOverride === 'bracket') return 'bracket'
    if (hasLiquipediaBracket) return 'bracket'
    if (stageMode.bracketEnabled && hasSufficientBracketData) return 'bracket'
    return 'list'
  }, [viewOverride, stageMode, hasLiquipediaBracket, hasSufficientBracketData])

  useEffect(() => {
    if (!TOURNAMENT_DEBUG) return

    const title = stageMode.bracketEnabled
      ? 'TOURNAMENT VIEW MODE: BRACKET'
      : 'TOURNAMENT VIEW MODE: LIST'

    console.log(
      `%c${title}`,
      'font-size:18px;font-weight:900;color:#ffffff;background:#C8102E;padding:8px 12px;border-radius:6px;letter-spacing:.8px;'
    )
    console.log('%cStage decision payload', 'font-size:13px;font-weight:800;color:#C8102E;')
    console.table({
      hasLeagueStyle: stageMode.hasLeagueStyle,
      hasBracketSignals: stageMode.hasBracketSignals,
      hasStageHints: stageMode.hasStageHints,
      stageUndetermined: stageMode.stageUndetermined,
      format: stageMode.format,
      bracketEnabled: stageMode.bracketEnabled,
      hasLiquipediaBracket,
      viewOverride,
      effectiveViewMode,
    })
  }, [stageMode, hasLiquipediaBracket, viewOverride, effectiveViewMode])
  const resolvedBracketMatches = useMemo(() => buildBracketStages(matches), [matches])
  const upperBracketMatches = useMemo(
    () => resolvedBracketMatches.filter(m => m.__bracketSide === 'upper'),
    [resolvedBracketMatches]
  )
  const lowerBracketMatches = useMemo(
    () => resolvedBracketMatches.filter(m => m.__bracketSide === 'lower'),
    [resolvedBracketMatches]
  )
  // Detect double-elimination format by looking for explicit lower/upper bracket
  // round_info strings. SE tournaments won't have these, preventing ghost columns.
  const isDoubleElim = useMemo(
    () => matches.some(m => {
      const ri = (m.round_info ?? '').toLowerCase()
      return ri.includes('lower') || ri.includes('upper')
    }),
    [matches]
  )

  // ── Stil değerleri ───────────────────────────────────────────
  const gName = tournament?.game?.name ?? ''
  // Ham slug ("Cs-Go"/"League-Of-Legends") yerine temiz oyun adı.
  const gLabel = GAMES.find(g => g.id === normalizeGameId(tournament?.game?.slug ?? gName))?.label || gName || 'Esports'
  const gc    = gameColor(gName)
  const tier  = getTierMeta(tournament?.tier)
  const tournamentDisplayName = cleanName(tournament?.name, 'Tournament')
  const isTR  = isTurkishTeam(tournament?.name ?? '') || tournament?.region === 'TR'
  const liquipediaMeta = tournament?.extra_metadata?.liquipedia || null
  const liquipediaLocation = liquipediaMeta?.location || null
  const liquipediaPrizePool = liquipediaMeta?.prize_pool || null

  // ── Loading ───────────────────────────────────────────────────
  if (loading) return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px' }}>
      <Sk h="220px" r="20px" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 20 }}>
        {[1, 2, 3].map(i => <Sk key={i} h="120px" r="14px" />)}
      </div>
    </div>
  )

  // ── Error ─────────────────────────────────────────────────────
  if (error || !tournament) return (
    <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center', color: 'white' }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Mascot size={86} dim /></div>
      <div style={{ fontSize: 18, color: '#FF4655', marginBottom: 8 }}>
        {error ?? 'Turnuva bulunamadı'}
      </div>
      <button
        onClick={() => navigate(-1)}
        style={{ padding: '10px 24px', background: FEXT.accentGrad, border: 'none',
          borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
      >← Geri</button>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 100px', color: 'var(--text-1)' }}>
      <SeoHead
        title={`${tournament.name} — Fikstür, Puan Durumu ve Sonuçlar`}
        description={`${tournament.name} espor turnuvası: maç programı, bracket, puan durumu ve sonuçlar — feXt.`}
        type="article"
        schema={{
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: tournament.name,
          sport: 'Esports',
          startDate: tournament.begin_at || undefined,
          endDate: tournament.end_at || undefined,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
        }}
      />

      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes livePulse {
          0%   { box-shadow: 0 0 0 0 rgba(255,70,85,.75); }
          70%  { box-shadow: 0 0 0 8px rgba(255,70,85,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,70,85,0); }
        }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
      `}</style>

      {/* ══════════════ HEADER ══════════════════════════════════════ */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: '0 0 24px 24px',
        background: 'linear-gradient(160deg,var(--surface) 0%,var(--surface) 100%)',
        borderBottom: isTR
          ? '1px solid rgba(200,16,46,.4)'
          : `1px solid ${gc}33`,
        padding: '0 0 24px',
        marginBottom: 28,
      }}>
        {/* Radial glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse at 50% 0%,${gc}18 0%,transparent 65%)`,
        }} />
        {isTR && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at 50% 0%,rgba(200,16,46,.14) 0%,transparent 65%)',
          }} />
        )}

        {/* TR stripe */}
        {isTR && (
          <div style={{
            background: 'linear-gradient(90deg,#DF4888,#8B3AA0 55%,#6A297F)',
            padding: '4px 0',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <span>🇹🇷</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '2px',
              color: '#fff', textTransform: 'uppercase' }}>Turkish Tournament</span>
            <span>🇹🇷</span>
          </div>
        )}

        {/* Back button */}
        <div style={{ padding: '14px 24px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'rgba(255,255,255,.06)', border: '1px solid var(--line)',
              borderRadius: 8, color: 'var(--text-3)', padding: '5px 12px',
              fontSize: 12, cursor: 'pointer', transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--text-5)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--line)' }}
          >← Geri</button>

          {/* Live indicator */}
          {upcomingMatches.some(m => m.status === 'running') && (
            <span style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800,
              background: 'rgba(255,70,85,.15)', border: '1px solid rgba(255,70,85,.5)',
              color: '#FF4655', animation: 'pulse 1.2s infinite',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF4655' }} /> LIVE</span>
          )}
        </div>

        {/* Main info */}
        <div style={{ padding: '0 24px', position: 'relative' }}>
          {/* Badges */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              background: `${gc}18`, border: `1px solid ${gc}44`, color: gc,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: gc }} /> {gLabel}</span>

            {tier && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: tier.bg, border: `1px solid ${tier.border}`, color: tier.color,
              }}>{tier.label}</span>
            )}

            {tournament.region && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: 'rgba(255,255,255,.06)', border: '1px solid var(--text-6)', color: 'var(--text-2)',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                <MapPin size={11} /> {String(tournament.region).toUpperCase()}
              </span>
            )}

            {liquipediaLocation && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: 'rgba(255,70,85,.12)', border: '1px solid rgba(255,70,85,.35)', color: '#ff8c97',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                <Compass size={11} /> {liquipediaLocation}
              </span>
            )}

            {liquipediaPrizePool && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: 'rgba(255,215,0,.12)', border: '1px solid rgba(255,215,0,.35)', color: '#FFD700',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                <Wallet size={11} /> {liquipediaPrizePool}
              </span>
            )}

            {format !== 'unknown' && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: 'rgba(129,140,248,.1)', border: '1px solid rgba(129,140,248,.25)',
                color: '#818cf8',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                {format === 'roundrobin' ? <><RefreshCw size={11} /> Round Robin</> : <><Trophy size={11} /> Elimination</>}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 style={{
            margin: '0 0 10px', fontSize: 28, fontWeight: 900, lineHeight: 1.15,
            color: 'var(--text-1)',
          }}>{tournamentDisplayName}</h1>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14,
            fontSize: 12, color: 'var(--text-4)' }}>
            {(tournament.begin_at || tournament.end_at) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CalendarDays size={12} /> {fmtDate(tournament.begin_at)}
                {tournament.end_at && ` — ${fmtDate(tournament.end_at)}`}
              </span>
            )}
            {tournament.region && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MapPin size={12} /> {tournament.region}</span>}
            {tournament.prizepool && (
              <span style={{ color: '#FFD700', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Wallet size={12} /> {tournament.prizepool}
              </span>
            )}
          </div>

          {/* Kompakt Stat Chips */}
          <StatChips chips={[
            { Icon: Gamepad2,    label: 'Maç',      value: matches.length,                              color: '#818cf8' },
            { Icon: CircleCheck, label: 'Upcoming', value: upcomingMatches.length,                      color: '#4CAF50' },
            { Icon: CircleCheck, label: 'Bitti',    value: pastMatches.length,                          color: '#FF8C00' },
            { Icon: Radio,       label: 'Live',     value: matches.filter(m => m.status === 'running').length, color: '#FF4655' },
          ]} />
        </div>
      </div>

      {/* ══════════════ CONTENT ════════════════════════════════════ */}
      <div style={{ padding: '0 20px', animation: 'fadeUp .3s ease' }}>

        {/* ── DEV: Manual View Override (yalnızca TOURNAMENT_DEBUG açıkken) ─── */}
        {TOURNAMENT_DEBUG && <div style={{
          marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12,
          padding: '8px 10px',
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-4)' }}>
            Dev View Override
          </span>
          {[{ id: 'auto', label: 'Auto' }, { id: 'list', label: 'List View' }, { id: 'bracket', label: 'Bracket View' }].map(opt => {
            const active = viewOverride === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => setViewOverride(opt.id)}
                style={{
                  padding: '6px 11px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  background: active ? FEXT.accentSoftBg : 'var(--surface)',
                  color: active ? FEXT.accentText : 'var(--text-4)',
                  outline: active ? `1px solid ${FEXT.accentBorder}` : '1px solid var(--line)',
                }}
              >
                {opt.label}
              </button>
            )
          })}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-4)' }}>
            Current: {effectiveViewMode === 'bracket' ? 'Bracket' : 'List'}
          </span>
        </div>}

        {/* ── STANDINGS (round-robin) ─────────────────────────────── */}
        {format !== 'elimination' && pastMatches.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <ST Icon={BarChart3} label="Puan Durumu" />
            <StandingsTable matches={pastMatches} navigate={navigate} />
          </div>
        )}

        {/* ── TOP PERFORMERS (hybrid v3 oyuncu KDA) ────────────────── */}
        {topPerformers.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <ST Icon={Target} label="Öne Çıkan Oyuncular" />
              <DeepScoutBadge />
            </div>
            <TopPerformers rows={topPerformers} navigate={navigate} />
          </div>
        )}

        {/* ── BRACKETS (elimination) ─────────────────────────────── */}
        {effectiveViewMode === 'bracket' && (matches.length > 0 || hasLiquipediaBracket) && (
          <div style={{ marginBottom: 36 }}>
            <ST Icon={Trophy} label="Playoff Ağacı"
              right={
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-5)' }}>Zoom</span>
                  <button
                    onClick={() => setBracketZoom(prev => clampBracketZoom(prev - 0.1))}
                    style={{ width: 24, height: 24, borderRadius: 7, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer' }}
                    title="Zoom out"
                  >
                    -
                  </button>
                  <button
                    onClick={() => setBracketZoom(1)}
                    style={{ padding: '0 8px', height: 24, borderRadius: 7, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}
                    title="Reset zoom"
                  >
                    {Math.round(bracketZoom * 100)}%
                  </button>
                  <button
                    onClick={() => setBracketZoom(prev => clampBracketZoom(prev + 0.1))}
                    style={{ width: 24, height: 24, borderRadius: 7, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer' }}
                    title="Zoom in"
                  >
                    +
                  </button>
                </div>
              }
            />
            {/* Bracket containers */}
            <div style={{
              background: 'var(--bg)', borderRadius: 16,
              border: '1px solid var(--surface-2)', padding: '16px',
              overflowX: 'auto',
            }}>
              {hasLiquipediaBracket ? (
                <>
                  <div style={{
                    fontSize: 11, fontWeight: 800, color: '#ff6b7a',
                    letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 8,
                  }}>
                    Liquipedia Pro Bracket
                  </div>

                  <div style={{
                    marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
                    border: '1px solid rgba(255,70,85,.35)', borderRadius: 999, padding: '4px 10px',
                    background: 'rgba(255,70,85,.1)', color: '#ff9aa5', fontSize: 10, fontWeight: 700,
                    letterSpacing: '.6px', textTransform: 'uppercase',
                  }}>
                    Winner Path highlighted
                  </div>

                  <BracketView
                    matches={liquipediaBracketMatches}
                    resolvedMatches={liquipediaBracketMatches}
                    navigate={navigate}
                    gc={gc}
                    bracketSide="upper"
                    zoom={bracketZoom}
                  />
                </>
              ) : (
                <>
                  <div style={{ marginBottom: 18 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 800, color: '#ff6b7a',
                      letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 8,
                    }}>
                      {isDoubleElim ? 'Upper Bracket' : 'Bracket'}
                    </div>
                    <BracketView
                      matches={matches}
                      resolvedMatches={upperBracketMatches}
                      navigate={navigate}
                      gc={gc}
                      bracketSide="upper"
                      zoom={bracketZoom}
                      isDoubleElim={isDoubleElim}
                    />
                  </div>

                  {isDoubleElim && lowerBracketMatches.length > 0 && (
                    <>
                      <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,var(--line),transparent)', margin: '12px 0 14px' }} />

                      <div>
                        <div style={{
                          fontSize: 11, fontWeight: 800, color: '#60a5fa',
                          letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 8,
                        }}>
                          Lower Bracket
                        </div>
                        <BracketView
                          matches={matches}
                          resolvedMatches={lowerBracketMatches}
                          navigate={navigate}
                          gc={gc}
                          bracketSide="lower"
                          zoom={bracketZoom}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── NON-BRACKET STAGE LIST ───────────────────────────── */}
        {effectiveViewMode === 'list' && matches.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <ST
              Icon={ClipboardList}
              label={stageMode.hasLeagueStyle ? 'Stage Matches (Swiss / Groups / Round Robin)' : 'Stage Match List'}
              right={<span style={{ fontSize: 10, color: 'var(--text-5)' }}>Tarih ve round bazli</span>}
            />
            <div style={{
              background: 'var(--bg)', borderRadius: 16,
              border: '1px solid var(--surface-2)', padding: '16px',
            }}>
              <StageListView matches={matches} navigate={navigate} gc={gc} />
            </div>
          </div>
        )}

        {/* ── MATCH LIST ─────────────────────────────────────────── */}
        <div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[
              { key: 'upcoming', label: 'Upcoming / Live', Icon: Radio, count: upcomingMatches.length },
              { key: 'past',     label: 'Geçmiş Sonuçlar', Icon: CircleCheck, count: pastMatches.length     },
            ].map(t => {
              const active = activeTab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 18px', borderRadius: 12, border: 'none',
                    cursor: 'pointer', fontSize: 13, fontWeight: active ? 800 : 500,
                    background: active ? `${gc}22` : 'var(--surface)',
                    color: active ? gc : 'var(--text-4)',
                    outline: active ? `1.5px solid ${gc}55` : 'none',
                    transition: 'all .18s',
                  }}
                >
                  {t.Icon && <t.Icon size={14} />}
                  {t.label}
                  <span style={{
                    padding: '2px 7px', borderRadius: 10, fontSize: 11,
                    background: active ? `${gc}30` : 'var(--surface-2)',
                    color: active ? gc : 'var(--text-5)', fontWeight: 800,
                  }}>{t.count}</span>
                </button>
              )
            })}
          </div>

          {/* Match Grid */}
          {(activeTab === 'upcoming' ? upcomingMatches : pastMatches).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px',
              color: 'var(--text-6)', background: 'var(--surface)', borderRadius: 16,
              border: '1px dashed var(--surface-2)' }}>
              <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}>
                {activeTab === 'upcoming' ? <CalendarDays size={34} color="var(--text-6)" /> : <ClipboardList size={34} color="var(--text-6)" />}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-4)' }}>
                {activeTab === 'upcoming' ? 'Planlanmış maç yok' : 'Geçmiş maç yok'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
              {(activeTab === 'upcoming' ? upcomingMatches : pastMatches).map(m => (
                <MatchListCard key={m.id} m={m} navigate={navigate} gc={gc} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Kompakt Stat Chips ──────────────────────────────────────────────────── */
function StatChips({ chips }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {chips.filter(s => s.value > 0).map(s => (
        <div
          key={s.label}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 20,
            background: `${s.color}10`,
            border: `1px solid ${s.color}25`,
          }}
        >
          {s.Icon && <s.Icon size={13} color={s.color} />}
          <span style={{ fontSize: 14, fontWeight: 900, color: s.color,
            fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}