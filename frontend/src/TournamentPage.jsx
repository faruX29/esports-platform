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
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate }                     from 'react-router-dom'
import { supabase }                                   from './supabaseClient'
import { isTurkishTeam }                              from './constants'

// ─── Sabitler ────────────────────────────────────────────────────────────────

const TIER_META = {
  S: { color: '#FFD700', bg: 'rgba(255,215,0,.15)',   border: 'rgba(255,215,0,.4)',   label: 'S · Premier'    },
  A: { color: '#FF4655', bg: 'rgba(255,70,85,.15)',   border: 'rgba(255,70,85,.4)',   label: 'A · Major'      },
  B: { color: '#FF8C00', bg: 'rgba(255,140,0,.15)',   border: 'rgba(255,140,0,.4)',   label: 'B · Regional'   },
  C: { color: '#818cf8', bg: 'rgba(129,140,248,.15)', border: 'rgba(129,140,248,.4)', label: 'C · Qualifier'  },
}

function gameColor(name = '') {
  const n = name.toLowerCase()
  if (n.includes('valorant'))                              return '#FF4655'
  if (n.includes('counter') || n.includes('cs'))          return '#F0A500'
  if (n.includes('league')  || n.includes('legends'))     return '#C89B3C'
  if (n.includes('dota'))                                  return '#9d2226'
  return '#818cf8'
}
function gameIcon(name = '') {
  const n = name.toLowerCase()
  if (n.includes('valorant'))                              return '⚡'
  if (n.includes('counter') || n.includes('cs'))          return '🎯'
  if (n.includes('league')  || n.includes('legends'))     return '🏆'
  if (n.includes('dota'))                                  return '🔮'
  return '🎮'
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
  if (!rawTier) return null
  return {
    key: rawTier,
    color: '#aaa',
    bg: 'rgba(255,255,255,.08)',
    border: 'rgba(170,170,170,.35)',
    label: `Tier ${rawTier}`,
  }
}

function getMatchTimestamp(match) {
  return match?.begin_at || match?.scheduled_at || null
}

