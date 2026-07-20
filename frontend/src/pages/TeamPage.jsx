import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link }     from 'react-router-dom'
import { supabase }                         from '../supabaseClient'
import { getRoleBadge }                     from '../utils/roleHelper'
import { isTurkishTeam }                   from '../constants'
import { useUser }                          from '../context/UserContext'
import InitialsImage                        from '../components/InitialsImage'
import { getBOFormat }                       from '../utils/matchFormat'
import { deriveWinnerTeamId, matchOutcome, correctedScores } from '../utils/matchResult'
import {
  Radio, CircleCheck, X as XIcon, Trophy, Star, MapPin, Flame, Swords, Users,
  Handshake, CalendarDays, ClipboardList, TriangleAlert, Video, AtSign,
  Globe, Music, Gamepad2, Link as LinkIcon, Clock, Info,
} from 'lucide-react'
import { FEXT } from '../theme'
import Mascot from '../components/Mascot'
import SeoHead from '../components/SeoHead'

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
  return <div style={{ width: w, height: h, borderRadius: r, background: 'linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
}

// ── Form pill ─────────────────────────────────────────────────────────────────
function FormPill({ result }) {
  const cfg = {
    W: { bg: 'rgba(76,175,80,.25)',  border: '#4CAF50', color: '#4CAF50', label: 'W' },
    L: { bg: 'rgba(255,70,85,.2)',   border: '#FF4655', color: '#FF4655', label: 'L' },
    D: { bg: 'rgba(150,150,150,.15)',border: 'var(--text-4)',    color: 'var(--text-4)',    label: 'D' },
  }[result] ?? { bg: 'var(--surface)', border: 'var(--text-6)', color: 'var(--text-4)', label: '?' }

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
function StatBox({ Icon, value, label, color = '#fff' }) {
  return (
    <div style={{
      textAlign: 'center', padding: '16px 20px', minWidth: 90,
      background: 'var(--surface)', borderRadius: 14,
      border: '1px solid var(--surface-2)',
    }}>
      <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'center' }}>{Icon && <Icon size={20} color={color} />}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-5)', marginTop: 4 }}>{label}</div>
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
        <span style={{ color: 'var(--text-4)' }}>Kazanma Oranı</span>
        <span style={{ color, fontWeight: 800 }}>{pct}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface)', overflow: 'hidden' }}>
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
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line)', display: 'block' }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg,var(--surface-2),var(--line))',
      border: '2px solid var(--text-6)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size * 0.3, fontWeight: 800,
      color: 'var(--text-4)', flexShrink: 0,
    }}>{initials}</div>
  )
}

const NAT_FLAGS = {
  TR: '🇹🇷', US: '🇺🇸', DE: '🇩🇪', FR: '🇫🇷', BR: '🇧🇷',
  KR: '🇰🇷', CN: '🇨🇳', RU: '🇷🇺', GB: '🇬🇧', SE: '🇸🇪',
  DK: '🇩🇰', FI: '🇫🇮', NO: '🇳🇴', PL: '🇵🇱', PT: '🇵🇹',
}

const SOCIAL_ICON_MAP = {
  twitter: { Icon: AtSign, label: 'X/Twitter' },
  twitch: { Icon: Video, label: 'Twitch' },
  youtube: { Icon: Video, label: 'YouTube' },
  instagram: { Icon: Globe, label: 'Instagram' },
  tiktok: { Icon: Music, label: 'TikTok' },
  steam: { Icon: Gamepad2, label: 'Steam' },
}

function getPlayerSocials(player) {
  const links = player?.extra_metadata?.liquipedia?.social_links || {}
  return Object.entries(links)
    .filter(([_, href]) => typeof href === 'string' && href.trim())
    .slice(0, 4)
}

function parseTransferDate(value) {
  if (!value) return null
  const t = Date.parse(value)
  if (Number.isNaN(t)) return null
  return new Date(t)
}

