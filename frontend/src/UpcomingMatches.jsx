import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { getFavorites, addFavorite, removeFavorite, isFavorite } from './favoritesHelper'

function UpcomingMatches() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState([])
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
  
  // Favorites state
  const [favorites, setFavorites] = useState([])

  useEffect(() => {
    setFavorites(getFavorites())
    fetchMatches()
    fetchRecentResults()
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
        fetchRecentResults()
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
        query = query.eq('game_name', gameFilter)
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

  function handleManualRefresh() {
    fetchMatches()
    fetchRecentResults()
  }

  function clearSearch() {
    setSearchQuery('')
  }

  function openMatchDetails(match) {
    setSelectedMatch(match)
    setShowModal(true)
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
  const liveCount = matches.filter(m => m.status === 'running').length
  const upcomingCount = matches.filter(m => m.status === 'not_started').length

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
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '10px' }}>
        🎮 Upcoming Esports Matches
      </h1>
      
      {/* Maç Sayıları */}
      <div style={{ 
        textAlign: 'center', 
        marginBottom: '20px',
        display: 'flex',
        gap: '15px',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        <div style={{
          padding: '8px 15px',
          backgroundColor: 'rgba(255, 70, 85, 0.2)',
          border: '1px solid #FF4655',
          borderRadius: '20px',
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#FF4655'
        }}>
          🔴 {liveCount} Live
        </div>
        <div style={{
          padding: '8px 15px',
          backgroundColor: 'rgba(255, 184, 0, 0.1)',
          border: '1px solid #FFB800',
          borderRadius: '20px',
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#FFB800'
        }}>
          ⏳ {upcomingCount} Upcoming
        </div>
        <div style={{
          padding: '8px 15px',
          backgroundColor: 'rgba(100, 100, 100, 0.1)',
          border: '1px solid #666',
          borderRadius: '20px',
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#888'
        }}>
          📊 {matches.length} Total
        </div>
        {favorites.length > 0 && (
          <div style={{
            padding: '8px 15px',
            backgroundColor: 'rgba(255, 215, 0, 0.1)',
            border: '1px solid #FFD700',
            borderRadius: '20px',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#FFD700'
          }}>
            ⭐ {favorites.length} Favorites
          </div>
        )}
      </div>

      {/* RECENT RESULTS SECTION - YENİ! */}
      {recentResults.length > 0 && (
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ 
            fontSize: '24px', 
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            📊 Recent Results
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '15px'
          }}>
            {recentResults.map((match) => {
              const isTeamAWinner = match.winner_id === match.team_a.id
              
              return (
                <div
                  key={match.id}
                  onClick={() => openMatchDetails(match)}
                  style={{
                    border: '1px solid #333',
                    borderRadius: '10px',
                    padding: '15px',
                    backgroundColor: '#1a1a1a',
                    cursor: 'pointer',
                    transition: 'transform 0.2s, box-shadow 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-3px)'
                    e.currentTarget.style.boxShadow = '0 5px 15px rgba(76, 175, 80, 0.2)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  {/* Game Badge */}
                  <div style={{
                    display: 'inline-block',
                    padding: '3px 8px',
                    backgroundColor: '#4CAF50',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    marginBottom: '10px'
                  }}>
                    {match.game.name}
                  </div>

                  {/* Teams with Scores */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '10px'
                  }}>
                    {/* Team A */}
                    <div style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      opacity: isTeamAWinner ? 1 : 0.6
                    }}>
                      {match.team_a.logo_url && (
                        <img
                          src={match.team_a.logo_url}
                          alt={match.team_a.name}
                          style={{
                            width: '40px',
                            height: '40px',
                            objectFit: 'contain'
                          }}
                        />
                      )}
                      <div>
                        <div style={{
                          fontSize: '13px',
                          fontWeight: 'bold',
                          color: isTeamAWinner ? '#4CAF50' : 'white'
                        }}>
                          {match.team_a.name}
                        </div>
                        <div style={{
                          fontSize: '20px',
                          fontWeight: 'bold',
                          color: isTeamAWinner ? '#4CAF50' : '#888'
                        }}>
                          {match.team_a_score !== null ? match.team_a_score : '-'}
                        </div>
                      </div>
                    </div>

                    {/* VS */}
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: '#666',
                      padding: '0 15px'
                    }}>
                      VS
                    </div>

                    {/* Team B */}
                    <div style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      justifyContent: 'flex-end',
                      opacity: !isTeamAWinner ? 1 : 0.6
                    }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: '13px',
                          fontWeight: 'bold',
                          color: !isTeamAWinner ? '#4CAF50' : 'white'
                        }}>
                          {match.team_b.name}
                        </div>
                        <div style={{
                          fontSize: '20px',
                          fontWeight: 'bold',
                          color: !isTeamAWinner ? '#4CAF50' : '#888'
                        }}>
                          {match.team_b_score !== null ? match.team_b_score : '-'}
                        </div>
                      </div>
                      {match.team_b.logo_url && (
                        <img
                          src={match.team_b.logo_url}
                          alt={match.team_b.name}
                          style={{
                            width: '40px',
                            height: '40px',
                            objectFit: 'contain'
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Tournament */}
                  {match.tournament && (
                    <div style={{
                      fontSize: '12px',
                      color: '#666',
                      textAlign: 'center',
                      marginTop: '8px'
                    }}>
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
      <div style={{ 
        maxWidth: '600px', 
        margin: '0 auto 20px',
        position: 'relative'
      }}>
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
      
      {/* Filtreler ve Refresh */}
      <div style={{ 
        display: 'flex', 
        gap: '20px', 
        marginBottom: '20px',
        justifyContent: 'center',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        <div>
          <label style={{ marginRight: '10px', fontWeight: 'bold' }}>
            🎮 Game:
          </label>
          <select 
            value={gameFilter}
            onChange={(e) => setGameFilter(e.target.value)}
            style={{
              padding: '10px 15px',
              borderRadius: '5px',
              border: '1px solid #444',
              backgroundColor: '#1a1a1a',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <option value="all">All Games</option>
            <option value="Valorant">Valorant</option>
            <option value="Counter-Strike 2">CS2</option>
            <option value="League of Legends">LoL</option>
          </select>
        </div>

        <div>
          <label style={{ marginRight: '10px', fontWeight: 'bold' }}>
            📅 Sort by:
          </label>
          <select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '10px 15px',
              borderRadius: '5px',
              border: '1px solid #444',
              backgroundColor: '#1a1a1a',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            <option value="date-asc">Earliest First</option>
            <option value="date-desc">Latest First</option>
          </select>
        </div>

        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px',
          cursor: 'pointer',
          userSelect: 'none',
          padding: '10px 15px',
          backgroundColor: showFavoritesOnly ? 'rgba(255, 215, 0, 0.2)' : 'transparent',
          borderRadius: '5px',
          border: showFavoritesOnly ? '1px solid #FFD700' : '1px solid transparent',
          transition: 'all 0.2s'
        }}>
          <input 
            type="checkbox"
            checked={showFavoritesOnly}
            onChange={(e) => setShowFavoritesOnly(e.target.checked)}
            style={{ cursor: 'pointer', width: '18px', height: '18px' }}
            disabled={favorites.length === 0}
          />
          <span style={{ fontSize: '14px', fontWeight: 'bold' }}>
            ⭐ Favorites Only
          </span>
        </label>

        <button
          onClick={handleManualRefresh}
          disabled={loading}
          style={{
            padding: '10px 20px',
            borderRadius: '5px',
            border: 'none',
            backgroundColor: '#4CAF50',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            transition: 'background-color 0.2s',
            opacity: loading ? 0.5 : 1
          }}
          onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = '#45a049')}
          onMouseLeave={(e) => !loading && (e.currentTarget.style.backgroundColor = '#4CAF50')}
        >
          {loading ? '⏳ Refreshing...' : '🔄 Refresh'}
        </button>

        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px',
          cursor: 'pointer',
          userSelect: 'none'
        }}>
          <input 
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ cursor: 'pointer', width: '18px', height: '18px' }}
          />
          <span style={{ fontSize: '14px' }}>
            🔁 Auto-refresh (30s)
          </span>
        </label>
      </div>

      {/* Sonuç sayısı */}
      <div style={{ 
        textAlign: 'center', 
        marginBottom: '20px'
      }}>
        <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>
          {filteredMatches.length === 0 ? (
            <span>📭 No matches found</span>
          ) : searchQuery ? (
            <span>🔍 Found {filteredMatches.length} of {matches.length} matches</span>
          ) : showFavoritesOnly ? (
            <span>⭐ Showing {filteredMatches.length} matches with favorite teams</span>
          ) : (
            <span>📊 Showing {filteredMatches.length} matches</span>
          )}
        </div>
        <div style={{ color: '#666', fontSize: '12px' }}>
          Last updated: {lastUpdate.toLocaleTimeString('tr-TR')}
          {autoRefresh && <span style={{ color: '#4CAF50', marginLeft: '10px' }}>● Auto-refresh ON</span>}
        </div>
      </div>
      
      {/* Maç Kartları */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '20px'
      }}>
        {filteredMatches.map((match) => {
          const statusBadge = getStatusBadge(match.status)
          const isLive = match.status === 'running'
          const teamAFav = isFavorite(match.team_a_id)
          const teamBFav = isFavorite(match.team_b_id)
          
          return (
            <div 
              key={match.id} 
              onClick={() => openMatchDetails(match)}
              style={{
                border: isLive ? '2px solid #FF4655' : '1px solid #333',
                borderRadius: '12px',
                padding: '20px',
                backgroundColor: '#1a1a1a',
                background: isLive 
                  ? 'linear-gradient(135deg, #1a1a1a 0%, #2a1a1a 100%)'
                  : '#1a1a1a',
                transition: 'transform 0.2s, box-shadow 0.2s',
                cursor: 'pointer',
                position: 'relative',
                boxShadow: isLive ? '0 0 20px rgba(255, 70, 85, 0.3)' : 'none'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-5px)'
                e.currentTarget.style.boxShadow = isLive 
                  ? '0 10px 30px rgba(255, 70, 85, 0.5)'
                  : '0 10px 25px rgba(255, 70, 85, 0.2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = isLive 
                  ? '0 0 20px rgba(255, 70, 85, 0.3)'
                  : 'none'
              }}
            >
              {/* Status Badge */}
              <div style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                padding: '5px 12px',
                backgroundColor: statusBadge.bg,
                border: `1px solid ${statusBadge.color}`,
                borderRadius: '15px',
                fontSize: '11px',
                fontWeight: 'bold',
                color: statusBadge.color,
                animation: isLive ? 'pulse 2s infinite' : 'none'
              }}>
                {statusBadge.text}
              </div>

              {/* AI Prediction Badge - YENİ! */}
              {(match.prediction_team_a && match.prediction_team_b) && (
                <div style={{
                  position: 'absolute',
                  top: '50px',
                  right: '15px',
                  padding: '5px 10px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  borderRadius: '15px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}>
                  🔮 AI: {(match.prediction_team_a > match.prediction_team_b 
                    ? Math.round(match.prediction_team_a * 100) 
                    : Math.round(match.prediction_team_b * 100))}%
                </div>
              )}

              {/* Game Name */}
              <div style={{ 
                fontSize: '12px', 
                color: '#888', 
                marginBottom: '15px',
                marginTop: '5px',
                textTransform: 'uppercase',
                fontWeight: 'bold',
                letterSpacing: '1px'
              }}>
                {match.game_name}
              </div>

              {/* Teams */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                marginBottom: '18px'
              }}>
                {/* Team A */}
                <div 
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/team/${match.team_a_id}`)
                  }}
                  style={{ 
                    textAlign: 'center', 
                    flex: 1,
                    cursor: 'pointer',
                    transition: 'opacity 0.2s, transform 0.2s',
                    padding: '10px',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.7'
                    e.currentTarget.style.transform = 'scale(1.05)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1'
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                >
                  {/* Favorite Star Team A */}
                  <button
                    onClick={(e) => toggleFavorite(match.team_a_id, e)}
                    style={{
                      position: 'absolute',
                      top: '-5px',
                      right: '-5px',
                      background: 'none',
                      border: 'none',
                      fontSize: '20px',
                      cursor: 'pointer',
                      padding: '5px',
                      lineHeight: '1',
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                      transition: 'transform 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.stopPropagation()
                      e.currentTarget.style.transform = 'scale(1.2)'
                    }}
                    onMouseLeave={(e) => {
                      e.stopPropagation()
                      e.currentTarget.style.transform = 'scale(1)'
                    }}
                  >
                    {teamAFav ? '⭐' : '☆'}
                  </button>

                  {match.team_a_logo && (
                    <img 
                      src={match.team_a_logo} 
                      alt={match.team_a_name}
                      style={{ 
                        width: '55px', 
                        height: '55px', 
                        objectFit: 'contain',
                        marginBottom: '10px',
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                      }}
                    />
                  )}
                  <div style={{ 
                    fontSize: '14px', 
                    fontWeight: 'bold',
                    lineHeight: '1.3'
                  }}>
                    {match.team_a_name}
                  </div>
                </div>

                {/* VS */}
                <div style={{ 
                  fontSize: '22px', 
                  fontWeight: 'bold', 
                  color: isLive ? '#FF4655' : '#FF4655',
                  padding: '0 15px',
                  textShadow: isLive ? '0 0 10px rgba(255, 70, 85, 0.5)' : 'none'
                }}>
                  VS
                </div>

                {/* Team B */}
                <div 
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/team/${match.team_b_id}`)
                  }}
                  style={{ 
                    textAlign: 'center', 
                    flex: 1,
                    cursor: 'pointer',
                    transition: 'opacity 0.2s, transform 0.2s',
                    padding: '10px',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.7'
                    e.currentTarget.style.transform = 'scale(1.05)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1'
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                >
                  {/* Favorite Star Team B */}
                  <button
                    onClick={(e) => toggleFavorite(match.team_b_id, e)}
                    style={{
                      position: 'absolute',
                      top: '-5px',
                      left: '-5px',
                      background: 'none',
                      border: 'none',
                      fontSize: '20px',
                      cursor: 'pointer',
                      padding: '5px',
                      lineHeight: '1',
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                      transition: 'transform 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.stopPropagation()
                      e.currentTarget.style.transform = 'scale(1.2)'
                    }}
                    onMouseLeave={(e) => {
                      e.stopPropagation()
                      e.currentTarget.style.transform = 'scale(1)'
                    }}
                  >
                    {teamBFav ? '⭐' : '☆'}
                  </button>

                  {match.team_b_logo && (
                    <img 
                      src={match.team_b_logo} 
                      alt={match.team_b_name}
                      style={{ 
                        width: '55px', 
                        height: '55px', 
                        objectFit: 'contain',
                        marginBottom: '10px',
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                      }}
                    />
                  )}
                  <div style={{ 
                    fontSize: '14px', 
                    fontWeight: 'bold',
                    lineHeight: '1.3'
                  }}>
                    {match.team_b_name}
                  </div>
                </div>
              </div>

              {/* Tournament */}
              <div style={{ 
                fontSize: '13px', 
                color: '#aaa',
                marginBottom: '12px',
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px'
              }}>
                <span>🏆</span>
                <span>{match.tournament_name}</span>
              </div>

              {/* Time */}
              <div style={{ 
                fontSize: '14px', 
                color: isLive ? '#FF4655' : '#4CAF50',
                textAlign: 'center',
                fontWeight: 'bold',
                padding: '8px',
                backgroundColor: isLive ? 'rgba(255, 70, 85, 0.1)' : 'rgba(76, 175, 80, 0.1)',
                borderRadius: '6px'
              }}>
                📅 {new Date(match.scheduled_at).toLocaleString('tr-TR')}
              </div>
            </div>
          )
        })}
      </div>

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

export default UpcomingMatches