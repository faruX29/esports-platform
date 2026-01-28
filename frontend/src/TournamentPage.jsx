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
      
      // Turnuva bilgilerini çek
      const { data: tournamentData, error: tournamentError } = await supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .single()
      
      if (tournamentError) throw tournamentError
      setTournament(tournamentData)
      
      // Turnuvanın maçlarını çek
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
        .limit(100)
      
      if (matchesError) throw matchesError
      setMatches(matchesData || [])
      
    } catch (error) {
      console.error('Error fetching tournament data:', error)
    } finally {
      setLoading(false)
    }
  }

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
            backgroundColor: '#FF4655',
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

  const upcomingMatches = matches.filter(m => m.status === 'not_started')
  const pastMatches = matches.filter(m => m.status === 'finished')
  const displayMatches = activeTab === 'upcoming' ? upcomingMatches : pastMatches

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Back Button */}
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
        onMouseEnter={(e) => e.target.style.backgroundColor = '#444'}
        onMouseLeave={(e) => e.target.style.backgroundColor = '#333'}
      >
        ← Back to Matches
      </button>

      {/* Tournament Header */}
      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '15px',
        padding: '40px',
        marginBottom: '30px',
        textAlign: 'center',
        border: '2px solid #FFB800',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #2a1a0a 100%)'
      }}>
        <div style={{
          display: 'inline-block',
          padding: '8px 20px',
          backgroundColor: '#FFB800',
          borderRadius: '20px',
          fontSize: '14px',
          fontWeight: 'bold',
          textTransform: 'uppercase',
          marginBottom: '20px',
          color: '#000'
        }}>
          🏆 Tournament
        </div>
        
        <h1 style={{ fontSize: '36px', marginBottom: '10px' }}>
          {tournament.name}
        </h1>
        
        {tournament.tier && (
          <div style={{ 
            fontSize: '18px', 
            color: '#FFB800',
            marginBottom: '10px',
            textTransform: 'uppercase',
            fontWeight: 'bold'
          }}>
            {tournament.tier}
          </div>
        )}

        <div style={{ 
          display: 'flex', 
          gap: '20px', 
          justifyContent: 'center',
          marginTop: '30px',
          flexWrap: 'wrap'
        }}>
          <div style={{ 
            backgroundColor: '#0a0a0a', 
            padding: '15px 25px',
            borderRadius: '10px'
          }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>
              Total Matches
            </div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FFB800' }}>
              {matches.length}
            </div>
          </div>

          <div style={{ 
            backgroundColor: '#0a0a0a', 
            padding: '15px 25px',
            borderRadius: '10px'
          }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>
              Upcoming
            </div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>
              {upcomingMatches.length}
            </div>
          </div>

          <div style={{ 
            backgroundColor: '#0a0a0a', 
            padding: '15px 25px',
            borderRadius: '10px'
          }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>
              Completed
            </div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#666' }}>
              {pastMatches.length}
            </div>
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
            color: activeTab === 'upcoming' ? '#000' : 'white',
            border: 'none',
            borderRadius: '5px 5px 0 0',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            transition: 'background-color 0.2s'
          }}
        >
          📅 Upcoming ({upcomingMatches.length})
        </button>

        <button
          onClick={() => setActiveTab('past')}
          style={{
            padding: '15px 30px',
            backgroundColor: activeTab === 'past' ? '#FFB800' : 'transparent',
            color: activeTab === 'past' ? '#000' : 'white',
            border: 'none',
            borderRadius: '5px 5px 0 0',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            transition: 'background-color 0.2s'
          }}
        >
          ✅ Past ({pastMatches.length})
        </button>
      </div>

      {/* Matches List */}
      {displayMatches.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '50px',
          backgroundColor: '#1a1a1a',
          borderRadius: '10px'
        }}>
          <h3>📭 No {activeTab} matches</h3>
        </div>
      ) : (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '20px'
        }}>
          {displayMatches.map((match) => (
            <div 
              key={match.id}
              style={{
                border: '1px solid #333',
                borderRadius: '10px',
                padding: '20px',
                backgroundColor: '#1a1a1a',
                transition: 'transform 0.2s, box-shadow 0.2s',
                cursor: 'pointer'
              }}
              onClick={() => navigate(`/team/${match.team_a.id}`)}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.02)'
                e.currentTarget.style.boxShadow = '0 5px 15px rgba(255, 184, 0, 0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* Game Name */}
              <div style={{ 
                fontSize: '12px', 
                color: '#888', 
                marginBottom: '10px',
                textTransform: 'uppercase',
                fontWeight: 'bold'
              }}>
                {match.game?.name || 'Unknown Game'}
              </div>

              {/* Teams */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                marginBottom: '15px'
              }}>
                {/* Team A */}
                <div style={{ textAlign: 'center', flex: 1 }}>
                  {match.team_a.logo_url && (
                    <img 
                      src={match.team_a.logo_url} 
                      alt={match.team_a.name}
                      style={{ 
                        width: '40px', 
                        height: '40px', 
                        objectFit: 'contain',
                        marginBottom: '8px'
                      }}
                    />
                  )}
                  <div style={{ fontSize: '13px', fontWeight: 'bold' }}>
                    {match.team_a.name}
                  </div>
                </div>

                {/* VS */}
                <div style={{ 
                  fontSize: '16px', 
                  fontWeight: 'bold', 
                  color: '#FFB800',
                  padding: '0 15px'
                }}>
                  VS
                </div>

                {/* Team B */}
                <div style={{ textAlign: 'center', flex: 1 }}>
                  {match.team_b.logo_url && (
                    <img 
                      src={match.team_b.logo_url} 
                      alt={match.team_b.name}
                      style={{ 
                        width: '40px', 
                        height: '40px', 
                        objectFit: 'contain',
                        marginBottom: '8px'
                      }}
                    />
                  )}
                  <div style={{ fontSize: '13px', fontWeight: 'bold' }}>
                    {match.team_b.name}
                  </div>
                </div>
              </div>

              {/* Time */}
              <div style={{ 
                fontSize: '13px', 
                color: match.status === 'not_started' ? '#4CAF50' : '#666',
                textAlign: 'center',
                fontWeight: 'bold'
              }}>
                📅 {new Date(match.scheduled_at).toLocaleString('tr-TR')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default TournamentPage