// Transferler `roster_changes` tablosundan gelir (Liquipedia v3/wikitext ETL).
// IN/OUT bu takıma göre: target_team_id === bu takım → katıldı (IN); source → ayrıldı (OUT).
function mapRosterChanges(rows, teamIdNum) {
  return (rows || [])
    .map(row => {
      const p = row?.raw_payload || {}
      const isIncoming = Number(row?.target_team_id) === teamIdNum
      const dateObj = parseTransferDate(row?.transfer_date || p?.date)
      return {
        dateRaw: row?.transfer_date || p?.date || null,
        dateObj,
        player: p?.player || 'Bilinmiyor',
        role: p?.role || null,
        changeType: isIncoming ? 'in' : 'out',
        oldTeam: p?.old_team || null,
        newTeam: p?.new_team || null,
      }
    })
    .sort((a, b) => {
      const at = a.dateObj ? a.dateObj.getTime() : 0
      const bt = b.dateObj ? b.dateObj.getTime() : 0
      return bt - at
    })
    .slice(0, 8)
}

function TransferTimeline({ transfers }) {
  if (!transfers.length) {
    return (
      <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--surface-2)', color: 'var(--text-5)', fontSize: 12, textAlign: 'center' }}>
        Transfer akisi henuz bulunamadi.
      </div>
    )
  }

  return (
    <div style={{ marginTop: 18, background: 'linear-gradient(160deg, rgba(200,16,46,.14), rgba(0,0,0,0) 48%)', border: '1px solid rgba(200,16,46,.28)', borderRadius: 14, padding: '16px 14px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: '.8px', color: '#ffd9de', textTransform: 'uppercase' }}>Son Transferler</div>
        <div style={{ fontSize: 11, color: '#ff9cab' }}>Transfer Market</div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {transfers.map((item, index) => {
          const isIncoming = item.changeType.includes('join') || item.changeType.includes('add') || item.changeType.includes('in')
          const accent = isIncoming ? '#22c55e' : '#FF4655'
          const label = isIncoming ? 'IN' : 'OUT'
          const dateLabel = item.dateObj
            ? item.dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
            : (item.dateRaw || '—')

          return (
            <div key={`${item.player}-${index}`} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 12, alignItems: 'stretch' }}>
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 8, background: accent, boxShadow: `0 0 12px ${accent}AA` }} />
                {index < transfers.length - 1 && (
                  <div style={{ position: 'absolute', top: 22, width: 2, bottom: -10, background: 'linear-gradient(180deg, rgba(255,255,255,.28), var(--hover))' }} />
                )}
              </div>

              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: '9px 11px', display: 'grid', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)' }}>{item.player}</div>
                  <span style={{ fontSize: 10, fontWeight: 800, color: accent, border: `1px solid ${accent}77`, borderRadius: 999, padding: '2px 7px', background: `${accent}1A` }}>{label}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {item.oldTeam && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>From: {item.oldTeam}</span>}
                  {item.newTeam && <span style={{ fontSize: 11, color: 'var(--text-1)' }}>To: {item.newTeam}</span>}
                  {item.role && <span style={{ fontSize: 10, color: '#ffadb8', border: '1px solid rgba(200,16,46,.35)', borderRadius: 7, padding: '1px 6px' }}>{item.role}</span>}
                  <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 'auto' }}>{dateLabel}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── PlayerCard ────────────────────────────────────────────────────────────────
