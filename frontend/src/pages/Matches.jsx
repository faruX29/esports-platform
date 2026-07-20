/**
 * Matches.jsx — Dikey zaman çizelgesi
 * GameContext filtresi → Supabase sorgusuna taşındı (client-side değil)
 * Pagination: 50/sayfa, count:exact
 */
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams }     from 'react-router-dom'
import { supabase, subscribeToMatchesUpdates } from '../supabaseClient'
import { useGame, GAMES }                   from '../context/GameContext'
import { useUser } from '../context/UserContext'
import { isTurkishTeam }                   from '../constants'
import { normalizeGameId }                  from '../utils/gameUtils'
import { FEXT, statusStyle }                from '../theme'
import Mascot                               from '../components/Mascot'
import { getBOFormat }                       from '../utils/matchFormat'
import { correctedScores }                   from '../utils/matchResult'
import { isUncertainPrediction }             from '../utils/prediction'
import { roundLabel }                        from '../utils/roundLabel'
import { clickableProps }                    from '../utils/a11y'
import TurkishBadge                          from '../components/TurkishBadge'
import InitialsImage                        from '../components/InitialsImage'
import {
  CalendarDays, Clock, CircleCheck, Radio, Search, Star, RefreshCw, Repeat,
  BarChart3, Flame, Sparkles, Trophy, Tv, Swords, Map as MapIcon, Users,
  ChevronLeft, ChevronRight, TriangleAlert, Inbox, Loader2, X as XIcon,
} from 'lucide-react'

const PAGE_SIZE = 50   // 20 → 50

const GAME_SHORT_NAMES = { valorant: 'VALORANT', cs2: 'CS2', lol: 'LoL', dota2: 'Dota2' }
function gameDisplayName(game) {
  const id = normalizeGameId(game?.slug ?? game?.name ?? '')
  return GAME_SHORT_NAMES[id] ?? game?.name ?? '?'
}

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

// DB'de aynı oyun için MÜKERRER kayıtlar var (ör. "Counter-Strike 2" id=2 VE
// "Cs-Go" id=8; "League of Legends" id=3 VE "League-Of-Legends" id=9). Maçlar
// bu id'ler arasında bölünmüş — tek id'ye .eq atınca upcoming boş görünüyordu.
// Bu yüzden kanonik oyuna ait TÜM game_id'leri toplayıp .in ile filtreliyoruz.
function resolveGameIds(activeGame, gameNames) {
  if (!activeGame || activeGame === 'all') return []
  const canonical = normalizeGameId(activeGame) ?? String(activeGame).toLowerCase()
  const ids = (gameNames || [])
    .filter(g => normalizeGameId(g?.slug ?? g?.name) === canonical)
    .map(g => g?.id)
    .filter(id => id != null)
  if (ids.length) return [...new Set(ids)]
  const fallback = FALLBACK_GAME_IDS[canonical]
  return fallback != null ? [fallback] : []
}

function matchTimeIso(match) {
  return match?.scheduled_at ?? match?.begin_at ?? match?.created_at ?? null
}

function formatMatchTime(match, localeOptions) {
  const iso = matchTimeIso(match)
  if (!iso) return 'TBA'
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return 'TBA'
  const now = new Date()
  const isToday =
    time.getDate() === now.getDate() &&
    time.getMonth() === now.getMonth() &&
    time.getFullYear() === now.getFullYear()
  if (isToday) {
    return 'Bugün, ' + time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  }
  return time.toLocaleString('tr-TR', localeOptions)
}

// number_of_games varsa önce onu kullan; yoksa skor heuristiği (finished)


/* Upcoming maçlar için geri sayım — kendi interval'ını yönetir (30sn tick),
   sadece sayaç re-render olur (tüm liste değil). */
function Countdown({ target }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  const ts = target ? new Date(target).getTime() : 0
  if (!ts) return null
  const diff = ts - now
  if (diff <= 0) return <span style={{ fontSize: 10, color: '#4CAF50', fontWeight: 700 }}>● Başlıyor</span>
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const label = d > 0 ? `${d}g ${h}s` : h > 0 ? `${h}s ${m}dk` : `${m}dk`
  return <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, whiteSpace: 'nowrap' }}>⏱ {label}</span>
}

