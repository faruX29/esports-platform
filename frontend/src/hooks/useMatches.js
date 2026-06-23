import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { gameMatchesFilter } from '../context/GameContext'

const DEFAULT_OPTIONS = {
  status: null,      // 'not_started' | 'running' | 'finished' | null (all)
  gameId: 'all',     // active game filter from GameContext
  limit: 50,
  enabled: true,
}

export function useMatches(options = {}) {
  const { status, gameId, limit, enabled } = { ...DEFAULT_OPTIONS, ...options }

  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const fetch = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('matches')
        .select(`
          id, status, scheduled_at, game,
          team_a:team_a_id(id, name, logo_url),
          team_b:team_b_id(id, name, logo_url),
          team_a_score, team_b_score,
          winner_id, tournament_id,
          prediction_team_a, prediction_team_b, prediction_confidence
        `)
        .order('scheduled_at', { ascending: false })
        .limit(limit)

      if (status) query = query.eq('status', status)

      const { data, error: fetchError } = await query
      if (fetchError) throw fetchError

      const filtered = gameId && gameId !== 'all'
        ? (data || []).filter(m => gameMatchesFilter(m?.game?.name ?? m?.game?.slug ?? '', gameId))
        : (data || [])

      setMatches(filtered)
    } catch (err) {
      setError(err.message ?? 'Matches fetch failed')
    } finally {
      setLoading(false)
    }
  }, [status, gameId, limit, enabled])

  useEffect(() => { fetch() }, [fetch])

  return { matches, loading, error, refetch: fetch }
}
