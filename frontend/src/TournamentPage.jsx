import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'

function TournamentPage() {
  const { tournamentId } = useParams()
  const navigate = useNavigate()
  
  const [tournament, setTournament] = useState(null)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('upcoming')

  useEffect(() => {
    fetchTournamentData()
  }, [tournamentId])

  async function fetchTournamentData() {
    try {
      setLoading(true)

      // Fetch tournament info
      const { data: tournamentData, error: tournamentError } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .single()

      if (tournamentError) throw tournamentError
      setTournament(tournamentData)

      // Fetch ALL tournament matches (upcoming + past)
      const { data: matchesData, error: matchesError } = await supabase
        .from('matches')
        .select(`
          *,
          team_a:teams!matches_team_a_id_fkey(*),
          team_b:teams!matches_team_b_id_fkey(*),
          tournament:tournaments(*),
          game:games(*)
        `)
        .eq('tournament_id', tournamentId)
        .order('scheduled_at', { ascending: false })

      if (matchesError) throw matchesError
      setMatches(matchesData || [])

    } catch (error) {
      console.error('Error fetching tournament data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter matches
  const upcomingMatches = matches.filter(m => m.status === 'not_started')
  const pastMatches = matches.filter(m => m.status === 'finished')

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <h2>⏳ Loading tournament data...</h2>
      </div>
    )
  }

  if (!tournament) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <h2>❌ Tournament not found</h2>
        <button
          onClick={() => navigate('/')}
          style={{
            marginTop: '20px',
            padding: '10px 20px',
            backgroundColor: '#FFB800',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          ← Back to Matches
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <button
        onClick={() => navigate('/')}
        style={{
          marginBottom: '20px',
          padding: '10px 20px',
          backgroundColor: '#333',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          fontSize: '14px'
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#444'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#333'}
      >
        ← Back to Matches
      </button>

      {/* Tournament Info */}
      <div style={{
        padding: '40px',
        marginBottom: '40px',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2a1a0a 100%)',
        borderRadius: '15px',
        border: '2px solid #FFB800',
        textAlign: 'center'
      }}>
        <div style={{
          display: 'inline-block',
          padding: '5px 15px',
          backgroundColor: '#FFB800',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 'bold',
          marginBottom: '20px'
        }}>
          TIER {tournament.tier || 'N/A'}
        </div>
        
        <h1 style={{ 
          margin: '0 0 30px 0', 
          fontSize: '48px',
          color: '#FFB800'
        }}>
          🏆 {tournament.name}
        </h1>

        {/* Stats */}
        <div style={{ 
          display: 'flex', 
          gap: '20px',
          justifyContent: 'center',
          flexWrap: 'wrap'
        }}>
          <div style={{
            textAlign: 'center',
            padding: '20px',
            backgroundColor: '#0a0a0a',
            borderRadius: '10px',
            minWidth: '120px'
          }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#FFB800' }}>
              {matches.length}
            </div>
            <div style={{ fontSize: '14px', color: '#888' }}>Total Matches</div>
          </div>
          <div style={{
            textAlign: 'center',
            padding: '20px',
            backgroundColor: '#0a0a0a',
            borderRadius: '10px',
            minWidth: '120px'
          }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#4CAF50' }}>
              {upcomingMatches.length}
            </div>
            <div style={{ fontSize: '14px', color: '#888' }}>Upcoming</div>
          </div>
          <div style={{
            textAlign: 'center',
            padding: '20px',
            backgroundColor: '#0a0a0a',
            borderRadius: '10px',
            minWidth: '120px'
          }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#888' }}>
              {pastMatches.length}
            </div>
            <div style={{ fontSize: '14px', color: '#888' }}>Completed</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '20px',
        borderBottom: '2px solid #333'
      }}>
        <button
          onClick={() => setActiveTab('upcoming')}
          style={{
            padding: '15px 30px',
            backgroundColor: activeTab === 'upcoming' ? '#FFB800' : 'transparent',
            color: 'white',
            border: 'none',
            borderRadius: '8px 8px 0 0',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            transition: 'background-color 0.2s'
          }}
        >
          Upcoming ({upcomingMatches.length})
        </button>
        <button
          onClick={() => setActiveTab('past')}
          style={{
            padding: '15px 30px',
            backgroundColor: activeTab === 'past' ? '#FFB800' : 'transparent',
            color: 'white',
            border: 'none',
            borderRadius: '8px 8px 0 0',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            transition: 'background-color 0.2s'
          }}
        >
          Past ({pastMatches.length})
        </button>
      </div>

      {/* Matches */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        gap: '20px'
      }}>
        {(activeTab === 'upcoming' ? upcomingMatches : pastMatches).map((match) => {
          const isWinnerA = match.winner_id === match.team_a.id
          const isWinnerB = match.winner_id === match.team_b.id
          
          return (
            <div
              key={match.id}
              style={{
                border: '1px solid #333',
                borderRadius: '12px',
                padding: '20px',
                backgroundColor: '#1a1a1a',
                position: 'relative'
              }}
            >
              {/* Game Badge */}
              <div style={{
                display: 'inline-block',
                padding: '5px 10px',
                backgroundColor: activeTab === 'past' ? '#4CAF50' : '#FFB800',
                borderRadius: '5px',
                fontSize: '12px',
                fontWeight: 'bold',
                marginBottom: '15px'
              }}>
                {match.game.name}
              </div>

              {/* Result Badge (for past matches) */}
              {activeTab === 'past' && match.winner_id && (
                <div style={{
                  position: 'absolute',
                  top: '20px',
                  right: '20px',
                  padding: '5px 12px',
                  backgroundColor: 'rgba(76, 175, 80, 0.2)',
                  border: '1px solid #4CAF50',
                  borderRadius: '15px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color: '#4CAF50'
                }}>
                  ✅ FINISHED
                </div>
              )}

              {/* Teams */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
                marginBottom: '15px'
              }}>
                {/* Team A */}
                <div 
                  onClick={() => navigate(`/team/${match.team_a.id}`)}
                  style={{ 
                    flex: 1, 
                    textAlign: 'center',
                    cursor: 'pointer',
                    opacity: activeTab === 'past' && !isWinnerA ? 0.6 : 1,
                    transition: 'opacity 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = activeTab === 'past' && !isWinnerA ? '0.6' : '1'}
                >
                  {match.team_a.logo_url && (
                    <img
                      src={match.team_a.logo_url}
                      alt={match.team_a.name}
                      style={{
                        width: '60px',
                        height: '60px',
                        objectFit: 'contain',
                        marginBottom: '10px'
                      }}
                    />
                  )}
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    {match.team_a.name}
                  </div>
                  {activeTab === 'past' && match.team_a_score !== null && (
                    <div style={{
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: isWinnerA ? '#4CAF50' : '#888',
                      marginTop: '5px'
                    }}>
                      {match.team_a_score}
                    </div>
                  )}
                </div>

                {/* VS */}
                <div style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: '#FFB800'
                }}>
                  VS
                </div>

                {/* Team B */}
                <div
                  onClick={() => navigate(`/team/${match.team_b.id}`)}
                  style={{ 
                    flex: 1, 
                    textAlign: 'center',
                    cursor: 'pointer',
                    opacity: activeTab === 'past' && !isWinnerB ? 0.6 : 1,
                    transition: 'opacity 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = activeTab === 'past' && !isWinnerB ? '0.6' : '1'}
                >
                  {match.team_b.logo_url && (
                    <img
                      src={match.team_b.logo_url}
                      alt={match.team_b.name}
                      style={{
                        width: '60px',
                        height: '60px',
                        objectFit: 'contain',
                        marginBottom: '10px'
                      }}
                    />
                  )}
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    {match.team_b.name}
                  </div>
                  {activeTab === 'past' && match.team_b_score !== null && (
                    <div style={{
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: isWinnerB ? '#4CAF50' : '#888',
                      marginTop: '5px'
                    }}>
                      {match.team_b_score}
                    </div>
                  )}
                </div>
              </div>

              {/* Date */}
              <div style={{
                fontSize: '14px',
                color: activeTab === 'upcoming' ? '#4CAF50' : '#888',
                textAlign: 'center',
                fontWeight: 'bold',
                marginTop: '15px'
              }}>
                📅 {new Date(match.scheduled_at).toLocaleString('tr-TR')}
              </div>
            </div>
          )
        })}
      </div>

      {/* No matches message */}
      {(activeTab === 'upcoming' ? upcomingMatches : pastMatches).length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '50px',
          color: '#888'
        }}>
          <h3>No {activeTab} matches found</h3>
        </div>
      )}
    </div>
  )
}

export default TournamentPage