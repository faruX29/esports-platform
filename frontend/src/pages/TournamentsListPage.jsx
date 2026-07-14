import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { GAMES, useGame } from '../context/GameContext'
import { normalizeGameId } from '../utils/gameUtils'
import InitialsImage from '../components/InitialsImage'

// Kanonik oyuna ait TÜM game_id'ler (mükerrer kayıtlar dahil: CS2 2/8, LoL 3/9).
function resolveGameIds(activeGame, games) {
  if (!activeGame || activeGame === 'all') return []
  const canonical = normalizeGameId(activeGame) ?? String(activeGame).toLowerCase()
  return [...new Set((games || [])
    .filter(g => normalizeGameId(g?.slug ?? g?.name) === canonical)
    .map(g => g?.id)
    .filter(id => id != null))]
}

// Oyun etiketi normalize (DB'de "Cs-Go"/"League-Of-Legends" gibi çirkin slug'lar var).
function gameMeta(game) {
  const canonical = normalizeGameId(game?.slug ?? game?.name)
  const g = GAMES.find(x => x.id === canonical)
  return { label: g?.shortLabel || g?.label || game?.name || 'Esports', color: g?.color || '#94a3b8' }
}

const TIER_COLORS = { S: '#F0A500', A: '#C0C7D0', B: '#7f8c9a', C: '#64748b', D: '#475569' }

