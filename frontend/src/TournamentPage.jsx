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
import { useState, useEffect, useCallback, useMemo } from 'react'
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

function canonicalRoundLabel(roundInfo = '') {
  const s = String(roundInfo || '').toLowerCase().trim()
  if (!s) return 'Matches'

  if (/(quarter|qf|1\/4|çeyrek)/.test(s)) return 'Quarter-Final'
  if (/(semi|sf|yarı)/.test(s)) return 'Semi-Final'
  if (/(grand\s*final|gf|büyük\s*final)/.test(s)) return 'Grand Final'
  if (/(final|f\b)/.test(s)) return 'Final'

  return roundInfo
}

// round-robin mi elimination mı?
function detectFormat(matches) {
  if (!matches?.length) return 'unknown'
  // round_info alanı varsa kullan
  const rounds = [...new Set(matches.map(m => m.round_info).filter(Boolean))]
  if (rounds.some(r => /final|semi|quarter|bracket/i.test(r))) return 'elimination'
  if (rounds.some(r => /group|round|week/i.test(r)))           return 'roundrobin'
  // bracket_position varsa elimination
  if (matches.some(m => m.bracket_position != null))           return 'elimination'
  // fallback: maç sayısı az + tekrar eden takım çiftleri az → elimination
  return rounds.length > 0 ? 'roundrobin' : 'elimination'
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

const ROUND_ORDER  = ['Quarter-Final', 'Semi-Final', 'Final', 'Grand Final']
const ROUND_LABELS = {
  'Quarter-Final': { icon: '⚔️',  color: '#818cf8', short: 'QF', order: 0 },
  'Semi-Final':    { icon: '🔥',  color: '#FF8C00', short: 'SF', order: 1 },
  'Final':         { icon: '🏆',  color: '#FFD700', short: 'F',  order: 2 },
  'Grand Final':   { icon: '👑',  color: '#FFD700', short: 'GF', order: 3 },
}

/* ─── SVG Connector ─────────────────────────────────────────────────────────
   İki sütun arasındaki bağlantı çizgisi.
   leftCards: sol sütundaki kart sayısı → her çift bir sonraki karta bağlanır.
   cardH    : kart yüksekliği (px)
   gap      : kartlar arası gap (px)
*/
function BracketConnectors({ pairCount, cardH, cardGap, headerH }) {
  // Her pair için bir connector: sol'dan 2 kart → sağ'da 1 kart
  const connW = 32   // svg genişliği
  const totalH = pairCount * (cardH * 2 + cardGap) + (pairCount - 1) * cardGap

  return (
    <svg
      width={connW}
      height={totalH + headerH}
      style={{ flexShrink: 0, alignSelf: 'flex-start', marginTop: headerH }}
      overflow="visible"
    >
      {Array.from({ length: pairCount }).map((_, i) => {
        // Sol sütun: kardeş kartların orta Y'leri
        const topCardMidY    = i * (cardH * 2 + cardGap * 2) + cardH / 2
        const bottomCardMidY = topCardMidY + cardH + cardGap
        const midY           = (topCardMidY + bottomCardMidY) / 2

        return (
          <g key={i}>
            {/* üst kart → merkez */}
            <path
              d={`M 0 ${topCardMidY} H ${connW / 2} V ${midY}`}
              fill="none" stroke="#2a2a2a" strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            {/* alt kart → merkez */}
            <path
              d={`M 0 ${bottomCardMidY} H ${connW / 2} V ${midY}`}
              fill="none" stroke="#2a2a2a" strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            {/* merkez → sağ */}
            <path
              d={`M ${connW / 2} ${midY} H ${connW}`}
              fill="none" stroke="#FF4655" strokeWidth="1.5"
              opacity="0.5"
            />
            {/* merkez nokta */}
            <circle cx={connW / 2} cy={midY} r="3"
              fill="#FF4655" opacity="0.6" />
          </g>
        )
      })}
    </svg>
  )
}

const BRACKET_CARD_H   = 88   // px — BracketMatchCard yüksekliği
const BRACKET_CARD_GAP = 10   // px — kartlar arası gap
const BRACKET_HEADER_H = 44   // px — round header yüksekliği

function BracketMatchCard({ m, navigate, gc }) {
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
          : hov ? `1.5px solid ${gc}88` : '1.5px solid #1e1e1e',
        boxShadow: m.status === 'running'
          ? '0 0 14px rgba(255,70,85,.2)'
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

function BracketView({ matches, navigate, gc }) {
  const rounds = useMemo(() => {
    const grouped = {}
    for (const m of matches) {
      const raw   = m.round_info || m.round || ''
      const label = canonicalRoundLabel(raw)

      if (!grouped[label]) grouped[label] = []
      grouped[label].push(m)
    }

    // Sırala: ROUND_ORDER'a göre, sonra alfabetik
    const ordered = {}
    for (const r of ROUND_ORDER) {
      if (grouped[r]) ordered[r] = grouped[r]
    }
    for (const r of Object.keys(grouped)) {
      if (!ordered[r]) ordered[r] = grouped[r]
    }

    // Her round'u zaman sırasına göre sabitle.
    for (const key of Object.keys(ordered)) {
      ordered[key] = [...ordered[key]].sort(
        (a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)
      )
    }
    return ordered
  }, [matches])

  const roundKeys = Object.keys(rounds)
  if (roundKeys.length === 0) return (
    <div style={{ textAlign: 'center', padding: '32px', color: '#383838', fontSize: 13 }}>
      round_info verisi olmadan bracket oluşturulamıyor —
      maçlar aşağıdaki Match List'te listelendi.
    </div>
  )

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        gap: 0,  // connector SVG gap'i halleder
        minWidth: 'max-content',
        padding: '8px 4px 8px',
      }}>
        {roundKeys.map((rk, colIdx) => {
          const meta       = ROUND_LABELS[rk] || { icon: '🎮', color: gc, short: rk }
          const colMatches = rounds[rk]
          // Bu sütundan sonra bir connector gerekiyor mu?
          // (sonraki sütun varsa ve bu sütun çift sayıda maç içeriyorsa)
          const nextRk        = roundKeys[colIdx + 1]
          const nextCount     = nextRk ? rounds[nextRk].length : 0
          const pairCount     = Math.max(0, Math.min(nextCount, Math.floor(colMatches.length / 2)))
          const showConnector = nextRk && pairCount > 0

          return (
            <div key={rk} style={{ display: 'flex', alignItems: 'flex-start' }}>
              {/* Sütun */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {/* Round header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 20, marginBottom: 10,
                  background: `${meta.color}15`,
                  border: `1px solid ${meta.color}33`,
                  height: BRACKET_HEADER_H - 10 - 10,
                  alignSelf: 'stretch', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 12 }}>{meta.icon}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800,
                    color: meta.color, letterSpacing: '1px', textTransform: 'uppercase',
                  }}>{rk}</span>
                  <span style={{ fontSize: 9, color: '#444' }}>({colMatches.length})</span>
                </div>

                {/* Cards — dikey ortalanmış */}
                <div style={{
                  display: 'flex', flexDirection: 'column',
                  gap: BRACKET_CARD_GAP,
                  // Final/GF kartları dikey olarak (toplamın yarısı boşluk bırakır → optik ortalama)
                  marginTop: colIdx > 0
                    ? (colIdx * (BRACKET_CARD_H + BRACKET_CARD_GAP))
                    : 0,
                }}>
                  {colMatches.map(m => (
                    <BracketMatchCard key={m.id} m={m} navigate={navigate} gc={gc} />
                  ))}
                </div>
              </div>

              {/* Connector SVG */}
              {showConnector && (
                <BracketConnectors
                  pairCount={pairCount}
                  cardH={BRACKET_CARD_H}
                  cardGap={BRACKET_CARD_GAP}
                  headerH={BRACKET_HEADER_H}
                />
              )}
            </div>
          )
        })}
      </div>
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
          📅 {fmtDateTime(m.scheduled_at)}
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

  // ── Veri çekme ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [tourRes, matchRes] = await Promise.all([
        supabase
          .from('tournaments')
          .select('*, game:games(id, name, slug)')
          .eq('id', tournamentId)
          .single(),

        supabase
          .from('matches')
          .select(`
            id, status, scheduled_at,
            team_a_id, team_b_id, winner_id,
            team_a_score, team_b_score,
            round_info,
            team_a:teams!matches_team_a_id_fkey(id, name, logo_url, acronym),
            team_b:teams!matches_team_b_id_fkey(id, name, logo_url, acronym),
            game:games(id, name)
          `)
          .eq('tournament_id', tournamentId)
          .order('scheduled_at', { ascending: true })
          .limit(400),
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
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
    [matches]
  )
  const pastMatches = useMemo(() =>
    matches.filter(m => m.status === 'finished')
      .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at)),
    [matches]
  )

  // ── Format algılama ───────────────────────────────────────────
  const format = detectFormat(matches)

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

        {/* ── STANDINGS (round-robin) ─────────────────────────────── */}
        {format !== 'elimination' && pastMatches.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <ST icon="📊" label="Puan Durumu" />
            <StandingsTable matches={pastMatches} navigate={navigate} />
          </div>
        )}

        {/* ── BRACKETS (elimination) ─────────────────────────────── */}
        {format === 'elimination' && matches.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <ST icon="🏆" label="Playoff Ağacı"
              right={
                <span style={{ fontSize: 10, color: '#383838' }}>
                  kaydırılabilir →
                </span>
              }
            />
            {/* Bracket container */}
            <div style={{
              background: '#0a0a0a', borderRadius: 16,
              border: '1px solid #1a1a1a', padding: '16px',
              overflowX: 'auto',
            }}>
              <BracketView matches={matches} navigate={navigate} gc={gc} />
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