function Matches() {
  const navigate = useNavigate()
  const { activeGame } = useGame()
  // Favoriler = site geneli takip sistemi (DB). Böylece herhangi bir yerde takip
  // ettiğin takım burada da "favori" olur; çıkış yapmadan tek sistem. [[user-context]]
  const { followedTeamIds, toggleTeamFollow, isTeamFollowed } = useUser()
  const [searchParams] = useSearchParams()   // deep-link: /matches?q=Fnatic&tab=past

  const [matches, setMatches]                     = useState([])
  const [filteredMatches, setFilteredMatches]     = useState([])
  const [loading, setLoading]                     = useState(true)
  const [error, setError]                         = useState(null)
  const [searchQuery, setSearchQuery]             = useState(() => searchParams.get('q') || '')
  const [debouncedSearch, setDebouncedSearch]     = useState(() => (searchParams.get('q') || '').trim())
  const initialTab = (() => {
    const t = searchParams.get('tab')
    return ['live', 'upcoming', 'past'].includes(t) ? t : 'past'
  })()
  const [activeTab, setActiveTab]                 = useState(initialTab)
  // Geçmiş sekmesinde en yeni önce, yaklaşan/canlıda en erken önce mantıklı.
  const [sortBy, setSortBy]                       = useState(initialTab === 'past' ? 'date-desc' : 'date-asc')
  const [dateFrom, setDateFrom]                   = useState('')   // Past tab: tarih aralığı
  const [dateTo, setDateTo]                       = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [tournamentFilter, setTournamentFilter]   = useState('')   // yüklü maçlardan turnuvaya göre daralt
  const [lastUpdate, setLastUpdate]               = useState(new Date())
  const [autoRefresh, setAutoRefresh]             = useState(false)
  const [gameNames, setGameNames]                 = useState([])   // DB'deki gerçek game isimleri
  const [gamesLoading, setGamesLoading]           = useState(true)

  // ── Pagination ──────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount,  setTotalCount]  = useState(0)


  // Arama girdisini debounce et (server-side sorgu için)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Sekme / oyun / tarih / arama değişince 1. sayfaya dön
  useEffect(() => {
    setCurrentPage(1)
  }, [activeGame, sortBy, activeTab, dateFrom, dateTo, debouncedSearch, showFavoritesOnly])


  // DB'deki gerçek oyun isimlerini bir kez çek (debug için)
  useEffect(() => {
    let cancelled = false

    async function loadGames() {
      setGamesLoading(true)
      const { data } = await supabase.from('games').select('id, name, slug')

      if (!cancelled) {
        const rows = data || []
        setGameNames(rows)
        setGamesLoading(false)
      }
    }

    loadGames()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    fetchMatches()
    // favFilterKey: yalnızca "Favoriler" açıkken favori seti değişince tekrar çek —
    // filtre kapalıyken yıldız değiştirmek listeyi gereksiz yenilemesin.
  }, [activeGame, sortBy, activeTab, currentPage, gamesLoading, gameNames, dateFrom, dateTo, debouncedSearch, (showFavoritesOnly ? followedTeamIds.join(',') : '')])  // filtre değişince tekrar çek

  useEffect(() => {
    applyFilters()
  }, [matches, searchQuery, tournamentFilter])
  // NOT: activeGame artık burada YOK — filtre Supabase sorgusunda yapılıyor

  useEffect(() => {
    // Live tab: Realtime subscription — polling'e gerek yok
    if (activeTab === 'live') {
      const unsub = subscribeToMatchesUpdates(payload => {
        const nextRow = payload?.new
        if (!nextRow?.id) return
        const isInsert = payload.eventType === 'INSERT'
        const nextStatus = String(nextRow.status || '').toLowerCase()

        if (isInsert && nextStatus === 'running') {
          setMatches(prev => prev.some(m => m.id === nextRow.id) ? prev : [nextRow, ...prev])
          return
        }
        if (nextStatus === 'running') {
          setMatches(prev =>
            prev.some(m => m.id === nextRow.id)
              ? prev.map(m => m.id === nextRow.id ? { ...m, ...nextRow } : m)
              : [nextRow, ...prev]
          )
        } else {
          // Artık live değil (finished/cancelled) — listeden çıkar
          setMatches(prev => prev.filter(m => m.id !== nextRow.id))
        }
      })
      return unsub
    }

    // Diğer tablarda opsiyonel polling
    if (!autoRefresh) return
    const interval = setInterval(fetchMatches, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh, activeTab, activeGame, sortBy, currentPage, gamesLoading])

  // ── Supabase game filtresi builder ─────────────────────────────

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

      const buildQuery = async () => {
        let query = supabase
          .from('matches')
          .select(`
            id, status, scheduled_at,
            team_a_id, team_b_id, winner_id,
            team_a_score, team_b_score,
            number_of_games, stream_url, game_id, round_info,
            prediction_team_a, prediction_team_b, prediction_confidence,
            team_a:teams!matches_team_a_id_fkey(id, name, logo_url, acronym),
            team_b:teams!matches_team_b_id_fkey(id, name, logo_url, acronym),
            tournament:tournaments(id, name, tier),
            game:games(id, name, slug)
          `, { count: 'exact' })

        if (activeTab === 'live') {
          query = query.eq('status', 'running')
        } else if (activeTab === 'upcoming') {
          query = query
            .eq('status', 'not_started')
            .gt('scheduled_at', nowIso)
        } else {
          query = query.eq('status', 'finished')
          // Geçmiş arşivinde döneme atlama (33k maç — tarih aralığı filtresi)
          if (dateFrom) query = query.gte('scheduled_at', new Date(dateFrom).toISOString())
          if (dateTo) query = query.lte('scheduled_at', new Date(dateTo + 'T23:59:59.999Z').toISOString())
        }

        // ── Game filtresi SUNUCU tarafında (mükerrer oyun kayıtları dahil) ──
        if (activeGame && activeGame !== 'all') {
          const gameIds = resolveGameIds(activeGame, gameNames)
          if (!gameIds.length) {
            throw new Error(`Game filter id bulunamadi: ${activeGame}`)
          }

          query = query.in('game_id', gameIds)
        }

        // ── Server-side arama: takım/turnuva adını id'ye çözüp filtrele ──
        // (Tüm 33k arşivde ara — client-side sadece açık sayfayı süzerdi.)
        if (debouncedSearch) {
          const like = `%${debouncedSearch}%`
          const [teamsRes, toursRes] = await Promise.all([
            supabase.from('teams').select('id').ilike('name', like).limit(80),
            supabase.from('tournaments').select('id').ilike('name', like).limit(80),
          ])
          const teamIds = (teamsRes.data || []).map(t => t.id)
          const tourIds = (toursRes.data || []).map(t => t.id)
          const ors = []
          if (teamIds.length) {
            ors.push(`team_a_id.in.(${teamIds.join(',')})`)
            ors.push(`team_b_id.in.(${teamIds.join(',')})`)
          }
          if (tourIds.length) ors.push(`tournament_id.in.(${tourIds.join(',')})`)
          query = ors.length ? query.or(ors.join(',')) : query.eq('id', -1) // eşleşme yok → boş
        }

        // ── Favoriler: SUNUCU tarafında (tüm arşivde favori takım maçları) ──
        // Eskiden client-side sadece açık sayfayı süzüyordu → favori takımın maçı
        // o sayfada yoksa "boş" görünüyordu. Artık tüm sonuçları favoriye göre çeker.
        if (showFavoritesOnly && followedTeamIds.length) {
          query = query.or(`team_a_id.in.(${followedTeamIds.join(',')}),team_b_id.in.(${followedTeamIds.join(',')})`)
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

      const preparedQuery = await buildQuery()
      let { data, error: fetchError, count } = await preparedQuery

      if (fetchError) {
        console.error('Supabase error:', fetchError)
        throw fetchError
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

    // Turnuva (yüklü maçlar arasından)
    if (tournamentFilter) {
      filtered = filtered.filter(m => String(m.tournament?.id ?? '') === tournamentFilter)
    }

    // NOT: Favoriler filtresi artık SUNUCU tarafında (buildQuery) — burada yok.
    setFilteredMatches(filtered)
  }

  function toggleFavorite(teamId, e) {
    e.stopPropagation()
    // Site geneli takip sistemi — giriş yoksa kayıt modalını açar (anonim takip yok).
    toggleTeamFollow(teamId)
  }


  function getStatusBadge(status) {
    return statusStyle(status)
  }

  // ── Game filtresi debug banner ──────────────────────────────────
  function GameDebugBanner() {
    if (activeGame === 'all' || gameNames.length === 0) return null
    const dbGameId = resolveGameId(activeGame, gameNames)
    const dbGame = (gameNames || []).find(g => Number(g?.id) === Number(dbGameId))
    return (
      <div style={{
        textAlign: 'center', fontSize: 11, color: 'var(--text-5)',
        marginBottom: 8, padding: '3px 12px',
        background: 'var(--surface)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <Radio size={12} /> Filtre: <span style={{ color: 'var(--text-4)' }}>
          {dbGame ? `${dbGame?.name ?? '?'} (id=${dbGame?.id ?? '?'})` : `id bulunamadı: "${activeGame}"`}
        </span>
      </div>
    )
  }

  // Yüklü maçlardaki ayrı turnuvalar (dropdown filtresi için).
  // NOT: hook → erken return'lerden ÖNCE olmalı (rules-of-hooks).
  const tournamentOptions = useMemo(() => {
    const map = new Map()
    for (const m of matches) {
      const t = m.tournament
      if (t?.id != null && !map.has(String(t.id))) map.set(String(t.id), t.name || '—')
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [matches])

  // ── Loading / Error ─────────────────────────────────────────────
  if (loading && matches.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-4)' }}>
        <Loader2 size={30} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
        <div>Maçlar yükleniyor...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '50px', color: '#FF4655' }}>
        <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><TriangleAlert size={22} /> {error}</h2>
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
        borderTop: '1px solid var(--surface-2)', flexWrap: 'wrap',
      }}>
        {/* İlk sayfa */}
        <button
          onClick={() => goTo(1)} disabled={currentPage === 1}
          style={pageBtnStyle(false, currentPage === 1)}
        >«</button>

        {/* Önceki */}
        <button
          onClick={() => goTo(currentPage - 1)} disabled={currentPage === 1}
          style={{ ...pageBtnStyle(false, currentPage === 1), display: 'inline-flex', alignItems: 'center', gap: 4 }}
        ><ChevronLeft size={14} /> Önceki</button>

        {/* Sayfa numaraları */}
        {pages.map((p, idx) =>
          p === '...'
            ? <span key={`dot${idx}`} style={{ color: 'var(--text-6)', fontSize: 13, padding: '0 4px' }}>…</span>
            : <button
                key={p}
                onClick={() => goTo(p)}
                style={pageBtnStyle(p === currentPage, false)}
              >{p}</button>
        )}

        {/* Sonraki */}
        <button
          onClick={() => goTo(currentPage + 1)} disabled={currentPage === totalPages}
          style={{ ...pageBtnStyle(false, currentPage === totalPages), display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >Sonraki <ChevronRight size={14} /></button>

        {/* Son sayfa */}
        <button
          onClick={() => goTo(totalPages)} disabled={currentPage === totalPages}
          style={pageBtnStyle(false, currentPage === totalPages)}
        >»</button>

        {/* Bilgi */}
        <span style={{ fontSize: 11, color: 'var(--text-5)', marginLeft: 10 }}>
          Sayfa {currentPage} / {totalPages} — {totalCount.toLocaleString()} maç
        </span>

        {/* Hızlı git input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--text-5)' }}>Git:</span>
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
              border: '1px solid var(--line)', background: 'var(--surface)',
              color: 'var(--text-3)', fontSize: 12, outline: 'none', textAlign: 'center',
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
      border: active ? `1.5px solid ${FEXT.accent}` : '1px solid var(--line)',
      background: active ? FEXT.accentSoftBg : 'var(--surface)',
      color: disabled ? 'var(--line)' : active ? FEXT.accentText : 'var(--text-4)',
      fontSize: 13, fontWeight: active ? 800 : 400,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all .15s',
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 20px', maxWidth: '1440px', margin: '0 auto' }}>

      {/* Başlık */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', display: 'inline-flex', alignItems: 'center', gap: 10 }}><CalendarDays size={26} color={FEXT.accent} /> Maçlar</h1>
        <p style={{ color: 'var(--text-4)', fontSize: 13, margin: 0 }}>
          Tüm esports maçları — canlı, yaklaşan &amp; geçmiş
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
        {[
          { key: 'live',     label: 'CANLI',          isLive: true },
          { key: 'upcoming', label: 'Yaklaşan',       Icon: Clock },
          { key: 'past',     label: 'Geçmiş',         Icon: CircleCheck },
        ].map(t => (
          <button key={t.key} onClick={() => { setActiveTab(t.key); setSortBy(t.key === 'past' ? 'date-desc' : 'date-asc'); setTournamentFilter('') }} style={{
            padding: '9px 22px', borderRadius: 12, cursor: 'pointer',
            fontSize: 13, fontWeight: activeTab === t.key ? 700 : 500,
            background: activeTab === t.key
              ? (t.isLive ? '#FF4655' : FEXT.accent)
              : 'var(--surface-2)',
            color: activeTab === t.key ? '#fff' : (t.isLive ? '#FF4655' : 'var(--text-3)'),
            display: 'flex', alignItems: 'center', gap: 7,
            transition: 'all .18s',
            border: t.isLive && activeTab !== t.key ? '1px solid rgba(255,70,85,.4)' : 'none',
          }}>
            {t.isLive && (
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#FF4655',
                animation: 'pulse 1.4s infinite',
                flexShrink: 0,
              }} />
            )}
            {t.Icon && <t.Icon size={14} strokeWidth={2} />}
            {t.label}
          </button>
        ))}
      </div>


      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', maxWidth: 340, flex: 1 }}>
          <Search size={15} color="var(--text-4)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            type="text" placeholder="Takım veya turnuva ara..."
            value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '8px 36px 8px 34px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} aria-label="Aramayı temizle" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'inline-flex' }}><XIcon size={15} /></button>
          )}
        </div>

        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
          <option value="date-asc">En Erken Önce</option>
          <option value="date-desc">En Yeni Önce</option>
        </select>

        {tournamentOptions.length > 1 && (
          <select value={tournamentFilter} onChange={e => setTournamentFilter(e.target.value)} title="Turnuvaya göre filtrele" style={{ padding: '8px 12px', borderRadius: 8, border: tournamentFilter ? `1px solid ${FEXT.accentBorder}` : '1px solid var(--line)', background: tournamentFilter ? FEXT.accentSoftBg : 'var(--surface)', color: tournamentFilter ? FEXT.accentText : 'var(--text-2)', fontSize: 13, outline: 'none', cursor: 'pointer', maxWidth: 220 }}>
            <option value="">Tüm turnuvalar</option>
            {tournamentOptions.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}

        {activeTab === 'past' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Geçmiş arşivinde döneme atla (örn. 2018 maçları)">
            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><CalendarDays size={13} /> Dönem:</span>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12, outline: 'none', colorScheme: 'dark' }} />
            <span style={{ color: 'var(--text-4)', fontSize: 12 }}>–</span>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)}
              style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12, outline: 'none', colorScheme: 'dark' }} />
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo('') }} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'inline-flex' }}><XIcon size={14} /></button>
            )}
          </div>
        )}

        <button onClick={() => setShowFavoritesOnly(v => !v)} disabled={followedTeamIds.length === 0} style={{ padding: '8px 14px', borderRadius: 8, border: showFavoritesOnly ? '1px solid #FFD700' : '1px solid var(--line)', background: showFavoritesOnly ? 'rgba(255,215,0,.15)' : 'var(--surface)', color: showFavoritesOnly ? '#FFD700' : followedTeamIds.length === 0 ? 'var(--text-5)' : 'var(--text-3)', fontSize: 13, cursor: followedTeamIds.length === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Star size={14} fill={showFavoritesOnly ? '#FFD700' : 'none'} /> {showFavoritesOnly ? 'Tümü' : 'Favoriler'}
        </button>

        <button onClick={fetchMatches} disabled={loading} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: loading ? 'var(--text-5)' : 'var(--text-3)', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} /> Yenile
        </button>

        <button onClick={() => setAutoRefresh(v => !v)} style={{ padding: '8px 14px', borderRadius: 8, border: autoRefresh ? '1px solid #4CAF50' : '1px solid var(--line)', background: autoRefresh ? 'rgba(76,175,80,.15)' : 'var(--surface)', color: autoRefresh ? '#4CAF50' : 'var(--text-3)', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Repeat size={14} /> {autoRefresh ? 'Otomatik Açık' : 'Otomatik Kapalı'}
        </button>
      </div>

      {/* Stats chips */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 22 }}>
        {liveCount > 0 && <div style={{ padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#FF4655', background: 'rgba(255,70,85,.15)', border: '1px solid #FF465555', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Radio size={13} /> {liveCount} Canlı</div>}
        <div style={{ padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: 'var(--text-3)', background: 'rgba(148,163,184,.12)', border: '1px solid #94a3b855', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Clock size={13} /> {upcomingCount} Yaklaşan</div>
        <div style={{ padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: 'var(--text-3)', background: 'var(--hover)', border: '1px solid var(--line-2)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><BarChart3 size={13} /> {totalCount.toLocaleString()} Toplam</div>
        {followedTeamIds.length > 0 && <div style={{ padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#FFD700', background: 'rgba(255,215,0,.12)', border: '1px solid #FFD70055', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Star size={13} fill="#FFD700" /> {followedTeamIds.length} Favori</div>}
        <div style={{ color: 'var(--text-5)', fontSize: 11, display: 'flex', alignItems: 'center' }}>
          Güncellendi: {lastUpdate.toLocaleTimeString('tr-TR')}
          {autoRefresh && <span style={{ color: '#4CAF50', marginLeft: 8 }}>● auto</span>}
        </div>
      </div>

      {/* Match Grid */}
      {filteredMatches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-4)' }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Mascot size={88} dim /></div>
          <h3 style={{ margin: 0, color: 'var(--text-5)' }}>
            {activeTab === 'live' ? 'Şu an canlı maç yok' : 'Maç bulunamadı'}
          </h3>
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>
            {activeGame !== 'all'
              ? `"${activeGame}" için kayıt yok. Konsolu kontrol et (F12) — hangi game_id eşleşiyor?`
              : 'Filtre veya arama kriterleri değiştirilebilir.'}
          </p>
          {/* DB games listesi */}
          {gameNames.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-6)' }}>
              DB'deki oyunlar: {(gameNames || []).map(g => `${g?.name ?? '?'}(${g?.slug ?? '?'})`).join(' · ')}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
          {(filteredMatches || []).map(match => {
            const statusBadge = getStatusBadge(match.status)
            const cs          = correctedScores(match)  // ters-atanmış skor quirk'ini düzelt
            const isLive      = match.status === 'running'
            const teamAFav    = isTeamFollowed(match.team_a_id)
            const teamBFav    = isTeamFollowed(match.team_b_id)
            const turkA       = isTurkishTeam(match.team_a?.name ?? '')
            const turkB       = isTurkishTeam(match.team_b?.name ?? '')
            const hasTurkish  = turkA || turkB
            const isHotPick   = (match.prediction_confidence ?? 0) > 0.80

            return (
              <div
                key={match.id}
                {...clickableProps(() => navigate(`/match/${match.id}`), { label: `${match.team_a?.name ?? ''} - ${match.team_b?.name ?? ''} maç detayı` })}
                style={{
                  position: 'relative', borderRadius: 18,
                  padding: '18px 18px 14px',
                  overflow: 'visible',
                  background: 'var(--surface)',
                  border: isLive
                    ? '1.5px solid rgba(255,70,85,.6)'
                    : isHotPick
                    ? '1.5px solid rgba(255,100,50,.5)'
                    : hasTurkish
                    ? '1.5px solid rgba(224,69,94,.5)'
                    : '1.5px solid var(--line)',
                  boxShadow: isLive
                    ? '0 0 20px rgba(255,70,85,.2)'
                    : isHotPick
                    ? '0 0 14px rgba(255,100,50,.12)'
                    : hasTurkish
                    ? '0 0 14px rgba(224,69,94,.10)'
                    : 'none',
                  cursor: 'pointer',
                  transition: 'transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, border-color .2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform   = 'translateY(-5px) scale(1.012)'
                  e.currentTarget.style.boxShadow   = '0 12px 32px rgba(194,92,208,.22)'
                  e.currentTarget.style.borderColor = FEXT.accent
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform   = 'none'
                  e.currentTarget.style.boxShadow   = isLive ? '0 0 20px rgba(255,70,85,.2)' : isHotPick ? '0 0 14px rgba(255,100,50,.12)' : hasTurkish ? '0 0 14px rgba(224,69,94,.10)' : 'none'
                  e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.6)' : isHotPick ? 'rgba(255,100,50,.5)' : hasTurkish ? 'rgba(224,69,94,.5)' : 'var(--line)'
                }}
              >
                <div style={{ padding: 0 }}>
                  {/* Top row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                      <span style={{ padding: '2px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-4)' }}>
                        {gameDisplayName(match.game)}
                      </span>
                      {hasTurkish && <TurkishBadge compact />}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {/* Bo Format */}
                      {getBOFormat(match.team_a_score, match.team_b_score, match.number_of_games) && (
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(255,255,255,.06)', border: '1px solid var(--line)', color: 'var(--text-4)' }}>
                          {getBOFormat(match.team_a_score, match.team_b_score, match.number_of_games)}
                        </span>
                      )}
                      {/* AI Hot Pick */}
                      {isHotPick && (
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800, background: 'rgba(255,100,50,.2)', border: '1px solid rgba(255,100,50,.5)', color: '#ff8c42', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Flame size={11} /> Sıcak
                        </span>
                      )}
                      {/* Prediction % */}
                      {match.prediction_team_a != null && (
                        isUncertainPrediction(match.prediction_team_a, match.prediction_team_b, match.prediction_confidence) ? (
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'var(--hover)', border: '1px solid var(--line-2)', color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Sparkles size={11} /> Belirsiz
                          </span>
                        ) : (
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(102,126,234,.2)', border: '1px solid rgba(102,126,234,.5)', color: '#818cf8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Sparkles size={11} /> {Math.round(Math.max(match.prediction_team_a, match.prediction_team_b) * 100)}%
                          </span>
                        )
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
                      <button onClick={e => toggleFavorite(match.team_a_id, e)} style={{ position: 'absolute', top: 0, left: 2, background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
                        <Star size={15} fill={teamAFav ? '#FFD700' : 'none'} color={teamAFav ? '#FFD700' : 'var(--text-4)'} />
                      </button>
                      <InitialsImage
                        src={match.team_a?.logo_url}
                        name={match.team_a?.name ?? '?'}
                        width={52} height={52}
                        borderRadius={8}
                        style={{ margin: '0 auto 8px' }}
                        imgStyle={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }}
                      />
                      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word', color: turkA ? '#E0455E' : 'var(--text-1)' }}>
                        {match.team_a?.name}
                      </div>
                      {activeTab === 'past' && match.team_a_score != null && (
                        <div style={{ fontSize: 22, fontWeight: 800, color: match.winner_id === match.team_a_id ? '#4CAF50' : 'var(--text-2)', marginTop: 4 }}>
                          {cs.team_a_score}
                        </div>
                      )}
                    </div>

                    {/* VS */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: FEXT.accentText, letterSpacing: '2px' }}>VS</span>
                      <div style={{ width: 1, height: 24, background: 'var(--line)' }} />
                      {match.status === 'not_started' && <Countdown target={matchTimeIso(match)} />}
                    </div>

                    {/* Team B */}
                    <div
                      onClick={e => { e.stopPropagation(); navigate(`/team/${match.team_b_id}`) }}
                      style={{ flex: 1, textAlign: 'center', cursor: 'pointer', position: 'relative', padding: '8px 4px' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '.75'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      <button onClick={e => toggleFavorite(match.team_b_id, e)} style={{ position: 'absolute', top: 0, right: 2, background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
                        <Star size={15} fill={teamBFav ? '#FFD700' : 'none'} color={teamBFav ? '#FFD700' : 'var(--text-4)'} />
                      </button>
                      <InitialsImage
                        src={match.team_b?.logo_url}
                        name={match.team_b?.name ?? '?'}
                        width={52} height={52}
                        borderRadius={8}
                        style={{ margin: '0 auto 8px' }}
                        imgStyle={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }}
                      />
                      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word', color: turkB ? '#E0455E' : 'var(--text-1)' }}>
                        {match.team_b?.name}
                      </div>
                      {activeTab === 'past' && match.team_b_score != null && (
                        <div style={{ fontSize: 22, fontWeight: 800, color: match.winner_id === match.team_b_id ? '#4CAF50' : 'var(--text-2)', marginTop: 4 }}>
                          {cs.team_b_score}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* AI Win Bar */}
                  {match.prediction_team_a != null && match.prediction_team_b != null && (() => {
                    const predUncertain = isUncertainPrediction(match.prediction_team_a, match.prediction_team_b, match.prediction_confidence)
                    return (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface)', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ width: `${Math.round(match.prediction_team_a * 100)}%`, height: '100%', background: predUncertain ? 'var(--track)' : 'linear-gradient(90deg,#667eea,#764ba2)', transition: 'width .5s' }} />
                      </div>
                      {predUncertain ? (
                        <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 3, textAlign: 'center', fontWeight: 700 }}>AI · Belirsiz</div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-5)', marginTop: 3 }}>
                          <span style={{ color: match.prediction_team_a >= match.prediction_team_b ? '#818cf8' : 'var(--text-5)' }}>
                            {Math.round(match.prediction_team_a * 100)}%
                          </span>
                          <span style={{ color: match.prediction_team_b > match.prediction_team_a ? '#818cf8' : 'var(--text-5)' }}>
                            {Math.round(match.prediction_team_b * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                    )
                  })()}

                  {/* Bottom row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--surface-2)', paddingTop: 10, gap: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Trophy size={12} style={{ flexShrink: 0 }} /> {match.tournament?.name ?? '—'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {roundLabel(match) && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: FEXT.accentText, background: FEXT.accentSoftBg, border: `1px solid ${FEXT.accentBorder}`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{roundLabel(match)}</span>
                      )}
                      {match.stream_url && match.status !== 'finished' && (
                        <a
                          href={match.stream_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 10, fontWeight: 700,
                            color: 'var(--ai)', background: 'rgba(167,139,250,.12)',
                            border: '1px solid rgba(167,139,250,.35)',
                            borderRadius: 6, padding: '2px 8px',
                            textDecoration: 'none',
                            transition: 'background .15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(167,139,250,.22)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(167,139,250,.12)'}
                        >
                          ▶ İzle
                        </a>
                      )}
                      <div style={{ fontSize: 11, fontWeight: 600, color: isLive ? '#FF4655' : '#4CAF50', background: isLive ? 'rgba(255,70,85,.1)' : 'rgba(76,175,80,.1)', padding: '2px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {isLive ? <><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF4655', animation: 'pulse 1.4s infinite' }} /> CANLI</> : formatMatchTime(match, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
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

    </div>
  )
}

export default Matches