function normalizeTierKey(value) {
  if (!value) return null
  const normalized = String(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-')

  if (!normalized) return null
  if (normalized === 'S' || normalized.includes('S-TIER') || normalized.includes('TIER-S')) return 'S'
  if (normalized === 'A' || normalized.includes('A-TIER') || normalized.includes('TIER-A')) return 'A'
  if (normalized === 'B' || normalized.includes('B-TIER') || normalized.includes('TIER-B')) return 'B'
  if (normalized === 'C' || normalized.includes('C-TIER') || normalized.includes('TIER-C')) return 'C'

  const compact = normalized.replace(/-/g, '')
  return ['S', 'A', 'B', 'C', 'D', 'E'].includes(compact[0]) ? compact[0] : null
}

function isHeroTier(rawTier) {
  const key = normalizeTierKey(rawTier)
  return key === 'S' || key === 'A'
}

function fmtDate(iso) {
  if (!iso) return 'Tarih yok'
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return 'Tarih yok'
  return dt.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function TournamentsListPage() {
  const navigate = useNavigate()
  const { activeGame } = useGame()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showAllTiers, setShowAllTiers] = useState(false)
  const [tournaments, setTournaments] = useState([])
  const [games, setGames] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [teamsByTournament, setTeamsByTournament] = useState({})

  const PAGE_SIZE = 30

  // Oyun listesini bir kez çek (aktif oyun → game_id çözümü için).
  useEffect(() => {
    supabase.from('games').select('id,name,slug').then(({ data }) => setGames(data || []))
  }, [])

  // Arama debounce (server-side sorgu için)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  // Filtre (arama / oyun / tier) değişince başa dön + logo önbelleğini temizle.
  useEffect(() => { setPage(0); setTeamsByTournament({}) }, [debouncedSearch, activeGame, showAllTiers])

  useEffect(() => {
    let cancelled = false
    // Belirli oyun seçiliyken games henüz gelmediyse bekle (yanlışlıkla "hepsini" göstermemek için).
    if (activeGame && activeGame !== 'all' && games.length === 0) return

    async function loadTournaments() {
      page === 0 ? setLoading(true) : setLoadingMore(true)
      setError('')
      try {
        const gameIds = resolveGameIds(activeGame, games)
        let q = supabase
          .from('tournaments')
          .select('id,name,tier,region,begin_at,end_at,game:games(id,name,slug)')
        if (debouncedSearch) q = q.ilike('name', `%${debouncedSearch}%`)
        if (gameIds.length) q = q.in('game_id', gameIds)
        // Tier filtresi SUNUCU-taraflı: eskiden client-side'dı → 120'lik sayfa çoğu
        // alt-tier olunca S/A az kalıyor, sayfa dolmuyordu. Artık sayfa dolu S/A gelir.
        if (!showAllTiers) q = q.in('tier', ['S', 's', 'A', 'a'])
        // begin_at DESC + sayfalama → eski turnuvalara "Daha fazla" ile inilebilir.
        q = q.order('begin_at', { ascending: false, nullsFirst: false })
             .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

        const { data, error: queryError } = await q
        if (queryError) throw queryError
        if (cancelled) return
        setHasMore((data || []).length === PAGE_SIZE)
        setTournaments(prev => (page === 0 ? (data || []) : [...prev, ...(data || [])]))
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError?.message || 'Turnuvalar yuklenemedi.')
          if (page === 0) setTournaments([])
        }
      } finally {
        if (!cancelled) { setLoading(false); setLoadingMore(false) }
      }
    }

    loadTournaments()
    return () => { cancelled = true }
  }, [debouncedSearch, activeGame, page, games, showAllTiers])

  // Gizlenen alt-tier sayısı (S/A modunda) — server-side filtre kullandığımız için ayrı sayım.
  const [hiddenCount, setHiddenCount] = useState(0)
  useEffect(() => {
    if (showAllTiers) { setHiddenCount(0); return }
    if (activeGame && activeGame !== 'all' && games.length === 0) return
    let cancelled = false
    ;(async () => {
      const gameIds = resolveGameIds(activeGame, games)
      let q = supabase.from('tournaments').select('id', { count: 'exact', head: true })
        .or('tier.is.null,tier.not.in.(S,s,A,a)')
      if (debouncedSearch) q = q.ilike('name', `%${debouncedSearch}%`)
      if (gameIds.length) q = q.in('game_id', gameIds)
      const { count } = await q
      if (!cancelled) setHiddenCount(count || 0)
    })()
    return () => { cancelled = true }
  }, [debouncedSearch, activeGame, games, showAllTiers])

  const searchedTournaments = useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    if (!q) return tournaments
    return tournaments.filter(item => String(item?.name || '').toLowerCase().includes(q))
  }, [search, tournaments])

  const visibleTournaments = useMemo(() => {
    if (showAllTiers) return searchedTournaments
    return searchedTournaments.filter(item => isHeroTier(item?.tier))
  }, [searchedTournaments, showAllTiers])


  // Kartlara katılan takım logolarını çek (isim sadece "Playoffs"/"Group A" → logolar bağlam verir).
  // ARTIMLI: sadece henüz logosu ÇEKİLMEMİŞ turnuvaları sorgula (60'lık parça). Böylece "Daha
  // fazla" ile liste büyüdükçe üstteki turnuvalar truncate'e takılmaz, her turnuva kapsanır.
  useEffect(() => {
    const missing = visibleTournaments.map(t => t.id).filter(id => !(id in teamsByTournament))
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      const chunk = missing.slice(0, 60)
      const { data } = await supabase
        .from('matches')
        .select('tournament_id,team_a:teams!matches_team_a_id_fkey(id,name,logo_url),team_b:teams!matches_team_b_id_fkey(id,name,logo_url)')
        .in('tournament_id', chunk)
        .limit(3000)
      if (cancelled) return
      // Sorgulanan her turnuvaya anahtar ver (maçsız olsa da) → tekrar sorgulanmaz, döngü olmaz.
      const acc = {}
      for (const id of chunk) acc[id] = { seen: new Set(), list: [] }
      for (const m of (data || [])) {
        const bucket = acc[m.tournament_id] || (acc[m.tournament_id] = { seen: new Set(), list: [] })
        for (const t of [m.team_a, m.team_b]) {
          if (t?.id && !bucket.seen.has(t.id) && bucket.list.length < 6) {
            bucket.seen.add(t.id); bucket.list.push(t)
          }
        }
      }
      const out = {}
      for (const key in acc) out[key] = acc[key].list
      setTeamsByTournament(prev => ({ ...prev, ...out }))
    })()
    return () => { cancelled = true }
  }, [visibleTournaments, teamsByTournament])

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '24px 16px 80px', color: '#e2e8f0' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 30, letterSpacing: '.4px' }}>Turnuvalar</h1>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8' }}>
        Aktif ve yaklaşan turnuvalar. Detay, bracket ve puan durumu için bir turnuvaya tıkla.
      </p>

      <div style={{ marginBottom: 14 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder='Turnuva ara...'
          style={{ height: 40, width: '100%', maxWidth: 420, borderRadius: 10, border: '1px solid #26324a', background: '#131b2b', color: '#e2e8f0', padding: '0 12px', outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '.4px' }}>
          Varsayilan filtre: S-Tier + A-Tier
        </span>
        <div style={{
          display: 'inline-flex',
          borderRadius: 999,
          padding: 3,
          gap: 4,
          background: 'linear-gradient(120deg, rgba(255,70,85,.18), rgba(25,25,25,.95))',
          border: '1px solid rgba(255,70,85,.28)',
          boxShadow: '0 0 16px rgba(255,70,85,.14)',
        }}>
          <button
            onClick={() => setShowAllTiers(false)}
            style={{
              border: '1px solid transparent',
              background: showAllTiers ? 'transparent' : 'linear-gradient(135deg, rgba(255,70,85,.2), rgba(255,120,80,.18))',
              color: showAllTiers ? '#cbd5e1' : '#ffd3d9',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '.2px',
              padding: '7px 12px',
              cursor: 'pointer',
              boxShadow: showAllTiers ? 'none' : 'inset 0 0 0 1px rgba(255,120,130,.35), 0 0 14px rgba(255,70,85,.2)',
            }}
          >
            S/A Pro Pool
          </button>
          <button
            onClick={() => setShowAllTiers(true)}
            style={{
              border: '1px solid transparent',
              background: showAllTiers ? 'linear-gradient(135deg, rgba(76,175,80,.24), rgba(40,120,220,.22))' : 'transparent',
              color: showAllTiers ? '#d6f6d8' : '#cbd5e1',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '.2px',
              padding: '7px 12px',
              cursor: 'pointer',
              boxShadow: showAllTiers ? 'inset 0 0 0 1px rgba(100,220,120,.34), 0 0 14px rgba(100,200,120,.18)' : 'none',
            }}
          >
            Tumu
          </button>
        </div>
        {!showAllTiers && hiddenCount > 0 && (
          <span style={{ fontSize: 11, color: '#64748b' }}>
            {hiddenCount} alt-tier turnuva gizli
          </span>
        )}
      </div>

      {loading && <div style={{ fontSize: 13, color: '#94a3b8' }}>Turnuvalar yukleniyor...</div>}
      {!loading && error && <div style={{ fontSize: 13, color: '#ff7d91' }}>{error}</div>}

      {!loading && !error && visibleTournaments.length === 0 && (
        <div style={{ border: '1px dashed #26324a', borderRadius: 12, padding: 16, color: '#94a3b8', fontSize: 13 }}>
          Eslesen turnuva bulunamadi.
        </div>
      )}

      {!loading && !error && visibleTournaments.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10 }}>
          {visibleTournaments.map(item => {
            const gm = gameMeta(item.game)
            const tierKey = normalizeTierKey(item.tier)
            const tierColor = TIER_COLORS[tierKey] || '#475569'
            const logos = teamsByTournament[item.id] || []
            return (
              <button
                key={item.id}
                onClick={() => navigate(`/tournament/${item.id}`)}
                style={{
                  position: 'relative', overflow: 'hidden', textAlign: 'left',
                  border: '1px solid #26324a', background: '#131b2b', color: '#e2e8f0',
                  borderRadius: 12, padding: '12px 12px 12px 15px', cursor: 'pointer',
                  transition: 'border-color .15s, transform .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = `${gm.color}66`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#26324a'; e.currentTarget.style.transform = 'translateY(0)' }}
              >
                {/* sol renk şeridi (oyun) */}
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: gm.color }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name || 'Tournament'}
                  </div>
                  {tierKey && (
                    <span style={{ fontSize: 10, fontWeight: 900, color: '#0b0f19', background: tierColor, borderRadius: 5, padding: '2px 6px', flexShrink: 0, letterSpacing: '.3px' }}>
                      {tierKey}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: gm.color, fontWeight: 700 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: gm.color }} /> {gm.label}
                  </span>
                  {item.region && <span>· {item.region}</span>}
                </div>

                {logos.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 9 }}>
                    {logos.slice(0, 5).map(t => (
                      <InitialsImage key={t.id} src={t.logo_url} name={t.name} width={20} height={20} borderRadius={5} objectFit='contain' />
                    ))}
                    {logos.length > 5 && <span style={{ fontSize: 10, color: '#64748b', marginLeft: 2 }}>+{logos.length - 5}</span>}
                  </div>
                )}

                <div style={{ marginTop: 9, fontSize: 11.5, color: '#94a3b8' }}>
                  {fmtDate(item.begin_at)}
                  {item.end_at ? ` – ${fmtDate(item.end_at)}` : ''}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {!loading && !error && hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={loadingMore}
            style={{
              borderRadius: 10, border: '1px solid #26324a', background: '#131b2b',
              color: loadingMore ? '#64748b' : '#e2e8f0', fontSize: 12, fontWeight: 700,
              padding: '10px 20px', cursor: loadingMore ? 'default' : 'pointer',
            }}
          >
            {loadingMore ? 'Yükleniyor...' : 'Daha fazla göster (eski turnuvalar)'}
          </button>
        </div>
      )}
    </div>
  )
}
