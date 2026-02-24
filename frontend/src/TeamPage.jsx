import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'

const ROLE_STYLES = {
  igl:      { bg: 'rgba(139,92,246,0.2)',  border: 'rgba(139,92,246,0.55)', color: '#a78bfa', label: 'IGL' },
  sniper:   { bg: 'rgba(56,189,248,0.15)', border: 'rgba(56,189,248,0.5)',  color: '#38bdf8', label: 'Sniper' },
  awp:      { bg: 'rgba(56,189,248,0.15)', border: 'rgba(56,189,248,0.5)',  color: '#38bdf8', label: 'AWP' },
  entry:    { bg: 'rgba(239,68,68,0.2)',   border: 'rgba(239,68,68,0.5)',   color: '#f87171', label: 'Entry' },
  support:  { bg: 'rgba(234,179,8,0.18)',  border: 'rgba(234,179,8,0.45)',  color: '#fbbf24', label: 'Support' },
  lurker:   { bg: 'rgba(156,163,175,0.15)',border: 'rgba(156,163,175,0.35)',color: '#9ca3af', label: 'Lurker' },
  rifler:   { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)',   color: '#4ade80', label: 'Rifler' },
  carry:    { bg: 'rgba(251,146,60,0.2)',  border: 'rgba(251,146,60,0.5)',  color: '#fb923c', label: 'Carry' },
  jungler:  { bg: 'rgba(52,211,153,0.18)', border: 'rgba(52,211,153,0.45)', color: '#34d399', label: 'Jungler' },
  mid:      { bg: 'rgba(167,139,250,0.2)', border: 'rgba(167,139,250,0.5)', color: '#c4b5fd', label: 'Mid' },
  top:      { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.4)',  color: '#fcd34d', label: 'Top' },
  bot:      { bg: 'rgba(96,165,250,0.18)', border: 'rgba(96,165,250,0.45)', color: '#60a5fa', label: 'Bot' },
  adc:      { bg: 'rgba(96,165,250,0.18)', border: 'rgba(96,165,250,0.45)', color: '#60a5fa', label: 'ADC' },
  controller: { bg: 'rgba(20,184,166,0.18)', border: 'rgba(20,184,166,0.45)', color: '#2dd4bf', label: 'Controller' },
  duelist:  { bg: 'rgba(239,68,68,0.2)',   border: 'rgba(239,68,68,0.5)',   color: '#f87171', label: 'Duelist' },
  initiator:{ bg: 'rgba(251,146,60,0.2)',  border: 'rgba(251,146,60,0.5)',  color: '#fb923c', label: 'Initiator' },
  sentinel: { bg: 'rgba(139,92,246,0.2)',  border: 'rgba(139,92,246,0.55)', color: '#a78bfa', label: 'Sentinel' },
}

function getRoleBadge(role) {
  const key = role?.toLowerCase()
  return ROLE_STYLES[key] || { bg: 'rgba(255,70,85,0.15)', border: 'rgba(255,70,85,0.4)', color: '#FF4655', label: role }
}

