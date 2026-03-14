/**
 * Matches.jsx — Dikey zaman çizelgesi
 * GameContext filtresi → Supabase sorgusuna taşındı (client-side değil)
 * Pagination: 50/sayfa, count:exact
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate }                      from 'react-router-dom'
import { supabase }                         from './supabaseClient'
import { useGame, GAMES }                   from './GameContext'
import { getFavorites, addFavorite, removeFavorite, isFavorite } from './favoritesHelper'
import { isTurkishTeam }                   from './constants'

const PAGE_SIZE = 50   // 20 → 50

const FALLBACK_GAME_IDS = {
  valorant: 1,
  cs2: 2,
  lol: 3,
}

// ── Game adı → Supabase ilike pattern'leri ──────────────────────────────────
// games tablosundaki name değerleriyle birebir eşleşmeli
const GAME_DB_PATTERNS = {
  valorant: ['Valorant', 'valorant', 'VALORANT'],
  cs2:      ['Counter-Strike 2', 'CS2', 'cs-go', 'Counter-Strike'],
  lol:      ['League of Legends', 'LoL', 'league-of-legends'],
  dota2:    ['Dota 2', 'dota'],
}

function resolveGameId(activeGame, gameNames) {
  if (!activeGame || activeGame === 'all') return null

  const normalized = String(activeGame).toLowerCase()
  const dbGame = (gameNames || []).find(g =>
    g?.slug?.toLowerCase() === normalized ||
    (normalized === 'cs2' ? g?.name?.toLowerCase()?.includes('counter') :
      normalized === 'lol' ? g?.name?.toLowerCase()?.includes('league') :
      g?.name?.toLowerCase()?.includes(normalized))
  )

  return dbGame?.id ?? FALLBACK_GAME_IDS[normalized] ?? null
}

function matchTimeIso(match) {
  return match?.scheduled_at ?? match?.begin_at ?? match?.created_at ?? null
}

function formatMatchTime(match, localeOptions) {
  const iso = matchTimeIso(match)
  if (!iso) return 'TBA'
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return 'TBA'
  return time.toLocaleString('tr-TR', localeOptions)
}

function Matches() {
  const navigate = useNavigate()
  const { activeGame } = useGame()

  const [matches, setMatches]                     = useState([])
  const [filteredMatches, setFilteredMatches]     = useState([])
  const [loading, setLoading]                     = useState(true)
  const [error, setError]                         = useState(null)
  const [searchQuery, setSearchQuery]             = useState('')
  const [sortBy, setSortBy]                       = useState('date-asc')
  const [activeTab, setActiveTab]                 = useState('upcoming')
  const [favorites, setFavorites]                 = useState([])
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [lastUpdate, setLastUpdate]               = useState(new Date())
  const [autoRefresh, setAutoRefresh]             = useState(false)
  const [gameNames, setGameNames]                 = useState([])   // DB'deki gerçek game isimleri
  const [gamesLoading, setGamesLoading]           = useState(true)

  // ── Pagination ──────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount,  setTotalCount]  = useState(0)

  // Modal
  const [selectedMatch, setSelectedMatch]             = useState(null)
  const [showModal, setShowModal]                     = useState(false)
  const [modalPlayers, setModalPlayers]               = useState({ teamA: [], teamB: [] })
  const [loadingModalPlayers, setLoadingModalPlayers] = useState(false)
  const [h2hData, setH2hData]                         = useState(null)

  // Sekme / oyun değişince 1. sayfaya dön
  useEffect(() => {
    setCurrentPage(1)
  }, [activeGame, sortBy, activeTab])

  useEffect(() => {
    setFavorites(getFavorites())
  }, [])

  // DB'deki gerçek oyun isimlerini bir kez çek (debug için)
  useEffect(() => {
    let cancelled = false

    async function loadGames() {
      setGamesLoading(true)
      const { data } = await supabase.from('games').select('id, name, slug')

      if (!cancelled) {
        const rows = data || []
        setGameNames(rows)
        console.log('🎮 DB Games:', (rows || []).map(g => `${g?.name ?? '?'} (${g?.slug ?? '?'})`))
        setGamesLoading(false)
      }
    }

    loadGames()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    fetchMatches()
  }, [activeGame, sortBy, activeTab, currentPage, gamesLoading, gameNames])  // activeGame değişince tekrar çek

  useEffect(() => {
    applyFilters()
  }, [matches, searchQuery, showFavoritesOnly, favorites])
  // NOT: activeGame artık burada YOK — filtre Supabase sorgusunda yapılıyor

  useEffect(() => {
    let interval
    if (autoRefresh) interval = setInterval(fetchMatches, 30000)
    return () => { if (interval) clearInterval(interval) }
  }, [autoRefresh, activeGame, sortBy, activeTab, currentPage, gamesLoading])

  // ── Supabase game filtresi builder ─────────────────────────────
  function buildGameFilter(query) {
    if (!activeGame || activeGame === 'all') return query

    // Önce DB'deki gerçek isimleri kullan
    const dbGame = gameNames.find(g =>
      g.slug?.toLowerCase() === activeGame.toLowerCase() ||
      g.name?.toLowerCase().includes(activeGame === 'cs2' ? 'counter' :
        activeGame === 'lol' ? 'league' :
        activeGame)
    )

    if (dbGame) {
      // Exact game id match — en güvenilir yol
      return query.eq('game_id', dbGame.id)
    }

    // Fallback: ilike pattern dizisi ile OR sorgusu
    const patterns = GAME_DB_PATTERNS[activeGame] || []
    if (patterns.length === 0) return query

    // Supabase OR: game.name ilike her pattern
    // games join üzerinden: game->>name ilike pattern
    const orStr = patterns.map(p => `game.name.ilike.%${p}%`).join(',')
    return query.or(orStr)
  }

  // ── Ana veri çekme ──────────────────────────────────────────────
  async function fetchMatches() {
    try {
      if (activeGame !== 'all' && gamesLoading) {
        return
      }

      setLoading(true)
      setError(null)

      const nowIso = new Date().toISOString()

      const from = (currentPage - 1) * PAGE_SIZE
      const to   = from + PAGE_SIZE - 1

      const buildQuery = () => {
        let query = supabase
          .from('matches')
          .select(`
            id, status, scheduled_at,
            team_a_id, team_b_id, winner_id,
            team_a_score, team_b_score,
            game_id,
            prediction_team_a, prediction_team_b, prediction_confidence,
            team_a:teams!matches_team_a_id_fkey(id, name, logo_url, acronym),
            team_b:teams!matches_team_b_id_fkey(id, name, logo_url, acronym),
            tournament:tournaments(id, name, tier),
            game:games(id, name, slug)
          `, { count: 'exact' })

        if (activeTab === 'upcoming') {
          query = query
            .eq('status', 'not_started')
            .gt('scheduled_at', nowIso)
        } else {
          query = query.eq('status', 'finished')
        }

        // ── Game filtresi SUNUCU tarafında ──
        if (activeGame && activeGame !== 'all') {
          const gameId = resolveGameId(activeGame, gameNames)
          if (!gameId) {
            throw new Error(`Game filter id bulunamadi: ${activeGame}`)
          }

          console.log(`🎯 Game filter id=${gameId} (${activeGame})`)
          query = query.eq('game_id', gameId)
        }

        query = query.order('scheduled_at', {
          ascending: sortBy === 'date-asc',
        })
        query = query.order('id', {
          ascending: sortBy === 'date-asc',
        })

        query = query.range(from, to)
        return query
      }

      let { data, error: fetchError, count } = await buildQuery()

      if (fetchError) {
        console.error('Supabase error:', fetchError)
        throw fetchError
      }

      console.log(`📊 Fetched ${data?.length} matches (total: ${count}) | game: ${activeGame} | tab: ${activeTab} | page: ${currentPage}`)

      if (data?.length === 0 && gameNames.length > 0) {
        // Hangi game_id'lerin DB'de olduğunu logla
        console.warn('⚠️ 0 matches returned. DB games:', (gameNames || []).map(g => `${g?.slug ?? '?'}=${g?.id ?? '?'}`))
      }

      setMatches(data || [])
      setTotalCount(count ?? 0)
      setLastUpdate(new Date())
    } catch (err) {
      console.error('fetchMatches error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Client-side filtreler (sadece arama + favoriler) ────────────
  // NOT: Game filtresi artık burada YOK
  function applyFilters() {
    let filtered = [...matches]

    // Arama
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(m =>
        (m.team_a?.name    ?? '').toLowerCase().includes(q) ||
        (m.team_b?.name    ?? '').toLowerCase().includes(q) ||
        (m.tournament?.name ?? '').toLowerCase().includes(q)
      )
    }

    // Favoriler
    if (showFavoritesOnly && favorites.length > 0) {
      filtered = filtered.filter(m =>
        favorites.includes(m.team_a_id) || favorites.includes(m.team_b_id)
      )
    }

    setFilteredMatches(filtered)
  }

  function toggleFavorite(teamId, e) {
    e.stopPropagation()
    if (isFavorite(teamId)) {
      setFavorites(removeFavorite(teamId))
    } else {
      setFavorites(addFavorite(teamId))
    }
  }

  async function openMatchDetails(match) {
    setSelectedMatch(match)
    setShowModal(true)
    setModalPlayers({ teamA: [], teamB: [] })
    setH2hData(null)
    setLoadingModalPlayers(true)

    const teamAId = match.team_a_id ?? match.team_a?.id
    const teamBId = match.team_b_id ?? match.team_b?.id

    const [{ data: playersA }, { data: playersB }, { data: h2hMatches }] = await Promise.all([
      supabase.from('players').select('nickname, role, image_url').eq('team_pandascore_id', teamAId),
      supabase.from('players').select('nickname, role, image_url').eq('team_pandascore_id', teamBId),
      supabase.from('matches')
        .select('id, winner_id, team_a_id, team_b_id, team_a_score, team_b_score, scheduled_at')
        .eq('status', 'finished')
        .or(`and(team_a_id.eq.${teamAId},team_b_id.eq.${teamBId}),and(team_a_id.eq.${teamBId},team_b_id.eq.${teamAId})`)
        .order('scheduled_at', { ascending: false })
        .limit(10),
    ])

    setModalPlayers({ teamA: playersA || [], teamB: playersB || [] })

    const h2h       = h2hMatches || []
    const teamAWins = h2h.filter(m => m.winner_id === teamAId).length
    const teamBWins = h2h.filter(m => m.winner_id === teamBId).length
    const draws     = h2h.filter(m => !m.winner_id).length
    setH2hData({ matches: h2h, teamAWins, teamBWins, draws, total: h2h.length, teamAId, teamBId })

    setLoadingModalPlayers(false)
  }

  function closeModal()    { setShowModal(false); setSelectedMatch(null) }
  function getStatusBadge(status) {
    return {
      not_started: { text: '⏳ Upcoming', color: '#FFB800', bg: 'rgba(255,184,0,.1)' },
      running:     { text: '🔴 LIVE',     color: '#FF4655', bg: 'rgba(255,70,85,.2)' },
      finished:    { text: '✅ Finished', color: '#4CAF50', bg: 'rgba(76,175,80,.1)' },
    }[status] ?? { text: '⏳ Upcoming', color: '#FFB800', bg: 'rgba(255,184,0,.1)' }
  }

  // ── Game filtresi debug banner ──────────────────────────────────
  function GameDebugBanner() {
    if (activeGame === 'all' || gameNames.length === 0) return null
    const dbGameId = resolveGameId(activeGame, gameNames)
    const dbGame = (gameNames || []).find(g => Number(g?.id) === Number(dbGameId))
    return (
      <div style={{
        textAlign: 'center', fontSize: 11, color: '#444',
        marginBottom: 8, padding: '3px 12px',
        background: '#0d0d0d', borderRadius: 8, display: 'inline-block',
      }}>
        🎮 Filtre: <span style={{ color: '#666' }}>
          {dbGame ? `${dbGame?.name ?? '?'} (id=${dbGame?.id ?? '?'})` : `id bulunamadi: "${activeGame}"`}
        </span>
      </div>
    )
  }

  // ── Loading / Error ─────────────────────────────────────────────
  if (loading && matches.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: '#555' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
        <div>Maçlar yükleniyor...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '50px', color: '#FF4655' }}>
        <h2>❌ {error}</h2>
        <button
          onClick={fetchMatches}
          style={{ marginTop: 16, padding: '10px 24px', background: '#FF4655', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}
        >Tekrar Dene</button>
      </div>
    )
  }

  const totalPages    = Math.ceil(totalCount / PAGE_SIZE)
  const liveCount     = filteredMatches.filter(m => m.status === 'running').length
  const upcomingCount = filteredMatches.filter(m => m.status === 'not_started').length

  // ── Pagination Bar ──────────────────────────────────────────────
  function PaginationBar() {
    if (totalPages <= 1) return null

    const pages = []
    const delta = 2
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
        pages.push(i)
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...')
      }
    }

    const goTo = (p) => {
      setCurrentPage(p)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 6, marginTop: 36, paddingTop: 22,
        borderTop: '1px solid #1a1a1a', flexWrap: 'wrap',
      }}>
        {/* İlk sayfa */}
        <button
          onClick={() => goTo(1)} disabled={currentPage === 1}
          style={pageBtnStyle(false, currentPage === 1)}
        >«</button>

        {/* Önceki */}
        <button
          onClick={() => goTo(currentPage - 1)} disabled={currentPage === 1}
          style={pageBtnStyle(false, currentPage === 1)}
        >← Önceki</button>

        {/* Sayfa numaraları */}
        {pages.map((p, idx) =>
          p === '...'
            ? <span key={`dot${idx}`} style={{ color: '#333', fontSize: 13, padding: '0 4px' }}>…</span>
            : <button
                key={p}
                onClick={() => goTo(p)}
                style={pageBtnStyle(p === currentPage, false)}
              >{p}</button>
        )}

        {/* Sonraki */}
        <button
          onClick={() => goTo(currentPage + 1)} disabled={currentPage === totalPages}
          style={pageBtnStyle(false, currentPage === totalPages)}
        >Sonraki →</button>

        {/* Son sayfa */}
        <button
          onClick={() => goTo(totalPages)} disabled={currentPage === totalPages}
          style={pageBtnStyle(false, currentPage === totalPages)}
        >»</button>

        {/* Bilgi */}
        <span style={{ fontSize: 11, color: '#444', marginLeft: 10 }}>
          Sayfa {currentPage} / {totalPages} — {totalCount.toLocaleString()} maç
        </span>

        {/* Hızlı git input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 10 }}>
          <span style={{ fontSize: 11, color: '#444' }}>Git:</span>
          <input
            type="number" min={1} max={totalPages}
            defaultValue={currentPage}
            key={currentPage}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const v = Math.max(1, Math.min(totalPages, Number(e.target.value)))
                goTo(v)
              }
            }}
            style={{
              width: 48, padding: '4px 6px', borderRadius: 6,
              border: '1px solid #2a2a2a', background: '#111',
              color: '#888', fontSize: 12, outline: 'none', textAlign: 'center',
            }}
          />
        </div>
      </div>
    )
  }

  function pageBtnStyle(active, disabled) {
    return {
      padding: active ? '8px 14px' : '8px 12px',
      minWidth: 36, height: 36, borderRadius: 10,
      border: active ? '1.5px solid #FF4655' : '1px solid #2a2a2a',
      background: active ? 'rgba(255,70,85,.2)' : '#111',
      color: disabled ? '#2a2a2a' : active ? '#FF4655' : '#666',
      fontSize: 13, fontWeight: active ? 800 : 400,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all .15s',
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 20px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Başlık */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>📅 Matches</h1>
        <p style={{ color: '#555', fontSize: 13, margin: 0 }}>
          Tüm esports maçları — canlı, yaklaşan &amp; geçmiş
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
        {[
          { key: 'upcoming', label: '⏳ Upcoming' },
          { key: 'past',     label: '✅ Past Results'   },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: '9px 22px', borderRadius: 12, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: activeTab === t.key ? 700 : 500,
            background: activeTab === t.key ? '#FF4655' : '#1a1a1a',
            color: activeTab === t.key ? '#fff' : '#888',
            transition: 'all .18s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Debug banner */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <GameDebugBanner />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', maxWidth: 340, flex: 1 }}>
          <input
            type="text" placeholder="🔍 Takım veya turnuva ara..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: 'white', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}>✕</button>
          )}
        </div>

        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: '#ccc', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
          <option value="date-asc">📅 En Erken Önce</option>
          <option value="date-desc">📅 En Yeni Önce</option>
        </select>

        <button onClick={() => setShowFavoritesOnly(v => !v)} disabled={favorites.length === 0} style={{ padding: '8px 14px', borderRadius: 8, border: showFavoritesOnly ? '1px solid #FFD700' : '1px solid #2a2a2a', background: showFavoritesOnly ? 'rgba(255,215,0,.15)' : '#111', color: showFavoritesOnly ? '#FFD700' : favorites.length === 0 ? '#444' : '#888', fontSize: 13, cursor: favorites.length === 0 ? 'not-allowed' : 'pointer' }}>
          ⭐ {showFavoritesOnly ? 'Tümü' : 'Favoriler'}
        </button>

        <button onClick={fetchMatches} disabled={loading} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #2a2a2a', background: '#111', color: loading ? '#444' : '#888', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? '⏳' : '🔄'} Yenile
        </button>

        <button onClick={() => setAutoRefresh(v => !v)} style={{ padding: '8px 14px', borderRadius: 8, border: autoRefresh ? '1px solid #4CAF50' : '1px solid #2a2a2a', background: autoRefresh ? 'rgba(76,175,80,.15)' : '#111', color: autoRefresh ? '#4CAF50' : '#888', fontSize: 13, cursor: 'pointer' }}>
          🔁 {autoRefresh ? 'Auto ON' : 'Auto OFF'}
        </button>
      </div>

      {/* Stats chips */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 22 }}>
        {liveCount > 0 && <div style={{ padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#FF4655', background: 'rgba(255,70,85,.15)', border: '1px solid #FF465555' }}>🔴 {liveCount} Live</div>}
        <div style={{ padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#FFB800', background: 'rgba(255,184,0,.12)', border: '1px solid #FFB80055' }}>⏳ {upcomingCount} Upcoming</div>
        <div style={{ padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#888', background: 'rgba(255,255,255,.05)', border: '1px solid #88888855' }}>📊 {totalCount.toLocaleString()} Total</div>
        {favorites.length > 0 && <div style={{ padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#FFD700', background: 'rgba(255,215,0,.12)', border: '1px solid #FFD70055' }}>⭐ {favorites.length} Fav</div>}
        <div style={{ color: '#444', fontSize: 11, display: 'flex', alignItems: 'center' }}>
          Güncellendi: {lastUpdate.toLocaleTimeString('tr-TR')}
          {autoRefresh && <span style={{ color: '#4CAF50', marginLeft: 8 }}>● auto</span>}
        </div>
      </div>

      {/* Match Grid */}
      {filteredMatches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#555' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
          <h3 style={{ margin: 0, color: '#444' }}>Maç bulunamadı</h3>
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>
            {activeGame !== 'all'
              ? `"${activeGame}" için kayıt yok. Konsolu kontrol et (F12) — hangi game_id eşleşiyor?`
              : 'Filtre veya arama kriterleri değiştirilebilir.'}
          </p>
          {/* DB games listesi */}
          {gameNames.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: '#333' }}>
              DB'deki oyunlar: {(gameNames || []).map(g => `${g?.name ?? '?'}(${g?.slug ?? '?'})`).join(' · ')}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {(filteredMatches || []).map(match => {
            const statusBadge = getStatusBadge(match.status)
            const isLive      = match.status === 'running'
            const teamAFav    = isFavorite(match.team_a_id)
            const teamBFav    = isFavorite(match.team_b_id)
            const turkA       = isTurkishTeam(match.team_a?.name ?? '')
            const turkB       = isTurkishTeam(match.team_b?.name ?? '')
            const hasTurkish  = turkA || turkB
            const isHotPick   = (match.prediction_confidence ?? 0) > 0.80

            return (
              <div
                key={match.id}
                onClick={() => navigate(`/match/${match.id}`)}
                style={{
                  position: 'relative', borderRadius: 18,
                  padding: hasTurkish ? '0 0 14px' : '18px 18px 14px',
                  overflow: hasTurkish ? 'hidden' : 'visible',
                  background: '#111',
                  border: isLive
                    ? '1.5px solid rgba(255,70,85,.6)'
                    : isHotPick
                    ? '1.5px solid rgba(255,100,50,.5)'
                    : hasTurkish
                    ? '1.5px solid rgba(212,175,55,.5)'
                    : '1.5px solid #222',
                  boxShadow: isLive
                    ? '0 0 20px rgba(255,70,85,.2)'
                    : isHotPick
                    ? '0 0 14px rgba(255,100,50,.12)'
                    : hasTurkish
                    ? '0 0 14px rgba(212,175,55,.08)'
                    : 'none',
                  cursor: 'pointer',
                  transition: 'transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, border-color .2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform   = 'translateY(-5px) scale(1.012)'
                  e.currentTarget.style.boxShadow   = '0 12px 32px rgba(255,70,85,.22)'
                  e.currentTarget.style.borderColor = '#FF4655'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform   = 'none'
                  e.currentTarget.style.boxShadow   = isLive ? '0 0 20px rgba(255,70,85,.2)' : isHotPick ? '0 0 14px rgba(255,100,50,.12)' : hasTurkish ? '0 0 14px rgba(212,175,55,.08)' : 'none'
                  e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.6)' : isHotPick ? 'rgba(255,100,50,.5)' : hasTurkish ? 'rgba(212,175,55,.5)' : '#222'
                }}
              >
                {/* Turkish banner */}
                {hasTurkish && (
                  <div style={{ background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)', padding: '5px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
                    <span>🇹🇷</span>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1.5px', color: '#fff', textTransform: 'uppercase' }}>Turkish Pride</span>
                    <span>🇹🇷</span>
                  </div>
                )}

                <div style={{ padding: hasTurkish ? '0 18px' : 0 }}>
                  {/* Top row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ padding: '2px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: '#1e1e1e', border: '1px solid #2e2e2e', color: '#777' }}>
                      {match.game?.name ?? '?'}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {/* AI Hot Pick */}
                      {isHotPick && (
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800, background: 'rgba(255,100,50,.2)', border: '1px solid rgba(255,100,50,.5)', color: '#ff8c42' }}>
                          🔥 Hot
                        </span>
                      )}
                      {/* Prediction % */}
                      {match.prediction_team_a != null && (
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(102,126,234,.2)', border: '1px solid rgba(102,126,234,.5)', color: '#818cf8' }}>
                          🔮 {Math.round(Math.max(match.prediction_team_a, match.prediction_team_b) * 100)}%
                        </span>
                      )}
                      <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: statusBadge.bg, border: `1px solid ${statusBadge.color}44`, color: statusBadge.color, animation: isLive ? 'pulse 1.5s infinite' : 'none' }}>
                        {statusBadge.text}
                      </span>
                    </div>
                  </div>

                  {/* Teams */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
                    {/* Team A */}
                    <div
                      onClick={e => { e.stopPropagation(); navigate(`/team/${match.team_a_id}`) }}
                      style={{ flex: 1, textAlign: 'center', cursor: 'pointer', position: 'relative', padding: '8px 4px' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '.75'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      <button onClick={e => toggleFavorite(match.team_a_id, e)} style={{ position: 'absolute', top: 0, left: 2, background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: 2 }}>
                        {teamAFav ? '⭐' : '☆'}
                      </button>
                      {match.team_a?.logo_url
                        ? <img src={match.team_a.logo_url} alt={match.team_a.name} style={{ width: 52, height: 52, objectFit: 'contain', marginBottom: 8, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }} />
                        : <div style={{ width: 52, height: 52, margin: '0 auto 8px', background: '#1e1e1e', borderRadius: 8 }} />
                      }
                      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word', color: turkA ? '#FFD700' : 'white' }}>
                        {match.team_a?.name}
                      </div>
                      {activeTab === 'past' && match.team_a_score != null && (
                        <div style={{ fontSize: 22, fontWeight: 800, color: match.winner_id === match.team_a_id ? '#4CAF50' : '#aaa', marginTop: 4 }}>
                          {match.team_a_score}
                        </div>
                      )}
                    </div>

                    {/* VS */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#FF4655', letterSpacing: '2px', textShadow: isLive ? '0 0 8px rgba(255,70,85,.6)' : 'none' }}>VS</span>
                      <div style={{ width: 1, height: 24, background: '#2a2a2a' }} />
                    </div>

                    {/* Team B */}
                    <div
                      onClick={e => { e.stopPropagation(); navigate(`/team/${match.team_b_id}`) }}
                      style={{ flex: 1, textAlign: 'center', cursor: 'pointer', position: 'relative', padding: '8px 4px' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '.75'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      <button onClick={e => toggleFavorite(match.team_b_id, e)} style={{ position: 'absolute', top: 0, right: 2, background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: 2 }}>
                        {teamBFav ? '⭐' : '☆'}
                      </button>
                      {match.team_b?.logo_url
                        ? <img src={match.team_b.logo_url} alt={match.team_b.name} style={{ width: 52, height: 52, objectFit: 'contain', marginBottom: 8, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }} />
                        : <div style={{ width: 52, height: 52, margin: '0 auto 8px', background: '#1e1e1e', borderRadius: 8 }} />
                      }
                      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word', color: turkB ? '#FFD700' : 'white' }}>
                        {match.team_b?.name}
                      </div>
                      {activeTab === 'past' && match.team_b_score != null && (
                        <div style={{ fontSize: 22, fontWeight: 800, color: match.winner_id === match.team_b_id ? '#4CAF50' : '#aaa', marginTop: 4 }}>
                          {match.team_b_score}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* AI Win Bar */}
                  {match.prediction_team_a != null && match.prediction_team_b != null && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ height: 6, borderRadius: 3, background: '#0d0d0d', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ width: `${Math.round(match.prediction_team_a * 100)}%`, height: '100%', background: 'linear-gradient(90deg,#667eea,#764ba2)', transition: 'width .5s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#444', marginTop: 3 }}>
                        <span style={{ color: match.prediction_team_a >= match.prediction_team_b ? '#818cf8' : '#444' }}>
                          {Math.round(match.prediction_team_a * 100)}%
                        </span>
                        <span style={{ color: match.prediction_team_b > match.prediction_team_a ? '#818cf8' : '#444' }}>
                          {Math.round(match.prediction_team_b * 100)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Bottom row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #1e1e1e', paddingTop: 10, gap: 8 }}>
                    <div style={{ fontSize: 11, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      🏆 {match.tournament?.name ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: isLive ? '#FF4655' : '#4CAF50', flexShrink: 0, background: isLive ? 'rgba(255,70,85,.1)' : 'rgba(76,175,80,.1)', padding: '2px 8px', borderRadius: 6 }}>
                      {isLive ? '🔴 LIVE' : formatMatchTime(match, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      <PaginationBar />

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }`}</style>

      {/* Modal — değişmedi, aynı kalıyor */}
      {showModal && selectedMatch && (
        <div onClick={closeModal} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#1a1a1a', borderRadius: 15, padding: 30, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto', border: '2px solid #FF4655', position: 'relative' }}>
            <button onClick={closeModal} style={{ position: 'absolute', top: 15, right: 15, background: 'none', border: 'none', color: '#888', fontSize: 30, cursor: 'pointer' }}>×</button>

            <div style={{ display: 'inline-block', padding: '5px 15px', backgroundColor: '#FF4655', borderRadius: 20, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 20 }}>
              {selectedMatch.game?.name}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginBottom: 30, padding: '20px 0' }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                {selectedMatch.team_a?.logo_url && <img src={selectedMatch.team_a.logo_url} alt={selectedMatch.team_a.name} style={{ width: 100, height: 100, objectFit: 'contain', marginBottom: 15 }} />}
                <div style={{ fontSize: 20, fontWeight: 'bold' }}>{selectedMatch.team_a?.name}</div>
              </div>
              <div style={{ fontSize: 40, fontWeight: 'bold', color: '#FF4655', padding: '0 30px' }}>VS</div>
              <div style={{ textAlign: 'center', flex: 1 }}>
                {selectedMatch.team_b?.logo_url && <img src={selectedMatch.team_b.logo_url} alt={selectedMatch.team_b.name} style={{ width: 100, height: 100, objectFit: 'contain', marginBottom: 15 }} />}
                <div style={{ fontSize: 20, fontWeight: 'bold' }}>{selectedMatch.team_b?.name}</div>
              </div>
            </div>

            <div style={{ backgroundColor: '#0a0a0a', borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <div style={{ marginBottom: 15 }}>
                <div style={{ color: '#888', fontSize: 14, marginBottom: 5 }}>🏆 Tournament</div>
                <div style={{ fontSize: 16, fontWeight: 'bold' }}>{selectedMatch.tournament?.name ?? '—'}</div>
              </div>
              <div style={{ marginBottom: 15 }}>
                <div style={{ color: '#888', fontSize: 14, marginBottom: 5 }}>📅 Scheduled</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#4CAF50' }}>
                  {formatMatchTime(selectedMatch, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: 14, marginBottom: 5 }}>📊 Status</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: selectedMatch.status === 'not_started' ? '#FFB800' : '#4CAF50' }}>
                  {selectedMatch.status === 'not_started' ? '⏳ Upcoming' : selectedMatch.status === 'running' ? '🔴 Live' : '✅ Finished'}
                </div>
              </div>
            </div>

            {/* H2H */}
            {h2hData && h2hData.total > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ color: '#888', fontSize: 13, fontWeight: 'bold', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '1px' }}>⚔️ H2H</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', background: h2hData.teamAWins > h2hData.teamBWins ? 'rgba(76,175,80,.12)' : '#0d0d0d', border: h2hData.teamAWins > h2hData.teamBWins ? '1px solid rgba(76,175,80,.4)' : '1px solid #1e1e1e', borderRadius: 8 }}>
                    <div style={{ fontSize: 24, fontWeight: 'bold', color: '#4CAF50' }}>{h2hData.teamAWins}</div>
                    <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>{selectedMatch.team_a?.name}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '6px 10px' }}>
                    <div style={{ fontSize: 18, fontWeight: 'bold', color: '#444' }}>—</div>
                    <div style={{ fontSize: 11, color: '#444' }}>{h2hData.total} matches</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', background: h2hData.teamBWins > h2hData.teamAWins ? 'rgba(76,175,80,.12)' : '#0d0d0d', border: h2hData.teamBWins > h2hData.teamAWins ? '1px solid rgba(76,175,80,.4)' : '1px solid #1e1e1e', borderRadius: 8 }}>
                    <div style={{ fontSize: 24, fontWeight: 'bold', color: '#4CAF50' }}>{h2hData.teamBWins}</div>
                    <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>{selectedMatch.team_b?.name}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Rosters */}
            {loadingModalPlayers ? (
              <div style={{ textAlign: 'center', color: '#555', padding: 20 }}>Loading rosters...</div>
            ) : (
              <div style={{ marginBottom: 20 }}>
                <div style={{ color: '#888', fontSize: 13, fontWeight: 'bold', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '1px' }}>👥 Rosters</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {[{ label: selectedMatch.team_a?.name, players: modalPlayers.teamA },
                    { label: selectedMatch.team_b?.name, players: modalPlayers.teamB }].map(({ label, players }) => (
                    <div key={label}>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: '#aaa', marginBottom: 8, textAlign: 'center' }}>{label}</div>
                      {(players || []).length === 0
                        ? <div style={{ fontSize: 12, color: '#555', textAlign: 'center' }}>No data</div>
                        : (players || []).map((p, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: 6, background: '#0d0d0d', borderRadius: 8 }}>
                            {p.image_url ? <img src={p.image_url} alt={p.nickname} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1e1e1e' }} />}
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 'bold' }}>{p.nickname}</div>
                              {p.role && <div style={{ fontSize: 11, color: '#888' }}>{p.role}</div>}
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={closeModal} style={{ width: '100%', padding: 15, borderRadius: 8, border: 'none', backgroundColor: '#FF4655', color: 'white', fontSize: 16, fontWeight: 'bold', cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Matches