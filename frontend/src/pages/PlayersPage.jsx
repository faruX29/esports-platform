import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { GAMES, useGame } from '../context/GameContext'
import { getRoleBadge, normalizeRoleForGame } from '../utils/roleHelper'
import { useUser } from '../context/UserContext'
import { summarizePlayerMatchStats, metricBars, pickRowTimestamp } from '../utils/playerMetrics'
import InitialsImage from '../components/InitialsImage'
import { normalizeGameId } from '../utils/gameUtils'
import { DeepScoutBadge } from '../components/ScoutSignals'
import { X as XIcon, SearchX, Star } from 'lucide-react'
import { FEXT } from '../theme'

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


function resolveRowGameId(row, matchGameById) {
  return normalizeGameId(
    row?.game_id ??
    row?.game?.id ??
    row?.game?.slug ??
    row?.game?.name ??
    matchGameById.get(String(row?.match_id || ''))
  )
}


function fmt(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '0.00'
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizeSearchToken(value) {
  return normalizeSearchText(value).replace(/[%_,()]/g, '').trim()
}

function GameFilterTabs({ activeGame, setActiveGame }) {
  const games = GAMES.filter(game => !game.soon && game.id !== 'all')

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {games.map(game => {
        const active = game.id === activeGame
        return (
          <button
            key={game.id}
            onClick={() => setActiveGame(game.id)}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              border: active ? `1px solid ${game.color}` : '1px solid var(--line)',
              background: active ? `${game.color}22` : 'var(--surface)',
              color: active ? game.color : 'var(--text-3)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.2px',
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 7,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: game.color, flexShrink: 0 }} />
            {game.shortLabel || game.label}
          </button>
        )
      })}
    </div>
  )
}