function TeamPage() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  
  const [team, setTeam] = useState(null)
  const [matches, setMatches] = useState([])
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('upcoming')

  useEffect(() => {
    fetchTeamData()
  }, [teamId])

  async function fetchTeamData() {
    try {
      setLoading(true)

      // Fetch team info
      const { data: teamData, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .eq('id', teamId)
        .single()

      if (teamError) throw teamError
      setTeam(teamData)

      // Fetch ALL team matches (upcoming + past)
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

      if (matchesError) throw matchesError
      setMatches(matchesData || [])

      // Fetch player roster
      const { data: playersData } = await supabase
        .from('players')
        .select('nickname, real_name, role, image_url')
        .eq('team_pandascore_id', parseInt(teamId))
        .order('role')

      setPlayers(playersData || [])

    } catch (error) {
      console.error('Error fetching team data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter matches
  const upcomingMatches = matches.filter(m => m.status === 'not_started')
  const pastMatches = matches.filter(m => m.status === 'finished')

  // Get form (last 5 matches)
  const recentMatches = pastMatches.slice(0, 5)
  const form = recentMatches.map(match => {
    if (!match.winner_id) return 'D' // Draw
    return match.winner_id === parseInt(teamId) ? 'W' : 'L'
  })

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

      {/* Team Info */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '30px',
        marginBottom: '40px',
        padding: '30px',
        backgroundColor: '#1a1a1a',
        borderRadius: '15px',
        border: '2px solid #FF4655'
      }}>
        {team.logo_url && (
          <img
            src={team.logo_url}
            alt={team.name}
            style={{
              width: '150px',
              height: '150px',
              objectFit: 'contain'
            }}
          />
        )}
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: '0 0 10px 0', fontSize: '48px' }}>
            {team.name}
          </h1>
          {team.acronym && (
            <div style={{ fontSize: '24px', color: '#888', marginBottom: '20px' }}>
              {team.acronym}
            </div>
          )}
          
          {/* Form Badge */}
          {form.length > 0 && (
            <div style={{ display: 'flex', gap: '5px', marginTop: '15px' }}>
              <span style={{ color: '#888', marginRight: '10px', fontSize: '14px' }}>
                Recent Form:
              </span>
              {form.map((result, idx) => (
                <div
                  key={idx}
                  style={{
                    width: '30px',
                    height: '30px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '5px',
                    backgroundColor: 
                      result === 'W' ? '#4CAF50' : 
                      result === 'L' ? '#FF4655' : 
                      '#888',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  {result}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '20px' }}>
          <div style={{
            textAlign: 'center',
            padding: '20px',
            backgroundColor: '#0a0a0a',
            borderRadius: '10px',
            minWidth: '120px'
          }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#FF4655' }}>
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
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#FFB800' }}>
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
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#4CAF50' }}>
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
            backgroundColor: activeTab === 'upcoming' ? '#FF4655' : 'transparent',
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
            backgroundColor: activeTab === 'past' ? '#FF4655' : 'transparent',
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
        <button
          onClick={() => setActiveTab('roster')}
          style={{
            padding: '15px 30px',
            backgroundColor: activeTab === 'roster' ? '#FF4655' : 'transparent',
            color: 'white',
            border: 'none',
            borderRadius: '8px 8px 0 0',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            transition: 'background-color 0.2s'
          }}
        >
          👥 Roster ({players.length})
        </button>
      </div>

      {/* Roster Tab */}
      {activeTab === 'roster' && (
        <div>
          {players.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '50px', color: '#888' }}>
              <h3>No roster data available</h3>
              <p style={{ fontSize: '14px' }}>Player data for this team has not been synced yet.</p>
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '15px',
                marginBottom: '20px'
              }}>
                {players.map((player, i) => (
                  <div key={i} style={{
                    backgroundColor: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '12px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'border-color 0.2s',
                  }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = '#FF4655'}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = '#333'}
                  >
                    {player.image_url ? (
                      <img
                        src={player.image_url}
                        alt={player.nickname}
                        style={{ width: '70px', height: '70px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #444' }}
                      />
                    ) : (
                      <div style={{ width: '70px', height: '70px', borderRadius: '50%', backgroundColor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', border: '2px solid #444' }}>
                        👤
                      </div>
                    )}
                    <div style={{ fontSize: '16px', fontWeight: 'bold', textAlign: 'center' }}>{player.nickname}</div>
                    {player.real_name && (
                      <div style={{ fontSize: '13px', color: '#888', textAlign: 'center' }}>{player.real_name}</div>
                    )}
                    {player.role && (() => {
                      const badge = getRoleBadge(player.role)
                      return (
                        <div style={{
                          padding: '5px 12px',
                          backgroundColor: badge.bg,
                          border: `1px solid ${badge.border}`,
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: badge.color,
                          fontWeight: 'bold',
                          letterSpacing: '0.5px',
                          textTransform: 'capitalize',
                          boxShadow: `0 0 6px ${badge.border}`
                        }}>
                          {badge.label}
                        </div>
                      )
                    })()}
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center', padding: '15px', backgroundColor: '#0d0d0d', borderRadius: '8px', color: '#555', fontSize: '13px' }}>
                ℹ️ Individual K/D/A stats require PandaScore premium API access
              </div>
            </>
          )}
        </div>
      )}

      {/* Matches */}
      {activeTab !== 'roster' && (
      <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        gap: '20px'
      }}>
        {(activeTab === 'upcoming' ? upcomingMatches : pastMatches).map((match) => {
          const isTeamA = match.team_a.id === parseInt(teamId)
          const opponent = isTeamA ? match.team_b : match.team_a
          const teamScore = isTeamA ? match.team_a_score : match.team_b_score
          const opponentScore = isTeamA ? match.team_b_score : match.team_a_score
          const isWinner = match.winner_id === parseInt(teamId)
          
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
                backgroundColor: '#FF4655',
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
                  backgroundColor: isWinner ? '#4CAF50' : '#FF4655',
                  borderRadius: '15px',
                  fontSize: '11px',
                  fontWeight: 'bold'
                }}>
                  {isWinner ? '✅ WIN' : '❌ LOSS'}
                </div>
              )}

              {/* Teams */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
                marginBottom: '15px'
              }}>
                {/* Current Team */}
                <div style={{ flex: 1, textAlign: 'center', opacity: 1 }}>
                  {(isTeamA ? match.team_a : match.team_b).logo_url && (
                    <img
                      src={(isTeamA ? match.team_a : match.team_b).logo_url}
                      alt={team.name}
                      style={{
                        width: '60px',
                        height: '60px',
                        objectFit: 'contain',
                        marginBottom: '10px'
                      }}
                    />
                  )}
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    {team.name}
                  </div>
                  {activeTab === 'past' && teamScore !== null && (
                    <div style={{
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: isWinner ? '#4CAF50' : '#FF4655',
                      marginTop: '5px'
                    }}>
                      {teamScore}
                    </div>
                  )}
                </div>

                {/* VS */}
                <div style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: '#FF4655'
                }}>
                  VS
                </div>

                {/* Opponent */}
                <div
                  onClick={() => navigate(`/team/${opponent.id}`)}
                  style={{ flex: 1, textAlign: 'center', opacity: 0.6, cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
                >
                  {opponent.logo_url && (
                    <img
                      src={opponent.logo_url}
                      alt={opponent.name}
                      style={{
                        width: '60px',
                        height: '60px',
                        objectFit: 'contain',
                        marginBottom: '10px'
                      }}
                    />
                  )}
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                    {opponent.name}
                  </div>
                  {activeTab === 'past' && opponentScore !== null && (
                    <div style={{
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: '#888',
                      marginTop: '5px'
                    }}>
                      {opponentScore}
                    </div>
                  )}
                </div>
              </div>

              {/* Tournament */}
              {match.tournament && (
                <div style={{
                  fontSize: '13px',
                  color: '#aaa',
                  marginBottom: '10px',
                  textAlign: 'center'
                }}>
                  🏆 {match.tournament.name}
                </div>
              )}

              {/* Date */}
              <div style={{
                fontSize: '14px',
                color: activeTab === 'upcoming' ? '#4CAF50' : '#888',
                textAlign: 'center',
                fontWeight: 'bold'
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
      </>
      )}
    </div>
  )
}

export default TeamPage