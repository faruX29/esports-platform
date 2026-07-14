import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useGame, GAMES } from '../context/GameContext'
import { useUser } from '../context/UserContext'
import { correctedScores } from '../utils/matchResult'
import { normalizeGameId } from '../utils/gameUtils'

function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function formatPercent(v) {
  return `${Math.round(v)}%`
}

// Turnuva tier gücü. DB'de tier BÜYÜK/küçük harf karışık + NULL geliyor → normalize.
// Bu ağırlık hem "karşılaşılan seviye" (program gücü) hem güç tavanı olarak kullanılır.
const TIER_STRENGTH = { s: 1.0, a: 0.66, b: 0.42, c: 0.24, d: 0.12, unranked: 0.18 }

function tierKey(tier) {
  const t = String(tier || '').trim().toLowerCase()
  return ['s', 'a', 'b', 'c', 'd'].includes(t) ? t : 'unranked'
}

// Güncellik ağırlığı: son maçlar daha değerli (τ=120 gün → ~83 günde yarı etki).
function recencyWeight(iso, nowMs) {
  if (!iso) return 0.25
  const ageDays = Math.max(0, (nowMs - new Date(iso).getTime()) / 86400000)
  return Math.exp(-ageDays / 120)
}

// Kanonik oyuna ait TÜM game_id'ler (mükerrer kayıtlar dahil: CS2 id=2/8, LoL id=3/9).
function resolveGameIds(activeGame, games) {
  const canonical = normalizeGameId(activeGame) ?? String(activeGame || '').toLowerCase()
  const ids = (games || [])
    .filter(g => normalizeGameId(g?.slug ?? g?.name) === canonical)
    .map(g => g?.id)
    .filter(id => id != null)
  return [...new Set(ids)]
}

function buildPowerRankings(matches) {
  const map = new Map()
  const nowMs = Date.now()

  for (const m of (matches || [])) {
    const gameName = m?.game?.name || ''
    const tier = tierKey(m?.tournament?.tier)
    const tierStr = TIER_STRENGTH[tier]
    const recW = recencyWeight(m?.scheduled_at, nowMs)
    const matchW = tierStr * recW // maç ağırlığı: hem tier hem güncellik

    // Skorları winner_id ile tutarlı hale getir (ters-atanmış skor quirk'i)
    const cs = correctedScores({
      team_a_score: m?.team_a_score, team_b_score: m?.team_b_score,
      team_a_id: m?.team_a?.id, team_b_id: m?.team_b?.id, winner_id: m?.winner_id,
    })
    const teams = [
      { id: m?.team_a?.id, data: m?.team_a, score: toNum(cs.team_a_score), oppScore: toNum(cs.team_b_score) },
      { id: m?.team_b?.id, data: m?.team_b, score: toNum(cs.team_b_score), oppScore: toNum(cs.team_a_score) },
    ]

    for (const t of teams) {
      if (!t.id || !t.data) continue

      if (!map.has(t.id)) {
        map.set(t.id, {
          teamId: t.id, team: t.data, gameName,
          wins: 0, losses: 0, total: 0,
          sumW: 0, sumWinW: 0, strNum: 0, strDen: 0,
          recent: [],
        })
      }

      const entry = map.get(t.id)
      entry.total += 1

      // Sonuç winner_id ÖNCELİKLİ. Skorlar eşitse (Bo2 1:1 / 0:0) beraberlik → W/L sayılmaz.
      let outcome = null
      if (m?.winner_id != null) {
        outcome = Number(m.winner_id) === Number(t.id) ? 'W' : 'L'
      } else if (t.score != null && t.oppScore != null && t.score !== t.oppScore) {
        outcome = t.score > t.oppScore ? 'W' : 'L'
      }

      if (outcome === 'W') { entry.wins += 1; entry.sumWinW += matchW }
      else if (outcome === 'L') { entry.losses += 1 }
      if (outcome) entry.sumW += matchW // ağırlıklı galibiyet oranının paydası (kararlı maçlar)

      // Program gücü: karşılaşılan tier'ın güncellik-ağırlıklı ortalaması (0..1)
      entry.strNum += tierStr * recW
      entry.strDen += recW

      if (entry.recent.length < 10 && outcome) {
        entry.recent.push(outcome === 'W' ? 1 : 0)
      }
    }
  }

  return [...map.values()]
    .filter(x => x.total >= 5)
    .map(x => {
      const decided = x.wins + x.losses
      const winRate = decided > 0 ? (x.wins / decided) * 100 : 0
      const weightedWinRate = x.sumW > 0 ? x.sumWinW / x.sumW : 0        // 0..1 (tier+güncellik ağırlıklı)
      const scheduleStrength = x.strDen > 0 ? x.strNum / x.strDen : 0    // 0..1 (karşılaşılan seviye)
      const recentRate = x.recent.length > 0 ? (x.recent.reduce((a, b) => a + b, 0) / x.recent.length) * 100 : winRate

      // ÇARPIMSAL model: tier güç TAVANINI belirler. Bir takım ancak yüksek tier'da
      // kazanarak yükselebilir → B-tier bir takım (tavan ~62) bir S-tier şampiyonu (70+) ASLA geçemez.
      const powerScore = clamp(100 * weightedWinRate * (0.35 + 0.65 * scheduleStrength), 0, 100)
      const impactScore = clamp(scheduleStrength * 100, 0, 100) // "Kalite" sütunu: program gücü

      return { ...x, winRate, recentRate, impactScore, scheduleStrength, powerScore }
    })
    .sort((a, b) => b.powerScore - a.powerScore)
}

