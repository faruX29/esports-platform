/**
 * Matches.jsx — 14 günlük dikey zaman çizelgesi
 * DateNavigator + GameContext filtresi + Supabase
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate }                      from 'react-router-dom'
import { supabase }                         from './supabaseClient'
import { useGame, gameMatchesFilter }       from './GameContext'
import { getFavorites, addFavorite, removeFavorite, isFavorite } from './favoritesHelper'
import { isTurkishTeam }                   from './constants'

function Matches() {
  const navigate = useNavigate()
  const { activeGame } = useGame()

  const [matches, setMatches]               = useState([])
  const [filteredMatches, setFilteredMatches] = useState([])
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState(null)
  const [searchQuery, setSearchQuery]       = useState('')
  const [sortBy, setSortBy]                 = useState('date-asc')
  const [activeTab, setActiveTab]           = useState('upcoming')
  const [favorites, setFavorites]           = useState([])
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [lastUpdate, setLastUpdate]         = useState(new Date())
  const [autoRefresh, setAutoRefresh]       = useState(false)

  // Modal
  const [selectedMatch, setSelectedMatch]   = useState(null)
  const [showModal, setShowModal]           = useState(false)
  const [modalPlayers, setModalPlayers]     = useState({ teamA: [], teamB: [] })
  const [loadingModalPlayers, setLoadingModalPlayers] = useState(false)
  const [h2hData, setH2hData]               = useState(null)

  useEffect(() => {
    setFavorites(getFavorites())
    fetchMatches()
  }, [activeGame, sortBy, activeTab])

  useEffect(() => {
    applyFilters()
  }, [matches, searchQuery, showFavoritesOnly, favorites, activeGame])

  useEffect(() => {
    let interval
    if (autoRefresh) {
      interval = setInterval(fetchMatches, 30000)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [autoRefresh, activeGame, sortBy, activeTab])

  async function fetchMatches() {
    try {
      setLoading(true)

      const statusFilter = activeTab === 'upcoming'
        ? ['not_started', 'running']
        : ['finished']

      let query = supabase
        .from('matches')
        .select(`
          *,
          team_a:teams!matches_team_a_id_fkey(*),
          team_b:teams!matches_team_b_id_fkey(*),
          tournament:tournaments(*),
          game:games(*)
        `)
        .in('status', statusFilter)

      if (sortBy === 'date-asc') {
        query = query.order('scheduled_at', { ascending: true })
      } else {
        query = query.order('scheduled_at', { ascending: false })
      }

      query = query.limit(100)

      const { data, error: fetchError } = await query
      if (fetchError) throw fetchError

      setMatches(data || [])
      setLastUpdate(new Date())
    } catch (err) {
      console.error('Error fetching matches:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function applyFilters() {
    let filtered = matches

    // GameContext filtresi
    filtered = filtered.filter(m =>
      gameMatchesFilter(m.game?.name ?? '', activeGame)
    )

    // Arama filtresi
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(m =>
        (m.team_a?.name ?? '').toLowerCase().includes(q) ||
        (m.team_b?.name ?? '').toLowerCase().includes(q) ||
        (m.tournament?.name ?? '').toLowerCase().includes(q)
      )
    }

    // Favoriler filtresi
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
        .limit(10)
    ])

    setModalPlayers({ teamA: playersA || [], teamB: playersB || [] })

    const h2h       = h2hMatches || []
    const teamAWins = h2h.filter(m => m.winner_id === teamAId).length
    const teamBWins = h2h.filter(m => m.winner_id === teamBId).length
    const draws     = h2h.filter(m => !m.winner_id).length
    setH2hData({ matches: h2h, teamAWins, teamBWins, draws, total: h2h.length, teamAId, teamBId })

    setLoadingModalPlayers(false)
  }

  function closeModal() {
    setShowModal(false)
    setSelectedMatch(null)
  }

  function getStatusBadge(status) {
    const badges = {
      not_started: { text: '⏳ Upcoming', color: '#FFB800', bg: 'rgba(255,184,0,.1)' },
      running:     { text: '🔴 LIVE',     color: '#FF4655', bg: 'rgba(255,70,85,.2)' },
      finished:    { text: '✅ Finished', color: '#4CAF50', bg: 'rgba(76,175,80,.1)' },
    }
    return badges[status] || badges['not_started']
  }

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
        <button
          onClick={fetchMatches}
          style={{ marginTop: '16px', padding: '10px 24px', background: '#FF4655', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}
        >
          Retry
        </button>
      </div>
    )
  }

  const liveCount     = filteredMatches.filter(m => m.status === 'running').length
  const upcomingCount = filteredMatches.filter(m => m.status === 'not_started').length

  return (
    <div style={{ padding: '24px 20px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, margin: '0 0 6px' }}>📅 Matches</h1>
        <p style={{ color: '#555', fontSize: '13px', margin: 0 }}>
          All esports matches — live, upcoming &amp; past
        </p>
      </div>

      {/* ── Tabs: Upcoming / Past ── */}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '20px' }}>
        {[
          { key: 'upcoming', label: '⏳ Upcoming / Live' },
          { key: 'past',     label: '✅ Past Results' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '9px 22px', borderRadius: '12px', border: 'none', cursor: 'pointer',
              fontSize: '13px', fontWeight: activeTab === t.key ? 700 : 500,
              background: activeTab === t.key ? '#FF4655' : '#1a1a1a',
              color: activeTab === t.key ? '#fff' : '#888',
              transition: 'all .18s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search */}
        <div style={{ position: 'relative', maxWidth: '340px', flex: 1 }}>
          <input
            type="text"
            placeholder="🔍 Search team or tournament..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '8px 36px 8px 12px', borderRadius: '8px',
              border: '1px solid #2a2a2a', background: '#111', color: 'white',
              fontSize: '13px', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px' }}
            >✕</button>
          )}
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #2a2a2a', background: '#111', color: '#ccc', fontSize: '13px', outline: 'none', cursor: 'pointer' }}
        >
          <option value="date-asc">📅 Earliest First</option>
          <option value="date-desc">📅 Latest First</option>
        </select>

        {/* Favorites */}
        <button
          onClick={() => setShowFavoritesOnly(v => !v)}
          disabled={favorites.length === 0}
          style={{
            padding: '8px 14px', borderRadius: '8px',
            border: showFavoritesOnly ? '1px solid #FFD700' : '1px solid #2a2a2a',
            background: showFavoritesOnly ? 'rgba(255,215,0,.15)' : '#111',
            color: showFavoritesOnly ? '#FFD700' : favorites.length === 0 ? '#444' : '#888',
            fontSize: '13px', cursor: favorites.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          ⭐ {showFavoritesOnly ? 'All' : 'Favorites'}
        </button>

        {/* Refresh */}
        <button
          onClick={fetchMatches}
          disabled={loading}
          style={{
            padding: '8px 14px', borderRadius: '8px',
            border: '1px solid #2a2a2a', background: '#111',
            color: loading ? '#444' : '#888', fontSize: '13px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '⏳' : '🔄'} Refresh
        </button>

        {/* Auto-refresh */}
        <button
          onClick={() => setAutoRefresh(v => !v)}
          style={{
            padding: '8px 14px', borderRadius: '8px',
            border: autoRefresh ? '1px solid #4CAF50' : '1px solid #2a2a2a',
            background: autoRefresh ? 'rgba(76,175,80,.15)' : '#111',
            color: autoRefresh ? '#4CAF50' : '#888',
            fontSize: '13px', cursor: 'pointer',
          }}
        >
          🔁 {autoRefresh ? 'Auto ON' : 'Auto OFF'}
        </button>
      </div>

      {/* ── Stats chips ── */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '22px' }}>
        {liveCount > 0 && (
          <div style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, color: '#FF4655', background: 'rgba(255,70,85,.15)', border: '1px solid #FF465555' }}>
            🔴 {liveCount} Live
          </div>
        )}
        <div style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, color: '#FFB800', background: 'rgba(255,184,0,.12)', border: '1px solid #FFB80055' }}>
          ⏳ {upcomingCount} Upcoming
        </div>
        <div style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, color: '#888', background: 'rgba(255,255,255,.05)', border: '1px solid #88888855' }}>
          📊 {filteredMatches.length} Total
        </div>
        {favorites.length > 0 && (
          <div style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, color: '#FFD700', background: 'rgba(255,215,0,.12)', border: '1px solid #FFD70055' }}>
            ⭐ {favorites.length} Fav
          </div>
        )}
        <div style={{ color: '#444', fontSize: '11px', display: 'flex', alignItems: 'center' }}>
          Updated: {lastUpdate.toLocaleTimeString('tr-TR')}
          {autoRefresh && <span style={{ color: '#4CAF50', marginLeft: '8px' }}>● auto</span>}
        </div>
      </div>

      {/* ── Match Grid ── */}
      {filteredMatches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#555' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
          <h3 style={{ margin: 0, color: '#444' }}>No matches found</h3>
          <p style={{ margin: '8px 0 0', fontSize: '13px' }}>Try changing the filter or search query.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {filteredMatches.map(match => {
            const statusBadge = getStatusBadge(match.status)
            const isLive      = match.status === 'running'
            const teamAFav    = isFavorite(match.team_a_id)
            const teamBFav    = isFavorite(match.team_b_id)
            const turkA       = isTurkishTeam(match.team_a?.name ?? '')
            const turkB       = isTurkishTeam(match.team_b?.name ?? '')
            const hasTurkish  = turkA || turkB

            return (
              <div
                key={match.id}
                onClick={() => openMatchDetails(match)}
                style={{
                  position: 'relative', borderRadius: '18px',
                  padding: hasTurkish ? '0 0 14px' : '18px 18px 14px',
                  overflow: hasTurkish ? 'hidden' : 'visible',
                  background: '#111',
                  border: isLive
                    ? '1.5px solid rgba(255,70,85,.6)'
                    : hasTurkish
                    ? '1.5px solid rgba(212,175,55,.5)'
                    : '1.5px solid #222',
                  boxShadow: isLive ? '0 0 20px rgba(255,70,85,.2)' : hasTurkish ? '0 0 14px rgba(212,175,55,.08)' : 'none',
                  cursor: 'pointer',
                  transition: 'transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, border-color .2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform   = 'translateY(-5px) scale(1.012)'
                  e.currentTarget.style.boxShadow   = isLive ? '0 12px 36px rgba(255,70,85,.45)' : hasTurkish ? '0 12px 32px rgba(255,70,85,.22), 0 0 0 1.5px rgba(212,175,55,.3)' : '0 12px 32px rgba(255,70,85,.22)'
                  e.currentTarget.style.borderColor = '#FF4655'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform   = 'none'
                  e.currentTarget.style.boxShadow   = isLive ? '0 0 20px rgba(255,70,85,.2)' : hasTurkish ? '0 0 14px rgba(212,175,55,.08)' : 'none'
                  e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.6)' : hasTurkish ? 'rgba(212,175,55,.5)' : '#222'
                }}
              >
                {/* Turkish banner */}
                {hasTurkish && (
                  <div style={{
                    background: 'linear-gradient(90deg, #C8102E 0%, #a00d25 40%, #001f6d 100%)',
                    padding: '5px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '14px',
                  }}>
                    <span>🇹🇷</span>
                    <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '1.5px', color: '#fff', textTransform: 'uppercase' }}>Turkish Pride</span>
                    <span>🇹🇷</span>
                  </div>
                )}

                <div style={{ padding: hasTurkish ? '0 18px' : '0' }}>
                  {/* Top row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <span style={{ padding: '2px 9px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', background: '#1e1e1e', border: '1px solid #2e2e2e', color: '#777' }}>
                      {match.game?.name ?? '?'}
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {match.prediction_team_a && match.prediction_team_b && (
                        <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, background: 'rgba(102,126,234,.2)', border: '1px solid rgba(102,126,234,.5)', color: '#818cf8' }}>
                          🔮 {Math.round(Math.max(match.prediction_team_a, match.prediction_team_b) * 100)}%
                        </span>
                      )}
                      <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, background: statusBadge.bg, border: `1px solid ${statusBadge.color}`, color: statusBadge.color, animation: isLive ? 'pulse 1.5s infinite' : 'none' }}>
                        {statusBadge.text}
                      </span>
                    </div>
                  </div>

                  {/* Teams row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '14px' }}>
                    {/* Team A */}
                    <div
                      onClick={e => { e.stopPropagation(); navigate(`/team/${match.team_a_id}`) }}
                      style={{ flex: 1, textAlign: 'center', cursor: 'pointer', position: 'relative', padding: '8px 4px' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '.75'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      <button
                        onClick={e => toggleFavorite(match.team_a_id, e)}
                        style={{ position: 'absolute', top: 0, left: 2, background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', padding: '2px' }}
                      >{teamAFav ? '⭐' : '☆'}</button>
                      {match.team_a?.logo_url
                        ? <img src={match.team_a.logo_url} alt={match.team_a.name} style={{ width: '52px', height: '52px', objectFit: 'contain', marginBottom: '8px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }} />
                        : <div style={{ width: '52px', height: '52px', margin: '0 auto 8px', background: '#1e1e1e', borderRadius: '8px' }} />
                      }
                      <div style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word', color: turkA ? '#FFD700' : 'white' }}>
                        {match.team_a?.name}
                      </div>
                      {activeTab === 'past' && match.team_a_score !== null && (
                        <div style={{ fontSize: '22px', fontWeight: 800, color: match.winner_id === match.team_a_id ? '#4CAF50' : '#aaa', marginTop: '4px' }}>
                          {match.team_a_score}
                        </div>
                      )}
                    </div>

                    {/* VS */}
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
                        style={{ position: 'absolute', top: 0, left: 2, background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', padding: '2px' }}
                      >{teamBFav ? '⭐' : '☆'}</button>
                      {match.team_b?.logo_url
                        ? <img src={match.team_b.logo_url} alt={match.team_b.name} style={{ width: '52px', height: '52px', objectFit: 'contain', marginBottom: '8px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }} />
                        : <div style={{ width: '52px', height: '52px', margin: '0 auto 8px', background: '#1e1e1e', borderRadius: '8px' }} />
                      }
                      <div style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word', color: turkB ? '#FFD700' : 'white' }}>
                        {match.team_b?.name}
                      </div>
                      {activeTab === 'past' && match.team_b_score !== null && (
                        <div style={{ fontSize: '22px', fontWeight: 800, color: match.winner_id === match.team_b_id ? '#4CAF50' : '#aaa', marginTop: '4px' }}>
                          {match.team_b_score}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #1e1e1e', paddingTop: '10px', gap: '8px' }}>
                    <div style={{ fontSize: '11px', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      🏆 {match.tournament?.name ?? '—'}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: isLive ? '#FF4655' : '#4CAF50', flexShrink: 0, background: isLive ? 'rgba(255,70,85,.1)' : 'rgba(76,175,80,.1)', padding: '2px 8px', borderRadius: '6px' }}>
                      {isLive ? '🔴 LIVE' : new Date(match.scheduled_at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* CSS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.6; }
        }
      `}</style>

      {/* ── Modal ── */}
      {showModal && selectedMatch && (
        <div
          onClick={closeModal}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ backgroundColor: '#1a1a1a', borderRadius: '15px', padding: '30px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto', border: '2px solid #FF4655', position: 'relative' }}
          >
            <button
              onClick={closeModal}
              style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', color: '#888', fontSize: '30px', cursor: 'pointer', lineHeight: '30px', padding: 0, width: '30px', height: '30px' }}
              onMouseEnter={e => e.target.style.color = '#fff'}
              onMouseLeave={e => e.target.style.color = '#888'}
            >×</button>

            <div style={{ display: 'inline-block', padding: '5px 15px', backgroundColor: '#FF4655', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '20px' }}>
              {selectedMatch.game?.name}
            </div>

            {/* Teams */}
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginBottom: '30px', padding: '20px 0' }}>
              <div style={{ textAlign: 'center', flex: 1 }}>
                {selectedMatch.team_a?.logo_url && <img src={selectedMatch.team_a.logo_url} alt={selectedMatch.team_a.name} style={{ width: '100px', height: '100px', objectFit: 'contain', marginBottom: '15px' }} />}
                <div style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '5px' }}>{selectedMatch.team_a?.name}</div>
              </div>
              <div style={{ fontSize: '40px', fontWeight: 'bold', color: '#FF4655', padding: '0 30px' }}>VS</div>
              <div style={{ textAlign: 'center', flex: 1 }}>
                {selectedMatch.team_b?.logo_url && <img src={selectedMatch.team_b.logo_url} alt={selectedMatch.team_b.name} style={{ width: '100px', height: '100px', objectFit: 'contain', marginBottom: '15px' }} />}
                <div style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '5px' }}>{selectedMatch.team_b?.name}</div>
              </div>
            </div>

            {/* Info */}
            <div style={{ backgroundColor: '#0a0a0a', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
              <div style={{ marginBottom: '15px' }}>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>🏆 Tournament</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{selectedMatch.tournament?.name ?? '—'}</div>
              </div>
              <div style={{ marginBottom: '15px' }}>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>📅 Scheduled</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#4CAF50' }}>
                  {new Date(selectedMatch.scheduled_at).toLocaleString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div>
                <div style={{ color: '#888', fontSize: '14px', marginBottom: '5px' }}>📊 Status</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: selectedMatch.status === 'not_started' ? '#FFB800' : '#4CAF50' }}>
                  {selectedMatch.status === 'not_started' ? '⏳ Upcoming' : selectedMatch.status === 'running' ? '🔴 Live' : '✅ Finished'}
                </div>
              </div>
            </div>

            {/* H2H */}
            {h2hData && h2hData.total > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ color: '#888', fontSize: '13px', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>⚔️ H2H</div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', background: h2hData.teamAWins > h2hData.teamBWins ? 'rgba(76,175,80,.12)' : '#0d0d0d', border: h2hData.teamAWins > h2hData.teamBWins ? '1px solid rgba(76,175,80,.4)' : '1px solid #1e1e1e', borderRadius: '8px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>{h2hData.teamAWins}</div>
                    <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>{selectedMatch.team_a?.name}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '6px 10px' }}>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#444' }}>—</div>
                    <div style={{ fontSize: '11px', color: '#444' }}>{h2hData.total} matches</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', padding: '10px 6px', background: h2hData.teamBWins > h2hData.teamAWins ? 'rgba(76,175,80,.12)' : '#0d0d0d', border: h2hData.teamBWins > h2hData.teamAWins ? '1px solid rgba(76,175,80,.4)' : '1px solid #1e1e1e', borderRadius: '8px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>{h2hData.teamBWins}</div>
                    <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>{selectedMatch.team_b?.name}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Rosters */}
            {loadingModalPlayers ? (
              <div style={{ textAlign: 'center', color: '#555', padding: '20px' }}>Loading rosters...</div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ color: '#888', fontSize: '13px', fontWeight: 'bold', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>👥 Rosters</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {/* Team A */}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#aaa', marginBottom: '8px', textAlign: 'center' }}>{selectedMatch.team_a?.name}</div>
                    {modalPlayers.teamA.length === 0
                      ? <div style={{ fontSize: '12px', color: '#555', textAlign: 'center' }}>No data</div>
                      : modalPlayers.teamA.map((p, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '6px', background: '#0d0d0d', borderRadius: '8px' }}>
                          {p.image_url
                            ? <img src={p.image_url} alt={p.nickname} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                            : <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#1e1e1e' }} />
                          }
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 'bold' }}>{p.nickname}</div>
                            {p.role && <div style={{ fontSize: '11px', color: '#888' }}>{p.role}</div>}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                  {/* Team B */}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#aaa', marginBottom: '8px', textAlign: 'center' }}>{selectedMatch.team_b?.name}</div>
                    {modalPlayers.teamB.length === 0
                      ? <div style={{ fontSize: '12px', color: '#555', textAlign: 'center' }}>No data</div>
                      : modalPlayers.teamB.map((p, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '6px', background: '#0d0d0d', borderRadius: '8px' }}>
                          {p.image_url
                            ? <img src={p.image_url} alt={p.nickname} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                            : <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#1e1e1e' }} />
                          }
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 'bold' }}>{p.nickname}</div>
                            {p.role && <div style={{ fontSize: '11px', color: '#888' }}>{p.role}</div>}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={closeModal}
              style={{ width: '100%', padding: '15px', borderRadius: '8px', border: 'none', backgroundColor: '#FF4655', color: 'white', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}
              onMouseEnter={e => e.target.style.backgroundColor = '#e03d4d'}
              onMouseLeave={e => e.target.style.backgroundColor = '#FF4655'}
            >Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Matches