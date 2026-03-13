import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useUser } from '../context/UserContext'
import { summarizePlayerMatchStats, metricBars } from '../utils/playerMetrics'

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function safePct(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function extractTeamFallbackMetrics(rows) {
  const kills = rows.reduce((acc, row) => {
    const s = row?.stats || {}
    return acc + (toNum(s.kills ?? s.total_kills ?? s?.kda?.kills) || 0)
  }, 0)

  const deaths = rows.reduce((acc, row) => {
    const s = row?.stats || {}
    return acc + (toNum(s.deaths ?? s.total_deaths ?? s?.kda?.deaths) || 0)
  }, 0)

  const headshots = rows.reduce((acc, row) => {
    const s = row?.stats || {}
    return acc + (toNum(s.headshots ?? s.hs_kills ?? s.headshot_kills) || 0)
  }, 0)

  let wins = 0
  for (const row of rows) {
    const s = row?.stats || {}
    const games = Array.isArray(s.games_detail) ? s.games_detail : []
    const finCount = games.filter(g => g?.status === 'finished').length
    const score = toNum(s.score) || 0
    const oppScore = Math.max(0, finCount - score)
    if (score > oppScore) wins += 1
  }

  const sampleMatches = rows.length
  const kd = deaths > 0 ? kills / deaths : (kills > 0 ? kills : 0)
  const hsPct = kills > 0 ? (headshots / kills) * 100 : 0
  const winRate = sampleMatches > 0 ? (wins / sampleMatches) * 100 : 0
  const impact = Math.min(100, kd * 32 + hsPct * 0.48 + winRate * 0.2)

  return {
    sampleMatches,
    kd,
    hsPct: safePct(hsPct),
    winRate: safePct(winRate),
    impact: safePct(impact),
  }
}

function getRoleColor(role = '') {
  const r = role.toLowerCase()
  if (r.includes('support')) return '#5bc0ff'
  if (r.includes('carry') || r.includes('adc')) return '#ff8f4b'
  if (r.includes('mid')) return '#b082ff'
  if (r.includes('jung')) return '#7de07d'
  if (r.includes('sniper') || r.includes('rifler')) return '#f87086'
  return '#d2d2d2'
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '0.00'
}

function CompareCard({ player, onClear }) {
  if (!player) {
    return (
      <div style={{ border: '1px dashed #343434', borderRadius: 12, padding: 12, minHeight: 188, display: 'grid', placeItems: 'center', color: '#666', fontSize: 12 }}>
        Oyuncu sec
      </div>
    )
  }

  const bars = metricBars(player)
  return (
    <div style={{ border: '1px solid #2b2b2b', borderRadius: 12, padding: 12, background: '#101010' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {player.image_url
            ? <img src={player.image_url} alt={player.nickname || ''} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '1px solid #303030' }} />
            : <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#212121' }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.nickname || 'Unknown'}</div>
            <div style={{ color: '#8a8a8a', fontSize: 11 }}>{player.team?.name || 'Free Agent'}</div>
          </div>
        </div>
        <button onClick={onClear} style={{ border: '1px solid #3a3a3a', background: '#151515', color: '#a1a1a1', borderRadius: 7, padding: '4px 7px', cursor: 'pointer', fontSize: 11 }}>Temizle</button>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <div><div style={{ fontSize: 10, color: '#818181' }}>K/D</div><div style={{ fontSize: 15, fontWeight: 800 }}>{fmt(player.kd)}</div></div>
        <div><div style={{ fontSize: 10, color: '#818181' }}>HS%</div><div style={{ fontSize: 15, fontWeight: 800 }}>{Math.round(player.hsPct)}%</div></div>
        <div><div style={{ fontSize: 10, color: '#818181' }}>Win%</div><div style={{ fontSize: 15, fontWeight: 800 }}>{Math.round(player.winRate)}%</div></div>
        <div><div style={{ fontSize: 10, color: '#818181' }}>Impact</div><div style={{ fontSize: 15, fontWeight: 800, color: '#ff9aa9' }}>{Math.round(player.impact)}</div></div>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
        {[{ label: 'K/D', value: bars.kdBar, color: '#ff6a7f' }, { label: 'HS', value: bars.hsBar, color: '#f4f4f4' }, { label: 'Win', value: bars.winBar, color: '#7cd97f' }, { label: 'Impact', value: bars.impactBar, color: '#ff9aa9' }].map(row => (
          <div key={row.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8b8b8b', marginBottom: 3 }}><span>{row.label}</span><span>{Math.round(row.value)}</span></div>
            <div style={{ height: 5, borderRadius: 4, background: '#1c1c1c', overflow: 'hidden' }}>
              <div style={{ width: `${row.value}%`, height: '100%', background: row.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PlayersPage() {
  const navigate = useNavigate()
  const { isPlayerFollowed, togglePlayerFollow } = useUser()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [players, setPlayers] = useState([])
  const [metricsSource, setMetricsSource] = useState('player_match_stats')

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [nationality, setNationality] = useState('all')
  const [minKd, setMinKd] = useState(0.8)
  const [minHs, setMinHs] = useState(10)
  const [sortKey, setSortKey] = useState('impact')
  const [compareAId, setCompareAId] = useState('')
  const [compareBId, setCompareBId] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError('')

      try {
        const [playersRes, teamsRes, playerStatsRes, teamStatsRes] = await Promise.all([
          supabase
            .from('players')
            .select('id,nickname,real_name,role,image_url,nationality,team_pandascore_id')
            .limit(1000),
          supabase
            .from('teams')
            .select('id,name,logo_url')
            .limit(800),
          supabase
            .from('player_match_stats')
            .select('*')
            .limit(30000),
          supabase
            .from('match_stats')
            .select('team_id,stats')
            .limit(12000),
        ])

        if (playersRes.error) throw playersRes.error
        if (teamsRes.error) throw teamsRes.error

        if (cancelled) return

        const teamsById = new Map((teamsRes.data || []).map(t => [String(t.id), t]))
        const playerStatsById = new Map()
        const teamStatsByTeam = new Map()

        let granularReady = true
        if (playerStatsRes.error) {
          granularReady = false
          setMetricsSource('team_fallback')
        }

        if (!granularReady && teamStatsRes.error) {
          throw teamStatsRes.error
        }

        if (granularReady) {
          setMetricsSource('player_match_stats')
          for (const row of (playerStatsRes.data || [])) {
            const pid = row?.player_id
            if (!pid) continue
            if (!playerStatsById.has(pid)) playerStatsById.set(pid, [])
            playerStatsById.get(pid).push(row)
          }
        } else {
          for (const row of (teamStatsRes.data || [])) {
            const teamId = row?.team_id
            if (!teamId) continue
            const key = String(teamId)
            if (!teamStatsByTeam.has(key)) teamStatsByTeam.set(key, [])
            teamStatsByTeam.get(key).push(row)
          }
        }

        const enriched = (playersRes.data || []).map(p => {
          const teamId = p.team_pandascore_id
          const key = teamId ? String(teamId) : ''
          const team = key ? teamsById.get(key) : null
          const metrics = granularReady
            ? summarizePlayerMatchStats(playerStatsById.get(p.id) || [])
            : extractTeamFallbackMetrics(teamStatsByTeam.get(key) || [])

          return {
            ...p,
            team,
            kd: metrics.kd,
            hsPct: metrics.hsPct,
            impact: metrics.impact,
            winRate: metrics.winRate,
            sampleMatches: metrics.sampleMatches,
            totalKills: metrics.totalKills,
            totalDeaths: metrics.totalDeaths,
            totalAssists: metrics.totalAssists,
          }
        })

        setPlayers(enriched)
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Oyuncu verileri yuklenemedi.')
          setPlayers([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [])

  const roleOptions = useMemo(() => {
    const set = new Set(players.map(p => p.role).filter(Boolean))
    return ['all', ...[...set].sort((a, b) => a.localeCompare(b, 'tr'))]
  }, [players])

  const nationalityOptions = useMemo(() => {
    const set = new Set(players.map(p => p.nationality).filter(Boolean))
    return ['all', ...[...set].sort((a, b) => a.localeCompare(b, 'tr'))]
  }, [players])

  const visiblePlayers = useMemo(() => {
    const q = search.trim().toLowerCase()

    const filtered = players.filter(p => {
      const matchesSearch = !q || (p.nickname || '').toLowerCase().includes(q) || (p.real_name || '').toLowerCase().includes(q)
      const matchesRole = roleFilter === 'all' || p.role === roleFilter
      const matchesNat = nationality === 'all' || p.nationality === nationality
      const matchesKd = p.kd >= minKd
      const matchesHs = p.hsPct >= minHs
      return matchesSearch && matchesRole && matchesNat && matchesKd && matchesHs
    })

    filtered.sort((a, b) => {
      if (sortKey === 'kd') return b.kd - a.kd
      if (sortKey === 'hs') return b.hsPct - a.hsPct
      if (sortKey === 'wr') return b.winRate - a.winRate
      return b.impact - a.impact
    })

    return filtered
  }, [players, search, roleFilter, nationality, minKd, minHs, sortKey])

  useEffect(() => {
    if (visiblePlayers.length === 0) return
    if (!compareAId) setCompareAId(String(visiblePlayers[0].id))
    if (!compareBId && visiblePlayers.length > 1) setCompareBId(String(visiblePlayers[1].id))
  }, [visiblePlayers, compareAId, compareBId])

  const compareA = useMemo(() => visiblePlayers.find(p => String(p.id) === String(compareAId)) || null, [visiblePlayers, compareAId])
  const compareB = useMemo(() => visiblePlayers.find(p => String(p.id) === String(compareBId)) || null, [visiblePlayers, compareBId])

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px 80px', color: '#f5f5f5', position: 'relative' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: 'radial-gradient(circle at 10% 10%, rgba(200,16,46,.18), transparent 36%), radial-gradient(circle at 90% 4%, rgba(255,255,255,.06), transparent 28%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '.5px' }}>Player Scout Engine</h1>
        <p style={{ margin: '8px 0 16px', color: '#a8a8a8', fontSize: 13 }}>
          K/D, Headshot yuzdesi ve Impact sinyallerine gore filtreleyip siralayin. Veri kaynagi: {metricsSource === 'player_match_stats' ? 'player_match_stats' : 'team fallback'}
        </p>

        <div style={{
          border: '1px solid #2a2a2a',
          background: '#101010d9',
          borderRadius: 14,
          padding: 14,
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, color: '#ff9aa9', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', marginBottom: 10 }}>
            Compare
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginBottom: 10 }}>
            <select value={compareAId} onChange={e => setCompareAId(e.target.value)} style={{ height: 36, borderRadius: 10, border: '1px solid #333', background: '#131313', color: '#fff', padding: '0 10px' }}>
              <option value=''>Oyuncu A sec</option>
              {visiblePlayers.map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
            </select>
            <select value={compareBId} onChange={e => setCompareBId(e.target.value)} style={{ height: 36, borderRadius: 10, border: '1px solid #333', background: '#131313', color: '#fff', padding: '0 10px' }}>
              <option value=''>Oyuncu B sec</option>
              {visiblePlayers.map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10 }}>
            <CompareCard player={compareA} onClear={() => setCompareAId('')} />
            <CompareCard player={compareB} onClear={() => setCompareBId('')} />
          </div>
        </div>

        <div style={{
          border: '1px solid #2a2a2a',
          background: '#101010d9',
          borderRadius: 14,
          padding: 14,
          marginBottom: 14,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: 10,
        }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Oyuncu ara...'
            style={{ height: 36, borderRadius: 10, border: '1px solid #333', background: '#131313', color: '#fff', padding: '0 12px', outline: 'none' }}
          />

          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            style={{ height: 36, borderRadius: 10, border: '1px solid #333', background: '#131313', color: '#fff', padding: '0 10px' }}
          >
            {roleOptions.map(role => (
              <option key={role} value={role}>{role === 'all' ? 'Tum Roller' : role}</option>
            ))}
          </select>

          <select
            value={nationality}
            onChange={e => setNationality(e.target.value)}
            style={{ height: 36, borderRadius: 10, border: '1px solid #333', background: '#131313', color: '#fff', padding: '0 10px' }}
          >
            {nationalityOptions.map(item => (
              <option key={item} value={item}>{item === 'all' ? 'Tum Ulkeler' : item}</option>
            ))}
          </select>

          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            style={{ height: 36, borderRadius: 10, border: '1px solid #333', background: '#131313', color: '#fff', padding: '0 10px' }}
          >
            <option value='impact'>Impact Score</option>
            <option value='kd'>K/D</option>
            <option value='hs'>Headshot %</option>
            <option value='wr'>Win Rate</option>
          </select>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#a1a1a1' }}>Min K/D: {fmt(minKd, 2)}</label>
            <input type='range' min='0.5' max='2.5' step='0.05' value={minKd} onChange={e => setMinKd(Number(e.target.value))} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#a1a1a1' }}>Min HS%: {Math.round(minHs)}%</label>
            <input type='range' min='0' max='80' step='1' value={minHs} onChange={e => setMinHs(Number(e.target.value))} />
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#8d8d8d', marginBottom: 8 }}>
          {visiblePlayers.length} oyuncu listelendi
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{
            border: '1px solid #2a2a2a',
            borderRadius: 14,
            overflow: 'hidden',
            background: '#0f0f0f',
            minWidth: 930,
          }}>
            <div style={{
            display: 'grid',
            gridTemplateColumns: '1.7fr 1.2fr .7fr .7fr .7fr .7fr .6fr',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid #232323',
            fontSize: 11,
            color: '#8f8f8f',
            textTransform: 'uppercase',
            letterSpacing: '.5px',
          }}>
            <div>Player</div>
            <div>Team</div>
            <div>K/D</div>
            <div>HS%</div>
            <div>Win%</div>
            <div>Impact</div>
            <div>Follow</div>
          </div>

            {loading && <div style={{ padding: 18, color: '#8f8f8f', fontSize: 13 }}>Oyuncular yukleniyor...</div>}
            {!loading && error && <div style={{ padding: 18, color: '#ff6a7f', fontSize: 13 }}>{error}</div>}
            {!loading && !error && visiblePlayers.length === 0 && (
              <div style={{ padding: 18, color: '#8f8f8f', fontSize: 13 }}>Filtreye uygun oyuncu bulunamadi.</div>
            )}

            {!loading && !error && visiblePlayers.map((player, idx) => {
            const followed = isPlayerFollowed(player.id)
            const roleColor = getRoleColor(player.role)
            return (
              <div
                key={player.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.7fr 1.2fr .7fr .7fr .7fr .7fr .6fr',
                  gap: 8,
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderBottom: '1px solid #1d1d1d',
                  background: idx < 3 ? 'linear-gradient(90deg, rgba(200,16,46,.11), transparent 58%)' : 'transparent',
                }}
              >
                <div
                  onClick={() => navigate(`/player/${player.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, cursor: 'pointer' }}
                >
                  {player.image_url
                    ? <img src={player.image_url} alt={player.nickname || ''} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '1px solid #363636' }} />
                    : <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#212121' }} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.nickname || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: roleColor }}>{player.role || 'Role N/A'}</div>
                  </div>
                </div>

                <div
                  onClick={() => player.team?.id && navigate(`/team/${player.team.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: player.team?.id ? 'pointer' : 'default', minWidth: 0 }}
                >
                  {player.team?.logo_url
                    ? <img src={player.team.logo_url} alt={player.team?.name || ''} style={{ width: 24, height: 24, objectFit: 'contain' }} />
                    : <div style={{ width: 24, height: 24, borderRadius: 6, background: '#1f1f1f' }} />}
                  <span style={{ fontSize: 12, color: '#cbcbcb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.team?.name || 'Free Agent'}</span>
                </div>

                <div style={{ fontWeight: 700 }}>{fmt(player.kd)}</div>
                <div style={{ fontWeight: 700 }}>{Math.round(player.hsPct)}%</div>
                <div style={{ fontWeight: 700 }}>{Math.round(player.winRate)}%</div>
                <div style={{ color: '#ff9aa9', fontWeight: 800 }}>{Math.round(player.impact)}</div>

                <div>
                  <button
                    onClick={() => togglePlayerFollow(player.id)}
                    style={{
                      height: 30,
                      width: 30,
                      borderRadius: 8,
                      border: followed ? '1px solid #c8102e' : '1px solid #343434',
                      background: followed ? 'rgba(200,16,46,.2)' : '#111',
                      color: followed ? '#fff' : '#a2a2a2',
                      cursor: 'pointer',
                    }}
                    title={followed ? 'Takibi birak' : 'Takip et'}
                  >
                    {followed ? '★' : '☆'}
                  </button>
                </div>
              </div>
            )
            })}
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: '#7a7a7a' }}>
          Not: K/D ve HS% metrikleri once player_match_stats uzerinden bireysel hesaplanir; tablo mevcut degilse gecici fallback kullanilir.
        </div>
      </div>
    </div>
  )
}