function GameFilterTabs({ activeGame, setActiveGame }) {
  const games = GAMES.filter(g => !g.soon && g.id !== 'all')

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
              border: active ? `1px solid ${game.color}` : '1px solid #2a2a2a',
              background: active ? `${game.color}22` : '#121212',
              color: active ? '#ffffff' : '#9e9e9e',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.2px',
              cursor: 'pointer',
            }}
          >
            {game.icon} {game.shortLabel || game.label}
          </button>
        )
      })}
    </div>
  )
}

export default function RankingsPage() {
  const navigate = useNavigate()
  const { activeGame, setActiveGame } = useGame()
  const { isTeamFollowed, toggleTeamFollow } = useUser()
  const defaultGameId = GAMES.find(g => !g.soon && g.id !== 'all')?.id || 'valorant'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('power')
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!activeGame || activeGame === 'all') {
      setActiveGame(defaultGameId)
    }
  }, [activeGame, setActiveGame, defaultGameId])

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError('')

      try {
        // Oyun id'lerini çöz (mükerrer kayıtlar dahil) → maçları SUNUCU-taraflı oyuna göre çek.
        // Eskiden tüm oyunlar 9000 limitiyle birlikte çekiliyordu; CS2 hacmi bütçeyi yiyip
        // Valorant/LoL'ü "aç bırakıyordu" (maç sayısı artmıyor hissi). Artık her oyun kendi penceresini alır.
        const { data: games } = await supabase.from('games').select('id,name,slug')
        const gameIds = resolveGameIds(activeGame, games)
        const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

        // PostgREST max-rows=1000 → .limit(9000) 1000'e kırpılıyordu (ranking son ~1000 maça
        // bakıyordu, 6 ayın tamamına değil). Bütün pencereyi SAYFALAYARAK çekiyoruz.
        const PAGE = 1000
        const MAX_ROWS = 12000
        let allMatches = []
        for (let from = 0; from < MAX_ROWS; from += PAGE) {
          let query = supabase
            .from('matches')
            .select(`
              id,
              scheduled_at,
              status,
              winner_id,
              team_a_score,
              team_b_score,
              team_a:teams!matches_team_a_id_fkey(id,name,logo_url,acronym),
              team_b:teams!matches_team_b_id_fkey(id,name,logo_url,acronym),
              game:games(name),
              tournament:tournaments(tier)
            `)
            .eq('status', 'finished')
            .not('winner_id', 'is', null)
            .gte('scheduled_at', since)
            .order('scheduled_at', { ascending: false })
            .range(from, from + PAGE - 1)

          if (gameIds.length) query = query.in('game_id', gameIds)

          const { data: page, error: fetchErr } = await query
          if (fetchErr) throw fetchErr
          if (cancelled) return

          allMatches = allMatches.concat(page || [])
          if (!page || page.length < PAGE) break
        }

        const computed = buildPowerRankings(allMatches)
        setRows(computed)
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Power rankings yuklenemedi.')
          setRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [activeGame])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? rows.filter(r => (r.team?.name || '').toLowerCase().includes(q) || (r.team?.acronym || '').toLowerCase().includes(q))
      : rows

    const sorted = [...base]
    sorted.sort((a, b) => {
      if (sortKey === 'winrate') return b.winRate - a.winRate
      if (sortKey === 'impact') return b.impactScore - a.impactScore
      if (sortKey === 'wins') return b.wins - a.wins
      return b.powerScore - a.powerScore
    })
    return sorted
  }, [rows, query, sortKey])

  const top = filtered[0]

  return (
    <div style={{
      maxWidth: 1160,
      margin: '0 auto',
      padding: '24px 16px 80px',
      color: '#f5f5f5',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: 'radial-gradient(circle at 8% 10%, rgba(200,16,46,.18), transparent 36%), radial-gradient(circle at 88% 0%, rgba(255,255,255,.08), transparent 28%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '.5px' }}>Global Power Rankings</h1>
          <p style={{ margin: '8px 0 0', color: '#a8a8a8', fontSize: 13 }}>
            Son 6 ayin maclari; turnuva tier'i ve guncellik agirlikli guc siralamasi.
          </p>
          <p style={{ margin: '6px 0 0', color: '#7f7f7f', fontSize: 12 }}>
            Tier tavani belirler: dusuk tier bir takim yuksek tier bir sampiyonu gecemez. Siralama tek oyuna gore.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
          gap: 12,
          marginBottom: 16,
        }}>
          <div style={{ background: '#111111d9', border: '1px solid #2a2a2a', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#9a9a9a' }}>Lider</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 18 }}>{top?.team?.name || '—'}</div>
            <div style={{ marginTop: 2, fontSize: 12, color: '#d74a61' }}>{top ? `${formatPercent(top.powerScore)} Power` : 'Veri bekleniyor'}</div>
          </div>
          <div style={{ background: '#111111d9', border: '1px solid #2a2a2a', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#9a9a9a' }}>Listelenen Takim</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 22 }}>{filtered.length}</div>
            <div style={{ marginTop: 2, fontSize: 12, color: '#d0d0d0' }}>Min. 5 tamamlanmis mac</div>
          </div>
          <div style={{ background: '#111111d9', border: '1px solid #2a2a2a', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#9a9a9a' }}>Model</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 16 }}>Power = Form × Tier × Güncellik</div>
            <div style={{ marginTop: 2, fontSize: 12, color: '#d0d0d0' }}>Kalite: karşılaşılan tier (güncellik ağırlıklı)</div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          marginBottom: 14,
        }}>
          <GameFilterTabs activeGame={activeGame} setActiveGame={setActiveGame} />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Takim ara...'
              style={{
                height: 34,
                minWidth: 180,
                borderRadius: 10,
                border: '1px solid #343434',
                background: '#121212',
                color: '#fff',
                padding: '0 12px',
                fontSize: 12,
                outline: 'none',
              }}
            />
            {[
              { key: 'power', label: 'Power' },
              { key: 'impact', label: 'Kalite' },
              { key: 'winrate', label: 'Win Rate' },
              { key: 'wins', label: 'Wins' },
            ].map(btn => {
              const active = sortKey === btn.key
              return (
                <button
                  key={btn.key}
                  onClick={() => setSortKey(btn.key)}
                  style={{
                    height: 34,
                    borderRadius: 10,
                    border: active ? '1px solid #c8102e' : '1px solid #2b2b2b',
                    background: active ? 'rgba(200,16,46,.2)' : '#101010',
                    color: active ? '#ffffff' : '#a4a4a4',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '0 12px',
                    cursor: 'pointer',
                  }}
                >
                  {btn.label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{
            border: '1px solid #2b2b2b',
            borderRadius: 14,
            overflow: 'hidden',
            background: '#0f0f0f',
            minWidth: 860,
          }}>
            <div style={{
            display: 'grid',
            gridTemplateColumns: '70px 1.6fr 1fr .9fr .9fr .9fr .8fr',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid #232323',
            fontSize: 11,
            color: '#8f8f8f',
            textTransform: 'uppercase',
            letterSpacing: '.5px',
          }}>
            <div>Rank</div>
            <div>Team</div>
            <div>Record</div>
            <div>Win Rate</div>
            <div>Kalite</div>
            <div>Power</div>
            <div>Follow</div>
          </div>

            {loading && (
              <div style={{ padding: 18, color: '#8f8f8f', fontSize: 13 }}>Siralama verileri yukleniyor...</div>
            )}

            {!loading && error && (
              <div style={{ padding: 18, color: '#ff6a7f', fontSize: 13 }}>{error}</div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div style={{ padding: 18, color: '#8f8f8f', fontSize: 13 }}>Filtreye uygun takim bulunamadi.</div>
            )}

            {!loading && !error && filtered.map((row, idx) => {
            const followed = isTeamFollowed(row.teamId)
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : ''

            return (
              <div
                key={row.teamId}
                onClick={() => navigate(`/team/${row.teamId}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '70px 1.6fr 1fr .9fr .9fr .9fr .8fr',
                  gap: 8,
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderBottom: '1px solid #1d1d1d',
                  cursor: 'pointer',
                  background: idx < 3 ? 'linear-gradient(90deg, rgba(200,16,46,.12), transparent 55%)' : 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.03)' }}
                onMouseLeave={e => { e.currentTarget.style.background = idx < 3 ? 'linear-gradient(90deg, rgba(200,16,46,.12), transparent 55%)' : 'transparent' }}
              >
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {medal} #{idx + 1}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {row.team?.logo_url ? (
                    <img src={row.team.logo_url} alt={row.team?.name || ''} style={{ width: 30, height: 30, objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: '#1f1f1f' }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.team?.name || 'Unknown Team'}</div>
                    <div style={{ fontSize: 11, color: '#8b8b8b' }}>{row.gameName || 'Global'}</div>
                  </div>
                </div>

                <div style={{ fontSize: 13 }}>
                  <span style={{ color: '#6dde90', fontWeight: 700 }}>{row.wins}W</span>
                  <span style={{ color: '#6a6a6a' }}> / </span>
                  <span style={{ color: '#ef6a77', fontWeight: 700 }}>{row.losses}L</span>
                </div>

                <div style={{ fontWeight: 700 }}>{formatPercent(row.winRate)}</div>
                <div style={{ color: '#ff9aa9', fontWeight: 700 }}>{formatPercent(row.impactScore)}</div>
                <div style={{ color: '#ffffff', fontWeight: 800 }}>{formatPercent(row.powerScore)}</div>

                <div>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      toggleTeamFollow(row.teamId)
                    }}
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
      </div>
    </div>
  )
}
