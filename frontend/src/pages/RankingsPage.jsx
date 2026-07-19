import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useGame, GAMES } from '../context/GameContext'
import { useUser } from '../context/UserContext'
import { correctedScores } from '../utils/matchResult'
import { normalizeGameId } from '../utils/gameUtils'
import { Medal, Star } from 'lucide-react'
import { FEXT } from '../theme'

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

function buildPowerRankings(matches, gameLabel = 'Global') {
  const map = new Map()
  const nowMs = Date.now()

  for (const m of (matches || [])) {
    const tier = tierKey(m?.tournament?.tier)
    const tierStr = TIER_STRENGTH[tier]
    const recW = recencyWeight(m?.scheduled_at, nowMs)
    const matchW = tierStr * recW // maç ağırlığı: hem tier hem güncellik

    // Hafif sorgu: takım objesi yerine id'ler geliyor (hız için).
    const cs = correctedScores({
      team_a_score: m?.team_a_score, team_b_score: m?.team_b_score,
      team_a_id: m?.team_a_id, team_b_id: m?.team_b_id, winner_id: m?.winner_id,
    })
    const teams = [
      { id: m?.team_a_id, score: toNum(cs.team_a_score), oppScore: toNum(cs.team_b_score) },
      { id: m?.team_b_id, score: toNum(cs.team_b_score), oppScore: toNum(cs.team_a_score) },
    ]

    for (const t of teams) {
      if (!t.id) continue

      if (!map.has(t.id)) {
        map.set(t.id, {
          teamId: t.id, gameName: gameLabel,
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
    .map(x => {
      const decided = x.wins + x.losses
      const winRate = decided > 0 ? (x.wins / decided) * 100 : 0
      const weightedWinRate = x.sumW > 0 ? x.sumWinW / x.sumW : 0        // 0..1 (tier+güncellik ağırlıklı)
      const scheduleStrength = x.strDen > 0 ? x.strNum / x.strDen : 0    // 0..1 (karşılaşılan seviye)
      const recentRate = x.recent.length > 0 ? (x.recent.reduce((a, b) => a + b, 0) / x.recent.length) * 100 : winRate

      // ÇARPIMSAL model: tier güç TAVANINI belirler. Bir takım ancak yüksek tier'da
      // kazanarak yükselebilir → düşük-tier bir takım yüksek-tier şampiyonu ASLA geçemez.
      const powerScore = clamp(100 * weightedWinRate * (0.35 + 0.65 * scheduleStrength), 0, 100)
      const impactScore = clamp(scheduleStrength * 100, 0, 100) // "Kalite": program gücü (0..100)
      const rating = Math.round(powerScore * 10)               // 0..1000 puan (yüzde değil)

      return { ...x, winRate, recentRate, impactScore, scheduleStrength, powerScore, rating }
    })
    // İnternet-kafe / tek-turnuva çok alt-tier takımları listeye ALMA:
    // yeterli maç (≥6) + ortalama en az ~C seviyesi rekabet (sadece unranked/D → elenir).
    .filter(x => x.total >= 6 && x.scheduleStrength >= 0.21)
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
              border: active ? `1px solid ${game.color}` : '1px solid var(--line)',
              background: active ? `${game.color}22` : 'var(--surface)',
              color: active ? '#ffffff' : 'var(--text-3)',
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
      // 'all' iken çekme: diğer effect az sonra oyunu default'a çevirip yeniden
      // tetikler. Aksi halde ilk yüklemede boşa 12-sayfalık tüm-oyun taraması olur.
      if (!activeGame || activeGame === 'all') return

      setLoading(true)
      setError('')

      try {
        // Oyun id'lerini çöz (mükerrer kayıtlar dahil) → maçları SUNUCU-taraflı oyuna göre çek.
        // Eskiden tüm oyunlar 9000 limitiyle birlikte çekiliyordu; CS2 hacmi bütçeyi yiyip
        // Valorant/LoL'ü "aç bırakıyordu" (maç sayısı artmıyor hissi). Artık her oyun kendi penceresini alır.
        const { data: games } = await supabase.from('games').select('id,name,slug')
        const gameIds = resolveGameIds(activeGame, games)
        const gameLabel = GAMES.find(g => g.id === activeGame)?.label || activeGame
        const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

        const applyFilters = (q) => {
          let out = q.eq('status', 'finished').not('winner_id', 'is', null).gte('scheduled_at', since)
          if (gameIds.length) out = out.in('game_id', gameIds)
          return out
        }

        // Kaç sayfa gerektiğini öğren (PostgREST max-rows=1000 → tek istekle hepsini alamayız).
        const { count } = await applyFilters(
          supabase.from('matches').select('id', { count: 'exact', head: true })
        )
        const PAGE = 1000
        const MAX_ROWS = 12000
        const total = Math.min(count || 0, MAX_ROWS)
        const pageCount = Math.max(1, Math.ceil(total / PAGE))

        // HAFİF sorgu (takım embed'i YOK, sadece id'ler + tier) + PARALEL sayfalar → hız.
        const pageReqs = []
        for (let i = 0; i < pageCount; i++) {
          pageReqs.push(
            applyFilters(
              supabase
                .from('matches')
                .select('team_a_id,team_b_id,winner_id,team_a_score,team_b_score,scheduled_at,tournament:tournaments(tier)')
            )
              .order('scheduled_at', { ascending: false })
              .range(i * PAGE, i * PAGE + PAGE - 1)
          )
        }
        const pageResults = await Promise.all(pageReqs)
        if (cancelled) return
        const firstErr = pageResults.find(r => r.error)
        if (firstErr) throw firstErr.error
        const allMatches = pageResults.flatMap(r => r.data || [])

        const ranked = buildPowerRankings(allMatches, gameLabel)

        // Takım isim/logosunu SADECE listeye girenler için çek (paralel, 200'lük parçalar).
        const ids = ranked.map(r => r.teamId)
        const teamById = new Map()
        const chunks = []
        for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200))
        const teamResults = await Promise.all(
          chunks.map(chunk => supabase.from('teams').select('id,name,logo_url,acronym').in('id', chunk))
        )
        if (cancelled) return
        for (const res of teamResults) for (const t of (res.data || [])) teamById.set(t.id, t)

        const computed = ranked.map(r => ({
          ...r,
          team: teamById.get(r.teamId) || { name: 'Unknown Team', logo_url: null },
        }))
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
      maxWidth: 1440,
      margin: '0 auto',
      padding: '24px 16px 80px',
      color: 'var(--text-1)',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: 'radial-gradient(circle at 8% 10%, rgba(194,92,208,.18), transparent 36%), radial-gradient(circle at 88% 0%, rgba(255,255,255,.06), transparent 28%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 30, letterSpacing: '.5px' }}>Güç Sıralaması</h1>
          <p style={{ margin: '8px 0 0', color: 'var(--text-2)', fontSize: 13 }}>
            Son 6 ayin maclari; turnuva tier'i ve guncellik agirlikli guc siralamasi.
          </p>
          <p style={{ margin: '6px 0 0', color: 'var(--text-4)', fontSize: 12 }}>
            Tier tavani belirler: dusuk tier bir takim yuksek tier bir sampiyonu gecemez. Siralama tek oyuna gore.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
          gap: 12,
          marginBottom: 16,
        }}>
          <div style={{ background: '#131b2bd9', border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Lider</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 18 }}>{top?.team?.name || '—'}</div>
            <div style={{ marginTop: 2, fontSize: 12, color: '#d74a61' }}>{top ? `${top.rating} Puan` : 'Veri bekleniyor'}</div>
          </div>
          <div style={{ background: '#131b2bd9', border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Listelenen Takim</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 22 }}>{filtered.length}</div>
            <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-1)' }}>Min. 6 mac · gercek turnuva</div>
          </div>
          <div style={{ background: '#131b2bd9', border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Model</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 16 }}>Power = Form × Tier × Güncellik</div>
            <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-1)' }}>Kalite: karşılaşılan tier (güncellik ağırlıklı)</div>
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
                border: '1px solid var(--text-6)',
                background: 'var(--surface)',
                color: '#fff',
                padding: '0 12px',
                fontSize: 12,
                outline: 'none',
              }}
            />
            {[
              { key: 'power', label: 'Power' },
              { key: 'impact', label: 'Kalite' },
              { key: 'winrate', label: 'Kazanma Oranı' },
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
                    border: active ? `1px solid ${FEXT.accent}` : '1px solid var(--line)',
                    background: active ? FEXT.accent : 'var(--surface)',
                    color: active ? '#ffffff' : 'var(--text-2)',
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
            border: '1px solid var(--line)',
            borderRadius: 14,
            overflow: 'hidden',
            background: 'var(--surface)',
            minWidth: 860,
          }}>
            <div style={{
            display: 'grid',
            gridTemplateColumns: '70px 1.6fr 1fr .9fr .9fr .9fr .8fr',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid var(--line)',
            fontSize: 11,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '.5px',
          }}>
            <div>Rank</div>
            <div>Team</div>
            <div>Record</div>
            <div>Kazanma Oranı</div>
            <div>Kalite</div>
            <div>Power</div>
            <div>Follow</div>
          </div>

            {loading && (
              <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 13 }}>Siralama verileri yukleniyor...</div>
            )}

            {!loading && error && (
              <div style={{ padding: 18, color: '#ff6a7f', fontSize: 13 }}>{error}</div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div style={{ padding: 18, color: 'var(--text-3)', fontSize: 13 }}>Filtreye uygun takim bulunamadi.</div>
            )}

            {!loading && !error && filtered.map((row, idx) => {
            const followed = isTeamFollowed(row.teamId)
            const medalColor = idx === 0 ? '#f0c040' : idx === 1 ? 'var(--text-2)' : idx === 2 ? '#cd7f32' : null

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
                  borderBottom: '1px solid var(--surface-2)',
                  cursor: 'pointer',
                  background: idx < 3 ? 'linear-gradient(90deg, rgba(194,92,208,.12), transparent 55%)' : 'transparent',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = idx < 3 ? 'linear-gradient(90deg, rgba(194,92,208,.12), transparent 55%)' : 'transparent' }}
              >
                <div style={{ fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {medalColor && <Medal size={16} color={medalColor} strokeWidth={2.2} />} #{idx + 1}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {row.team?.logo_url ? (
                    <img src={row.team.logo_url} alt={row.team?.name || ''} style={{ width: 30, height: 30, objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2)' }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.team?.name || 'Unknown Team'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{row.gameName || 'Global'}</div>
                  </div>
                </div>

                <div style={{ fontSize: 13 }}>
                  <span style={{ color: '#6dde90', fontWeight: 700 }}>{row.wins}W</span>
                  <span style={{ color: 'var(--text-4)' }}> / </span>
                  <span style={{ color: '#ef6a77', fontWeight: 700 }}>{row.losses}L</span>
                </div>

                <div style={{ fontWeight: 700 }}>{formatPercent(row.winRate)}</div>
                <div style={{ color: '#ff9aa9', fontWeight: 700 }}>{Math.round(row.impactScore)}</div>
                <div style={{ color: '#ffffff', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{row.rating}</div>

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
                      border: followed ? `1px solid ${FEXT.accent}` : '1px solid var(--line)',
                      background: followed ? FEXT.accentSoftBg : 'var(--surface)',
                      color: followed ? '#fff' : 'var(--text-3)',
                      cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    title={followed ? 'Takibi birak' : 'Takip et'}
                  >
                    <Star size={15} fill={followed ? '#FFD700' : 'none'} color={followed ? '#FFD700' : 'var(--text-3)'} />
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