function CompareCard({ player, onClear }) {
  if (!player) {
    return (
      <div style={{ border: '1px dashed var(--text-6)', borderRadius: 12, padding: 12, minHeight: 188, display: 'grid', placeItems: 'center', color: 'var(--text-4)', fontSize: 12 }}>
        Oyuncu sec
      </div>
    )
  }

  const bars = metricBars(player)
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <InitialsImage
            src={player.image_url}
            alt={player.nickname || ''}
            name={player.nickname}
            width={34}
            height={34}
            borderRadius='50%'
            objectFit='cover'
            style={{ border: '1px solid var(--text-6)' }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.nickname || 'Unknown'}</div>
            <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{player.team?.name || 'Free Agent'}</div>
          </div>
        </div>
        <button onClick={onClear} style={{ border: '1px solid var(--text-6)', background: 'var(--surface)', color: 'var(--text-3)', borderRadius: 7, padding: '4px 7px', cursor: 'pointer', fontSize: 11 }}>Temizle</button>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <div><div style={{ fontSize: 10, color: 'var(--text-4)' }}>K/D</div><div style={{ fontSize: 15, fontWeight: 800 }}>{fmt(player.kd)}</div></div>
        <div><div style={{ fontSize: 10, color: 'var(--text-4)' }}>HS%</div><div style={{ fontSize: 15, fontWeight: 800 }}>{Math.round(player.hsPct)}%</div></div>
        <div><div style={{ fontSize: 10, color: 'var(--text-4)' }}>Kaz.%</div><div style={{ fontSize: 15, fontWeight: 800 }}>{Math.round(player.winRate)}%</div></div>
        <div><div style={{ fontSize: 10, color: 'var(--text-4)' }}>Etki</div><div style={{ fontSize: 15, fontWeight: 800, color: '#ff9aa9' }}>{Math.round(player.impact)}</div></div>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
        {[{ label: 'K/D', value: bars.kdBar, color: '#ff6a7f' }, { label: 'HS', value: bars.hsBar, color: 'var(--text-1)' }, { label: 'Gal', value: bars.winBar, color: '#7cd97f' }, { label: 'Etki', value: bars.impactBar, color: '#ff9aa9' }].map(row => (
          <div key={row.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginBottom: 3 }}><span>{row.label}</span><span>{Math.round(row.value)}</span></div>
            <div style={{ height: 5, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
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
  const { activeGame, setActiveGame } = useGame()
  const { isPlayerFollowed, togglePlayerFollow } = useUser()
  const defaultGameId = GAMES.find(game => !game.soon && game.id !== 'all')?.id || 'valorant'
  const selectedGameId = activeGame && activeGame !== 'all' ? activeGame : defaultGameId

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [players, setPlayers] = useState([])
  const [metricsSource, setMetricsSource] = useState('player_match_stats')

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('impact')
  const [compareMode, setCompareMode] = useState(false)
  const [compareAId, setCompareAId] = useState('')
  const [compareBId, setCompareBId] = useState('')
  const searchCacheRef = useRef(new Map())
  const normalizedSearch = useMemo(() => normalizeSearchToken(search), [search])

  useEffect(() => {
    if (!activeGame || activeGame === 'all') {
      setActiveGame(defaultGameId)
    }
  }, [activeGame, setActiveGame, defaultGameId])

  useEffect(() => {
    setCompareAId('')
    setCompareBId('')
  }, [selectedGameId])

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError('')

      try {
        // match_stats (büyük JSONB, 65k satır) SADECE fallback'te gerekiyor → burada
        // eager çekme. player_match_stats başarısız olursa aşağıda lazy çekilir.
        const [playersRes, teamsRes, gamesRes, playerStatsRes] = await Promise.all([
          supabase
            .from('players')
            .select('id,nickname,real_name,role,image_url,nationality,team_pandascore_id')
            .limit(1000),
          supabase
            .from('teams')
            .select('id,name,logo_url,game_id')
            .limit(800),
          supabase
            .from('games')
            .select('id,name,slug')
            .limit(40),
          supabase
            .from('player_match_stats')
            .select('*')
            .limit(30000),
        ])

        if (playersRes.error) throw playersRes.error
        if (teamsRes.error) throw teamsRes.error
        if (gamesRes.error) throw gamesRes.error

        if (cancelled) return

        const gamesById = new Map((gamesRes.data || []).map(game => [String(game.id), game]))
        const teamsById = new Map((teamsRes.data || []).map(t => {
          const gameMeta = t.game_id ? gamesById.get(String(t.game_id)) : null
          const normalizedTeamGameId = normalizeGameId(gameMeta?.slug ?? gameMeta?.name)
          return [String(t.id), { ...t, game: gameMeta || null, normalized_game_id: normalizedTeamGameId }]
        }))
        const playersById = new Map((playersRes.data || []).map(player => [String(player.id), player]))
        const teamStatsByTeam = new Map()
        const playerStatsByGame = new Map()
        const playerRolesByGame = new Map()
        const playerTeamsByGame = new Map()

        let granularReady = true
        if (playerStatsRes.error) {
          granularReady = false
          setMetricsSource('team_fallback')
        }

        if (granularReady) {
          setMetricsSource('player_match_stats')
          const unresolvedMatchIds = [...new Set((playerStatsRes.data || [])
            .filter(row => !normalizeGameId(row?.game_id ?? row?.game?.id ?? row?.game?.slug ?? row?.game?.name) && row?.match_id)
            .map(row => row.match_id))]

          const matchGameById = new Map()
          for (let index = 0; index < unresolvedMatchIds.length; index += 400) {
            const batch = unresolvedMatchIds.slice(index, index + 400)
            const { data: matchesData, error: matchesError } = await supabase
              .from('matches')
              .select('id,game:games(id,name,slug)')
              .in('id', batch)

            if (matchesError) throw matchesError

            for (const match of (matchesData || [])) {
              matchGameById.set(String(match.id), normalizeGameId(match?.game?.slug ?? match?.game?.id ?? match?.game?.name))
            }
          }

          for (const row of (playerStatsRes.data || [])) {
            const pid = String(row?.player_id || '')
            const gameId = resolveRowGameId(row, matchGameById)
            if (!pid || !gameId) continue

            if (!playerStatsByGame.has(pid)) playerStatsByGame.set(pid, new Map())
            if (!playerRolesByGame.has(pid)) playerRolesByGame.set(pid, new Map())
            if (!playerTeamsByGame.has(pid)) playerTeamsByGame.set(pid, new Map())

            const scopedStats = playerStatsByGame.get(pid)
            if (!scopedStats.has(gameId)) scopedStats.set(gameId, [])
            scopedStats.get(gameId).push(row)

            const normalizedRole = normalizeRoleForGame(row?.role ?? playersById.get(pid)?.role, gameId)
            if (normalizedRole) {
              playerRolesByGame.get(pid).set(gameId, normalizedRole)
            }

            const currentTeam = playerTeamsByGame.get(pid).get(gameId)
            const candidateTeamId = row?.team_id ?? row?.team_pandascore_id ?? playersById.get(pid)?.team_pandascore_id
            const rowTime = pickRowTimestamp(row) ? new Date(pickRowTimestamp(row)).getTime() : 0
            const currentTime = currentTeam?.timestamp || 0
            if (candidateTeamId && rowTime >= currentTime) {
              playerTeamsByGame.get(pid).set(gameId, { teamId: String(candidateTeamId), timestamp: rowTime })
            }
          }
        } else {
          // Fallback: player_match_stats yoksa takım-bazlı tahmin için match_stats'i
          // şimdi çek (yalnız bu nadir yolda).
          const teamStatsRes = await supabase.from('match_stats').select('team_id,stats').limit(1000)
          if (teamStatsRes.error) throw teamStatsRes.error
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
          const pid = String(p.id)
          const scopedStats = playerStatsByGame.get(pid) || new Map()
          const scopedRoles = playerRolesByGame.get(pid) || new Map()
          const scopedTeams = playerTeamsByGame.get(pid) || new Map()
          const gameStats = {}

          if (granularReady) {
            for (const [gameId, rows] of scopedStats.entries()) {
              const metrics = summarizePlayerMatchStats(rows || [])
              const scopedTeamId = scopedTeams.get(gameId)?.teamId || key
              gameStats[gameId] = {
                ...metrics,
                team: scopedTeamId ? teamsById.get(String(scopedTeamId)) || team : team,
                role: scopedRoles.get(gameId) || normalizeRoleForGame(p.role, gameId),
              }
            }
          } else {
            gameStats[selectedGameId] = {
              ...extractTeamFallbackMetrics(teamStatsByTeam.get(key) || []),
              team,
              role: normalizeRoleForGame(p.role, selectedGameId),
            }
          }

          return {
            ...p,
            team,
            teamGameId: team?.normalized_game_id || null,
            gameStats,
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

  useEffect(() => {
    const q = normalizedSearch
    if (q.length < 2) return undefined

    const cached = searchCacheRef.current.get(q)
    if (cached?.players?.length) {
      setPlayers(prev => {
        const mergedById = new Map(prev.map(player => [String(player.id), player]))
        const teamMap = new Map((cached.teams || []).map(team => [String(team.id), team]))

        for (const remote of cached.players) {
          const key = String(remote.id)
          const existing = mergedById.get(key)
          const rawTeam = remote.team_pandascore_id ? teamMap.get(String(remote.team_pandascore_id)) || null : null
          const team = rawTeam
            ? {
              ...rawTeam,
              normalized_game_id: normalizeGameId(rawTeam?.game?.slug ?? rawTeam?.game?.name),
            }
            : null

          if (existing) {
            mergedById.set(key, {
              ...remote,
              ...existing,
              gameStats: existing.gameStats || {},
              team: existing.team || team,
              teamGameId: existing.teamGameId || team?.normalized_game_id || null,
            })
            continue
          }

          mergedById.set(key, {
            ...remote,
            team,
            teamGameId: team?.normalized_game_id || null,
            gameStats: {},
          })
        }

        return [...mergedById.values()]
      })
      return undefined
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const { data: prefixedPlayers, error: prefixedPlayersError } = await supabase
          .from('players')
          .select('id,nickname,real_name,role,image_url,nationality,team_pandascore_id')
          .or(`nickname.ilike.${q}%,real_name.ilike.${q}%`)
          .limit(60)

        if (prefixedPlayersError || cancelled) return

        let remotePlayers = prefixedPlayers || []

        if (remotePlayers.length < 18) {
          const { data: broadPlayers, error: broadPlayersError } = await supabase
            .from('players')
            .select('id,nickname,real_name,role,image_url,nationality,team_pandascore_id')
            .or(`nickname.ilike.%${q}%,real_name.ilike.%${q}%`)
            .limit(60)

          if (!broadPlayersError && !cancelled && (broadPlayers || []).length) {
            const merged = new Map()
            for (const item of [...remotePlayers, ...broadPlayers]) merged.set(String(item.id), item)
            remotePlayers = [...merged.values()]
          }
        }

        if (cancelled || !(remotePlayers || []).length) return

        const teamIds = [...new Set((remotePlayers || []).map(p => p.team_pandascore_id).filter(Boolean))]
        const { data: remoteTeams } = teamIds.length
          ? await supabase.from('teams').select('id,name,logo_url,game_id,game:games(id,name,slug)').in('id', teamIds)
          : { data: [] }

        if (cancelled) return

        const teamMap = new Map((remoteTeams || []).map(team => [String(team.id), team]))
        searchCacheRef.current.set(q, { players: remotePlayers, teams: remoteTeams || [] })

        setPlayers(prev => {
          const mergedById = new Map(prev.map(player => [String(player.id), player]))

          for (const remote of (remotePlayers || [])) {
            const key = String(remote.id)
            const existing = mergedById.get(key)
            const rawTeam = remote.team_pandascore_id ? teamMap.get(String(remote.team_pandascore_id)) || null : null
            const normalizedTeam = rawTeam
              ? {
                ...rawTeam,
                normalized_game_id: normalizeGameId(rawTeam?.game?.slug ?? rawTeam?.game?.name),
              }
              : null

            if (existing) {
              mergedById.set(key, {
                ...remote,
                ...existing,
                gameStats: existing.gameStats || {},
                team: existing.team || normalizedTeam,
                teamGameId: existing.teamGameId || normalizedTeam?.normalized_game_id || null,
              })
              continue
            }

            mergedById.set(key, {
              ...remote,
              team: normalizedTeam,
              teamGameId: normalizedTeam?.normalized_game_id || null,
              gameStats: {},
            })
          }

          return [...mergedById.values()]
        })
      } catch {
        // Search assist is best-effort; keep current list if request fails.
      }
    }, 110)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [normalizedSearch])

  const gamePlayers = useMemo(() => {
    return players
      .map(player => {
        const playerTeamGameId = player.teamGameId || player.team?.normalized_game_id || null
        if (!playerTeamGameId || playerTeamGameId !== selectedGameId) return null

        const scoped = player.gameStats?.[selectedGameId]

        if (!scoped) {
          return {
            ...player,
            sampleMatches: 0,
            kd: 0,
            hsPct: 0,
            winRate: 0,
            impact: 0,
            team: player.team || null,
            role: normalizeRoleForGame(player.role, selectedGameId),
          }
        }

        return {
          ...player,
          ...scoped,
          team: scoped.team || player.team || null,
          role: scoped.role || normalizeRoleForGame(player.role, selectedGameId),
        }
      })
        .filter(Boolean)
  }, [players, selectedGameId])

  const visiblePlayers = useMemo(() => {
    const q = normalizedSearch

    const filtered = gamePlayers.filter(p => {
      if (!q) return true
      const nickname = normalizeSearchText(p.nickname)
      const realName = normalizeSearchText(p.real_name)
      return nickname.includes(q) || realName.includes(q)
    })

    filtered.sort((a, b) => {
      if (sortKey === 'kd') return b.kd - a.kd
      if (sortKey === 'acs') return (b.acs || 0) - (a.acs || 0)
      if (sortKey === 'hs') return b.hsPct - a.hsPct
      if (sortKey === 'wr') return b.winRate - a.winRate
      return b.impact - a.impact
    })

    return filtered
  }, [gamePlayers, normalizedSearch, sortKey])

  useEffect(() => {
    if (!compareMode) return
    if (visiblePlayers.length === 0) return
    if (!compareAId || !visiblePlayers.some(player => String(player.id) === String(compareAId))) {
      setCompareAId(String(visiblePlayers[0].id))
    }
    if (!compareBId || !visiblePlayers.some(player => String(player.id) === String(compareBId))) {
      setCompareBId(String(visiblePlayers[1]?.id || ''))
    }
  }, [visiblePlayers, compareAId, compareBId, compareMode])

  const compareA = useMemo(() => visiblePlayers.find(p => String(p.id) === String(compareAId)) || null, [visiblePlayers, compareAId])
  const compareB = useMemo(() => visiblePlayers.find(p => String(p.id) === String(compareBId)) || null, [visiblePlayers, compareBId])

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '24px 16px 80px', color: 'var(--text-1)', position: 'relative' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: 'radial-gradient(circle at 10% 10%, rgba(194,92,208,.18), transparent 36%), radial-gradient(circle at 90% 4%, rgba(255,255,255,.06), transparent 28%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '.5px' }}>Oyuncu Keşif Motoru</h1>
          {metricsSource === 'player_match_stats' && <DeepScoutBadge />}
        </div>
        <p style={{ margin: '8px 0 16px', color: 'var(--text-2)', fontSize: 13 }}>
          Seçili oyuna göre oyuncuları K/D, ACS ve Impact'e göre sıralayın.
          {metricsSource === 'player_match_stats'
            ? <span style={{ color: '#C25CD0' }}> · Gerçek maç istatistikleri</span>
            : <span style={{ color: 'var(--text-4)' }}> · Takım bazlı tahmin</span>}
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <GameFilterTabs activeGame={selectedGameId} setActiveGame={setActiveGame} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--text-1)', fontSize: 12, fontWeight: 700 }}>
            <input
              type='checkbox'
              checked={compareMode}
              onChange={e => setCompareMode(e.target.checked)}
              style={{ accentColor: '#c8102e', width: 16, height: 16 }}
            />
            Compare Mode
          </label>
        </div>

        {compareMode && (
          <div style={{
            border: '1px solid var(--line)',
            background: 'var(--surface)',
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 11, color: '#ff9aa9', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', marginBottom: 10 }}>
              Compare
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginBottom: 10 }}>
              <select value={compareAId} onChange={e => setCompareAId(e.target.value)} style={{ height: 36, borderRadius: 10, border: '1px solid var(--text-6)', background: 'var(--surface)', color: 'var(--text)', padding: '0 10px' }}>
                <option value=''>Oyuncu A sec</option>
                {visiblePlayers.map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
              </select>
              <select value={compareBId} onChange={e => setCompareBId(e.target.value)} style={{ height: 36, borderRadius: 10, border: '1px solid var(--text-6)', background: 'var(--surface)', color: 'var(--text)', padding: '0 10px' }}>
                <option value=''>Oyuncu B sec</option>
                {visiblePlayers.map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10 }}>
              <CompareCard player={compareA} onClear={() => setCompareAId('')} />
              <CompareCard player={compareB} onClear={() => setCompareBId('')} />
            </div>
          </div>
        )}

        <div style={{
          border: '1px solid var(--line)',
          background: 'var(--surface)',
          borderRadius: 14,
          padding: 14,
          marginBottom: 14,
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 10,
          alignItems: 'center',
        }}>
          <div style={{ position: 'relative' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder='Oyuncu ara (nick veya gerçek isim)...'
              style={{ height: 38, width: '100%', borderRadius: 12, border: '1px solid var(--text-6)', background: 'var(--surface)', color: 'var(--text)', padding: '0 38px 0 12px', outline: 'none' }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Aramayı temizle"
                style={{ position: 'absolute', right: 8, top: 7, width: 24, height: 24, borderRadius: 8, border: '1px solid var(--text-6)', background: 'var(--surface-2)', color: 'var(--text-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
              >
                <XIcon size={13} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value)}
              style={{ height: 38, borderRadius: 12, border: '1px solid var(--text-6)', background: 'var(--surface)', color: 'var(--text)', padding: '0 10px' }}
            >
              <option value='impact'>Etki Skoru</option>
              <option value='kd'>K/D</option>
              <option value='acs'>ACS</option>
              <option value='hs'>Headshot %</option>
              <option value='wr'>Kazanma Oranı</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
          {visiblePlayers.length} oyuncu listelendi · {GAMES.find(game => game.id === selectedGameId)?.label || selectedGameId}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{
            border: '1px solid var(--line)',
            borderRadius: 14,
            overflow: 'hidden',
            background: 'var(--surface)',
            minWidth: 930,
          }}>
            <div style={{
            display: 'grid',
            gridTemplateColumns: '1.7fr 1.2fr .7fr .7fr .7fr .7fr .7fr .6fr',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid var(--line)',
            fontSize: 11,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '.5px',
          }}>
            <div>Oyuncu</div>
            <div>Takım</div>
            <div>K/D</div>
            <div>ACS</div>
            <div>HS%</div>
            <div>Kaz.%</div>
            <div>Etki</div>
            <div>Takip</div>
          </div>

            {loading && <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 13 }}>Oyuncular yukleniyor...</div>}
            {!loading && error && <div style={{ padding: 18, color: '#ff6a7f', fontSize: 13 }}>{error}</div>}
            {!loading && !error && visiblePlayers.length === 0 && (
              <div style={{ padding: 26, textAlign: 'center' }}>
                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}><SearchX size={26} color="var(--text-5)" /></div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>Oyuncu Bulunamadı</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Arama kelimesini sadeleştirip tekrar deneyin ya da oyun filtresini değiştirin.
                </div>
              </div>
            )}

            {!loading && !error && visiblePlayers.map((player, idx) => {
            const followed = isPlayerFollowed(player.id)
            const roleBadge = getRoleBadge(player.role)
            const showRoleBadge = roleBadge !== null
            return (
              <div
                key={player.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.7fr 1.2fr .7fr .7fr .7fr .7fr .7fr .6fr',
                  gap: 8,
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--surface-2)',
                  background: idx < 3 ? 'linear-gradient(90deg, rgba(194,92,208,.11), transparent 58%)' : 'transparent',
                }}
              >
                <div
                  onClick={() => navigate(`/player/${player.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, cursor: 'pointer' }}
                >
                  <InitialsImage
                    src={player.image_url}
                    alt={player.nickname || ''}
                    name={player.nickname}
                    width={34}
                    height={34}
                    borderRadius='50%'
                    objectFit='cover'
                    style={{ border: '1px solid var(--text-6)' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.nickname || 'Unknown'}</div>
                    {showRoleBadge && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', marginTop: 3, padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: roleBadge.bg, color: roleBadge.color, border: `1px solid ${roleBadge.border}` }}>
                      {roleBadge.label}
                    </div>
                  )}
                  </div>
                </div>

                <div
                  onClick={() => player.team?.id && navigate(`/team/${player.team.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: player.team?.id ? 'pointer' : 'default', minWidth: 0 }}
                >
                  <InitialsImage
                    src={player.team?.logo_url}
                    alt={player.team?.name || ''}
                    name={player.team?.name}
                    width={24}
                    height={24}
                    borderRadius={6}
                    objectFit='contain'
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.team?.name || 'Free Agent'}</span>
                </div>

                <div style={{ fontWeight: 700 }}>{fmt(player.kd)}</div>
                <div style={{ fontWeight: 700, color: player.acs != null ? '#C25CD0' : 'var(--text-5)' }}>{player.acs != null ? player.acs : '—'}</div>
                <div style={{ fontWeight: 700, color: player.hsPct > 0 ? 'var(--text-1)' : 'var(--text-5)' }}>{player.hsPct > 0 ? `${Math.round(player.hsPct)}%` : '—'}</div>
                <div style={{ fontWeight: 700 }}>{Math.round(player.winRate)}%</div>
                <div style={{ color: '#ff9aa9', fontWeight: 800 }}>{Math.round(player.impact)}</div>

                <div>
                  <button
                    onClick={() => togglePlayerFollow(player.id)}
                    style={{
                      height: 30,
                      width: 30,
                      borderRadius: 8,
                      border: followed ? `1px solid ${FEXT.accent}` : '1px solid var(--text-6)',
                      background: followed ? FEXT.accentSoftBg : 'var(--surface)',
                      color: followed ? FEXT.accentText : 'var(--text-3)',
                      cursor: 'pointer', display: 'grid', placeItems: 'center',
                    }}
                    title={followed ? 'Takibi birak' : 'Takip et'}
                  >
                    <Star size={14} fill={followed ? '#FFD700' : 'none'} color={followed ? '#FFD700' : 'var(--text-3)'} />
                  </button>
                </div>
              </div>
            )
            })}
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-4)' }}>
          Not: Oyuncular istatistikleri olmasa bile arama sonuclarinda listelenir. Faker/Caps gibi isimler dogrudan bulunabilir.
        </div>
      </div>
    </div>
  )
}
