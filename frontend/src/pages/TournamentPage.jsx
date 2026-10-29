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
import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import { useParams, useNavigate, Link }               from 'react-router-dom'
import { supabase }                                   from '../supabaseClient'
import { isTurkishTeam, useTurkTakimlar }                              from '../constants'
import { cleanDisplayName }                           from '../utils/nameCleaner'
import { getBOFormat }                                from '../utils/matchFormat'
import { DeepScoutBadge }                             from '../components/ScoutSignals'
import TrBadge                                        from '../components/TrBadge'
import { deriveWinnerTeamId }                         from '../utils/matchResult'
import { roundLabel }                                 from '../utils/roundLabel'
import { isUncertainPrediction }                      from '../utils/prediction'
import { clickableProps }                             from '../utils/a11y'
import TurkishBadge                                   from '../components/TurkishBadge'
import { normalizeGameId }                            from '../utils/gameUtils'
import { GAMES }                                      from '../context/GameContext'
import {
  Swords, Trophy, Gamepad2, CalendarDays, Medal, Info, ZoomIn, ZoomOut,
  MapPin, Compass, Wallet, RefreshCw, CircleCheck, BarChart3, ClipboardList,
  Radio, Target, Layers, ChevronRight,
} from 'lucide-react'
import { FEXT } from '../theme'
import Mascot from '../components/Mascot'
import SeoHead from '../components/SeoHead'
import { tournamentDisplayName, isGenericStageName, displayRegion } from '../utils/tournamentDisplay'
import DragScroll from '../components/DragScroll'
import { normalizeTurnuvaMaci } from '../utils/turnuvaMaci'
import { ligPath, ligBaslik, turnuvaLigiGetir } from '../utils/ligler'
import { buildBracketModel, layoutBracket, BRACKET_DIM, turEtiketi, ayaksizTurNo } from '../utils/bracketModel'

// ─── Sabitler ────────────────────────────────────────────────────────────────