function inferBracketStageFromText(text = '', bracketSide = 'upper') {
  const s = String(text || '').toLowerCase().trim()
  if (!s) return null

  if (/(3rd|third|bronze|decider|placement)/.test(s)) return 'Third Place Decider'

  if (bracketSide === 'lower') {
    const roundNum = s.match(/(?:lower|lb|loser)[\s_-]*(?:round|r)?[\s_-]*(\d+)/)
    if (roundNum?.[1]) return `Lower Round ${roundNum[1]}`
    if (/(lower[\s_-]*semi|lb[\s_-]*semi|semi[\s_-]*final|semifinal|\bsf\b)/.test(s)) return 'Lower Semi-final'
    if (/(lower[\s_-]*final|lb[\s_-]*final|\blf\b|\bfinal\b)/.test(s)) return 'Lower Final'
    return 'Lower Round 1'
  }

  if (/(semi[\s_-]*final|semifinal|\bsf\b|round[\s_-]*of[\s_-]*4|round[\s_-]*4|ro4|1\/2)/.test(s)) return 'Semi-finals'
  if (/(quarter[\s_-]*final|quarterfinal|\bqf\b|round[\s_-]*of[\s_-]*8|round[\s_-]*8|ro8|round[\s_-]*of[\s_-]*16|ro16|round[\s_-]*16|\br16\b|1\/8\s*final|1\/8|1\/4)/.test(s)) return 'Quarter-finals'
  if (/(grand[\s_-]*final|\bgf\b)/.test(s)) return 'Grand final'

  // "Upper Final" çoğunlukla GF öncesi eşleşme olduğundan Semi-final kolonunda tutulur.
  if (/(upper[\s_-]*final|\bfinal\b|finals?)/.test(s)) return 'Semi-finals'

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

function buildBracketStages(matches = []) {
  const sortedByTime = [...matches].sort((a, b) => {
    const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
    const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
    return ta - tb
  })

  const resolved = sortedByTime.map(m => {
    const bracketSide = inferBracketSide(m)

    const stageFromRound = inferBracketStageFromText(m?.round_info, bracketSide)
    if (stageFromRound) {
      return { ...m, __stage: stageFromRound, __stageSource: 'round_info', __bracketSide: bracketSide }
    }

    const stageFromName = inferBracketStageFromText(m?.name, bracketSide)
    if (stageFromName) {
      return { ...m, __stage: stageFromName, __stageSource: 'name', __bracketSide: bracketSide }
    }

    const fallbackStage = bracketSide === 'lower' ? 'Lower Round 1' : 'Quarter-finals'
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

    return {
      ...m,
      __stage: fallbackStage,
      __stageSource: 'side-default',
      __bracketSide: bracketSide,
    }
  })

  return resolved
}

// round-robin mi elimination mı?
function detectFormat(matches) {
  if (!matches?.length) return 'unknown'
  // round_info alanı varsa kullan
  const rounds = [...new Set(matches.map(m => m.round_info || m.name).filter(Boolean))]
  if (rounds.some(r => /final|semi|quarter|bracket/i.test(r))) return 'elimination'
  if (rounds.some(r => /group|round|week/i.test(r)))           return 'roundrobin'
  // bracket_position varsa elimination
  if (matches.some(m => m.bracket_position != null))           return 'elimination'
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
      <div style={{ textAlign: 'center', padding: '28px', color: '#555' }}>
        Bu aşamada listelenecek maç bulunamadı.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {dateKeys.map(dateKey => (
        <div key={dateKey} style={{ border: '1px solid #1b1b1b', borderRadius: 12, background: '#0c0c0c', padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: gc, letterSpacing: '.9px', marginBottom: 8 }}>
            📅 {dateKey}
          </div>

          {Object.entries(grouped[dateKey]).map(([roundKey, list]) => (
            <div key={`${dateKey}-${roundKey}`} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: '#7a7a7a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.8px' }}>
                {roundKey}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
                {list.map(m => (
                  <MatchListCard key={m.id} m={m} navigate={navigate} gc={gc} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
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
      background: 'linear-gradient(90deg,#111 25%,#1c1c1c 50%,#111 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
      ...style,
    }} />
  )
}

// ─── Section title ────────────────────────────────────────────────────────────

function ST({ icon, label, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#555',
        letterSpacing: '1.5px', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: '#1a1a1a' }} />
      {right}
    </div>
  )
}

// ─── Team Logo / Avatar ───────────────────────────────────────────────────────

function TeamAv({ src, name, size = 36 }) {
  const [err, setErr] = useState(false)
  const initials = (name || '?').split(/[\s_]/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  if (src && !err) {
    return (
      <img src={src} alt={name} onError={() => setErr(true)}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />
    )
  }
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, borderRadius: 8,
      background: 'linear-gradient(135deg,#1e1e1e,#2a2a2a)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.32, fontWeight: 800, color: '#444',
    }}>{initials}</div>
  )
}

// ─── Standings Table ─────────────────────────────────────────────────────────

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
      const aWon = m.winner_id === m.team_a.id || m.winner_id === m.team_a_id
      if (aWon) { map[m.team_a.id].w++; map[m.team_b.id].l++ }
      else      { map[m.team_b.id].w++; map[m.team_a.id].l++ }
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
                fontSize: 10, color: '#444', fontWeight: 700,
                letterSpacing: '1px', textTransform: 'uppercase',
                borderBottom: '1px solid #1a1a1a',
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
            const medals = ['🥇', '🥈', '🥉']
            return (
              <tr
                key={t.id}
                onClick={() => navigate(`/team/${t.id}`)}
                style={{ cursor: 'pointer' }}
              >
                {/* Rank */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: '#0d0d0d', borderRadius: '10px 0 0 10px',
                  borderLeft: isTop3 ? `3px solid ${['#FFD700','#C0C0C0','#CD7F32'][i]}` : '3px solid transparent',
                }}>
                  <span style={{ fontSize: 14 }}>{isTop3 ? medals[i] : i + 1}</span>
                </td>

                {/* Team */}
                <td style={{ padding: '10px 12px', background: '#0d0d0d', minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TeamAv src={t.logo} name={t.name} size={28} />
                    <span style={{ fontSize: 13, fontWeight: 700,
                      color: isTR ? '#FFD700' : '#ddd' }}>
                      {t.name}{isTR && ' 🇹🇷'}
                    </span>
                  </div>
                </td>

                {/* W */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: '#0d0d0d',
                  fontSize: 14, fontWeight: 800, color: '#4CAF50' }}>{t.w}</td>

                {/* L */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: '#0d0d0d',
                  fontSize: 14, fontWeight: 800, color: '#FF4655' }}>{t.l}</td>

                {/* W% */}
                <td style={{ padding: '10px 12px', background: '#0d0d0d', minWidth: 100 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 5, borderRadius: 3,
                      background: '#1a1a1a', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`,
                        background: pct >= 60 ? '#4CAF50' : pct >= 40 ? '#FF8C00' : '#FF4655',
                        transition: 'width .6s ease', borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#888', minWidth: 28 }}>{pct}%</span>
                  </div>
                </td>

                {/* Map W / L */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: '#0d0d0d', fontSize: 12, color: '#4CAF50' }}>{t.mw}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: '#0d0d0d', borderRadius: '0 10px 10px 0',
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

const UPPER_ROUND_ORDER = ['Quarter-finals', 'Semi-finals', 'Grand final']
const LOWER_ROUND_ORDER = ['Lower Round 1', 'Lower Round 2', 'Lower Round 3', 'Lower Round 4', 'Lower Semi-final', 'Lower Final']
const ROUND_LABELS = {
  'Quarter-finals': { icon: '⚔️', color: '#818cf8', short: 'QF' },
  'Semi-finals':    { icon: '🔥', color: '#FF8C00', short: 'SF' },
  'Grand final':    { icon: '👑', color: '#FFD700', short: 'GF' },
  'Lower Round 1':  { icon: '🛣️', color: '#94a3b8', short: 'LB R1' },
  'Lower Round 2':  { icon: '🛣️', color: '#94a3b8', short: 'LB R2' },
  'Lower Round 3':  { icon: '🛣️', color: '#94a3b8', short: 'LB R3' },
  'Lower Round 4':  { icon: '🛣️', color: '#94a3b8', short: 'LB R4' },
  'Lower Semi-final': { icon: '⚔️', color: '#60a5fa', short: 'LB SF' },
  'Lower Final':      { icon: '🏁', color: '#38bdf8', short: 'LB F' },
}

const BRACKET_CARD_H   = 88   // px — BracketMatchCard yüksekliği
const BRACKET_CARD_GAP = 10   // px — kartlar arası gap
const BRACKET_HEADER_H = 44   // px — round header yüksekliği
const BRACKET_CARD_W   = 200
const BRACKET_COL_GAP  = 76
const BRACKET_TOP_PAD  = 8
const CONNECTOR_MODE = 'orthogonal'

function BracketMatchCard({ m, navigate, gc, highlightPath = false }) {
  const aId   = m.team_a?.id || m.team_a_id
  const bId   = m.team_b?.id || m.team_b_id
  const aWon  = m.status === 'finished' && (m.winner_id === aId)
  const bWon  = m.status === 'finished' && (m.winner_id === bId)
  const aName = m.team_a?.name || 'TBD'
  const bName = m.team_b?.name || 'TBD'
  const aLogo = m.team_a?.logo_url
  const bLogo = m.team_b?.logo_url
  const isTRA = isTurkishTeam(aName)
  const isTRB = isTurkishTeam(bName)
  const [hov, setHov] = useState(false)

  return (
    <div
      onClick={() => m.team_a && navigate(`/match/${m.id}`)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative',
        borderRadius: 10, overflow: 'hidden',
        border: m.status === 'running'
          ? '1.5px solid rgba(255,70,85,.6)'
          : highlightPath
          ? '1.5px solid rgba(255,70,85,.55)'
          : hov ? `1.5px solid ${gc}88` : '1.5px solid #1e1e1e',
        boxShadow: m.status === 'running'
          ? '0 0 14px rgba(255,70,85,.2)'
          : highlightPath
          ? '0 0 16px rgba(255,70,85,.18)'
          : hov ? `0 4px 16px ${gc}20` : 'none',
        cursor: m.team_a ? 'pointer' : 'default',
        background: '#0d0d0d',
        transition: 'all .18s',
        width: 200,
        height: BRACKET_CARD_H,
        display: 'flex', flexDirection: 'column',
      }}
    >
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
            borderBottom: i === 0 ? '1px solid #111' : 'none',
            minHeight: 0,
          }}
        >
          {/* Logo */}
          <div style={{ width: 20, height: 20, flexShrink: 0 }}>
            {side.logo
              ? <img src={side.logo} alt={side.name}
                  style={{ width: 20, height: 20, objectFit: 'contain' }} />
              : <div style={{ width: 20, height: 20, borderRadius: 4,
                  background: '#1e1e1e', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 9, color: '#444' }}>?</div>
            }
          </div>

          {/* Name */}
          <span style={{
            flex: 1, fontSize: 11, fontWeight: side.won ? 800 : 400,
            color: side.won ? '#eee' : side.name === 'TBD' ? '#333' : '#888',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {side.isTR && '🇹🇷 '}{side.name}
          </span>

          {/* Score */}
          {m.status === 'finished' && (
            <span style={{
              fontSize: 14, fontWeight: 900, flexShrink: 0,
              color: side.won ? '#4CAF50' : '#383838',
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
}

function BracketView({ matches, resolvedMatches, navigate, gc, bracketSide = 'upper' }) {
  const scrollRef = useRef(null)
  const dragRef = useRef({ isDown: false, moved: false, startX: 0, scrollLeft: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const prepared = useMemo(() => {
    const source = (resolvedMatches || buildBracketStages(matches))
      .filter(m => m.__bracketSide === bracketSide)

    const roundOrder = bracketSide === 'lower' ? LOWER_ROUND_ORDER : UPPER_ROUND_ORDER
    const main = Object.fromEntries(roundOrder.map(k => [k, []]))
    let thirdPlace = null

    for (const m of source) {
      if (m.__stage === 'Third Place Decider') {
        if (!thirdPlace) thirdPlace = m
        continue
      }
      if (main[m.__stage]) {
        main[m.__stage].push(m)
      }
    }

    for (const key of Object.keys(main)) {
      main[key] = main[key].sort((a, b) => {
        const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
        const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
        return ta - tb
      })
    }

    return { main, thirdPlace, roundOrder }
  }, [matches, resolvedMatches, bracketSide])

  const roundKeys = prepared.roundOrder.filter(k => prepared.main[k]?.length > 0)

  const layout = useMemo(() => {
    const columns = roundKeys.map((rk, colIdx) => {
      const colMatches = prepared.main[rk]
      const x = colIdx * (BRACKET_CARD_W + BRACKET_COL_GAP)
      const yOffset = colIdx > 0 ? colIdx * (BRACKET_CARD_H + BRACKET_CARD_GAP) : 0

      const cards = colMatches.map((m, idx) => {
        const y = BRACKET_TOP_PAD + BRACKET_HEADER_H + yOffset + idx * (BRACKET_CARD_H + BRACKET_CARD_GAP)
        const winnerId = m?.winner_id || null

        return {
          m,
          idx,
          x,
          y,
          centerY: y + BRACKET_CARD_H / 2,
          winnerId,
        }
      })

      return { rk, colIdx, x, yOffset, cards }
    })

    const edges = []
    for (let c = 0; c < columns.length - 1; c++) {
      const leftCards = columns[c].cards
      const rightCards = columns[c + 1].cards

      leftCards.forEach((srcCard, srcIdx) => {
        const src = srcCard.m
        const winnerId = src?.winner_id || null

        let targetIndex = -1
        if (winnerId) {
          targetIndex = rightCards.findIndex(rc => {
            const t = rc.m
            const ta = t?.team_a?.id || t?.team_a_id
            const tb = t?.team_b?.id || t?.team_b_id
            return winnerId === ta || winnerId === tb
          })
        }

        // Winner eşleşmesi yoksa bracket akışını bozmamak için index-pair fallback.
        if (targetIndex === -1 && rightCards.length > 0) {
          targetIndex = Math.min(Math.floor(srcIdx / 2), rightCards.length - 1)
        }

        if (targetIndex < 0) return
        const dstCard = rightCards[targetIndex]
        edges.push({
          key: `${c}-${srcCard.idx}-${targetIndex}`,
          from: { x: srcCard.x + BRACKET_CARD_W, y: srcCard.centerY },
          to: { x: dstCard.x, y: dstCard.centerY },
          highlight: Boolean(winnerId),
          sourceId: src?.id,
          targetId: dstCard.m?.id,
        })
      })
    }

    const width = Math.max(BRACKET_CARD_W, columns.length * BRACKET_CARD_W + Math.max(0, columns.length - 1) * BRACKET_COL_GAP)
    const maxCardBottom = columns.flatMap(col => col.cards.map(card => card.y + BRACKET_CARD_H))
      .reduce((acc, v) => Math.max(acc, v), BRACKET_TOP_PAD + BRACKET_HEADER_H)
    const height = maxCardBottom + BRACKET_TOP_PAD

    return { columns, edges, width, height }
  }, [roundKeys, prepared])

  const highlightedSourceIds = useMemo(
    () => new Set(layout.edges.filter(e => e.highlight).map(e => e.sourceId).filter(Boolean)),
    [layout.edges]
  )

  const onMouseDown = (e) => {
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
    <div style={{ textAlign: 'center', padding: '32px', color: '#383838', fontSize: 13 }}>
      Playoff verisi bulunamadı.
    </div>
  )

  return (
    <div>
      <div style={{ fontSize: 10, color: '#4a4a4a', marginBottom: 8, textAlign: 'right' }}>
        Drag to scroll →
      </div>
      <div style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        paddingBottom: 12,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: isDragging ? 'none' : 'auto',
      }}
      ref={scrollRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      >
        <div style={{
          position: 'relative',
          width: layout.width,
          height: layout.height,
          minWidth: 'max-content',
        }}>
          {/* Connector layer */}
          <svg
            width={layout.width}
            height={layout.height}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
          >
            <defs>
              <filter id="winnerGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {layout.edges.map(edge => {
              const { from, to, highlight, key } = edge
              const midX = from.x + ((to.x - from.x) / 2)
              const d = CONNECTOR_MODE === 'orthogonal'
                ? `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`
                : `M ${from.x} ${from.y} C ${from.x + 20} ${from.y}, ${to.x - 20} ${to.y}, ${to.x} ${to.y}`

              return (
                <g key={key}>
                  <path
                    d={d}
                    fill="none"
                    stroke={highlight ? 'rgba(255,70,85,.2)' : 'rgba(42,42,42,.55)'}
                    strokeWidth={highlight ? 3 : 2}
                    strokeLinecap="round"
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={highlight ? '#FF4655' : '#4a4a4a'}
                    strokeWidth={highlight ? 1.4 : 1}
                    strokeLinecap="round"
                    strokeDasharray={highlight ? undefined : '4 4'}
                    filter={highlight ? 'url(#winnerGlow)' : undefined}
                  />
                </g>
              )
            })}
          </svg>

          {/* Columns */}
          {layout.columns.map(col => {
            const meta = ROUND_LABELS[col.rk] || { icon: '🎮', color: gc, short: col.rk }

            return (
              <div
                key={col.rk}
                style={{
                  position: 'absolute',
                  left: col.x,
                  top: BRACKET_TOP_PAD,
                  width: BRACKET_CARD_W,
                }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 20, marginBottom: 10,
                  background: `${meta.color}15`,
                  border: `1px solid ${meta.color}33`,
                  height: BRACKET_HEADER_H - 10,
                }}>
                  <span style={{ fontSize: 12 }}>{meta.icon}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800,
                    color: meta.color, letterSpacing: '1px', textTransform: 'uppercase',
                  }}>{col.rk}</span>
                  <span style={{ fontSize: 9, color: '#444' }}>({col.cards.length})</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: BRACKET_CARD_GAP, marginTop: col.yOffset }}>
                  {col.cards.map(card => (
                    <BracketMatchCard
                      key={card.m.id}
                      m={card.m}
                      navigate={navigate}
                      gc={gc}
                      highlightPath={highlightedSourceIds.has(card.m.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {bracketSide === 'upper' && prepared.thirdPlace && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: '#5a5a5a', marginBottom: 8, letterSpacing: '.8px', textTransform: 'uppercase' }}>
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

function MatchListCard({ m, navigate, gc }) {
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
        background: '#0d0d0d',
        border: isLive
          ? '1.5px solid rgba(255,70,85,.6)'
          : hasTR
          ? '1.5px solid rgba(200,16,46,.4)'
          : '1.5px solid #1a1a1a',
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
          : hasTR ? 'rgba(200,16,46,.4)' : '#1a1a1a'
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
          background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)',
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
          <span style={{ fontSize: 10, color: '#555' }}>
            {m.game?.name ?? ''}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
              color: aWon ? '#eee' : '#666',
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
                  color: aWon ? '#4CAF50' : '#555' }}>
                  {m.team_a_score ?? '—'}
                </span>
                <span style={{ fontSize: 11, color: '#333' }}>:</span>
                <span style={{ fontSize: 18, fontWeight: 900,
                  color: bWon ? '#4CAF50' : '#555' }}>
                  {m.team_b_score ?? '—'}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 700,
                color: isLive ? '#FF4655' : '#444' }}>
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
              color: bWon ? '#eee' : '#666',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {isTRB && '🇹🇷 '}{m.team_b?.name ?? '?'}
            </span>
          </div>
        </div>

        {/* Date */}
        <div style={{ marginTop: 10, fontSize: 10, color: '#383838',
          textAlign: 'center', borderTop: '1px solid #111', paddingTop: 8 }}>
          📅 {fmtDateTime(getMatchTimestamp(m))}
        </div>
      </div>
    </div>
  )
}

// ─── Ana Bileşen ──────────────────────────────────────────────────────────────

export default function TournamentPage() {
  const { tournamentId } = useParams()
  const navigate          = useNavigate()

  const [tournament,  setTournament]  = useState(null)
  const [matches,     setMatches]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [activeTab,   setActiveTab]   = useState('upcoming')
  const [viewOverride, setViewOverride] = useState('auto') // auto | list | bracket

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

      setTournament(tourRes.data)
      setMatches(matchRes.data || [])
    } catch (e) {
      console.error('TournamentPage fetch error:', e)
      setError(e.message)
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
  const effectiveViewMode = useMemo(() => {
    if (viewOverride === 'list') return 'list'
    if (viewOverride === 'bracket') return 'bracket'
    return stageMode.bracketEnabled ? 'bracket' : 'list'
  }, [viewOverride, stageMode])

  useEffect(() => {
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
      viewOverride,
      effectiveViewMode,
    })
  }, [stageMode, viewOverride, effectiveViewMode])
  const resolvedBracketMatches = useMemo(() => buildBracketStages(matches), [matches])
  const upperBracketMatches = useMemo(
    () => resolvedBracketMatches.filter(m => m.__bracketSide === 'upper'),
    [resolvedBracketMatches]
  )
  const lowerBracketMatches = useMemo(
    () => resolvedBracketMatches.filter(m => m.__bracketSide === 'lower'),
    [resolvedBracketMatches]
  )

  // ── Stil değerleri ───────────────────────────────────────────
  const gName = tournament?.game?.name ?? ''
  const gc    = gameColor(gName)
  const gi    = gameIcon(gName)
  const tier  = getTierMeta(tournament?.tier)
  const isTR  = isTurkishTeam(tournament?.name ?? '') || tournament?.region === 'TR'

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
      <div style={{ fontSize: 44, marginBottom: 16 }}>❌</div>
      <div style={{ fontSize: 18, color: '#FF4655', marginBottom: 8 }}>
        {error ?? 'Turnuva bulunamadı'}
      </div>
      <button
        onClick={() => navigate(-1)}
        style={{ padding: '10px 24px', background: '#FF4655', border: 'none',
          borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
      >← Geri</button>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 100px', color: 'white' }}>

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
        background: 'linear-gradient(160deg,#0d0d0d 0%,#111 100%)',
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
            background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)',
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
              background: 'rgba(255,255,255,.06)', border: '1px solid #222',
              borderRadius: 8, color: '#888', padding: '5px 12px',
              fontSize: 12, cursor: 'pointer', transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#444' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#222' }}
          >← Geri</button>

          {/* Live indicator */}
          {upcomingMatches.some(m => m.status === 'running') && (
            <span style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800,
              background: 'rgba(255,70,85,.15)', border: '1px solid rgba(255,70,85,.5)',
              color: '#FF4655', animation: 'pulse 1.2s infinite',
            }}>🔴 LIVE</span>
          )}
        </div>

        {/* Main info */}
        <div style={{ padding: '0 24px', position: 'relative' }}>
          {/* Badges */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              background: `${gc}18`, border: `1px solid ${gc}44`, color: gc,
            }}>{gi} {gName || 'Esports'}</span>

            {tier && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: tier.bg, border: `1px solid ${tier.border}`, color: tier.color,
              }}>{tier.label}</span>
            )}

            {tournament.region && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: 'rgba(255,255,255,.06)', border: '1px solid #333', color: '#aaa',
              }}>
                📍 {String(tournament.region).toUpperCase()}
              </span>
            )}

            {format !== 'unknown' && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: 'rgba(129,140,248,.1)', border: '1px solid rgba(129,140,248,.25)',
                color: '#818cf8',
              }}>
                {format === 'roundrobin' ? '🔄 Round Robin' : '🏆 Elimination'}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 style={{
            margin: '0 0 10px', fontSize: 28, fontWeight: 900, lineHeight: 1.15,
            color: '#f0f0f0',
          }}>{tournament.name}</h1>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14,
            fontSize: 12, color: '#666' }}>
            {(tournament.begin_at || tournament.end_at) && (
              <span>📅 {fmtDate(tournament.begin_at)}
                {tournament.end_at && ` — ${fmtDate(tournament.end_at)}`}
              </span>
            )}
            {tournament.region && <span>📍 {tournament.region}</span>}
            {tournament.prizepool && (
              <span style={{ color: '#FFD700', fontWeight: 700 }}>
                💰 {tournament.prizepool}
              </span>
            )}
          </div>

          {/* Kompakt Stat Chips */}
          <StatChips chips={[
            { icon: '🎮', label: 'Maç',      value: matches.length,                              color: '#818cf8' },
            { icon: '⏳', label: 'Upcoming', value: upcomingMatches.length,                      color: '#4CAF50' },
            { icon: '✅', label: 'Bitti',    value: pastMatches.length,                          color: '#FF8C00' },
            { icon: '🔴', label: 'Live',     value: matches.filter(m => m.status === 'running').length, color: '#FF4655' },
          ]} />
        </div>
      </div>

      {/* ══════════════ CONTENT ════════════════════════════════════ */}
      <div style={{ padding: '0 20px', animation: 'fadeUp .3s ease' }}>

        {/* ── DEV: Manual View Override ─────────────────────────── */}
        <div style={{
          marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: '#0d0d0d', border: '1px solid #202020', borderRadius: 12,
          padding: '8px 10px',
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: '#666' }}>
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
                  background: active ? 'rgba(255,70,85,.18)' : '#141414',
                  color: active ? '#FF4655' : '#777',
                  outline: active ? '1px solid rgba(255,70,85,.45)' : '1px solid #222',
                }}
              >
                {opt.label}
              </button>
            )
          })}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#555' }}>
            Current: {effectiveViewMode === 'bracket' ? 'Bracket' : 'List'}
          </span>
        </div>

        {/* ── STANDINGS (round-robin) ─────────────────────────────── */}
        {format !== 'elimination' && pastMatches.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <ST icon="📊" label="Puan Durumu" />
            <StandingsTable matches={pastMatches} navigate={navigate} />
          </div>
        )}

        {/* ── BRACKETS (elimination) ─────────────────────────────── */}
        {effectiveViewMode === 'bracket' && matches.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <ST icon="🏆" label="Playoff Ağacı"
              right={
                <span style={{ fontSize: 10, color: '#383838' }}>
                  kaydırılabilir →
                </span>
              }
            />
            {/* Bracket containers */}
            <div style={{
              background: '#0a0a0a', borderRadius: 16,
              border: '1px solid #1a1a1a', padding: '16px',
            }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{
                  fontSize: 11, fontWeight: 800, color: '#ff6b7a',
                  letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 8,
                }}>
                  Upper Bracket
                </div>
                <BracketView
                  matches={matches}
                  resolvedMatches={upperBracketMatches}
                  navigate={navigate}
                  gc={gc}
                  bracketSide="upper"
                />
              </div>

              {lowerBracketMatches.length > 0 && (
                <>
                  <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,#202020,transparent)', margin: '12px 0 14px' }} />

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
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── NON-BRACKET STAGE LIST ───────────────────────────── */}
        {effectiveViewMode === 'list' && matches.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <ST
              icon="📋"
              label={stageMode.hasLeagueStyle ? 'Stage Matches (Swiss / Groups / Round Robin)' : 'Stage Match List'}
              right={<span style={{ fontSize: 10, color: '#4a4a4a' }}>Tarih ve round bazli</span>}
            />
            <div style={{
              background: '#0a0a0a', borderRadius: 16,
              border: '1px solid #1a1a1a', padding: '16px',
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
              { key: 'upcoming', label: '⏳ Upcoming / Live', count: upcomingMatches.length },
              { key: 'past',     label: '✅ Geçmiş Sonuçlar', count: pastMatches.length     },
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
                    background: active ? `${gc}22` : '#0d0d0d',
                    color: active ? gc : '#555',
                    outline: active ? `1.5px solid ${gc}55` : 'none',
                    transition: 'all .18s',
                  }}
                >
                  {t.label}
                  <span style={{
                    padding: '2px 7px', borderRadius: 10, fontSize: 11,
                    background: active ? `${gc}30` : '#1a1a1a',
                    color: active ? gc : '#444', fontWeight: 800,
                  }}>{t.count}</span>
                </button>
              )
            })}
          </div>

          {/* Match Grid */}
          {(activeTab === 'upcoming' ? upcomingMatches : pastMatches).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px',
              color: '#383838', background: '#0d0d0d', borderRadius: 16,
              border: '1px dashed #1e1e1e' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>
                {activeTab === 'upcoming' ? '📅' : '📋'}
              </div>
              <div style={{ fontSize: 14, color: '#555' }}>
                {activeTab === 'upcoming' ? 'Planlanmış maç yok' : 'Geçmiş maç yok'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
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
          <span style={{ fontSize: 11, color: s.color }}>{s.icon}</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: s.color,
            fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
          <span style={{ fontSize: 10, color: '#555' }}>{s.label}</span>
        </div>
      ))}
    </div>
  )
}