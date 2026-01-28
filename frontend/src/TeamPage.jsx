import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'

function TeamPage() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  
  const [team, setTeam] = useState(null)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('upcoming')

  useEffect(() => {
    fetchTeamData()
  }, [teamId])

  async function fetchTeamData() {
    try {
      setLoading(true)
      
      // Takım bilgilerini çek
      const { data: teamData, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .eq('id', teamId)
        .single()
      
      if (teamError) throw teamError
      setTeam(teamData)
      
      // Takımın maçlarını çek
      const { data: matchesData, error: matchesError } = await supabase
        .from('matches')
        .select(`
          *,
          team_a:teams!matches_team_a_id_fkey(*),
          team_b:teams!matches_team_b_id_fkey(*),
          tournament:tournaments(*),
          game:games(*)
        `)
        .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
        .order('scheduled_at', { ascending: false })
        .limit(50)
      
      if (matchesError) throw matchesError
      setMatches(matchesData || [])
      
    } catch (error) {
      console.error('Error fetching team data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <h2>⏳ Loading team data...</h2>
      </div>
    )
  }

  if (!team) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <h2>❌ Team not found</h2>
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

      {/* Team Header */}
      <div style={{
        backgroundColor: '#1a1a1a',
        borderRadius: '15px',
        padding: '30px',
        marginBottom: '30px',
        textAlign: 'center',
        border: '2px solid #FF4655'
      }}>
        {team.logo_url && (
          <img 
            src={team.logo_url} 
            alt={team.name}
            style={{
              width: '150px',
              height: '150px',
              objectFit: 'contain',
              marginBottom: '20px'
            }}
          />
        )}
        
        <h1 style={{ fontSize: '36px', marginBottom: '10px' }}>
          {team.name}
        </h1>
        
        {team.acronym && (
          <div style={{ 
            fontSize: '18px', 
            color: '#888',
            marginBottom: '10px'
          }}>
            {team.acronym}
          </div>
        )}

        <div style={{ 
          display: 'flex', 
          gap: '20px', 
          justifyContent: 'center',
          marginTop: '20px',
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
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>
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
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FFB800' }}>
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
            backgroundColor: activeTab === 'upcoming' ? '#FF4655' : 'transparent',
            color: 'white',
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
            backgroundColor: activeTab === 'past' ? '#FF4655' : 'transparent',
            color: 'white',
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
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.02)'
                e.currentTarget.style.boxShadow = '0 5px 15px rgba(255, 70, 85, 0.3)'
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
                <div style={{ 
                  textAlign: 'center', 
                  flex: 1,
                  opacity: match.team_a.id === parseInt(teamId) ? 1 : 0.6
                }}>
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
                  color: '#FF4655',
                  padding: '0 15px'
                }}>
                  VS
                </div>

                {/* Team B */}
                <div style={{ 
                  textAlign: 'center', 
                  flex: 1,
                  opacity: match.team_b.id === parseInt(teamId) ? 1 : 0.6
                }}>
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

              {/* Tournament */}
              <div style={{ 
                fontSize: '12px', 
                color: '#aaa',
                marginBottom: '10px',
                textAlign: 'center'
              }}>
                🏆 {match.tournament?.name || 'Unknown Tournament'}
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

export default TeamPage