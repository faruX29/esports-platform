import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { NEWS_LIMIT } from '../utils/newsStories'

const DEFAULT_OPTIONS = {
  gameId: null,        // filter by normalized game id
  limit: NEWS_LIMIT,
  enabled: true,
}

export function useNews(options = {}) {
  const { gameId, limit, enabled } = { ...DEFAULT_OPTIONS, ...options }

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
          id, status, scheduled_at, tier,
          game, tournament_id,
          team_a:team_a_id(id, name, logo_url),
          team_b:team_b_id(id, name, logo_url),
          team_a_score, team_b_score, winner_id,
          prediction_team_a, prediction_team_b, prediction_confidence
        `)
        .in('status', ['finished', 'running', 'not_started'])
        .order('scheduled_at', { ascending: false })
        .limit(limit)

      const { data, error: fetchError } = await query
      if (fetchError) throw fetchError

      setMatches(data || [])
    } catch (err) {
      setError(err.message ?? 'News fetch failed')
    } finally {
      setLoading(false)
    }
  }, [gameId, limit, enabled])

  useEffect(() => { fetch() }, [fetch])

  return { matches, loading, error, refetch: fetch }
}
