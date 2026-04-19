import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from './AuthContext'
import BRANDING from '../branding.config'

const STORAGE_KEY = BRANDING.followStateStorageKey

const UserContext = createContext(null)

function normalizeGameId(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return null
  if (value === 'valorant') return 'valorant'
  if (value === 'cs2' || value === 'csgo' || value.includes('counter') || value.includes('cs-go')) return 'cs2'
  if (value === 'lol' || value.includes('league')) return 'lol'
  return null
}

function uniqueCanonicalGames(gameList = []) {
  return [...new Set((gameList || []).map(normalizeGameId).filter(Boolean))]
}

function sanitizeTeamGameMap(rawMap = {}) {
  if (!rawMap || typeof rawMap !== 'object') return {}
  const result = {}

  for (const [teamIdRaw, gameIdRaw] of Object.entries(rawMap)) {
    const teamId = String(teamIdRaw || '').trim()
    const gameId = normalizeGameId(gameIdRaw)
    if (!teamId || !gameId) continue
    result[teamId] = gameId
  }

  return result
}

function collectMappedGames(teamIdList = [], teamGameMap = {}) {
  return [...new Set((teamIdList || [])
    .map(teamId => teamGameMap[String(teamId)])
    .map(normalizeGameId)
    .filter(Boolean))]
}

function parseTeamIds(list = []) {
  return [...new Set((list || []).map(id => Number(id)).filter(Number.isFinite))]
}

function readStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { teamIds: [], playerIds: [], gameIds: [], teamGameMap: {} }
    const parsed = JSON.parse(raw)
    return {
      teamIds: Array.isArray(parsed.teamIds) ? parsed.teamIds : [],
      playerIds: Array.isArray(parsed.playerIds) ? parsed.playerIds : [],
      gameIds: Array.isArray(parsed.gameIds) ? parsed.gameIds : [],
      teamGameMap: sanitizeTeamGameMap(parsed.teamGameMap),
    }
  } catch {
    return { teamIds: [], playerIds: [], gameIds: [], teamGameMap: {} }
  }
}

export function UserProvider({ children }) {
  const storedState = readStoredState()
  const { user, profile, updateProfile } = useAuth()
  const [teamIds, setTeamIds] = useState(() => parseTeamIds(storedState.teamIds))
  const [playerIds, setPlayerIds] = useState(() => Array.isArray(storedState.playerIds) ? storedState.playerIds : [])
  const [gameIds, setGameIds] = useState(() => uniqueCanonicalGames(storedState.gameIds))
  const [teamGameMap, setTeamGameMap] = useState(() => sanitizeTeamGameMap(storedState.teamGameMap))
  const [hydratedFromDb, setHydratedFromDb] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamIds, playerIds, gameIds, teamGameMap }))
  }, [teamIds, playerIds, gameIds, teamGameMap])

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
        .map(x => x.target_id)
        .filter(Boolean)

      let mappedTeamGames = {}
      if (teamFromDb.length) {
        const { data: teamRows, error: teamRowsError } = await supabase
          .from('teams')
          .select('id,game_id,game:games(id,name,slug)')
          .in('id', teamFromDb)

        if (!teamRowsError) {
          mappedTeamGames = sanitizeTeamGameMap(Object.fromEntries((teamRows || []).map(row => {
            const gameId = normalizeGameId(row?.game?.slug ?? row?.game?.name ?? row?.game?.id ?? row?.game_id)
            return [String(row.id), gameId]
          })))
        }
      }

      const mergedGames = [...new Set([
        ...uniqueCanonicalGames(gameFromDb),
        ...collectMappedGames(teamFromDb, mappedTeamGames),
      ])]

      // Loginli kullanicida DB state source-of-truth olsun; eski local veriyi ez.
      setTeamIds(teamFromDb)
      setPlayerIds(playerFromDb)
      setGameIds(mergedGames)
      setTeamGameMap(mappedTeamGames)
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
      const mappedGameIds = collectMappedGames(teamIds, teamGameMap)
      const persistedGameIds = [...new Set([
        ...uniqueCanonicalGames(gameIds),
        ...mappedGameIds,
      ])]

      const rows = [
        ...teamIds.map(id => ({ user_id: user.id, target_type: 'team', target_id: String(id) })),
        ...playerIds.map(id => ({ user_id: user.id, target_type: 'player', target_id: String(id) })),
        ...persistedGameIds.map(id => ({ user_id: user.id, target_type: 'game', target_id: String(id) })),
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
  }, [user?.id, hydratedFromDb, teamIds, playerIds, gameIds, teamGameMap, updateProfile, profile?.favorite_team_id, syncing])

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
    const normalized = normalizeGameId(gameId)
    if (!normalized) return
    setGameIds(prev => (prev.includes(normalized) ? prev : [...prev, normalized]))
  }

  function unfollowGame(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return
    setGameIds(prev => prev.filter(id => id !== normalized))
  }

  function toggleGameFollow(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return
    setGameIds(prev => (prev.includes(normalized)
      ? prev.filter(id => id !== normalized)
      : [...prev, normalized]))
  }

  function isGameFollowed(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return false
    return gameIds.includes(normalized)
  }

  function setFollowedTeams(nextTeamIds = [], options = {}) {
    const normalizedTeamIds = parseTeamIds(nextTeamIds)
    const providedMap = sanitizeTeamGameMap(options?.teamGameMap)
    const mergedMap = { ...teamGameMap, ...providedMap }
    const inferredGames = collectMappedGames(normalizedTeamIds, mergedMap)

    setTeamIds(normalizedTeamIds)
    if (Object.keys(providedMap).length > 0) {
      setTeamGameMap(mergedMap)
    }

    if (inferredGames.length > 0) {
      setGameIds(prev => [...new Set([
        ...uniqueCanonicalGames(prev),
        ...inferredGames,
      ])])
    }
  }

  function setFollowedGames(nextGameIds = [], options = {}) {
    const normalizedTeamIds = parseTeamIds(options?.teamIds || teamIds)
    const providedMap = sanitizeTeamGameMap(options?.teamGameMap)
    const mergedMap = { ...teamGameMap, ...providedMap }
    const inferredGames = collectMappedGames(normalizedTeamIds, mergedMap)
    const normalizedGames = [...new Set([
      ...uniqueCanonicalGames(nextGameIds),
      ...inferredGames,
    ])]

    if (Object.keys(providedMap).length > 0) {
      setTeamGameMap(mergedMap)
    }
    setGameIds(normalizedGames)
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
