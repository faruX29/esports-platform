import { useState, useEffect, useCallback } from 'react'
import { useNavigate }                      from 'react-router-dom'
import { supabase }                         from './supabaseClient'
import { useGame }                          from './GameContext'
import { getFavorites, toggleFavorite }     from './favoritesHelper'

/* ─── Yardımcılar ───────────────────────────────────────────────────────────── */
function gameColor(n = '') {
  const s = n.toLowerCase()
  if (s.includes('valorant'))                   return '#FF4655'
  if (s.includes('counter') || s.includes('cs')) return '#F0A500'
  if (s.includes('league'))                     return '#C89B3C'
  return '#6366f1'
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
        transition: 'color .15s, transform .15s',
        flexShrink: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.color = active ? '#FFD700' : '#555'; e.currentTarget.style.transform = 'scale(1.25)' }}
      onMouseLeave={e => { e.currentTarget.style.color = active ? '#FFD700' : '#2a2a2a'; e.currentTarget.style.transform = 'scale(1)' }}
    >
      {active ? '⭐' : '☆'}
    </button>
  )
}

/* ─── Rankings — default export ─────────────────────────────────────────────── */
export default function Rankings() {
  const navigate       = useNavigate()
  const { activeGame } = useGame()

  const [teams,   setTeams]   = useState([])
  const [loading, setLoading] = useState(true)
  const [favs,    setFavs]    = useState(() => getFavorites())
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState('winRate') // winRate | wins | total

  /* ── Veri çekme ── */
  const fetchRankings = useCallback(async () => {
    setLoading(true)
    try {
      // match_stats tablosundan takım bazlı istatistik
      // Not: match_stats tablosunda 'win' kolonu yok; kazanan bilgisi
      // matches.winner_id üzerinden türetiliyor.
      const { data, error } = await supabase
        .from('match_stats')
        .select('match_id, team_id, team:teams(id, name, logo_url, acronym)')
        .limit(5000)
      if (error) throw error

      // Oyuna göre filtre için maçları da çekelim
      const { data: matchData } = await supabase
        .from('matches')
        .select('id, team_a_id, team_b_id, winner_id, game:games(name)')
        .eq('status', 'finished')
        .limit(5000)

      // Oyun filtresi için maç→oyun haritası + kazanan haritası
      const matchGameMap   = {}
      const teamGameMap    = {}
      const matchWinnerMap = {}   // match_id → winner_id
      for (const m of (matchData || [])) {
        const gName = m.game?.name || ''
        matchGameMap[m.id]   = gName
        matchWinnerMap[m.id] = m.winner_id
        if (m.team_a_id) teamGameMap[m.team_a_id] = teamGameMap[m.team_a_id] || gName
        if (m.team_b_id) teamGameMap[m.team_b_id] = teamGameMap[m.team_b_id] || gName
      }

      // Takım istatistiklerini hesapla
      const map = {}
      for (const row of (data || [])) {
        const tid = row.team_id || row.team?.id
        if (!tid) continue
        if (!map[tid]) map[tid] = { team: row.team, wins: 0, losses: 0, total: 0, game: teamGameMap[tid] || '' }
        map[tid].total++
        const won = matchWinnerMap[row.match_id] === tid
        won ? map[tid].wins++ : map[tid].losses++
      }

      let arr = Object.values(map).map(t => ({
        ...t,
        winRate: t.total > 0 ? Math.round(t.wins / t.total * 100) : 0,
      }))

      // Oyun filtresi
      if (activeGame && activeGame !== 'all') {
        const pats = {
          valorant: ['valorant'],
          cs2:      ['counter-strike', 'cs-go', 'cs2'],
          lol:      ['league of legends', 'league-of-legends'],
        }[activeGame] || []
        arr = arr.filter(t => pats.some(p => (t.game || '').toLowerCase().includes(p)))
      }

      // Minimum 3 maç
      arr = arr.filter(t => t.total >= 3)

      setTeams(arr)
    } catch (e) { console.error('Rankings fetch:', e.message) }
    finally { setLoading(false) }
  }, [activeGame])

  useEffect(() => { fetchRankings() }, [fetchRankings])

  /* ── Toggle favori ── */
  function handleToggleFav(teamId) {
    const { list } = toggleFavorite(teamId)
    setFavs([...list])
  }

  /* ── Sırala + filtrele ── */
  const displayed = teams
    .filter(t => !search.trim() || (t.team?.name || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortKey === 'wins')     return b.wins - a.wins
      if (sortKey === 'total')    return b.total - a.total
      return b.winRate - a.winRate // default
    })

  const topWR  = displayed[0]?.winRate  || 1
  const topWins= displayed[0]?.wins     || 1

  const MEDALS = ['🥇', '🥈', '🥉']

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 60px', color: 'white' }}>

      {/* Başlık */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 900, letterSpacing: '-.3px' }}>🏆 Sıralamalar</h1>
        <p style={{ margin: 0, fontSize: 11, color: '#383838' }}>
          Kazanma oranına göre · min 3 maç · {teams.length} takım
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Sıralama seçici */}
        {[
          { key: 'winRate', label: '% Win Rate' },
          { key: 'wins',    label: '# Galibiyetler' },
          { key: 'total',   label: '# Toplam Maç' },
        ].map(s => (
          <button key={s.key} onClick={() => setSortKey(s.key)} style={{
            padding: '6px 14px', borderRadius: 10, fontSize: 11, cursor: 'pointer', transition: 'all .15s',
            border:     sortKey === s.key ? '1.5px solid #FF4655'        : '1.5px solid #1a1a1a',
            background: sortKey === s.key ? 'rgba(255,70,85,.15)'        : '#111',
            color:      sortKey === s.key ? '#FF4655'                    : '#555',
            fontWeight: sortKey === s.key ? 700 : 500,
          }}>{s.label}</button>
        ))}

        {/* Arama */}
        <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#333', pointerEvents: 'none' }}>🔍</span>
          <input type="text" placeholder="Takım ara..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', height: 34, paddingLeft: 28, paddingRight: 28, borderRadius: 10, border: '1.5px solid #1a1a1a', background: '#111', color: '#ccc', fontSize: 12, outline: 'none', transition: 'border-color .15s', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#FF465555'}
            onBlur={e  => e.target.style.borderColor = '#1a1a1a'}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 14 }}>✕</button>
          )}
        </div>

        <button onClick={fetchRankings} style={{ padding: '6px 12px', borderRadius: 10, border: '1.5px solid #1a1a1a', background: '#111', color: '#555', fontSize: 12, cursor: 'pointer' }}
          onMouseEnter={e => { e.currentTarget.style.color = '#ccc'; e.currentTarget.style.borderColor = '#333' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#1a1a1a' }}
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
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 72px 72px 72px 80px 36px', gap: 8, padding: '6px 14px', alignItems: 'center' }}>
            {['#', 'Takım', 'G', 'M', 'Top', 'Win%', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 9, fontWeight: 700, color: '#2a2a2a', textTransform: 'uppercase', letterSpacing: '.5px', textAlign: i > 1 ? 'center' : 'left' }}>{h}</div>
            ))}
          </div>

          {displayed.map((t, idx) => {
            const team    = t.team || {}
            const gc      = gameColor(t.game || '')
            const medal   = MEDALS[idx] || null
            const favActive = favs.includes(team.id)
            const barW    = sortKey === 'wins'
              ? Math.round(t.wins / topWins * 100)
              : sortKey === 'total'
              ? Math.round(t.total / (displayed[0]?.total || 1) * 100)
              : Math.round(t.winRate / topWR * 100)

            return (
              <div key={team.id || idx}
                onClick={() => navigate(`/team/${team.id}`)}
                style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr 72px 72px 72px 80px 36px',
                  gap: 8, padding: '11px 14px', alignItems: 'center',
                  background: idx < 3 ? `linear-gradient(90deg,${gc}08,#111)` : '#111',
                  borderRadius: 14, cursor: 'pointer', transition: 'all .18s',
                  border: favActive
                    ? '1.5px solid rgba(255,215,0,.4)'
                    : idx === 0 ? `1.5px solid ${gc}44` : '1.5px solid #1a1a1a',
                  position: 'relative', overflow: 'hidden',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `linear-gradient(90deg,${gc}12,#161616)`; e.currentTarget.style.borderColor = favActive ? 'rgba(255,215,0,.6)' : `${gc}77` }}
                onMouseLeave={e => { e.currentTarget.style.background = idx < 3 ? `linear-gradient(90deg,${gc}08,#111)` : '#111'; e.currentTarget.style.borderColor = favActive ? 'rgba(255,215,0,.4)' : idx === 0 ? `${gc}44` : '#1a1a1a' }}
              >
                {/* Altın border — sadece favoriler */}
                {favActive && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,#FFD700,#FFA500,transparent)', borderRadius: '2px 2px 0 0' }} />}

                {/* Sıra */}
                <div style={{ textAlign: 'center', fontSize: medal ? 16 : 12, fontWeight: 700, color: idx < 3 ? '#aaa' : '#2a2a2a' }}>
                  {medal || idx + 1}
                </div>

                {/* Takım */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {team.logo_url
                    ? <img src={team.logo_url} alt={team.name} style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
                    : <div style={{ width: 28, height: 28, background: '#1a1a1a', borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>🛡️</div>
                  }
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name || '?'}</div>
                    <div style={{ fontSize: 9, color: '#2a2a2a', marginTop: 1 }}>{t.game}</div>
                  </div>
                </div>

                {/* G / M / Toplam */}
                {[t.wins, t.losses, t.total].map((v, i) => (
                  <div key={i} style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: i === 0 ? '#4CAF50' : i === 1 ? '#FF4655' : '#555', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                ))}

                {/* Win% bar */}
                <div style={{ position: 'relative' }}>
                  <div style={{ height: 6, borderRadius: 3, background: '#1a1a1a', overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{ height: '100%', width: `${barW}%`, borderRadius: 3, background: t.winRate >= 60 ? '#4CAF50' : t.winRate >= 45 ? '#FFB800' : '#FF4655', transition: 'width .6s cubic-bezier(.4,0,.2,1)' }} />
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, color: t.winRate >= 60 ? '#4CAF50' : t.winRate >= 45 ? '#FFB800' : '#FF4655', fontVariantNumeric: 'tabular-nums' }}>
                    {t.winRate}%
                  </div>
                </div>

                {/* Fav yıldızı */}
                <FavStar teamId={team.id} favs={favs} onToggle={handleToggleFav} />
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </div>
  )
}