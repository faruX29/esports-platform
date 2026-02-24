import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate }                              from 'react-router-dom'
import { supabase }                                 from './supabaseClient'
import { useGame }                                  from './GameContext'
import { getFavorites, toggleFavorite }             from './favoritesHelper'

/* ─── Yardımcılar ───────────────────────────────────────────────────────────── */
function gameColor(n = '') {
  const s = n.toLowerCase()
  if (s.includes('valorant'))                     return '#FF4655'
  if (s.includes('counter') || s.includes('cs'))  return '#F0A500'
  if (s.includes('league'))                       return '#C89B3C'
  return '#6366f1'
}

/**
 * Rating = (Wins × 3) + (WinRate × 100)
 * Minimum maç eşiği dışarıda uygulanır (≥ 5 maç).
 */
function calcRating(wins, winRate) {
  return Math.round(wins * 3 + winRate * 100)
}

function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(90deg,#111 25%,#1a1a1a 50%,#111 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
    }} />
  )
}

/* ─── Tooltip ───────────────────────────────────────────────────────────────── */
function RatingTooltip() {
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setVisible(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={e => { e.stopPropagation(); setVisible(v => !v) }}
        style={{
          background: 'none', border: '1px solid #2a2a2a', borderRadius: '50%',
          width: 16, height: 16, cursor: 'pointer', fontSize: 9, color: '#555',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1, padding: 0, marginLeft: 5, transition: 'border-color .15s,color .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color='#aaa'; e.currentTarget.style.borderColor='#555' }}
        onMouseLeave={e => { e.currentTarget.style.color='#555'; e.currentTarget.style.borderColor='#2a2a2a' }}
        title="Nasıl hesaplanır?"
      >?</button>

      {visible && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%',
          transform: 'translateX(-50%)',
          background: '#161616', border: '1px solid #2a2a2a', borderRadius: 10,
          padding: '12px 14px', width: 230, zIndex: 9999,
          boxShadow: '0 8px 32px rgba(0,0,0,.8)',
          pointerEvents: 'none',
        }}>
          <div style={{
            position: 'absolute', bottom: -6, left: '50%',
            width: 10, height: 10, background: '#161616',
            border: '1px solid #2a2a2a', borderTop: 'none', borderLeft: 'none',
            transform: 'translateX(-50%) rotate(45deg)',
          }} />
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            📐 Rating Formülü
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 12, color: '#c084fc',
            background: 'rgba(192,132,252,.08)', borderRadius: 6,
            padding: '6px 10px', marginBottom: 8,
          }}>
            (Wins × 3) + (Win% × 100)
          </div>
          <div style={{ fontSize: 10, color: '#555', lineHeight: 1.7 }}>
            <span style={{ color: '#4CAF50' }}>Wins × 3</span> → hacim ödülü<br />
            <span style={{ color: '#60a5fa' }}>Win% × 100</span> → kalite çarpanı<br />
            <span style={{ color: '#888' }}>Min 5 maç</span> → listeleme eşiği
          </div>
        </div>
      )}
    </span>
  )
}

/* ─── FavStar ───────────────────────────────────────────────────────────────── */
function FavStar({ teamId, favs, onToggle }) {
  const active = favs.includes(teamId)
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(teamId) }}
      title={active ? 'Favoriden çıkar' : 'Favoriye ekle'}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 16, lineHeight: 1, padding: '2px 4px',
        color: active ? '#FFD700' : '#2a2a2a',
        transition: 'color .15s,transform .15s', flexShrink: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.color = active?'#FFD700':'#555'; e.currentTarget.style.transform='scale(1.25)' }}
      onMouseLeave={e => { e.currentTarget.style.color = active?'#FFD700':'#2a2a2a'; e.currentTarget.style.transform='scale(1)' }}
    >{active ? '⭐' : '☆'}</button>
  )
}