const TIER_META = {
  S: { color: '#FFD700', bg: 'rgba(255,215,0,.15)',   border: 'rgba(255,215,0,.4)',   label: 'S-Tier'               },
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

function getMatchTimestamp(match) {
  return match?.begin_at || match?.scheduled_at || null
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

// GSL grubu (4 takım, çift eleme): açılış → kazananlar / elenme → decider.
// PandaScore bu maçları "Winners Match" / "Elimination Match" / "Decider Match"
// diye etiketliyor. 28 Eylül'de görüldü: metin içindeki "elimination" kelimesi
// yüzünden turnuva ELEME AĞACI sanılıyor ve maçlar "Çeyrek Final / Yarı Final /
// Büyük Final" kolonlarına dağıtılıyordu — grupta öyle bir aşama yok.
// Veritabanında bu etiketi taşıyan 1.842 maç var, yani sorun Champions'a özel değil.
const GSL_RE = /(winners?\s*match|elimination\s*match|decider\s*match|opening\s*match)/i

function isGslStage(tournament, matches) {
  const adGrup = /^group\b/i.test(String(tournament?.name || '').trim())
  const gslEtiket = (matches || []).some(m => GSL_RE.test(String(m?.round_info || m?.name || '')))
  return adGrup || gslEtiket
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

  const gsl = isGslStage(tournament, matches)
  const hasLeagueStyle = gsl || /(swiss|groups?|round\s*robin|\brr\b)/.test(stageText)
  const hasBracketSignals = /(play[\s_-]*offs?|elimination|knockout|bracket|quarter|semi|grand\s*final|lower|upper)/.test(stageText)
  const hasStageHints = Boolean(rootStageText) || (matches || []).some(m => Boolean(m?.stage_type || m?.stage_name))
  const stageUndetermined = !hasStageHints && !hasLeagueStyle && !hasBracketSignals

  // Güvenli varsayılan: stage tipi belirlenemiyorsa liste görünümü.
  const bracketEnabled = !hasLeagueStyle && hasBracketSignals && !stageUndetermined

  return {
    gsl,
    hasLeagueStyle,
    hasBracketSignals,
    hasStageHints,
    stageUndetermined,
    format,
    bracketEnabled,
  }
}

// Liste görünümünde tur başlığı: PandaScore etiketleri İngilizce ve büyük harfe
// çevrilince Türkçe kurallarıyla bozuluyordu ("WİNNERS MATCH"); Türkçe karşılık
// turEtiketi'nden. Takım kodlu etiket ("TL vs PR") başlık olmaz.
function getRoundDisplayLabel(match) {
  return turEtiketi(match) || ''
}

function StageListView({ matches, navigate, gc }) {
  const [visibleGroups, setVisibleGroups] = useState(8)
  // Gruplama: her maç ayaksız "Tur n" ise (İsviçre / lig usulü) tur tur; her maçın
  // tanınan bir aşaması varsa (ağacı çizilemeyen eleme) aşama aşama; yoksa tarih tarih
  const mod = useMemo(() => {
    const list = matches || []
    if (list.length && list.every(m => ayaksizTurNo(m) != null)) return 'tur'
    const etiketler = list.map(m => turEtiketi(m))
    if (list.length && etiketler.every(Boolean) && new Set(etiketler).size < list.length) return 'asama'
    return 'tarih'
  }, [matches])
  const turTur = mod === 'tur'
  const groups = useMemo(() => {
    const sorted = [...(matches || [])].sort((a, b) => {
      const ta = getMatchTimestamp(a) ? new Date(getMatchTimestamp(a)).getTime() : 0
      const tb = getMatchTimestamp(b) ? new Date(getMatchTimestamp(b)).getTime() : 0
      return ta - tb
    })

    const bucket = new Map()
    for (const m of sorted) {
      let key, title, sub
      if (turTur) {
        const n = ayaksizTurNo(m)
        key = `tur-${n}`; title = `Tur ${n}`; sub = ''
      } else if (mod === 'asama') {
        title = turEtiketi(m); key = title; sub = ''
      } else {
        const ts = getMatchTimestamp(m)
        const d = ts ? new Date(ts) : null
        title = d && !Number.isNaN(d.getTime())
          ? d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
          : 'Tarih bilinmiyor'
        key = title
        sub = getRoundDisplayLabel(m)
      }
      if (!bucket.has(key)) bucket.set(key, { key, title, n: turTur ? ayaksizTurNo(m) : 0, subs: new Map() })
      const g = bucket.get(key)
      if (!g.subs.has(sub)) g.subs.set(sub, [])
      g.subs.get(sub).push(m)
    }
    const list = [...bucket.values()]
    if (turTur) list.sort((a, b) => a.n - b.n)
    return list
  }, [matches, turTur, mod])

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '28px', color: 'var(--text-4)' }}>
        Bu aşamada listelenecek maç bulunamadı.
      </div>
    )
  }

  const shown = groups.slice(0, visibleGroups)
  const remaining = groups.length - shown.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {shown.map(g => (
        <div key={g.key} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-2)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            {mod === 'tarih' ? <CalendarDays size={13} color={gc} /> : <Layers size={13} color={gc} />} {g.title}
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-5)' }}>
              · {[...g.subs.values()].reduce((a, l) => a + l.length, 0)} maç
            </span>
          </div>

          {[...g.subs.entries()].map(([sub, list]) => (
            <div key={`${g.key}-${sub}`} style={{ marginBottom: 10 }}>
              {sub && (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-4)', marginBottom: 6 }}>
                  {sub}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 10 }}>
                {list.map(m => (
                  <MatchListCard key={m.id} m={m} navigate={navigate} gc={gc} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {remaining > 0 && (
        <button
          onClick={() => setVisibleGroups(v => v + 12)}
          style={{
            alignSelf: 'center', marginTop: 4, padding: '10px 20px', borderRadius: 10,
            border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Daha fazla göster (+{remaining} {mod === 'tur' ? 'tur' : mod === 'asama' ? 'aşama' : 'gün'})
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

export function Sk({ w = '100%', h = '16px', r = '8px', style = {} }) {
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

export function ST({ Icon, label, right }) {
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

function TopPerformers({ rows }) {
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

// cikanSayisi: kaç takım bir sonraki aşamaya çıkıyor (GSL grubunda 2). 0 = bilinmiyor,
// o zaman hiçbir sıra vurgulanmaz — "kim ödül aldı" izlenimi vermemek için.
function StandingsTable({ matches, navigate, cikanSayisi = 0 }) {
  useTurkTakimlar()  // Türk takımı listesi yüklenince yeniden çiz
  // Katılımcı takımları maçlardan türet
  const table = useMemo(() => {
    const map = {}
    const ensure = (team) => {
      if (!team?.id) return
      if (!map[team.id]) map[team.id] = {
        id: team.id, name: team.name, logo: team.logo_url,
        w: 0, l: 0, mw: 0, ml: 0,  // match wins/losses, map wins/losses
        history: [],               // {date, result:'W'|'L'|'D'} — son-5 form için
      }
    }
    for (const m of matches) {
      if (m.status !== 'finished') continue
      ensure(m.team_a); ensure(m.team_b)
      if (!m.team_a?.id || !m.team_b?.id) continue
      // Skor-öncelikli kazanan (winner_id ~%1.2 maçta skorla çelişir). Beraberlik (Bo2 1:1)
      // → W/L SAYMA (eski kod her 'aWon değil'i team_b galibiyeti sayıyordu = beraberlik bug'ı).
      const winner = deriveWinnerTeamId(m)
      const t = m.scheduled_at ? new Date(m.scheduled_at).getTime() : 0
      if (winner != null) {
        const aWon = winner === Number(m.team_a.id) || winner === Number(m.team_a_id)
        if (aWon) {
          map[m.team_a.id].w++; map[m.team_b.id].l++
          map[m.team_a.id].history.push({ t, result: 'W' }); map[m.team_b.id].history.push({ t, result: 'L' })
        } else {
          map[m.team_b.id].w++; map[m.team_a.id].l++
          map[m.team_b.id].history.push({ t, result: 'W' }); map[m.team_a.id].history.push({ t, result: 'L' })
        }
      } else {
        map[m.team_a.id].history.push({ t, result: 'D' }); map[m.team_b.id].history.push({ t, result: 'D' })
      }
      // map scores
      if (m.team_a_score != null) map[m.team_a.id].mw += m.team_a_score
      if (m.team_b_score != null) map[m.team_a.id].ml += m.team_b_score
      if (m.team_b_score != null) map[m.team_b.id].mw += m.team_b_score
      if (m.team_a_score != null) map[m.team_b.id].ml += m.team_a_score
    }
    return Object.values(map)
      .map(t => ({
        ...t,
        // en son 5 maç, soldan sağa eskiden yeniye
        form: t.history.sort((a, b) => a.t - b.t).slice(-5).map(h => h.result),
      }))
      // Sıralama: (1) maç galibiyeti ↓ (2) map farkı ↓ [espor standart tie-break —
      // eşit galibiyette map farkı fazla olan önde] (3) toplam map galibiyeti ↓
      // (4) maç mağlubiyeti ↑ (round-robin'de herkes aynı sayıda oynamayabilir).
      .sort((a, b) =>
        b.w - a.w ||
        (b.mw - b.ml) - (a.mw - a.ml) ||
        b.mw - a.mw ||
        a.l - b.l
      )
  }, [matches])

  if (table.length < 2) return null

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
        <thead>
          <tr>
            {['#', 'Takım', 'W', 'L', 'W%', 'Form', 'Map W', 'Map L'].map(h => (
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
            const isTR   = isTurkishTeam(t)
            // Madalya YOK (28 Eylül): 4 takımlı GSL grubunda yalnız ilk 2 takım
            // playoff'a çıkar; 3. sıraya bronz madalya koymak "ödül kazandı" gibi
            // okunuyordu. Çıkanlar ayrıca işaretlenir (cikanSayisi).
            const cikiyor = cikanSayisi > 0 && i < cikanSayisi
            return (
              <tr
                key={t.id}
                {...clickableProps(() => navigate(`/team/${t.id}`), { label: `${t.name} takım sayfası` })}
                style={{ cursor: 'pointer' }}
              >
                {/* Rank */}
                <td style={{ padding: '10px 12px', textAlign: 'center',
                  background: 'var(--surface)', borderRadius: '10px 0 0 10px',
                  borderLeft: `3px solid ${cikiyor ? 'var(--accent-fg)' : 'transparent'}`,
                }}>
                  <span style={{ fontSize: 14, fontWeight: cikiyor ? 800 : 500,
                    color: cikiyor ? 'var(--accent-fg)' : 'var(--text-3)' }}>{i + 1}</span>
                </td>

                {/* Team */}
                <td style={{ padding: '10px 12px', background: 'var(--surface)', minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TeamAv src={t.logo} name={t.name} size={28} />
                    <span style={{ fontSize: 13, fontWeight: 700,
                      color: isTR ? '#FFD700' : 'var(--text-1)' }}>
                      {t.name}{isTR && <TrBadge />}
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

                {/* Form (son 5) */}
                <td style={{ padding: '10px 12px', textAlign: 'center', background: 'var(--surface)' }}>
                  {t.form.length > 0 ? (
                    <div style={{ display: 'inline-flex', gap: 3 }}>
                      {t.form.map((r, fi) => {
                        const c = r === 'W' ? '#4CAF50' : r === 'L' ? '#FF4655' : 'var(--text-5)'
                        return (
                          <span key={fi} title={r === 'W' ? 'Galibiyet' : r === 'L' ? 'Mağlubiyet' : 'Beraberlik'} style={{
                            width: 16, height: 16, borderRadius: 4, fontSize: 9, fontWeight: 800,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            color: c, background: `${c}22`, border: `1px solid ${c}55`,
                          }}>{r}</span>
                        )
                      })}
                    </div>
                  ) : <span style={{ fontSize: 11, color: 'var(--text-6)' }}>—</span>}
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

// ─── Eleme ağacı ─────────────────────────────────────────────────────────────
// Model ve yerleşim utils/bracketModel.js'te (saf, toplu denetlenebilir); burada
// yalnız çizim. Bağlantı çizgileri takımdan doğrulanmış (düz) ya da henüz rakibi
// belli olmayan maça giden yapısal (kesik) çizgilerdir.

const BRACKET_MIN_ZOOM = 0.6
const BRACKET_MAX_ZOOM = 1.3

function clampBracketZoom(value) {
  return Math.min(BRACKET_MAX_ZOOM, Math.max(BRACKET_MIN_ZOOM, Math.round(value * 100) / 100))
}

function fmtKisaTarih(d) {
  if (!d) return ''
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const BracketMatchCard = memo(function BracketMatchCard({ m, navigate, hoverTeam, onHoverTeam }) {
  useTurkTakimlar()  // Türk takımı listesi yüklenince yeniden çiz
  const D = BRACKET_DIM
  const [hov, setHov] = useState(false)
  const virtual = m?.is_virtual === true
  const live = m?.status === 'running'
  const finished = m?.status === 'finished'
  const winner = finished ? deriveWinnerTeamId(m) : null
  const showScore = finished || live
  const canNavigate = !virtual && m?.id != null
  const aName = m.team_a?.name || 'Belirlenecek'
  const bName = m.team_b?.name || 'Belirlenecek'

  const rows = [
    { team: m.team_a, id: m.team_a?.id ?? m.team_a_id, name: aName, score: m.team_a_score },
    { team: m.team_b, id: m.team_b?.id ?? m.team_b_id, name: bName, score: m.team_b_score },
  ]

  return (
    <div
      {...(canNavigate ? clickableProps(() => navigate(`/match/${m.id}`), { label: `${aName} - ${bName} maç detayı` }) : {})}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: D.cardW,
        height: D.headH + 2 * D.rowH,
        boxSizing: 'border-box',
        borderRadius: 10,
        overflow: 'hidden',
        background: virtual ? 'transparent' : 'var(--surface)',
        border: virtual
          ? '1px dashed var(--line-2)'
          : live
          ? `1px solid ${FEXT.status.live.color}99`
          : hov && canNavigate ? `1px solid ${FEXT.accentBorder}` : '1px solid var(--line)',
        boxShadow: live
          ? `0 0 0 3px ${FEXT.status.live.bg}`
          : hov && canNavigate ? `0 6px 18px ${FEXT.accentGlow}` : 'none',
        cursor: canNavigate ? 'pointer' : 'default',
        transition: 'border-color .15s, box-shadow .15s',
      }}
    >
      {/* Üst şerit: tarih · seri formatı / canlı */}
      <div style={{
        height: D.headH, boxSizing: 'border-box', padding: '0 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        fontSize: 10, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums',
        background: virtual ? 'transparent' : 'var(--surface-2)',
        borderBottom: virtual ? '1px dashed var(--line-2)' : '1px solid var(--line)',
      }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {virtual ? 'Bekleniyor' : fmtKisaTarih(getMatchTimestamp(m)) || 'Tarih yok'}
        </span>
        {live ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: FEXT.status.live.color, fontWeight: 800, letterSpacing: '.4px' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: FEXT.status.live.color, animation: 'livePulse 1.2s infinite' }} />
            CANLI
          </span>
        ) : m.number_of_games ? (
          <span style={{ fontWeight: 700, color: 'var(--text-4)' }}>Bo{m.number_of_games}</span>
        ) : null}
      </div>

      {rows.map((r, i) => {
        const id = r.id != null ? String(r.id) : null
        const won = winner != null && id != null && Number(id) === winner
        const lost = winner != null && !won
        const isTR = !virtual && r.team && isTurkishTeam(r.team)
        const hi = id != null && hoverTeam === id
        return (
          <div
            key={i}
            onMouseEnter={() => id && onHoverTeam?.(id)}
            onMouseLeave={() => onHoverTeam?.(null)}
            style={{
              height: D.rowH, boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10,
              borderTop: i === 1 ? (virtual ? '1px dashed var(--line-2)' : '1px solid var(--line)') : 'none',
              background: hi ? FEXT.accentSoftBg : 'transparent',
              transition: 'background .15s',
            }}
          >
            {r.team
              ? <TeamAv src={r.team.logo_url} name={r.name} size={18} />
              : <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 5, border: '1px dashed var(--line-2)' }} />}
            <span
              title={r.team ? r.name : undefined}
              style={{
                flex: 1, minWidth: 0, fontSize: 12,
                fontWeight: won ? 800 : 600,
                color: !r.team ? 'var(--text-5)' : lost ? 'var(--text-4)' : 'var(--text-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {isTR && <TrBadge style={{ marginLeft: 0 }} />}{r.name}
            </span>
            <span style={{
              width: 30, alignSelf: 'stretch', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
              color: won ? FEXT.good : live ? FEXT.status.live.color : 'var(--text-4)',
              background: virtual ? 'transparent' : won ? `${FEXT.good}1f` : 'var(--surface-2)',
              borderLeft: virtual ? 'none' : '1px solid var(--line)',
            }}>
              {showScore ? (r.score ?? '–') : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
})

const SIDE_DOT = { upper: FEXT.accent, mid: FEXT.warn, lower: 'var(--text-4)' }

function BracketView({ layout: L, navigate, zoom = 1 }) {
  const [hoverTeam, setHoverTeam] = useState(null)
  const D = BRACKET_DIM

  return (
    // Aktif Turnuvalar şeridiyle aynı davranış: scrollbar gizli, fareyle sürükleme
    // + kenar oklarıyla kayma; sürükleme sonrası tıklama yutulur (maç açılmasın).
    <DragScroll ariaLabel="Turnuva ağacı" arrowAlign="top" style={{ display: 'block', paddingBottom: 4 }}>
      <div style={{ position: 'relative', width: L.width * zoom, height: L.height * zoom, flexShrink: 0 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0,
          width: L.width, height: L.height,
          transform: `scale(${zoom})`, transformOrigin: 'top left',
        }}>
          <svg
            width={L.width} height={L.height} aria-hidden="true"
            style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
          >
            {L.edges.map(e => {
              const hi = hoverTeam != null && e.team === hoverTeam
              return (
                <path
                  key={e.key}
                  d={e.d}
                  fill="none"
                  strokeLinejoin="round"
                  style={{
                    stroke: hi ? 'var(--accent-fg)' : 'var(--line-2)',
                    strokeWidth: hi ? 2.25 : 1.5,
                    strokeDasharray: e.verified ? undefined : '4 4',
                    transition: 'stroke .15s',
                  }}
                />
              )
            })}
          </svg>

          {L.sections.map(s => (
            <div key={s.side} style={{
              position: 'absolute', left: 0, top: s.y, height: D.secHead,
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, fontWeight: 800, color: 'var(--text-2)', whiteSpace: 'nowrap',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: SIDE_DOT[s.side] }} />
              {s.label}
            </div>
          ))}

          {L.headers.map(h => (
            <div key={`${h.x}-${h.y}`} style={{
              position: 'absolute', left: h.x, top: h.y, width: D.cardW, height: D.colHead - 10,
              boxSizing: 'border-box', borderBottom: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
              color: h.stage === 'gf' ? 'var(--accent-fg)' : 'var(--text-3)',
            }}>
              {h.stage === 'gf' && <Trophy size={12} />}
              {h.label}
            </div>
          ))}

          {L.cards.map(c => (
            <div key={c.m.id} style={{ position: 'absolute', left: c.x, top: c.y }}>
              <BracketMatchCard m={c.m} navigate={navigate} hoverTeam={hoverTeam} onHoverTeam={setHoverTeam} />
            </div>
          ))}

          {L.third && (
            <>
              <div style={{
                position: 'absolute', left: L.third.x, top: L.third.labelY, width: D.cardW, height: D.colHead - 10,
                boxSizing: 'border-box', borderBottom: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 800, color: 'var(--text-3)', whiteSpace: 'nowrap',
              }}>
                <Medal size={12} /> Üçüncülük Maçı
              </div>
              <div style={{ position: 'absolute', left: L.third.x, top: L.third.y }}>
                <BracketMatchCard m={L.third.m} navigate={navigate} hoverTeam={hoverTeam} onHoverTeam={setHoverTeam} />
              </div>
            </>
          )}
        </div>
      </div>
    </DragScroll>
  )
}

// ─── Match List Card ──────────────────────────────────────────────────────────

export const MatchListCard = memo(function MatchListCard({ m, navigate, gc }) {
  useTurkTakimlar()  // Türk takımı listesi yüklenince yeniden çiz
  const aId   = m.team_a?.id || m.team_a_id
  const bId   = m.team_b?.id || m.team_b_id
  const aWon  = m.status === 'finished' && m.winner_id === aId
  const bWon  = m.status === 'finished' && m.winner_id === bId
  const isLive= m.status === 'running'
  const isTRA = isTurkishTeam(m.team_a)
  const isTRB = isTurkishTeam(m.team_b)
  const hasTR = isTRA || isTRB

  return (
    <div
      {...clickableProps(() => navigate(`/match/${m.id}`), { label: `${m.team_a?.name ?? ''} - ${m.team_b?.name ?? ''} maç detayı` })}
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
          CANLI
        </div>
      )}

      <div style={{ padding: '14px 16px' }}>
        {/* Top: game + status + round */}
        <div style={{ display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
            {m.game?.name ?? ''}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {hasTR && <TurkishBadge compact />}
            {getBOFormat(m.team_a_score, m.team_b_score, m.number_of_games) && (
              <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8,
                background: 'rgba(96,165,250,.12)', border: '1px solid rgba(96,165,250,.3)',
                color: '#60a5fa', fontWeight: 700 }}>
                {getBOFormat(m.team_a_score, m.team_b_score, m.number_of_games)}
              </span>
            )}
            {roundLabel(m) && (
              <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8,
                background: `${gc}18`, border: `1px solid ${gc}44`, color: gc,
                fontWeight: 700 }}>
                {roundLabel(m)}
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
              {isTRA && <TrBadge />}{m.team_a?.name ?? '?'}
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
                {isLive ? 'CANLI' : 'VS'}
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
              {isTRB && <TrBadge />}{m.team_b?.name ?? '?'}
            </span>
          </div>
        </div>

        {/* AI tahmin çubuğu — yaklaşan/canlı maçlar (bitmişte skor zaten var) */}
        {m.status !== 'finished' && m.prediction_team_a != null && m.prediction_team_b != null && (() => {
          const predUncertain = isUncertainPrediction(m.prediction_team_a, m.prediction_team_b, m.prediction_confidence)
          const pA = Math.round(m.prediction_team_a * 100)
          return (
            <div style={{ marginTop: 10 }}>
              <div style={{ height: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
                <div style={{ width: `${pA}%`, height: '100%', background: predUncertain ? 'var(--track)' : 'linear-gradient(90deg,#667eea,#764ba2)', transition: 'width .5s', transformOrigin: 'left', animation: 'winBarFill .8s cubic-bezier(.2,.8,.3,1)' }} />
              </div>
              {predUncertain ? (
                <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 3, textAlign: 'center', fontWeight: 700, letterSpacing: '.4px' }}>FEXTOPUS · BELİRSİZ</div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 3, fontWeight: 700 }}>
                  <span style={{ color: m.prediction_team_a >= m.prediction_team_b ? '#818cf8' : 'var(--text-5)' }}>%{pA}</span>
                  <span style={{ color: 'var(--text-6)' }}>Fextopus</span>
                  <span style={{ color: m.prediction_team_b > m.prediction_team_a ? '#818cf8' : 'var(--text-5)' }}>%{100 - pA}</span>
                </div>
              )}
            </div>
          )
        })()}

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

/* ─── Aşama içeriği ───────────────────────────────────────────────────────────
 * Tek aşamanın (turnuva satırı) gövdesi: puan durumu, öne çıkan oyuncular, eleme
 * ağacı ya da aşama listesi, yaklaşan/geçmiş maç sekmeleri. Turnuva sayfası ve
 * lig sayfası (/lig/<slug>, her aşama için) ortak kullanır. `matches`
 * normalizeTurnuvaMaci ile hazırlanmış olmalı.
 */
export function AsamaIcerigi({ tournament, matches, navigate, gc, topPerformers = [], viewOverride = 'auto' }) {
  // Yaklaşan maç yoksa (bitmiş aşama) doğrudan sonuçlar açılsın
  const [activeTab,   setActiveTab]   = useState(() =>
    matches.some(m => ['not_started', 'running'].includes(m.status)) ? 'upcoming' : 'past')

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

  // Ağaç ancak doğrulanabiliyorsa çizilir; yoksa liste (yanlış ağaç göstermektense)
  const bracketModel = useMemo(() => buildBracketModel(matches, { tournament }), [matches, tournament])
  const bracketLayout = useMemo(() => (bracketModel.ok ? layoutBracket(bracketModel) : null), [bracketModel])
  // Açılış yakınlaştırması: ağaç sayfaya %80'e kadar küçülerek sığıyorsa sığdır;
  // dar ekranda %80 (yatay kaydırma yine var)
  const [bracketZoom, setBracketZoom] = useState(() => {
    if (typeof window === 'undefined' || !bracketLayout) return 1
    if (window.innerWidth < 640) return 0.8
    const alan = Math.min(window.innerWidth, 1100) - 76
    return bracketLayout.width <= alan ? 1 : clampBracketZoom(Math.max(0.8, Math.floor((alan / bracketLayout.width) * 100) / 100))
  })
  const effectiveViewMode = viewOverride !== 'list' && bracketModel.ok ? 'bracket' : 'list'
  // Ağaç benzeri veri var ama tutarsız → listenin üstünde kısa not
  const agacCizilemedi = !bracketModel.ok && !['lig-usulu', 'eleme-degil', 'bos'].includes(bracketModel.reason)
  const yerTutucuVar = bracketModel.ok && bracketModel.sides.some(s => s.columns.some(c => c.matches.some(m => m.is_virtual)))

  useEffect(() => {
    if (!TOURNAMENT_DEBUG) return
    console.log('[TournamentPage][Bracket]', {
      ok: bracketModel.ok, kind: bracketModel.kind, reason: bracketModel.reason, detail: bracketModel.detail,
      viewOverride, effectiveViewMode,
    })
  }, [bracketModel, viewOverride, effectiveViewMode])

  const zoomBtn = {
    width: 28, height: 28, borderRadius: 8, padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', cursor: 'pointer',
  }

  return (
    <>
      {/* ── STANDINGS (round-robin) ─────────────────────────────── */}
      {format !== 'elimination' && pastMatches.length > 0 && (
        <div style={{ marginBottom: 36 }}>
          <ST Icon={BarChart3} label="Puan Durumu" />
          <StandingsTable matches={pastMatches} navigate={navigate}
            cikanSayisi={stageMode.gsl ? 2 : 0} />
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

      {/* ── ELEME AĞACI ──────────────────────────────────────────── */}
      {effectiveViewMode === 'bracket' && (
        <div style={{ marginBottom: 36 }}>
          <ST Icon={bracketModel.kind === 'gsl' ? Swords : Trophy}
            label={bracketModel.kind === 'gsl' ? 'Grup Ağacı' : bracketModel.kind === 'double' ? 'Eleme Ağacı · Çift Eleme' : 'Eleme Ağacı'}
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button type="button" style={zoomBtn} aria-label="Uzaklaştır" title="Uzaklaştır"
                  onClick={() => setBracketZoom(z => clampBracketZoom(z - 0.1))}
                  disabled={bracketZoom <= BRACKET_MIN_ZOOM}>
                  <ZoomOut size={14} />
                </button>
                <button type="button" title="Yakınlaştırmayı sıfırla" aria-label="Yakınlaştırmayı sıfırla"
                  onClick={() => setBracketZoom(1)}
                  style={{ ...zoomBtn, width: 'auto', padding: '0 8px', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  %{Math.round(bracketZoom * 100)}
                </button>
                <button type="button" style={zoomBtn} aria-label="Yakınlaştır" title="Yakınlaştır"
                  onClick={() => setBracketZoom(z => clampBracketZoom(z + 0.1))}
                  disabled={bracketZoom >= BRACKET_MAX_ZOOM}>
                  <ZoomIn size={14} />
                </button>
              </div>
            }
          />
          <div style={{
            background: 'var(--bg)', borderRadius: 16,
            border: '1px solid var(--line)', padding: '14px 16px 12px',
          }}>
            <BracketView layout={bracketLayout} navigate={navigate} zoom={bracketZoom} />
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11, color: 'var(--text-5)' }}>
              <span className="hide-sm">Takımın üstüne gelince turnuvadaki yolu vurgulanır.</span>
              {yerTutucuVar && <span>Kesik çizgili kutular: rakipleri henüz belli olmayan maçlar.</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── AŞAMA LİSTESİ (ağaç çizilemeyen aşamalar) ─────────────── */}
      {effectiveViewMode === 'list' && matches.length > 0 && (
        <div style={{ marginBottom: 36 }}>
          <ST
            Icon={ClipboardList}
            label="Aşama Maçları"
          />
          <div style={{
            background: 'var(--bg)', borderRadius: 16,
            border: '1px solid var(--line)', padding: '16px',
          }}>
            {agacCizilemedi && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14,
                padding: '10px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5,
                background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text-3)',
              }}>
                <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>Bu aşamanın eşleşme ağacı veriden güvenilir biçimde çıkarılamadı; maçlar liste olarak gösteriliyor.</span>
              </div>
            )}
            <StageListView matches={matches} navigate={navigate} gc={gc} />
          </div>
        </div>
      )}

      {/* ── MATCH LIST ─────────────────────────────────────────── */}
      <div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {[
            { key: 'upcoming', label: 'Yaklaşan / Canlı', Icon: Radio, count: upcomingMatches.length },
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
    </>
  )
}

// ─── Ana Bileşen ──────────────────────────────────────────────────────────────

export default function TournamentPage() {
  const { tournamentId } = useParams()
  const navigate          = useNavigate()

  const [tournament,  setTournament]  = useState(null)
  const [matches,     setMatches]     = useState([])
  const [eventStages, setEventStages] = useState([])  // aynı serie'nin kardeş aşamaları (Group A / Playoffs …)
  const [lig,         setLig]         = useState(null) // kalıcı lig sayfası ({ slug, ad, yil, guncel }) — yoksa null
  const [topPerformers, setTopPerformers] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
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

      const normalizedMatches = (matchRes.data || []).map(normalizeTurnuvaMaci)

      setTournament(normalizedTournament)
      setMatches(normalizedMatches)

      // ── Etkinlik aşamaları: aynı serie_id'yi paylaşan kardeş turnuvalar ──
      // (PandaScore hiyerarşisi League→Serie→Tournament; "Group A/Playoffs" hepsi
      // aynı serie'dedir → aralarında gezinme şeridi. serie_id maçlarda saklı.)
      const serieId = (() => {
        const counts = {}
        for (const m of normalizedMatches) {
          if (m.serie_id != null) counts[m.serie_id] = (counts[m.serie_id] || 0) + 1
        }
        let best = null, bestN = 0
        for (const [sid, n] of Object.entries(counts)) if (n > bestN) { best = sid; bestN = n }
        return best
      })()
      if (serieId != null) {
        const { data: siblingRows } = await supabase
          .from('matches')
          .select('tournament_id, tournament:tournaments(id, name, begin_at)')
          .eq('serie_id', serieId)
          .not('tournament_id', 'is', null)
        const byId = new Map()
        for (const r of siblingRows || []) {
          const t = r.tournament
          if (t?.id != null && !byId.has(t.id)) byId.set(t.id, t)
        }
        const stages = [...byId.values()].sort((a, b) => {
          const ta = a.begin_at ? new Date(a.begin_at).getTime() : Infinity
          const tb = b.begin_at ? new Date(b.begin_at).getTime() : Infinity
          return ta - tb || String(a.name || '').localeCompare(String(b.name || ''))
        })
        setEventStages(stages.length > 1 ? stages : [])
      } else {
        setEventStages([])
      }

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

  // Lig bağlantısı ayrı ve sessiz: RPC yoksa ya da tutmazsa sayfa aynen çalışır
  useEffect(() => {
    let iptal = false
    turnuvaLigiGetir(tournamentId).then(l => { if (!iptal) setLig(l) })
    return () => { iptal = true }
  }, [tournamentId])

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

  // ── Stil değerleri ───────────────────────────────────────────
  const gName = tournament?.game?.name ?? ''
  // Ham slug ("Cs-Go"/"League-Of-Legends") yerine temiz oyun adı.
  const gameId = normalizeGameId(tournament?.game?.slug ?? gName)
  const gLabel = GAMES.find(g => g.id === gameId)?.label || gName || 'Esports'
  const gc    = gameColor(gName)
  const tier  = getTierMeta(tournament?.tier)
  const regionLabel = displayRegion(tournament?.region, gameId)
  const tournamentTitle = tournamentDisplayName(tournament, { game: gameId })
  const isTR  = tournament?.region === 'TR'
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
    <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center', color: 'var(--text-1)' }}>
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
        title={`${tournamentTitle} — Fikstür, Puan Durumu ve Sonuçlar`}
        description={`${tournamentTitle} espor turnuvası: maç programı, bracket, puan durumu ve sonuçlar — feXt.`}
        type="article"
        schema={tournament.begin_at ? {
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: tournamentTitle,
          sport: 'Esports',
          startDate: tournament.begin_at,
          endDate: tournament.end_at || undefined,
          eventStatus: 'https://schema.org/EventScheduled',
          eventAttendanceMode: liquipediaLocation
            ? 'https://schema.org/MixedEventAttendanceMode'
            : 'https://schema.org/OnlineEventAttendanceMode',
          location: liquipediaLocation
            ? { '@type': 'Place', name: liquipediaLocation, address: liquipediaLocation }
            : { '@type': 'VirtualLocation', url: typeof window !== 'undefined' ? window.location.href : undefined },
          description: `${tournamentTitle} espor turnuvası: maç programı, bracket, puan durumu ve sonuçlar.`,
          organizer: { '@type': 'Organization', name: 'feXt' },
          url: typeof window !== 'undefined' ? window.location.href : undefined,
        } : null}
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

        {isTR && (
          <div style={{ padding: '7px 0 0', display: 'flex', justifyContent: 'center' }}>
            <TurkishBadge />
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
            }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF4655' }} /> CANLI</span>
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

            {tournament.region && !isGenericStageName(tournament?.name) && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: 'var(--hover)', border: '1px solid var(--line-2)', color: 'var(--text-2)',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                <MapPin size={11} /> {String(regionLabel).toUpperCase()}
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
                {stageMode.gsl
                  ? <><Swords size={11} /> GSL · çift eleme</>
                  : format === 'roundrobin'
                    ? <><RefreshCw size={11} /> Lig Usulü</>
                    : <><Trophy size={11} /> Eleme</>}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 style={{
            margin: '0 0 10px', fontSize: 28, fontWeight: 900, lineHeight: 1.15,
            color: 'var(--text-1)',
          }}>{tournamentTitle}</h1>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14,
            fontSize: 12, color: 'var(--text-4)' }}>
            {(tournament.begin_at || tournament.end_at) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CalendarDays size={12} /> {fmtDate(tournament.begin_at)}
                {tournament.end_at && ` — ${fmtDate(tournament.end_at)}`}
              </span>
            )}
            {tournament.region && !isGenericStageName(tournament?.name) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MapPin size={12} /> {regionLabel}</span>}
            {tournament.prizepool && (
              <span style={{ color: '#FFD700', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Wallet size={12} /> {tournament.prizepool}
              </span>
            )}
          </div>

          {/* Kompakt Stat Chips */}
          <StatChips chips={[
            // Sayaçlar AYRIK olmalı (toplamları = Maç). "Yaklaşan" yalnız not_started;
            // canlı maçlar ayrı "Canlı" sayacında (upcomingMatches ikisini de içerir →
            // burada kullanılırsa canlı çift sayılır, 6 yerine 7 görünürdü).
            { Icon: Gamepad2,    label: 'Maç',      value: matches.length,                                        color: '#818cf8' },
            { Icon: CircleCheck, label: 'Yaklaşan', value: matches.filter(m => m.status === 'not_started').length, color: '#4CAF50' },
            { Icon: CircleCheck, label: 'Bitti',    value: pastMatches.length,                                    color: '#FF8C00' },
            { Icon: Radio,       label: 'Canlı',    value: matches.filter(m => m.status === 'running').length,     color: '#FF4655' },
          ]} />
        </div>
      </div>

      {/* ══════════════ CONTENT ════════════════════════════════════ */}
      <div style={{ padding: '0 20px', animation: 'fadeUp .3s ease' }}>

        {/* ── Kalıcı lig sayfası: eski etkinlikte "Güncel", güncelde "Tüm aşamalar" ── */}
        {lig?.slug && (
          <Link
            to={ligPath(lig.slug)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
              padding: '10px 14px', borderRadius: 12, textDecoration: 'none',
              background: FEXT.accentSoftBg, border: `1px solid ${FEXT.accentBorder}`,
              color: 'var(--text-1)', fontSize: 13, fontWeight: 700,
            }}
          >
            <CalendarDays size={15} color={FEXT.accentText} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {lig.guncel
                ? <>Tüm aşamalar tek sayfada: <span style={{ color: FEXT.accentText }}>{ligBaslik(lig)}</span></>
                : <>Güncel: <span style={{ color: FEXT.accentText }}>{ligBaslik(lig)}</span> fikstür ve puan durumu</>}
            </span>
            <ChevronRight size={16} color={FEXT.accentText} />
          </Link>
        )}

        {/* ── Etkinlik aşamaları arası gezinme (aynı serie: Group A / Play-In / Playoffs) ── */}
        {eventStages.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={12} /> Bu Etkinliğin Aşamaları
            </div>
            <div className="scroll-fade-x" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 3, scrollbarWidth: 'none' }}>
              {eventStages.map(s => {
                const isCurrent = String(s.id) === String(tournamentId)
                const label = cleanName(s.name, s.name || 'Aşama')
                return (
                  <button
                    key={s.id}
                    onClick={() => { if (!isCurrent) navigate(`/tournament/${s.id}`) }}
                    aria-current={isCurrent ? 'page' : undefined}
                    style={{
                      flexShrink: 0, cursor: isCurrent ? 'default' : 'pointer',
                      padding: '7px 13px', minHeight: 36, borderRadius: 999,
                      fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                      border: isCurrent ? `1px solid ${FEXT.accentBorder}` : '1px solid var(--line-2)',
                      background: isCurrent ? FEXT.accentSoftBg : 'var(--surface)',
                      color: isCurrent ? FEXT.accentText : 'var(--text-2)',
                    }}
                    onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.borderColor = FEXT.accentBorder }}
                    onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.borderColor = 'var(--line-2)' }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

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
            Current: {viewOverride}
          </span>
        </div>}

        <AsamaIcerigi
          tournament={tournament}
          matches={matches}
          navigate={navigate}
          gc={gc}
          topPerformers={topPerformers}
          viewOverride={viewOverride}
        />
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