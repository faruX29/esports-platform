import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { getFavorites, addFavorite, removeFavorite, isFavorite } from './favoritesHelper'
import { isTurkishTeam } from './constants'

// game_name sütunundaki olası değerlere karşı ilike eşleştirme patternleri
// (PandaScore, cs-go, Counter-Strike 2, vb. farklı isimler için)
const GAME_FILTER_PATTERNS = {
  'Valorant':          ['valorant'],
  'Counter-Strike 2':  ['counter-strike', 'cs-go', 'cs2'],
  'League of Legends': ['league of legends', 'league-of-legends'],
  '__dota2__':         ['dota'],
}

function UpcomingMatches() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState([])
  const [accuracy, setAccuracy] = useState(null);
  const [recentResults, setRecentResults] = useState([])
  const [filteredMatches, setFilteredMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Filtre state'leri
  const [gameFilter, setGameFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date-asc')
  const [searchQuery, setSearchQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  
  // Refresh state'leri
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(new Date())
  
  // Modal state
  const [selectedMatch, setSelectedMatch] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [modalPlayers, setModalPlayers] = useState({ teamA: [], teamB: [] })
  const [loadingModalPlayers, setLoadingModalPlayers] = useState(false)
  const [h2hData, setH2hData] = useState(null)
  
  // Live matches state
  const [liveMatches, setLiveMatches] = useState([])

  // Favorites state
  const [favorites, setFavorites] = useState([])

  useEffect(() => {
    setFavorites(getFavorites())
    fetchMatches()
    fetchRecentResults()
    fetchAccuracy()
    fetchLiveMatches()
  }, [gameFilter, sortBy])

  // Search and favorites filter effect
  useEffect(() => {
    let filtered = matches

    // Arama filtresi
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(match => 
        match.team_a_name.toLowerCase().includes(query) ||
        match.team_b_name.toLowerCase().includes(query) ||
        match.tournament_name.toLowerCase().includes(query)
      )
    }

    // Favoriler filtresi
    if (showFavoritesOnly && favorites.length > 0) {
      filtered = filtered.filter(match => 
        favorites.includes(match.team_a_id) || favorites.includes(match.team_b_id)
      )
    }

    setFilteredMatches(filtered)
  }, [searchQuery, matches, showFavoritesOnly, favorites])

  // Auto-refresh effect
  useEffect(() => {
    let interval
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchMatches()
        fetchAccuracy();
        fetchRecentResults()
        fetchLiveMatches()
      }, 30000)
    }
    
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [autoRefresh, gameFilter, sortBy])

  async function fetchMatches() {
    try {
      setLoading(true)
      
      let query = supabase
        .from('upcoming_matches')
        .select('*')
      
      if (gameFilter !== 'all') {
        const patterns = GAME_FILTER_PATTERNS[gameFilter] ?? []
        if (patterns.length > 0) {
          // ilike ile büyük/küçük harf ve alias bağımsız eşleştirme
          query = query.or(
            patterns.map(p => `game_name.ilike.%${p}%`).join(',')
          )
        } else {
          query = query.ilike('game_name', `%${gameFilter}%`)
        }
      }
      
      if (sortBy === 'date-asc') {
        query = query.order('scheduled_at', { ascending: true })
      } else if (sortBy === 'date-desc') {
        query = query.order('scheduled_at', { ascending: false })
      }
      
      query = query.limit(50)
      
      const { data, error } = await query
      
      if (error) throw error
      
      setMatches(data || [])
      setFilteredMatches(data || [])
      setLastUpdate(new Date())
    } catch (error) {
      console.error('Error fetching matches:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchAccuracy = async () => {
  console.log('🧠 Fetching accuracy...')
  try {
    const { data, error } = await supabase
      .from('ai_accuracy_stats')
      .select('*')
      .single();

      console.log('📊 Accuracy data:', data, 'Error:', error);
    
    if (error) throw error;
    setAccuracy(data);
  } catch (error) {
    console.error('Error fetching accuracy:', error);
  }
};

  async function fetchRecentResults() {
    try {
      const { data, error } = await supabase
        .from('matches')
        .select(`
          *,
          team_a:teams!matches_team_a_id_fkey(*),
          team_b:teams!matches_team_b_id_fkey(*),
          tournament:tournaments(*),
          game:games(*)
        `)
        .eq('status', 'finished')
        .order('scheduled_at', { ascending: false })
        .limit(10)

      if (error) throw error
      setRecentResults(data || [])
    } catch (error) {
      console.error('Error fetching recent results:', error)
    }
  }

  async function fetchLiveMatches() {
    try {
      const { data } = await supabase
        .from('matches')
        .select(`
          *,
          team_a:teams!matches_team_a_id_fkey(*),
          team_b:teams!matches_team_b_id_fkey(*),
          tournament:tournaments(*),
          game:games(*)
        `)
        .eq('status', 'running')
        .order('scheduled_at', { ascending: true })
      setLiveMatches(data || [])
    } catch (error) {
      console.error('Error fetching live matches:', error)
    }
  }

  function handleManualRefresh() {
    fetchMatches()
    fetchRecentResults()
    fetchLiveMatches()
  }

  function clearSearch() {
    setSearchQuery('')
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
        .limit(10)
    ])

    setModalPlayers({ teamA: playersA || [], teamB: playersB || [] })

    const h2h = h2hMatches || []
    const teamAWins = h2h.filter(m => m.winner_id === teamAId).length
    const teamBWins = h2h.filter(m => m.winner_id === teamBId).length
    const draws = h2h.filter(m => !m.winner_id).length
    setH2hData({ matches: h2h, teamAWins, teamBWins, draws, total: h2h.length, teamAId, teamBId })

    setLoadingModalPlayers(false)
  }

  function closeModal() {
    setShowModal(false)
    setSelectedMatch(null)
  }

  function toggleFavorite(teamId, event) {
    event.stopPropagation()
    
    if (isFavorite(teamId)) {
      const updated = removeFavorite(teamId)
      setFavorites(updated)
    } else {
      const updated = addFavorite(teamId)
      setFavorites(updated)
    }
  }

  function getStatusBadge(status) {
    const badges = {
      'not_started': { text: '⏳ Upcoming', color: '#FFB800', bg: 'rgba(255, 184, 0, 0.1)' },
      'running': { text: '🔴 LIVE', color: '#FF4655', bg: 'rgba(255, 70, 85, 0.2)' },
      'finished': { text: '✅ Finished', color: '#4CAF50', bg: 'rgba(76, 175, 80, 0.1)' }
    }
    return badges[status] || badges['not_started']
  }

  // Maç sayıları
  const liveCount = liveMatches.length
  const upcomingCount = filteredMatches.filter(m => m.status === 'not_started').length

  // ── Oyun ikonu yardımcısı ────────────────────────────────────────
  const GAME_TABS = [
    { value: 'all',               label: 'All',      icon: '🎮', patterns: [] },
    { value: 'Valorant',          label: 'VALORANT',  icon: '⚡', patterns: GAME_FILTER_PATTERNS['Valorant'] },
    { value: 'Counter-Strike 2',  label: 'CS2',       icon: '🎯', patterns: GAME_FILTER_PATTERNS['Counter-Strike 2'] },
    { value: 'League of Legends', label: 'LoL',       icon: '🏆', patterns: GAME_FILTER_PATTERNS['League of Legends'] },
    { value: '__dota2__',         label: 'Dota 2',    icon: '🔮', patterns: GAME_FILTER_PATTERNS['__dota2__'], soon: true },
  ]

  if (loading && matches.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <h2>⏳ Loading matches...</h2>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '50px', color: 'red' }}>
        <h2>❌ Error: {error}</h2>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 20px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* ── Hero Header ──────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.5px' }}>
          🎮 Esports Matches
        </h1>
        <p style={{ color: '#555', fontSize: '13px', margin: 0 }}>
          Live &amp; upcoming — auto-synced every 15 min
        </p>
      </div>

      {/* ── Game Selector ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '8px', justifyContent: 'center',
        flexWrap: 'wrap', marginBottom: '22px',
      }}>
        {GAME_TABS.map(tab => {
          const active = gameFilter === tab.value
          return tab.soon ? (
            <div
              key={tab.value}
              title="Yakında eklenecek"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '9px 18px',
                borderRadius: '12px',
                border: '1px solid #2a2a2a',
                background: '#111',
                color: '#444', fontSize: '13px', fontWeight: 600,
                cursor: 'not-allowed', userSelect: 'none',
                position: 'relative',
              }}
            >
              {tab.icon} {tab.label}
              <span style={{
                position: 'absolute', top: '-9px', right: '-6px',
                padding: '2px 7px', borderRadius: '7px',
                background: 'linear-gradient(135deg,#FFB800,#FF8C00)',
                color: '#000',
                fontSize: '9px', fontWeight: 800, letterSpacing: '0.5px',
                textTransform: 'uppercase',
                boxShadow: '0 2px 6px rgba(255,184,0,.4)',
              }}>Yakında</span>
            </div>
          ) : (
            <button
              key={tab.value}
              onClick={() => setGameFilter(tab.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '9px 18px',
                borderRadius: '12px',
                border: active ? '1.5px solid #FF4655' : '1.5px solid #2a2a2a',
                background: active ? 'rgba(255,70,85,.15)' : '#111',
                color: active ? '#FF4655' : '#888',
                fontSize: '13px', fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                transition: 'all .18s',
                boxShadow: active ? '0 0 12px rgba(255,70,85,.25)' : 'none',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor='#555'; e.currentTarget.style.color='#ccc'; e.currentTarget.style.background='#181818' } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor='#2a2a2a'; e.currentTarget.style.color='#888'; e.currentTarget.style.background='#111' } }}
            >
              {tab.icon} {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Stats Bar ────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '10px', justifyContent: 'center',
        flexWrap: 'wrap', marginBottom: '22px',
      }}>
        <Chip color='#FF4655' bg='rgba(255,70,85,.15)'>🔴 {liveCount} Live</Chip>
        <Chip color='#FFB800' bg='rgba(255,184,0,.12)'>⏳ {upcomingCount} Upcoming</Chip>
        <Chip color='#888'   bg='rgba(255,255,255,.05)'>📊 {matches.length} Total</Chip>
        {favorites.length > 0 && <Chip color='#FFD700' bg='rgba(255,215,0,.12)'>⭐ {favorites.length} Fav</Chip>}
      </div>

      {/* ── AI Accuracy Badge ───────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
      {/* AI Accuracy Badge */}
{accuracy && (() => {
  const pct = parseFloat(accuracy.accuracy_percentage)
  const isHigh   = pct >= 70
  const isMedium = pct >= 50 && pct < 70
  const gradient = isHigh
    ? 'linear-gradient(135deg, #00b09b 0%, #0f9e58 100%)'
    : isMedium
    ? 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)'
    : 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)'
  const label = isHigh ? '🔥 High Accuracy' : isMedium ? '📈 Improving' : '🎓 Learning'
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 16px',
      background: gradient,
      borderRadius: '20px',
      fontSize: '14px',
      fontWeight: '600',
      color: 'white',
      marginLeft: '12px',
      boxShadow: isHigh ? '0 0 12px rgba(0,176,155,0.4)' : 'none'
    }}>
      <span>🧠</span>
      <span>AI Accuracy: {accuracy.accuracy_percentage}%</span>
      <span style={{ fontSize: '12px', opacity: 0.9 }}>
        ({accuracy.correct_predictions}/{accuracy.total_predictions})
      </span>
      <span style={{ fontSize: '11px', opacity: 0.85 }}>{label}</span>
    </div>
  )
})()}
      </div>{/* /AI accuracy wrapper */}

      {/* ── LIVE MATCHES ─────────────────────────────────────────── */}
      {liveMatches.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{
            fontSize: '24px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#FF4655'
          }}>
            <span style={{ animation: 'pulse 1.2s infinite' }}>🔴</span>
            LIVE NOW — {liveMatches.length} maç
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '15px'
          }}>
            {liveMatches.map((match) => {
              const turkA = isTurkishTeam(match.team_a?.name)
              const turkB = isTurkishTeam(match.team_b?.name)
              const hasTurkish = turkA || turkB
              return (
                <div
                  key={match.id}
                  onClick={() => openMatchDetails(match)}
                  style={{
                    border: '2px solid #FF4655',
                    borderRadius: '12px',
                    padding: '16px',
                    backgroundColor: '#1a0a0a',
                    background: 'linear-gradient(135deg, #1a0a0a 0%, #2a0f0f 100%)',
                    boxShadow: '0 0 20px rgba(255,70,85,0.35)',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'transform 0.2s, box-shadow 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)'
                    e.currentTarget.style.boxShadow = '0 8px 30px rgba(255,70,85,0.55)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = '0 0 20px rgba(255,70,85,0.35)'
                  }}
                >
                  {/* LIVE badge */}
                  <div style={{
                    position: 'absolute', top: '12px', right: '12px',
                    padding: '3px 10px',
                    backgroundColor: '#FF4655',
                    borderRadius: '12px',
                    fontSize: '11px', fontWeight: 'bold',
                    animation: 'pulse 1.2s infinite'
                  }}>
                    🔴 LIVE
                  </div>

                  {/* Turkish badge */}
                  {hasTurkish && (
                    <div style={{
                      position: 'absolute', top: '12px', left: '12px',
                      padding: '3px 8px',
                      background: 'linear-gradient(135deg, #C8102E 0%, #003087 100%)',
                      borderRadius: '10px',
                      fontSize: '11px', fontWeight: 'bold',
                      border: '1px solid rgba(212,175,55,0.6)'
                    }}>
                      🇹🇷
                    </div>
                  )}

                  {/* Game */}
                  <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px', marginBottom: '14px', textAlign: 'center' }}>
                    {match.game?.name}
                  </div>

                  {/* Teams + Score */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    {/* Team A */}
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      {match.team_a?.logo_url && (
                        <img src={match.team_a.logo_url} alt={match.team_a.name}
                          style={{ width: '48px', height: '48px', objectFit: 'contain', marginBottom: '6px' }} />
                      )}
                      <div style={{ fontSize: '13px', fontWeight: 'bold', color: turkA ? '#FFD700' : 'white' }}>
                        {match.team_a?.name}
                      </div>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#FF4655', marginTop: '4px' }}>
                        {match.team_a_score ?? '—'}
                      </div>
                    </div>

                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#FF4655', padding: '0 10px' }}>VS</div>

                    {/* Team B */}
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      {match.team_b?.logo_url && (
                        <img src={match.team_b.logo_url} alt={match.team_b.name}
                          style={{ width: '48px', height: '48px', objectFit: 'contain', marginBottom: '6px' }} />
                      )}
                      <div style={{ fontSize: '13px', fontWeight: 'bold', color: turkB ? '#FFD700' : 'white' }}>
                        {match.team_b?.name}
                      </div>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#FF4655', marginTop: '4px' }}>
                        {match.team_b_score ?? '—'}
                      </div>
                    </div>
                  </div>

                  {/* Tournament */}
                  {match.tournament && (
                    <div style={{ fontSize: '12px', color: '#666', textAlign: 'center' }}>
                      🏆 {match.tournament.name}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Arama Kutusu */}
      <div style={{ maxWidth: '520px', margin: '0 auto 16px', position: 'relative' }}>
        <input
          type="text"
          placeholder="🔍 Search by team or tournament name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '15px 40px 15px 15px',
            borderRadius: '8px',
            border: '2px solid #444',
            backgroundColor: '#1a1a1a',
            color: 'white',
            fontSize: '16px',
            outline: 'none',
            transition: 'border-color 0.2s'
          }}
          onFocus={(e) => e.target.style.borderColor = '#FF4655'}
          onBlur={(e) => e.target.style.borderColor = '#444'}
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            style={{
              position: 'absolute',
              right: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '5px 10px'
            }}
            onMouseEnter={(e) => e.target.style.color = '#fff'}
            onMouseLeave={(e) => e.target.style.color = '#888'}
          >
            ✕
          </button>
        )}
      </div>
      
      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '10px', marginBottom: '18px',
        justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center',
      }}>
        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: '8px',
            border: '1px solid #2a2a2a', background: '#111',
            color: '#ccc', cursor: 'pointer', fontSize: '13px', outline: 'none',
          }}
        >
          <option value="date-asc">📅 Earliest First</option>
          <option value="date-desc">📅 Latest First</option>
        </select>

        {/* Favorites toggle */}
        <button
          onClick={() => setShowFavoritesOnly(v => !v)}
          disabled={favorites.length === 0}
          style={{
            padding: '8px 14px', borderRadius: '8px',
            border: showFavoritesOnly ? '1px solid #FFD700' : '1px solid #2a2a2a',
            background: showFavoritesOnly ? 'rgba(255,215,0,.15)' : '#111',
            color: showFavoritesOnly ? '#FFD700' : favorites.length === 0 ? '#444' : '#888',
            fontSize: '13px', fontWeight: showFavoritesOnly ? 700 : 400,
            cursor: favorites.length === 0 ? 'not-allowed' : 'pointer', transition: 'all .15s',
          }}
        >
          ⭐ {showFavoritesOnly ? 'All Matches' : 'Favorites'}
        </button>

        {/* Refresh */}
        <button
          onClick={handleManualRefresh}
          disabled={loading}
          style={{
            padding: '8px 14px', borderRadius: '8px',
            border: '1px solid #2a2a2a', background: '#111',
            color: loading ? '#444' : '#888', fontSize: '13px',
            cursor: loading ? 'not-allowed' : 'pointer', transition: 'all .15s',
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.color = '#fff' }}
          onMouseLeave={e => { if (!loading) e.currentTarget.style.color = '#888' }}
        >
          {loading ? '⏳' : '🔄'} Refresh
        </button>

        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh(v => !v)}
          style={{
            padding: '8px 14px', borderRadius: '8px',
            border: autoRefresh ? '1px solid #4CAF50' : '1px solid #2a2a2a',
            background: autoRefresh ? 'rgba(76,175,80,.15)' : '#111',
            color: autoRefresh ? '#4CAF50' : '#888',
            fontSize: '13px', fontWeight: autoRefresh ? 700 : 400,
            cursor: 'pointer', transition: 'all .15s',
          }}
        >
          🔁 {autoRefresh ? 'Auto ON' : 'Auto OFF'}
        </button>
      </div>

      {/* ── Sonuç sayısı ─────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <div style={{ color: '#555', fontSize: '12px', marginBottom: '2px' }}>
          {filteredMatches.length === 0 ? '📭 No matches found'
            : searchQuery ? `🔍 ${filteredMatches.length} / ${matches.length} matches`
            : showFavoritesOnly ? `⭐ ${filteredMatches.length} favourited matches`
            : `${filteredMatches.length} matches`}
        </div>
        <div style={{ color: '#444', fontSize: '11px' }}>
          Last updated: {lastUpdate.toLocaleTimeString('tr-TR')}
          {autoRefresh && <span style={{ color: '#4CAF50', marginLeft: '8px' }}>● auto</span>}
        </div>
      </div>

      {/* ── For You Section ──────────────────────────────────────────── */}
      {(() => {
        if (favorites.length === 0) return null
        const forYouMatches = matches.filter(
          m => favorites.includes(m.team_a_id) || favorites.includes(m.team_b_id)
        )
        if (forYouMatches.length === 0) return null
        return (
          <div style={{ marginBottom: '36px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '5px 14px', borderRadius: '20px',
                background: 'linear-gradient(135deg,rgba(255,215,0,.15),rgba(255,165,0,.08))',
                border: '1px solid rgba(255,215,0,.4)',
              }}>
                <span style={{ fontSize: '14px' }}>⭐</span>
                <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '1px', color: '#FFD700', textTransform: 'uppercase' }}>
                  For You
                </span>
                <span style={{
                  padding: '1px 7px', borderRadius: '10px',
                  background: 'rgba(255,215,0,.25)', color: '#FFD700',
                  fontSize: '11px', fontWeight: 700,
                }}>
                  {forYouMatches.length}
                </span>
              </div>
              <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg,rgba(255,215,0,.3),transparent)' }} />
              <span style={{ fontSize: '11px', color: '#666' }}>takip edilen takımlar</span>
            </div>

            {/* Yatay kaydırmalı kart şeridi */}
            <div style={{
              display: 'flex', gap: '12px',
              overflowX: 'auto', paddingBottom: '6px',
              scrollbarWidth: 'thin', scrollbarColor: '#333 transparent',
            }}>
              {forYouMatches.map(match => {
                const isLive   = match.status === 'running'
                const favA     = favorites.includes(match.team_a_id)
                const favB     = favorites.includes(match.team_b_id)
                return (
                  <div
                    key={match.id}
                    onClick={() => openMatchDetails(match)}
                    style={{
                      flexShrink: 0, width: '200px',
                      background: '#111',
                      border: isLive
                        ? '1.5px solid rgba(255,70,85,.6)'
                        : '1.5px solid rgba(255,215,0,.35)',
                      borderRadius: '16px',
                      padding: '14px',
                      cursor: 'pointer',
                      transition: 'transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, border-color .2s',
                      boxShadow: isLive ? '0 0 16px rgba(255,70,85,.18)' : '0 0 12px rgba(255,215,0,.05)',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-4px) scale(1.02)'
                      e.currentTarget.style.boxShadow = '0 10px 28px rgba(255,215,0,.2)'
                      e.currentTarget.style.borderColor = '#FFD700'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'none'
                      e.currentTarget.style.boxShadow = isLive ? '0 0 16px rgba(255,70,85,.18)' : '0 0 12px rgba(255,215,0,.05)'
                      e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.6)' : 'rgba(255,215,0,.35)'
                    }}
                  >
                    {/* Game + Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontSize: '9px', fontWeight: 700, color: '#555', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                        {match.game_name}
                      </span>
                      {isLive && (
                        <span style={{ fontSize: '9px', fontWeight: 800, color: '#FF4655', animation: 'pulse 1.2s infinite' }}>
                          ● LIVE
                        </span>
                      )}
                    </div>

                    {/* Teams */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {[
                        { name: match.team_a_name, logo: match.team_a_logo, fav: favA },
                        { name: match.team_b_name, logo: match.team_b_logo, fav: favB },
                      ].map((t, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {t.logo
                            ? <img src={t.logo} alt={t.name} style={{ width: '26px', height: '26px', objectFit: 'contain', flexShrink: 0 }} />
                            : <div style={{ width: '26px', height: '26px', background: '#1e1e1e', borderRadius: '6px', flexShrink: 0 }} />
                          }
                          <span style={{
                            fontSize: '12px', fontWeight: t.fav ? 700 : 400,
                            color: t.fav ? '#FFD700' : '#bbb',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {t.fav && <span style={{ marginRight: '3px', fontSize: '10px' }}>⭐</span>}
                            {t.name}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Date */}
                    <div style={{ fontSize: '10px', color: '#444', marginTop: '10px', textAlign: 'right' }}>
                      {isLive ? <span style={{ color: '#FF4655' }}>🔴 LIVE</span>
                        : new Date(match.scheduled_at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── Maç Kartları ─────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '16px',
      }}>
        {filteredMatches.map((match) => {
          const statusBadge = getStatusBadge(match.status)
          const isLive = match.status === 'running'
          const teamAFav = isFavorite(match.team_a_id)
          const teamBFav = isFavorite(match.team_b_id)
          const turkA = isTurkishTeam(match.team_a_name)
          const turkB = isTurkishTeam(match.team_b_name)
          const hasTurkish = turkA || turkB

          return (
            <div
              key={match.id}
              onClick={() => openMatchDetails(match)}
              style={{
                position: 'relative',
                borderRadius: '18px',
                padding: hasTurkish ? '0 0 14px' : '18px 18px 14px',
                overflow: hasTurkish ? 'hidden' : 'visible',
                background: '#111',
                border: isLive
                  ? '1.5px solid rgba(255,70,85,.6)'
                  : hasTurkish
                  ? '1.5px solid rgba(212,175,55,.5)'
                  : '1.5px solid #222',
                boxShadow: isLive
                  ? '0 0 20px rgba(255,70,85,.2)'
                  : hasTurkish
                  ? '0 0 14px rgba(212,175,55,.08)'
                  : 'none',
                cursor: 'pointer',
                transition: 'transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, border-color .2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-5px) scale(1.012)'
                e.currentTarget.style.boxShadow = isLive
                  ? '0 12px 36px rgba(255,70,85,.45)'
                  : hasTurkish
                  ? '0 12px 32px rgba(255,70,85,.22), 0 0 0 1.5px rgba(212,175,55,.3)'
                  : '0 12px 32px rgba(255,70,85,.22)'
                e.currentTarget.style.borderColor = '#FF4655'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = isLive ? '0 0 20px rgba(255,70,85,.2)' : hasTurkish ? '0 0 14px rgba(212,175,55,.08)' : 'none'
                e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.6)' : hasTurkish ? 'rgba(212,175,55,.5)' : '#222'
              }}
            >
              {/* ── Turkish Pride Banner ───────────────────────────────── */}
              {hasTurkish && (
                <div style={{
                  background: 'linear-gradient(90deg, #C8102E 0%, #a00d25 40%, #001f6d 100%)',
                  padding: '5px 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  marginBottom: '14px',
                }}>
                  <span style={{ fontSize: '14px' }}>🇹🇷</span>
                  <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '1.5px', color: '#fff', textTransform: 'uppercase' }}>Turkish Pride</span>
                  <span style={{ fontSize: '14px' }}>🇹🇷</span>
                </div>
              )}
              {/* ── Top row: game tag + badges ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', padding: hasTurkish ? '0 18px' : '0' }}>
                {/* Game tag */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    padding: '2px 9px',
                    borderRadius: '6px',
                    fontSize: '10px', fontWeight: 700, letterSpacing: '0.8px',
                    textTransform: 'uppercase',
                    background: '#1e1e1e', border: '1px solid #2e2e2e', color: '#777',
                  }}>
                    {match.game_name}
                  </span>
                </div>

                {/* Status + AI badges */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {match.prediction_team_a && match.prediction_team_b && (
                    <span style={{
                      padding: '2px 8px', borderRadius: '6px',
                      fontSize: '10px', fontWeight: 700,
                      background: 'rgba(102,126,234,.2)',
                      border: '1px solid rgba(102,126,234,.5)', color: '#818cf8',
                    }}>
                      🔮 {Math.round(Math.max(match.prediction_team_a, match.prediction_team_b) * 100)}%
                    </span>
                  )}
                  <span style={{
                    padding: '2px 8px', borderRadius: '6px',
                    fontSize: '10px', fontWeight: 700,
                    background: statusBadge.bg,
                    border: `1px solid ${statusBadge.color}`,
                    color: statusBadge.color,
                    animation: isLive ? 'pulse 1.5s infinite' : 'none',
                  }}>
                    {statusBadge.text}
                  </span>
                </div>
              </div>

              {/* ── Teams row ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '14px', padding: hasTurkish ? '0 18px' : '0' }}>
                {/* Team A */}
                <div
                  onClick={e => { e.stopPropagation(); navigate(`/team/${match.team_a_id}`) }}
                  style={{ flex: 1, textAlign: 'center', cursor: 'pointer', position: 'relative', padding: '8px 4px' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '.75'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <button
                    onClick={e => toggleFavorite(match.team_a_id, e)}
                    style={{
                      position: 'absolute', top: 0, right: 2,
                      background: 'none', border: 'none',
                      fontSize: '14px', cursor: 'pointer', padding: '2px',
                    }}
                  >{teamAFav ? '⭐' : '☆'}</button>
                  {match.team_a_logo
                    ? <img src={match.team_a_logo} alt={match.team_a_name} style={{ width: '52px', height: '52px', objectFit: 'contain', marginBottom: '8px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }} />
                    : <div style={{ width: '52px', height: '52px', margin: '0 auto 8px', background: '#1e1e1e', borderRadius: '8px' }} />
                  }
                  <div style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word' }}>
                    {match.team_a_name}
                  </div>
                </div>

                {/* VS divider */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: '#FF4655', letterSpacing: '2px', textShadow: isLive ? '0 0 8px rgba(255,70,85,.6)' : 'none' }}>VS</span>
                  <div style={{ width: '1px', height: '24px', background: '#2a2a2a' }} />
                </div>

                {/* Team B */}
                <div
                  onClick={e => { e.stopPropagation(); navigate(`/team/${match.team_b_id}`) }}
                  style={{ flex: 1, textAlign: 'center', cursor: 'pointer', position: 'relative', padding: '8px 4px' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '.75'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <button
                    onClick={e => toggleFavorite(match.team_b_id, e)}
                    style={{
                      position: 'absolute', top: 0, left: 2,
                      background: 'none', border: 'none',
                      fontSize: '14px', cursor: 'pointer', padding: '2px',
                    }}
                  >{teamBFav ? '⭐' : '☆'}</button>
                  {match.team_b_logo
                    ? <img src={match.team_b_logo} alt={match.team_b_name} style={{ width: '52px', height: '52px', objectFit: 'contain', marginBottom: '8px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }} />
                    : <div style={{ width: '52px', height: '52px', margin: '0 auto 8px', background: '#1e1e1e', borderRadius: '8px' }} />
                  }
                  <div style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word' }}>
                    {match.team_b_name}
                  </div>
                </div>
              </div>

              {/* ── Bottom row: tournament + date ── */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderTop: '1px solid #1e1e1e', paddingTop: '10px',
                gap: '8px',
                margin: hasTurkish ? '0 18px' : '0',
              }}>
                <div style={{
                  fontSize: '11px', color: '#555',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                  🏆 {match.tournament_name}
                </div>
                <div style={{
                  fontSize: '11px', fontWeight: 600,
                  color: isLive ? '#FF4655' : '#4CAF50',
                  flexShrink: 0,
                  background: isLive ? 'rgba(255,70,85,.1)' : 'rgba(76,175,80,.1)',
                  padding: '2px 8px', borderRadius: '6px',
                }}>
                  {isLive ? '🔴 LIVE' : new Date(match.scheduled_at).toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {/* ── Recent Results (compact) ─────────────────────────────────── */}
      {recentResults.length > 0 && (
        <div style={{ marginTop: '56px', paddingTop: '32px', borderTop: '1px solid #1a1a1a' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            marginBottom: '16px',
          }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
              📊 Recent Results
            </span>
            <div style={{ flex: 1, height: '1px', background: '#1e1e1e' }} />
            <span style={{ fontSize: '11px', color: '#383838' }}>last 10</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {recentResults.map(match => {
              const winA = match.winner_id === match.team_a?.id
              return (
                <div
                  key={match.id}
                  onClick={() => openMatchDetails(match)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '7px 12px',
                    background: '#0e0e0e', borderRadius: '10px',
                    border: '1px solid #181818',
                    cursor: 'pointer', transition: 'border-color .15s, background .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#FF4655'; e.currentTarget.style.background = '#141414' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#181818'; e.currentTarget.style.background = '#0e0e0e' }}
                >
                  {/* Game pill */}
                  <span style={{
                    flexShrink: 0, fontSize: '10px', fontWeight: 700,
                    padding: '1px 6px', borderRadius: '5px',
                    background: '#1e1e1e', border: '1px solid #2e2e2e', color: '#666',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    minWidth: '36px', textAlign: 'center',
                  }}>
                    {match.game?.name === 'Counter-Strike 2' ? 'CS2'
                      : match.game?.name === 'League of Legends' ? 'LoL'
                      : match.game?.name ?? '?'}
                  </span>
                  {/* Team A */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end', opacity: winA ? 1 : .5 }}>
                    <span style={{ fontSize: '12px', fontWeight: winA ? 700 : 400, color: winA ? '#4CAF50' : '#aaa', textAlign: 'right' }}>{match.team_a?.name}</span>
                    {match.team_a?.logo_url && <img src={match.team_a.logo_url} style={{ width: '22px', height: '22px', objectFit: 'contain' }} alt='' />}
                  </div>
                  {/* Score */}
                  <div style={{ flexShrink: 0, fontWeight: 800, fontSize: '13px', minWidth: '44px', textAlign: 'center', color: '#aaa' }}>
                    <span style={{ color: winA ? '#4CAF50' : '#aaa' }}>{match.team_a_score ?? '—'}</span>
                    <span style={{ color: '#444', margin: '0 3px' }}>:</span>
                    <span style={{ color: !winA ? '#4CAF50' : '#aaa' }}>{match.team_b_score ?? '—'}</span>
                  </div>
                  {/* Team B */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', opacity: !winA ? 1 : .5 }}>
                    {match.team_b?.logo_url && <img src={match.team_b.logo_url} style={{ width: '22px', height: '22px', objectFit: 'contain' }} alt='' />}
                    <span style={{ fontSize: '12px', fontWeight: !winA ? 700 : 400, color: !winA ? '#4CAF50' : '#aaa' }}>{match.team_b?.name}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* CSS Animation for LIVE pulse */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>

      {/* Modal */}
      {showModal && selectedMatch && (
        <div 
          onClick={closeModal}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#1a1a1a',
              borderRadius: '15px',
              padding: '30px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              border: '2px solid #FF4655',
              position: 'relative'
            }}
          >
            <button
              onClick={closeModal}
              style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: '30px',
                cursor: 'pointer',
                lineHeight: '30px',
                padding: '0',
                width: '30px',
                height: '30px'
              }}
              onMouseEnter={(e) => e.target.style.color = '#fff'}
              onMouseLeave={(e) => e.target.style.color = '#888'}
            >
              ×
            </button>

            <div style={{
              display: 'inline-block',
              padding: '5px 15px',
              backgroundColor: '#FF4655',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              marginBottom: '20px'
            }}>
              {selectedMatch.game_name}
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-around',
              alignItems: 'center',
              marginBottom: '30px',
              padding: '20px 0'
            }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                {selectedMatch.team_a_logo && (
                  <img 
                    src={selectedMatch.team_a_logo} 
                    alt={selectedMatch.team_a_name}
                    style={{ 
                      width: '100px', 
                      height: '100px', 
                      objectFit: 'contain',
                      marginBottom: '15px'
                    }}
                  />
                )}
                <div style={{ 
                  fontSize: '20px', 
                  fontWeight: 'bold',
                  marginBottom: '5px'
                }}>
                  {selectedMatch.team_a_name}
                </div>
              </div>

              <div style={{ 
                fontSize: '40px', 
                fontWeight: 'bold', 
                color: '#FF4655',
                padding: '0 30px'
              }}>
                VS
              </div>

              <div style={{ textAlign: 'center', flex: 1 }}>
                {selectedMatch.team_b_logo && (
                  <img 
                    src={selectedMatch.team_b_logo} 
                    alt={selectedMatch.team_b_name}
                    style={{ 
                      width: '100px', 
                      height: '100px', 
                      objectFit: 'contain',
                      marginBottom: '15px'
                    }}
                  />
                )}
                <div style={{ 
                  fontSize: '20px', 
                  fontWeight: 'bold',
                  marginBottom: '5px'
                }}>
                  {selectedMatch.team_b_name}
                </div>
              </div>
            </div>

            <div style={{
              backgroundColor: '#0a0a0a',
              borderRadius: '10px',
              padding: '20px',
              marginBottom: '20px'
            }}>
              <div style={{ marginBottom: '15px' }}>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>
                  🏆 Tournament
                </div>
                {selectedMatch.tournament_id ? (
                  <div 
                    onClick={() => {
                      closeModal()
                      navigate(`/tournament/${selectedMatch.tournament_id}`)
                    }}
                    style={{ 
                      fontSize: '16px', 
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      color: '#FFB800',
                      textDecoration: 'underline'
                    }}
                    onMouseEnter={(e) => e.target.style.color = '#FFC933'}
                    onMouseLeave={(e) => e.target.style.color = '#FFB800'}
                  >
                    {selectedMatch.tournament_name} →
                  </div>
                ) : (
                  <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                    {selectedMatch.tournament_name}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: '15px' }}>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>
                  📅 Scheduled Time
                </div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#4CAF50' }}>
                  {new Date(selectedMatch.scheduled_at).toLocaleString('tr-TR', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>

              <div style={{ marginBottom: '15px' }}>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>
                  📊 Status
                </div>
                <div style={{ 
                  fontSize: '16px', 
                  fontWeight: 'bold',
                  color: selectedMatch.status === 'not_started' ? '#FFB800' : '#4CAF50'
                }}>
                  {selectedMatch.status === 'not_started' ? '⏳ Upcoming' : 
                   selectedMatch.status === 'running' ? '🔴 Live' : 
                   selectedMatch.status === 'finished' ? '✅ Finished' : selectedMatch.status}
                </div>
              </div>

              <div>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>
                  🆔 Match ID
                </div>
                <div style={{ fontSize: '14px', color: '#666', fontFamily: 'monospace' }}>
                  {selectedMatch.id}
                </div>
              </div>
            </div>

            {/* AI Prediction + H2H Analysis */}
            <div style={{ marginBottom: '20px' }}>

              {/* AI Prediction Bar */}
              {(selectedMatch.prediction_team_a != null && selectedMatch.prediction_team_b != null) && (() => {
                const pctA = Math.round(selectedMatch.prediction_team_a * 100)
                const pctB = Math.round(selectedMatch.prediction_team_b * 100)
                const aFavored = pctA >= pctB
                return (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ color: '#888', fontSize: '13px', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      🤖 AI Tahmini
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 'bold', flex: 1, textAlign: 'right', color: aFavored ? '#a78bfa' : '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selectedMatch.team_a_name || selectedMatch.team_a?.name}
                      </div>
                      <div style={{ flex: 3, height: '24px', backgroundColor: '#111', borderRadius: '12px', overflow: 'hidden', display: 'flex', position: 'relative' }}>
                        <div style={{ width: `${pctA}%`, background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)', transition: 'width 0.5s ease' }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', color: 'white', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                          {pctA}% — {pctB}%
                        </div>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 'bold', flex: 1, color: !aFavored ? '#a78bfa' : '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selectedMatch.team_b_name || selectedMatch.team_b?.name}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '12px', color: '#555', marginTop: '6px' }}>
                      {aFavored
                        ? `${selectedMatch.team_a_name || selectedMatch.team_a?.name} favori`
                        : `${selectedMatch.team_b_name || selectedMatch.team_b?.name} favori`}
                      {Math.abs(pctA - pctB) < 10 && ' · Çok yakın maç'}
                    </div>
                  </div>
                )
              })()}

              {/* H2H Record */}
              <div>
                <div style={{ color: '#888', fontSize: '13px', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  ⚔️ H2H Geçmişi
                </div>
                {!h2hData ? (
                  <div style={{ textAlign: 'center', color: '#555', padding: '8px', fontSize: '13px' }}>Yükleniyor...</div>
                ) : h2hData.total === 0 ? (
                  <div style={{ textAlign: 'center', color: '#555', padding: '12px', fontSize: '13px', backgroundColor: '#0d0d0d', borderRadius: '8px' }}>
                    Bu iki takım daha önce karşılaşmamış
                  </div>
                ) : (
                  <>
                    {/* Win count boxes */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                      <div style={{
                        flex: 1, textAlign: 'center', padding: '10px 6px',
                        backgroundColor: h2hData.teamAWins > h2hData.teamBWins ? 'rgba(76,175,80,0.12)' : '#0d0d0d',
                        border: h2hData.teamAWins > h2hData.teamBWins ? '1px solid rgba(76,175,80,0.4)' : '1px solid #1e1e1e',
                        borderRadius: '8px'
                      }}>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>{h2hData.teamAWins}</div>
                        <div style={{ fontSize: '11px', color: '#777', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedMatch.team_a_name || selectedMatch.team_a?.name}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', padding: '6px 10px' }}>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#444' }}>—</div>
                        <div style={{ fontSize: '11px', color: '#444' }}>{h2hData.total} maç</div>
                        {h2hData.draws > 0 && <div style={{ fontSize: '10px', color: '#333' }}>{h2hData.draws} berabere</div>}
                      </div>
                      <div style={{
                        flex: 1, textAlign: 'center', padding: '10px 6px',
                        backgroundColor: h2hData.teamBWins > h2hData.teamAWins ? 'rgba(76,175,80,0.12)' : '#0d0d0d',
                        border: h2hData.teamBWins > h2hData.teamAWins ? '1px solid rgba(76,175,80,0.4)' : '1px solid #1e1e1e',
                        borderRadius: '8px'
                      }}>
                        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>{h2hData.teamBWins}</div>
                        <div style={{ fontSize: '11px', color: '#777', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedMatch.team_b_name || selectedMatch.team_b?.name}
                        </div>
                      </div>
                    </div>

                    {/* Recent match rows */}
                    {h2hData.matches.slice(0, 5).map((m) => {
                      const isALeft = m.team_a_id === h2hData.teamAId
                      const leftName  = isALeft ? (selectedMatch.team_a_name || selectedMatch.team_a?.name) : (selectedMatch.team_b_name || selectedMatch.team_b?.name)
                      const rightName = isALeft ? (selectedMatch.team_b_name || selectedMatch.team_b?.name) : (selectedMatch.team_a_name || selectedMatch.team_a?.name)
                      const leftScore  = isALeft ? m.team_a_score : m.team_b_score
                      const rightScore = isALeft ? m.team_b_score : m.team_a_score
                      const leftWinnerId  = isALeft ? h2hData.teamAId : h2hData.teamBId
                      const leftWon  = m.winner_id === leftWinnerId
                      const rightWon = m.winner_id != null && !leftWon
                      return (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', padding: '5px 8px', backgroundColor: '#0d0d0d', borderRadius: '6px', fontSize: '12px' }}>
                          <div style={{ flex: 1, textAlign: 'right', fontWeight: leftWon ? 'bold' : 'normal', color: leftWon ? '#4CAF50' : '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {leftName}
                          </div>
                          <div style={{ padding: '2px 8px', backgroundColor: '#161616', borderRadius: '4px', fontWeight: 'bold', color: '#aaa', minWidth: '52px', textAlign: 'center', flexShrink: 0 }}>
                            {leftScore ?? '?'} — {rightScore ?? '?'}
                          </div>
                          <div style={{ flex: 1, fontWeight: rightWon ? 'bold' : 'normal', color: rightWon ? '#4CAF50' : '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rightName}
                          </div>
                          <div style={{ color: '#333', fontSize: '10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {new Date(m.scheduled_at).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric', year: '2-digit' })}
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            </div>

            {/* Team Rosters */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ color: '#888', fontSize: '13px', fontWeight: 'bold', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                👥 Team Rosters
              </div>
              {loadingModalPlayers ? (
                <div style={{ textAlign: 'center', color: '#666', padding: '10px' }}>Loading rosters...</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                  {/* Team A Roster */}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#aaa', marginBottom: '8px', textAlign: 'center' }}>
                      {selectedMatch.team_a_name || selectedMatch.team_a?.name}
                    </div>
                    {modalPlayers.teamA.length === 0 ? (
                      <div style={{ fontSize: '12px', color: '#555', textAlign: 'center' }}>No roster data</div>
                    ) : (
                      modalPlayers.teamA.map((p, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', backgroundColor: '#0d0d0d', borderRadius: '6px', padding: '6px 8px' }}>
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.nickname} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>?</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</div>
                            {p.role && <div style={{ fontSize: '11px', color: '#888' }}>{p.role}</div>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Team B Roster */}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#aaa', marginBottom: '8px', textAlign: 'center' }}>
                      {selectedMatch.team_b_name || selectedMatch.team_b?.name}
                    </div>
                    {modalPlayers.teamB.length === 0 ? (
                      <div style={{ fontSize: '12px', color: '#555', textAlign: 'center' }}>No roster data</div>
                    ) : (
                      modalPlayers.teamB.map((p, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', backgroundColor: '#0d0d0d', borderRadius: '6px', padding: '6px 8px' }}>
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.nickname} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>?</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</div>
                            {p.role && <div style={{ fontSize: '11px', color: '#888' }}>{p.role}</div>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={closeModal}
              style={{
                width: '100%',
                padding: '15px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#FF4655',
                color: 'white',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#e03d4d'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#FF4655'}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Chip — küçük durum pill'i ──────────────────────────────────────────────────
function Chip({ color, bg, children }) {
  return (
    <div style={{
      padding: '5px 12px',
      borderRadius: '20px',
      fontSize: '13px', fontWeight: 600,
      color, background: bg,
      border: `1px solid ${color}55`,
    }}>
      {children}
    </div>
  )
}

export default UpcomingMatches