function PlayerCard({ player }) {
  const navigate = useNavigate()          // ← navigate hook ekle
  const badge    = getRoleBadge(player.role)
  const natCode = String(player.nationality || '').toUpperCase()
  const flag = NAT_FLAGS[natCode]
  const socials = getPlayerSocials(player)

  return (
    <div
      onClick={() => player.id && navigate(`/player/${player.id}`)}  // ← tıklanabilir
      style={{
        background: 'var(--surface)', borderRadius: 14,
        border: '1px solid var(--surface-2)', padding: '18px 14px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        transition: 'border-color .2s, transform .2s',
        cursor: player.id ? 'pointer' : 'default',   // ← cursor
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = player.id ? badge.border : 'var(--surface-2)'
        e.currentTarget.style.transform   = player.id ? 'translateY(-4px)' : 'none'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--surface-2)'
        e.currentTarget.style.transform   = 'none'
      }}
    >
      <PlayerAvatar src={player.image_url} name={player.nickname} size={64} />

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.3 }}>{player.nickname}</div>
        {player.real_name && (
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>{player.real_name}</div>
        )}
        {flag && (
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>{flag} {natCode}</div>
        )}
      </div>

      {player.role ? (
        <div style={{
          padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: badge.bg, border: `1px solid ${badge.border}`,
          color: badge.color, letterSpacing: '.5px', textTransform: 'capitalize',
        }}>{badge.label}</div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-6)' }}>—</div>
      )}

      {/* K/D — hybrid v3 verisi (varsa) */}
      {player.kd != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: -2 }}>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>K/D</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: player.kd >= 1 ? '#4ade80' : '#ff6a7f', fontVariantNumeric: 'tabular-nums' }}>
            {player.kd.toFixed(2)}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-5)' }}>({player.statMatches} maç)</span>
        </div>
      )}

      {/* Profil linki göstergesi */}
      {player.id && (
        <div style={{ fontSize: 9, color: 'var(--text-6)', marginTop: -4 }}>profili gör →</div>
      )}

      {socials.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {socials.map(([network, href]) => {
            const meta = SOCIAL_ICON_MAP[network] || { Icon: LinkIcon, label: network }
            return (
              <a
                key={network}
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                title={meta.label}
                style={{
                  width: 24, height: 24, borderRadius: 999,
                  display: 'grid', placeItems: 'center',
                  textDecoration: 'none',
                  border: '1px solid rgba(200,16,46,.45)',
                  background: 'radial-gradient(circle at 30% 30%, rgba(200,16,46,.45), rgba(0,0,0,.86))',
                  color: '#fff', fontSize: 11, fontWeight: 800,
                }}
              >
                {meta.Icon && <meta.Icon size={12} />}
              </a>
            )
          })}
        </div>
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
  const cs       = correctedScores(match)
  const myScore  = isTeamA ? cs.team_a_score  : cs.team_b_score
  const oppScore = isTeamA ? cs.team_b_score  : cs.team_a_score
  const isFin    = match.status === 'finished'
  const isLive   = match.status === 'running'
  const winnerTeam = isFin ? deriveWinnerTeamId(match) : null
  const isWin    = winnerTeam != null && winnerTeam === Number(tid)
  const isLoss   = winnerTeam != null && winnerTeam !== Number(tid)
  const hasPred  = match.prediction_team_a != null && match.prediction_team_b != null
  const myPred   = hasPred ? (isTeamA ? match.prediction_team_a : match.prediction_team_b) : null
  const oppPred  = hasPred ? (isTeamA ? match.prediction_team_b : match.prediction_team_a) : null

  return (
    <div
      onClick={() => navigate(`/match/${match.id}`)}
      style={{
        background: 'var(--surface)', borderRadius: 14, padding: '14px 16px',
        border: isWin  ? '1.5px solid rgba(76,175,80,.5)'
              : isLoss ? '1.5px solid rgba(255,70,85,.35)'
              : isLive ? '1.5px solid rgba(255,70,85,.6)'
              : '1.5px solid var(--surface-2)',
        boxShadow: isLive ? '0 0 14px rgba(255,70,85,.18)' : 'none',
        cursor: 'pointer',
        transition: 'transform .2s, border-color .2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = '#FF4655' }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'none'
        e.currentTarget.style.borderColor = isWin ? 'rgba(76,175,80,.5)' : isLoss ? 'rgba(255,70,85,.35)' : isLive ? 'rgba(255,70,85,.6)' : 'var(--surface-2)'
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-5)', letterSpacing: '.5px' }}>
            {match.game?.name === 'Counter-Strike 2' ? 'CS2' : match.game?.name === 'League of Legends' ? 'LoL' : (match.game?.name ?? '?')}
          </span>
          {getBOFormat(match.team_a_score, match.team_b_score, match.number_of_games) && (
            <span style={{ fontSize: 9, fontWeight: 700, color: '#60a5fa', background: 'rgba(96,165,250,.12)', border: '1px solid rgba(96,165,250,.3)', borderRadius: 5, padding: '1px 6px' }}>
              {getBOFormat(match.team_a_score, match.team_b_score, match.number_of_games)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isLive && (
            <span style={{ fontSize: 10, fontWeight: 800, color: '#FF4655', animation: 'pulse 1.5s infinite', display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF4655' }} /> LIVE</span>
          )}
          {isFin && (
            <span style={{
              fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 6,
              background: isWin ? 'rgba(76,175,80,.2)' : isLoss ? 'rgba(255,70,85,.2)' : 'rgba(100,100,100,.15)',
              color: isWin ? '#4CAF50' : isLoss ? '#FF4655' : 'var(--text-3)',
              border: `1px solid ${isWin ? 'rgba(76,175,80,.4)' : isLoss ? 'rgba(255,70,85,.4)' : 'var(--text-6)'}`,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {isWin ? <><CircleCheck size={11} /> WIN</> : isLoss ? <><XIcon size={11} /> LOSS</> : '— DRAW'}
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
            : <div style={{ width: 32, height: 32, background: 'var(--surface-2)', borderRadius: 6, flexShrink: 0 }} />
          }
          <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isWin ? '#4CAF50' : 'var(--text-1)' }}>
            {myTeam?.name}
          </span>
        </div>

        {/* Score */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          {isFin ? (
            <div style={{ fontSize: 18, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: 'var(--text-1)' }}>
              <span style={{ color: isWin ? '#4CAF50' : isLoss ? '#FF4655' : 'var(--text-3)' }}>{myScore ?? 0}</span>
              <span style={{ color: 'var(--line)', margin: '0 4px' }}>:</span>
              <span style={{ color: isLoss ? '#4CAF50' : isWin ? 'var(--text-3)' : 'var(--text-3)' }}>{oppScore ?? 0}</span>
            </div>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-6)' }}>VS</span>
          )}
        </div>

        {/* Opponent */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-4)', textAlign: 'right' }}>
            {opp?.name}
          </span>
          {opp?.logo_url
            ? <img src={opp.logo_url} alt="" style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }} />
            : <div style={{ width: 32, height: 32, background: 'var(--surface-2)', borderRadius: 6, flexShrink: 0 }} />
          }
        </div>
      </div>

      {/* AI Win bar */}
      {hasPred && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--surface)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(myPred * 100)}%`, height: '100%', background: 'linear-gradient(90deg,#667eea,#764ba2)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 3, color: 'var(--text-5)' }}>
            <span style={{ color: myPred >= oppPred ? '#818cf8' : 'var(--text-5)' }}>{Math.round(myPred * 100)}%</span>
            <span style={{ color: 'var(--text-5)' }}>AI</span>
            <span style={{ color: oppPred > myPred ? '#818cf8' : 'var(--text-5)' }}>{Math.round(oppPred * 100)}%</span>
          </div>
        </div>
      )}

      {/* Bottom */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--surface-2)', paddingTop: 8, gap: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--text-6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Trophy size={11} style={{ flexShrink: 0 }} /> {match.tournament?.name ?? '—'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-5)', flexShrink: 0 }}>
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
  const [teamTransfers, setTeamTransfers] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [activeTab, setActiveTab] = useState('roster')
  const [gameFilter, setGameFilter] = useState('all')

  // ── Veri çekme ──────────────────────────────────────────────────
  const fetchTeamData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [teamRes, matchRes, playerRes, rosterChangesRes] = await Promise.all([
        supabase.from('teams').select('*').eq('id', teamId).single(),

        supabase.from('matches').select(`
          id, status, scheduled_at,
          team_a_id, team_b_id, winner_id,
          team_a_score, team_b_score, number_of_games,
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
          .select('id, nickname, real_name, role, image_url, nationality, extra_metadata')
          .eq('team_pandascore_id', parseInt(teamId))
          .order('role'),

        // Transferler: roster_changes tablosu (bu takıma giren/çıkan oyuncular)
        supabase.from('roster_changes')
          .select('source_team_id, target_team_id, transfer_date, transfer_type, raw_payload')
          .or(`source_team_id.eq.${parseInt(teamId)},target_team_id.eq.${parseInt(teamId)}`)
          .order('transfer_date', { ascending: false })
          .limit(30),
      ])

      if (teamRes.error)   throw teamRes.error
      if (matchRes.error)  throw matchRes.error

      setTeam(teamRes.data)
      setMatches(matchRes.data || [])
      setTeamTransfers(mapRosterChanges(rosterChangesRes?.data, parseInt(teamId)))
      const roster = playerRes.data || []
      setPlayers(roster)

      // Roster oyuncularının K/D'sini player_match_stats'ten (hybrid v3) çek — varsa
      const pids = roster.map(p => p.id).filter(Boolean)
      if (pids.length > 0) {
        const { data: pms } = await supabase
          .from('player_match_stats')
          .select('player_id,kills,deaths')
          .in('player_id', pids)
          .not('kills', 'is', null)
        if (pms?.length) {
          const acc = {}
          for (const r of pms) {
            const s = acc[r.player_id] || { k: 0, d: 0, n: 0 }
            s.k += Number(r.kills) || 0
            s.d += Number(r.deaths) || 0
            s.n += 1
            acc[r.player_id] = s
          }
          setPlayers(roster.map(p => {
            const s = acc[p.id]
            return (s && s.n > 0) ? { ...p, kd: s.d > 0 ? s.k / s.d : s.k, statMatches: s.n } : p
          }))
        }
      }
    } catch (e) {
      console.error('TeamPage fetch:', e?.message || e)
      setError('Takım bulunamadı.')
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => { fetchTeamData() }, [fetchTeamData])

  // ── Türevler ──────────────────────────────────────────────────
  const upcomingMatches = matches.filter(m => ['not_started', 'running'].includes(m.status))
  const pastMatches     = matches.filter(m => m.status === 'finished')
  const tidNum          = parseInt(teamId)
  const wins            = pastMatches.filter(m => deriveWinnerTeamId(m) === tidNum).length
  const losses          = pastMatches.filter(m => { const w = deriveWinnerTeamId(m); return w != null && w !== tidNum }).length
  const draws           = pastMatches.length - wins - losses
  const rating          = calcTeamRating(wins, wins + losses)
  const isTR            = isTurkishTeam(team?.name ?? '')

  // Last 10 matches form
  const form = [...pastMatches]
    .slice(0, 10)
    .map(m => matchOutcome(m, tidNum))

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
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Mascot size={86} dim /></div>
      <div style={{ fontSize: 16, marginBottom: 20 }}>{error ?? 'Takım bulunamadı'}</div>
      <button onClick={() => navigate(-1)} style={{ padding: '10px 24px', background: FEXT.accentGrad, border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
        ← Geri
      </button>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 80px', color: 'var(--text-1)' }}>
      <SeoHead
        title={`${team.name} — Kadro, Maçlar ve İstatistikler`}
        description={`${team.name} espor takımı: güncel kadro, son maç sonuçları, kazanma oranı, transferler ve istatistikler — feXt.`}
        image={team.logo_url || ''}
        type="profile"
        schema={{
          '@context': 'https://schema.org',
          '@type': 'SportsTeam',
          name: team.name,
          sport: 'Esports',
          logo: team.logo_url || undefined,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
        }}
      />

      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.5} }
      `}</style>

      {/* ═══ HEADER KAPAK ═══════════════════════════════════════════ */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(160deg, var(--surface) 0%, var(--surface) 100%)',
        borderBottom: isTR ? '1px solid rgba(200,16,46,.4)' : '1px solid var(--surface-2)',
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
            background: 'rgba(255,255,255,.06)', border: '1px solid var(--line)',
            borderRadius: 8, color: 'var(--text-3)', padding: '6px 12px',
            fontSize: 12, cursor: 'pointer', transition: 'all .15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
        >← Geri</button>

        {/* Fav button */}
        <button
          onClick={handleToggleFav}
          style={{
            position: 'absolute', top: 16, right: 20,
            background: isFav ? 'rgba(255,215,0,.15)' : 'rgba(255,255,255,.06)',
            border: isFav ? '1px solid rgba(255,215,0,.5)' : '1px solid var(--line)',
            borderRadius: 8, color: isFav ? '#FFD700' : 'var(--text-4)',
            padding: '6px 14px', fontSize: 13, cursor: 'pointer',
            transition: 'all .15s', fontWeight: isFav ? 700 : 400,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        ><Star size={14} fill={isFav ? '#FFD700' : 'none'} color={isFav ? '#FFD700' : 'currentColor'} /> {isFav ? 'Favori' : 'Favoriye Ekle'}</button>

        {/* Team identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 24 }}>
          {/* Logo */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <InitialsImage
              src={team.logo_url}
              name={team.name}
              width={100} height={100}
              borderRadius={16}
              imgStyle={{ objectFit: 'contain', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.7))' }}
            />
            {isTR && (
              <span style={{ position: 'absolute', bottom: -2, right: -2, fontSize: 20 }}>🇹🇷</span>
            )}
          </div>

          {/* Name + meta */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{
                margin: 0, fontSize: 'clamp(22px, 6vw, 34px)', fontWeight: 900, lineHeight: 1.1,
                overflowWrap: 'anywhere', minWidth: 0,
                background: isTR
                  ? 'linear-gradient(135deg,#fff,#ff6b7a)'
                  : 'linear-gradient(135deg,#fff,var(--text-3))',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>{team.name}</h1>
              {team.acronym && (
                <span style={{ fontSize: 16, color: 'var(--text-4)', fontWeight: 700 }}>({team.acronym})</span>
              )}
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {team.location && (
                <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <MapPin size={12} /> {team.location}
                </span>
              )}
              {isTR && (
                <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800, background: 'rgba(200,16,46,.2)', border: '1px solid rgba(200,16,46,.5)', color: '#ff6b7a' }}>
                  🇹🇷 Turkish Team
                </span>
              )}
              <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.4)', color: '#818cf8', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Star size={12} fill="#818cf8" /> Rating {rating}
              </span>
            </div>

            {/* Form strip */}
            {form.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, color: 'var(--text-5)', marginBottom: 6, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
                  Son Form ({form.length} maç)
                  {streak && streak.count >= 3 && (
                    <span style={{
                      marginLeft: 10, fontSize: 10, fontWeight: 800,
                      color: streak.type === 'W' ? '#4CAF50' : '#FF4655',
                      padding: '2px 8px', borderRadius: 6,
                      background: streak.type === 'W' ? 'rgba(76,175,80,.15)' : 'rgba(255,70,85,.15)',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      <Flame size={11} /> {streak.count} {streak.type === 'W' ? 'Galibiyet' : 'Mağlubiyet'} serisi
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
          <StatBox Icon={Swords}      value={wins + losses}          label="Total Maç"   color="var(--text-3)"  />
          <StatBox Icon={CircleCheck} value={wins}                   label="Galibiyet"   color="#4CAF50"  />
          <StatBox Icon={XIcon}       value={losses}                 label="Mağlubiyet"  color="#FF4655"  />
          {draws > 0 && <StatBox Icon={Handshake} value={draws}      label="Beraberlik (Bo2)" color="#FFB800" />}
          <StatBox Icon={Clock}       value={upcomingMatches.length} label="Yaklaşan"    color="var(--text-3)"  />
          <StatBox Icon={Users}       value={players.length}         label="Oyuncu"      color="#818cf8"  />
        </div>

        {/* Win rate bar */}
        <div style={{ maxWidth: 360, marginTop: 8 }}>
          <WinRateBar wins={wins} total={wins + losses} />
        </div>
      </div>

      {/* ═══ TABS ════════════════════════════════════════════════════ */}
      <div style={{ padding: '0 20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--surface-2)', paddingBottom: 12 }}>
          {[
            { key: 'roster',   label: 'Kadro',    Icon: Users,       count: players.length },
            { key: 'upcoming', label: 'Upcoming', Icon: Clock,       count: upcomingMatches.length },
            { key: 'past',     label: 'Geçmiş',   Icon: CircleCheck, count: pastMatches.length },
          ].map(t => {
            const active = activeTab === t.key
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 18px', borderRadius: 10,
                border: active ? `1.5px solid ${FEXT.accent}` : '1.5px solid var(--surface-2)',
                background: active ? FEXT.accentSoftBg : 'var(--surface)',
                color: active ? FEXT.accentText : 'var(--text-4)',
                fontSize: 13, fontWeight: active ? 800 : 500,
                cursor: 'pointer', transition: 'all .18s',
              }}>
                {t.Icon && <t.Icon size={14} />}
                {t.label}
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: active ? FEXT.accentSoftBg : 'var(--surface-2)', color: active ? FEXT.accentText : 'var(--text-4)' }}>
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
            <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-5)' }}>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Users size={38} color="var(--text-6)" /></div>
              <div>Kadro verisi henüz senkronize edilmedi</div>
            </div>
          ) : (
            <div>
              {players.length > 7 && (
                <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,184,0,.06)', border: '1px solid rgba(255,184,0,.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TriangleAlert size={14} color="#FFB800" />
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    Bu kadroda {players.length} oyuncu görünüyor. Bazıları transfer olmuş olabilir; güncel kadro yakında yansıyacak.
                  </span>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
                {players.map((p, i) => <PlayerCard key={p.id ?? i} player={p} />)}
              </div>

              <TransferTimeline transfers={teamTransfers} />

              <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--surface-2)', fontSize: 12, color: 'var(--text-5)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Info size={13} style={{ flexShrink: 0 }} /> Oyuncu K/D verisi Liquipedia kapsamındaki maçlardan hesaplanır; kadro büyüdükçe zenginleşir
              </div>
            </div>
          )
        )}

        {/* ── UPCOMING & PAST ── */}
        {(activeTab === 'upcoming' || activeTab === 'past') && (() => {
          const source = activeTab === 'upcoming' ? upcomingMatches : pastMatches
          // Çok-oyunlu org'lar için oyun filtresi (Valorant/CS2/LoL karışık gelir)
          const games = [...new Set(source.map(m => m.game?.name).filter(Boolean))]
          const list = gameFilter === 'all' ? source : source.filter(m => m.game?.name === gameFilter)
          return (
            <>
              {games.length > 1 && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  {['all', ...games].map(g => {
                    const active = gameFilter === g
                    return (
                      <button key={g} onClick={() => setGameFilter(g)} style={{
                        padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        border: active ? `1px solid ${FEXT.accent}` : '1px solid var(--line)',
                        background: active ? FEXT.accentSoftBg : 'var(--surface)',
                        color: active ? FEXT.accentText : 'var(--text-3)',
                      }}>
                        {g === 'all' ? `Tümü (${source.length})` : `${g} (${source.filter(m => m.game?.name === g).length})`}
                      </button>
                    )
                  })}
                </div>
              )}
              {activeTab === 'past' && team?.name && (
                <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-4)' }}>
                  Son {source.length} maç gösteriliyor.{' '}
                  <Link to={`/matches?q=${encodeURIComponent(team.name)}&tab=past`} style={{ color: '#9db4ff', textDecoration: 'none', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <CalendarDays size={12} /> Tüm geçmişi (yıla göre) ara →
                  </Link>
                </div>
              )}
              {list.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-5)' }}>
                  <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>{activeTab === 'upcoming' ? <CalendarDays size={38} color="var(--text-6)" /> : <ClipboardList size={38} color="var(--text-6)" />}</div>
                  <div>{activeTab === 'upcoming' ? 'Planlanmış maç yok' : 'Geçmiş maç yok'}</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                  {list.map(m => <MatchCard key={m.id} match={m} teamId={teamId} navigate={navigate} />)}
                </div>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}