/* ─── Rankings — default export ─────────────────────────────────────────────── */
export default function Rankings() {
  const navigate       = useNavigate()
  const { activeGame } = useGame()

  const [teams,   setTeams]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [favs,    setFavs]    = useState(() => getFavorites())
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState('rating')

  /* ── Veri Çekme: SADECE matches tablosu ────────────────────────────────── */
  const fetchRankings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      /*
       * matches tablosundan direkt oku — match_stats'a bağımlılık YOK.
       * Vitality gibi istatistik tablosunda kaydı olmayan takımlar da gelir.
       */
      const { data: matchData, error: matchErr } = await supabase
        .from('matches')
        .select(`
          id,
          team_a_id, team_b_id, winner_id,
          team_a:teams!matches_team_a_id_fkey(id, name, logo_url, acronym),
          team_b:teams!matches_team_b_id_fkey(id, name, logo_url, acronym),
          game:games(name)
        `)
        .eq('status', 'finished')
        .not('winner_id', 'is', null)       // kazananı belli olmayan maçları atla
        .limit(8000)                         // büyük havuz → daha fazla takım
      if (matchErr) throw matchErr

      /* ── Takım bazlı istatistik map'i ── */
      const map = {}

      const ensureTeam = (teamObj, gameName) => {
        if (!teamObj?.id) return
        const tid = teamObj.id
        if (!map[tid]) {
          map[tid] = {
            team:   teamObj,
            wins:   0,
            losses: 0,
            total:  0,
            game:   gameName || '',
          }
        }
        // Oyun adını ilk karşılaşılana göre doldur
        if (!map[tid].game && gameName) map[tid].game = gameName
      }

      for (const m of (matchData || [])) {
        const gName = m.game?.name || ''
        ensureTeam(m.team_a, gName)
        ensureTeam(m.team_b, gName)

        if (m.team_a?.id) {
          map[m.team_a.id].total++
          if (m.winner_id === m.team_a.id) map[m.team_a.id].wins++
          else map[m.team_a.id].losses++
        }
        if (m.team_b?.id) {
          map[m.team_b.id].total++
          if (m.winner_id === m.team_b.id) map[m.team_b.id].wins++
          else map[m.team_b.id].losses++
        }
      }

      /* ── WinRate + Rating hesapla ── */
      let arr = Object.values(map)
        .filter(t => t.total >= 5)                    // min 5 maç eşiği
        .map(t => {
          const winRate = t.wins / t.total
          return {
            ...t,
            winRatePct: Math.round(winRate * 100),
            rating:     calcRating(t.wins, winRate),
          }
        })

      /* ── Oyun filtresi (GameContext) ── */
      if (activeGame && activeGame !== 'all') {
        const pats = {
          valorant: ['valorant'],
          cs2:      ['counter-strike', 'cs-go', 'cs2'],
          lol:      ['league of legends', 'league-of-legends'],
        }[activeGame] || []
        if (pats.length > 0) {
          arr = arr.filter(t =>
            pats.some(p => (t.game || '').toLowerCase().includes(p))
          )
        }
      }

      setTeams(arr)
    } catch (e) {
      console.error('Rankings fetch:', e.message)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeGame])

  useEffect(() => { fetchRankings() }, [fetchRankings])

  /* ── Toggle favori ── */
  function handleToggleFav(teamId) {
    const next = toggleFavorite(teamId)
    setFavs(next?.list ? [...next.list] : getFavorites())
  }

  /* ── Sırala + arama filtresi ── */
  const displayed = [...teams]
    .filter(t => !search.trim() || (t.team?.name || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === 'wins')    return b.wins       - a.wins
      if (sortKey === 'total')   return b.total      - a.total
      if (sortKey === 'winRate') return b.winRatePct - a.winRatePct
      return b.rating - a.rating
    })

  /* Bar normalizasyonu */
  const topRating = displayed[0]?.rating      || 1
  const topWins   = displayed[0]?.wins        || 1
  const topTotal  = displayed[0]?.total       || 1
  const topWR     = displayed[0]?.winRatePct  || 1

  const MEDALS      = ['🥇', '🥈', '🥉']
  const MEDAL_GLOWS = [
    'rgba(255,215,0,.15)',
    'rgba(192,192,192,.12)',
    'rgba(205,127,50,.12)',
  ]

  /* ── Render ── */
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px 80px', color: 'white' }}>

      {/* Başlık */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          margin: '0 0 4px', fontSize: 24, fontWeight: 900,
          background: 'linear-gradient(135deg,#fff,#888)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>🏆 Sıralamalar</h1>
        <p style={{ margin: 0, fontSize: 11, color: '#383838' }}>
          Rating = (G×3)+(Win%×100) · min 5 maç ·{' '}
          <span style={{ color: '#555' }}>{teams.length} takım</span>
        </p>
      </div>

      {/* Hata */}
      {error && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(255,70,85,.1)', border: '1px solid rgba(255,70,85,.3)', color: '#FF4655', fontSize: 11, marginBottom: 20 }}>
          ⚠️ {error}
        </div>
      )}

      {/* Podium (ilk 3) */}
      {!loading && displayed.length >= 3 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 1fr', gap: 10, marginBottom: 28 }}>
          {[displayed[1], displayed[0], displayed[2]].map((t, podIdx) => {
            const realIdx = [1, 0, 2][podIdx]
            const team    = t?.team || {}
            const gc      = gameColor(t?.game || '')
            return (
              <div
                key={team.id || podIdx}
                onClick={() => navigate(`/team/${team.id}`)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center',
                  padding: podIdx === 1 ? '22px 12px 18px' : '16px 12px 14px',
                  borderRadius: 16,
                  background: `linear-gradient(160deg,${MEDAL_GLOWS[realIdx]},#111)`,
                  border: `1px solid ${gc}33`,
                  cursor: 'pointer', transition: 'transform .18s, border-color .18s',
                  position: 'relative', overflow: 'hidden',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = `${gc}77` }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)';   e.currentTarget.style.borderColor = `${gc}33` }}
              >
                {/* Top glow bar */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                  background: `linear-gradient(90deg,${gc},${gc}44,transparent)`,
                  borderRadius: '2px 2px 0 0',
                }} />

                <div style={{ fontSize: podIdx === 1 ? 34 : 26, marginBottom: 8 }}>
                  {MEDALS[realIdx]}
                </div>
                {team.logo_url
                  ? <img src={team.logo_url} alt={team.name} style={{ width: podIdx === 1 ? 48 : 38, height: podIdx === 1 ? 48 : 38, objectFit: 'contain', marginBottom: 8 }} />
                  : <div style={{ width: 38, height: 38, background: '#1a1a1a', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🛡️</div>
                }
                <div style={{ fontSize: podIdx === 1 ? 13 : 11, fontWeight: 800, color: '#ddd', textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {team.name || '?'}
                </div>
                {/* Win record */}
                <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>
                  {t.wins}W – {t.losses}L
                </div>
                <div style={{
                  marginTop: 8, padding: '3px 12px', borderRadius: 20,
                  background: `${gc}22`, border: `1px solid ${gc}44`,
                  fontSize: 11, fontWeight: 900, color: gc,
                }}>
                  {t.rating.toLocaleString()} pts
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { key: 'rating',  label: '⭐ Rating'       },
          { key: 'winRate', label: '% Win Rate'      },
          { key: 'wins',    label: '# Galibiyet'     },
          { key: 'total',   label: '# Toplam'        },
        ].map(s => (
          <button key={s.key} onClick={() => setSortKey(s.key)} style={{
            padding: '6px 14px', borderRadius: 10, fontSize: 11, cursor: 'pointer', transition: 'all .15s',
            border:     sortKey === s.key ? '1.5px solid #FF4655'    : '1.5px solid #1a1a1a',
            background: sortKey === s.key ? 'rgba(255,70,85,.15)'    : '#111',
            color:      sortKey === s.key ? '#FF4655'                : '#555',
            fontWeight: sortKey === s.key ? 700                      : 500,
          }}>{s.label}</button>
        ))}

        {/* Arama */}
        <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#333', pointerEvents: 'none' }}>🔍</span>
          <input
            type="text" placeholder="Takım ara..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', height: 34, paddingLeft: 28, paddingRight: 28,
              borderRadius: 10, border: '1.5px solid #1a1a1a',
              background: '#111', color: '#ccc', fontSize: 12,
              outline: 'none', transition: 'border-color .15s', boxSizing: 'border-box',
            }}
            onFocus={e => e.target.style.borderColor = '#FF465555'}
            onBlur={e  => e.target.style.borderColor = '#1a1a1a'}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14 }}>✕</button>
          )}
        </div>

        <button
          onClick={fetchRankings}
          style={{ padding: '6px 12px', borderRadius: 10, border: '1.5px solid #1a1a1a', background: '#111', color: '#555', fontSize: 12, cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.color='#ccc'; e.currentTarget.style.borderColor='#333' }}
          onMouseLeave={e => { e.currentTarget.style.color='#555'; e.currentTarget.style.borderColor='#1a1a1a' }}
        >🔄</button>
      </div>

      {/* Tablo */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3,4,5,6,7,8].map(i => <Sk key={i} h="56px" r="14px" />)}
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#282828' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🏆</div>
          <div style={{ fontSize: 13 }}>Sıralama verisi bulunamadı</div>
          <div style={{ fontSize: 11, marginTop: 6, color: '#222' }}>
            Min 5 maç ve biten maç (winner_id) gereklidir
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '44px 1fr 56px 56px 56px 72px 96px 36px',
            gap: 8, padding: '4px 14px',
          }}>
            {[
              { label: '#',      a: 'center' },
              { label: 'Takım',  a: 'left'   },
              { label: 'G',      a: 'center' },
              { label: 'M',      a: 'center' },
              { label: 'Top',    a: 'center' },
              { label: 'Win%',   a: 'center' },
              { label: 'Rating', a: 'center', tip: true },
              { label: '',       a: 'center' },
            ].map((h, i) => (
              <div key={i} style={{
                fontSize: 9, fontWeight: 700, color: '#2a2a2a',
                textTransform: 'uppercase', letterSpacing: '.5px',
                textAlign: h.a,
                display: 'flex', alignItems: 'center',
                justifyContent: h.a === 'center' ? 'center' : 'flex-start',
              }}>
                {h.label}{h.tip && <RatingTooltip />}
              </div>
            ))}
          </div>

          {/* Satırlar */}
          {displayed.map((t, idx) => {
            const team      = t.team || {}
            const gc        = gameColor(t.game || '')
            const medal     = MEDALS[idx] ?? null
            const favActive = favs.includes(team.id)

            const barW = sortKey === 'wins'    ? Math.round(t.wins       / topWins   * 100)
                       : sortKey === 'total'   ? Math.round(t.total      / topTotal  * 100)
                       : sortKey === 'winRate' ? Math.round(t.winRatePct / topWR     * 100)
                       :                        Math.round(t.rating      / topRating * 100)

            const ratingColor = t.rating >= 5000  ? '#a78bfa'
                              : t.rating >= 3000  ? '#60a5fa'
                              : t.rating >= 1500  ? '#4ade80'
                              : '#555'

            return (
              <div
                key={team.id || idx}
                onClick={() => navigate(`/team/${team.id}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px 1fr 56px 56px 56px 72px 96px 36px',
                  gap: 8, padding: '11px 14px', alignItems: 'center',
                  background: idx < 3
                    ? `linear-gradient(90deg,${MEDAL_GLOWS[idx]},#111 55%)`
                    : '#111',
                  borderRadius: 14, cursor: 'pointer', transition: 'all .18s',
                  border: favActive
                    ? '1.5px solid rgba(255,215,0,.4)'
                    : idx === 0 ? `1.5px solid ${gc}44` : '1.5px solid #1a1a1a',
                  position: 'relative', overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background    = `linear-gradient(90deg,${gc}14,#161616)`
                  e.currentTarget.style.borderColor   = favActive ? 'rgba(255,215,0,.7)' : `${gc}88`
                  e.currentTarget.style.transform     = 'translateX(2px)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background  = idx < 3
                    ? `linear-gradient(90deg,${MEDAL_GLOWS[idx]},#111 55%)`
                    : '#111'
                  e.currentTarget.style.borderColor = favActive
                    ? 'rgba(255,215,0,.4)'
                    : idx === 0 ? `${gc}44` : '#1a1a1a'
                  e.currentTarget.style.transform   = 'translateX(0)'
                }}
              >
                {/* Fav çizgisi */}
                {favActive && (
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: 'linear-gradient(90deg,#FFD700,#FFA500,transparent)',
                    borderRadius: '2px 2px 0 0',
                  }} />
                )}

                {/* Sıra */}
                <div style={{ textAlign: 'center', fontSize: medal ? 18 : 12, fontWeight: 700, color: idx < 3 ? '#aaa' : '#333' }}>
                  {medal || idx + 1}
                </div>

                {/* Takım */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {team.logo_url
                    ? <img src={team.logo_url} alt={team.name} style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0, borderRadius: 4 }} />
                    : <div style={{ width: 28, height: 28, background: `${gc}22`, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>🛡️</div>
                  }
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {team.name || '?'}
                    </div>
                    <div style={{ fontSize: 9, color: '#383838', marginTop: 1 }}>{t.game}</div>
                  </div>
                </div>

                {/* G / M / Top */}
                {[
                  { v: t.wins,   c: '#4CAF50' },
                  { v: t.losses, c: '#FF4655' },
                  { v: t.total,  c: '#555'    },
                ].map(({ v, c }, i) => (
                  <div key={i} style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                ))}

                {/* Win% */}
                <div>
                  <div style={{ height: 5, borderRadius: 3, background: '#1a1a1a', overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{
                      height: '100%', width: `${t.winRatePct}%`, borderRadius: 3,
                      background: t.winRatePct >= 60 ? '#4CAF50'
                                : t.winRatePct >= 45 ? '#FFB800'
                                : '#FF4655',
                      transition: 'width .6s cubic-bezier(.4,0,.2,1)',
                    }} />
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                    color: t.winRatePct >= 60 ? '#4CAF50' : t.winRatePct >= 45 ? '#FFB800' : '#FF4655' }}>
                    {t.winRatePct}%
                  </div>
                </div>

                {/* Rating */}
                <div>
                  <div style={{ height: 5, borderRadius: 3, background: '#1a1a1a', overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{
                      height: '100%', width: `${barW}%`, borderRadius: 3,
                      background: `linear-gradient(90deg,${ratingColor}66,${ratingColor})`,
                      transition: 'width .6s cubic-bezier(.4,0,.2,1)',
                    }} />
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 900, color: ratingColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.3px' }}>
                    {t.rating.toLocaleString()}
                  </div>
                </div>

                {/* Fav */}
                <FavStar teamId={team.id} favs={favs} onToggle={handleToggleFav} />
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
    </div>
  )
}