import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from './AuthContext'
import BRANDING from '../branding.config'

const STORAGE_KEY = BRANDING.followStateStorageKey

const UserContext = createContext(null)

function readStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { teamIds: [], playerIds: [], gameIds: [] }
    const parsed = JSON.parse(raw)
    return {
      teamIds: Array.isArray(parsed.teamIds) ? parsed.teamIds : [],
      playerIds: Array.isArray(parsed.playerIds) ? parsed.playerIds : [],
      gameIds: Array.isArray(parsed.gameIds) ? parsed.gameIds : [],
    }
  } catch {
    return { teamIds: [], playerIds: [], gameIds: [] }
  }
}

export function UserProvider({ children }) {
  const { user, profile, updateProfile } = useAuth()
  const [teamIds, setTeamIds] = useState(() => readStoredState().teamIds)
  const [playerIds, setPlayerIds] = useState(() => readStoredState().playerIds)
  const [gameIds, setGameIds] = useState(() => readStoredState().gameIds)
  const [hydratedFromDb, setHydratedFromDb] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamIds, playerIds, gameIds }))
  }, [teamIds, playerIds, gameIds])

  // Girisli kullanicida follow datayi veritabanindan hydrate et.
  useEffect(() => {
    let cancelled = false

    async function loadFromDb() {
      if (!user?.id) {
        setHydratedFromDb(true)
        return
      }

      const { data, error } = await supabase
        .from('follows')
        .select('target_type,target_id')
        .eq('user_id', user.id)

      if (cancelled) return

      if (error) {
        console.warn('UserContext follows load:', error.message)
        setHydratedFromDb(true)
        return
      }

      const teamFromDb = (data || [])
        .filter(x => x.target_type === 'team')
        .map(x => Number(x.target_id))
        .filter(Number.isFinite)

      const playerFromDb = (data || [])
        .filter(x => x.target_type === 'player')
        .map(x => x.target_id)
        .filter(Boolean)

      const gameFromDb = (data || [])
        .filter(x => x.target_type === 'game')
        .map(x => String(x.target_id || '').trim())
        .filter(Boolean)

      // Loginli kullanicida DB state source-of-truth olsun; eski local veriyi ez.
      setTeamIds(teamFromDb)
      setPlayerIds(playerFromDb)
      setGameIds(gameFromDb)
      setHydratedFromDb(true)
    }

    loadFromDb()
    return () => { cancelled = true }
  }, [user?.id])

  // Follow degisikliklerini veritabanina yaz.
  useEffect(() => {
    if (!user?.id || !hydratedFromDb || syncing) return

    let cancelled = false

    async function persistFollows() {
      setSyncing(true)
      const rows = [
        ...teamIds.map(id => ({ user_id: user.id, target_type: 'team', target_id: String(id) })),
        ...playerIds.map(id => ({ user_id: user.id, target_type: 'player', target_id: String(id) })),
        ...gameIds.map(id => ({ user_id: user.id, target_type: 'game', target_id: String(id) })),
      ]

      const { error: delError } = await supabase.from('follows').delete().eq('user_id', user.id)
      if (delError) {
        console.warn('UserContext follows delete:', delError.message)
        setSyncing(false)
        return
      }

      if (rows.length) {
        const { error: insError } = await supabase.from('follows').insert(rows)
        if (insError) {
          console.warn('UserContext follows insert:', insError.message)
          setSyncing(false)
          return
        }
      }

      if (!cancelled && typeof updateProfile === 'function') {
        const preferredTeam = teamIds[0] || null
        if ((profile?.favorite_team_id || null) !== preferredTeam) {
          try {
            await updateProfile({ favorite_team_id: preferredTeam })
          } catch (e) {
            console.warn('UserContext profile favorite sync:', e.message)
          }
        }
      }

      if (!cancelled) setSyncing(false)
    }

    persistFollows()
    return () => { cancelled = true }
  }, [user?.id, hydratedFromDb, teamIds, playerIds, gameIds, updateProfile, profile?.favorite_team_id, syncing])

  function followTeam(teamId) {
    if (!teamId) return
    setTeamIds(prev => (prev.includes(teamId) ? prev : [...prev, teamId]))
  }

  function unfollowTeam(teamId) {
    if (!teamId) return
    setTeamIds(prev => prev.filter(id => id !== teamId))
  }

  function toggleTeamFollow(teamId) {
    if (!teamId) return
    setTeamIds(prev => (prev.includes(teamId)
      ? prev.filter(id => id !== teamId)
      : [...prev, teamId]))
  }

  function isTeamFollowed(teamId) {
    return teamIds.includes(teamId)
  }

  function followPlayer(playerId) {
    if (!playerId) return
    setPlayerIds(prev => (prev.includes(playerId) ? prev : [...prev, playerId]))
  }

  function unfollowPlayer(playerId) {
    if (!playerId) return
    setPlayerIds(prev => prev.filter(id => id !== playerId))
  }

  function togglePlayerFollow(playerId) {
    if (!playerId) return
    setPlayerIds(prev => (prev.includes(playerId)
      ? prev.filter(id => id !== playerId)
      : [...prev, playerId]))
  }

  function isPlayerFollowed(playerId) {
    return playerIds.includes(playerId)
  }

  function followGame(gameId) {
    const normalized = String(gameId || '').trim()
    if (!normalized) return
    setGameIds(prev => (prev.includes(normalized) ? prev : [...prev, normalized]))
  }

  function unfollowGame(gameId) {
    const normalized = String(gameId || '').trim()
    if (!normalized) return
    setGameIds(prev => prev.filter(id => id !== normalized))
  }

  function toggleGameFollow(gameId) {
    const normalized = String(gameId || '').trim()
    if (!normalized) return
    setGameIds(prev => (prev.includes(normalized)
      ? prev.filter(id => id !== normalized)
      : [...prev, normalized]))
  }

  function isGameFollowed(gameId) {
    const normalized = String(gameId || '').trim()
    if (!normalized) return false
    return gameIds.includes(normalized)
  }

  function setFollowedTeams(nextTeamIds = []) {
    const normalized = [...new Set((nextTeamIds || []).map(id => Number(id)).filter(Number.isFinite))]
    setTeamIds(normalized)
  }

  function setFollowedGames(nextGameIds = []) {
    const normalized = [...new Set((nextGameIds || []).map(id => String(id || '').trim()).filter(Boolean))]
    setGameIds(normalized)
  }

  const value = useMemo(() => ({
    followedTeamIds: teamIds,
    followedPlayerIds: playerIds,
    followedGames: gameIds,
    followTeam,
    unfollowTeam,
    toggleTeamFollow,
    isTeamFollowed,
    followPlayer,
    unfollowPlayer,
    togglePlayerFollow,
    isPlayerFollowed,
    followGame,
    unfollowGame,
    toggleGameFollow,
    isGameFollowed,
    setFollowedTeams,
    setFollowedGames,
  }), [teamIds, playerIds, gameIds])

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) {
    throw new Error('useUser must be used within UserProvider')
  }
  return ctx
}
