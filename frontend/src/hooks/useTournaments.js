import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { normalizeGameId } from '../utils/gameUtils'

const DEFAULT_OPTIONS = {
  gameId: null,    // normalized game id filter
  limit: 30,
  enabled: true,
}

export function useTournaments(options = {}) {
  const { gameId, limit, enabled } = { ...DEFAULT_OPTIONS, ...options }

  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)

  const fetch = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('tournaments')
        .select('id, name, game, slug, tier, begin_at, end_at, logo_url, country, league_id')
        .order('begin_at', { ascending: false })
        .limit(limit)

      if (fetchError) throw fetchError

      const result = gameId
        ? (data || []).filter(t => normalizeGameId(t?.game?.slug ?? t?.game?.name) === gameId)
        : (data || [])

      setTournaments(result)
    } catch (err) {
      setError(err.message ?? 'Tournaments fetch failed')
    } finally {
      setLoading(false)
    }
  }, [gameId, limit, enabled])

  useEffect(() => { fetch() }, [fetch])

  return { tournaments, loading, error, refetch: fetch }
}
