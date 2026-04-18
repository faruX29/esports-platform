import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

function normalizeTierKey(value) {
  if (!value) return null
  const normalized = String(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-')

  if (!normalized) return null
  if (normalized === 'S' || normalized.includes('S-TIER') || normalized.includes('TIER-S')) return 'S'
  if (normalized === 'A' || normalized.includes('A-TIER') || normalized.includes('TIER-A')) return 'A'
  if (normalized === 'B' || normalized.includes('B-TIER') || normalized.includes('TIER-B')) return 'B'
  if (normalized === 'C' || normalized.includes('C-TIER') || normalized.includes('TIER-C')) return 'C'

  const compact = normalized.replace(/-/g, '')
  return ['S', 'A', 'B', 'C', 'D', 'E'].includes(compact[0]) ? compact[0] : null
}

function isHeroTier(rawTier) {
  const key = normalizeTierKey(rawTier)
  return key === 'S' || key === 'A'
}

function fmtDate(iso) {
  if (!iso) return 'Tarih yok'
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return 'Tarih yok'
  return dt.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function TournamentsListPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [showAllTiers, setShowAllTiers] = useState(false)
  const [tournaments, setTournaments] = useState([])

  useEffect(() => {
    let cancelled = false

    async function loadTournaments() {
      setLoading(true)
      setError('')
      try {
        const { data, error: queryError } = await supabase
          .from('tournaments')
          .select('id,name,tier,region,begin_at,end_at,game:games(id,name,slug)')
          .order('begin_at', { ascending: false, nullsFirst: false })
          .limit(300)

        if (queryError) throw queryError
        if (!cancelled) setTournaments(data || [])
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError?.message || 'Turnuvalar yuklenemedi.')
          setTournaments([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadTournaments()
    return () => { cancelled = true }
  }, [])

  const searchedTournaments = useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    if (!q) return tournaments
    return tournaments.filter(item => String(item?.name || '').toLowerCase().includes(q))
  }, [search, tournaments])

  const visibleTournaments = useMemo(() => {
    if (showAllTiers) return searchedTournaments
    return searchedTournaments.filter(item => isHeroTier(item?.tier))
  }, [searchedTournaments, showAllTiers])

  const hiddenByTierCount = Math.max(0, searchedTournaments.length - visibleTournaments.length)

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 16px 80px', color: '#f2f2f2' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 30, letterSpacing: '.4px' }}>Turnuvalar</h1>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9c9c9c' }}>
        Sade MVP liste gorunumu. Bir turnuvaya tiklayarak detay sayfasina git.
      </p>

      <div style={{ marginBottom: 14 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder='Turnuva ara...'
          style={{ height: 40, width: '100%', maxWidth: 420, borderRadius: 10, border: '1px solid #2f2f2f', background: '#111', color: '#f3f3f3', padding: '0 12px', outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#a1a1a1', letterSpacing: '.4px' }}>
          Varsayilan filtre: S-Tier + A-Tier
        </span>
        <div style={{
          display: 'inline-flex',
          borderRadius: 999,
          padding: 3,
          gap: 4,
          background: 'linear-gradient(120deg, rgba(255,70,85,.18), rgba(25,25,25,.95))',
          border: '1px solid rgba(255,70,85,.28)',
          boxShadow: '0 0 16px rgba(255,70,85,.14)',
        }}>
          <button
            onClick={() => setShowAllTiers(false)}
            style={{
              border: '1px solid transparent',
              background: showAllTiers ? 'transparent' : 'linear-gradient(135deg, rgba(255,70,85,.2), rgba(255,120,80,.18))',
              color: showAllTiers ? '#b6b6b6' : '#ffd3d9',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '.2px',
              padding: '7px 12px',
              cursor: 'pointer',
              boxShadow: showAllTiers ? 'none' : 'inset 0 0 0 1px rgba(255,120,130,.35), 0 0 14px rgba(255,70,85,.2)',
            }}
          >
            S/A Pro Pool
          </button>
          <button
            onClick={() => setShowAllTiers(true)}
            style={{
              border: '1px solid transparent',
              background: showAllTiers ? 'linear-gradient(135deg, rgba(76,175,80,.24), rgba(40,120,220,.22))' : 'transparent',
              color: showAllTiers ? '#d6f6d8' : '#b6b6b6',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '.2px',
              padding: '7px 12px',
              cursor: 'pointer',
              boxShadow: showAllTiers ? 'inset 0 0 0 1px rgba(100,220,120,.34), 0 0 14px rgba(100,200,120,.18)' : 'none',
            }}
          >
            Tumu
          </button>
        </div>
        {!showAllTiers && hiddenByTierCount > 0 && (
          <span style={{ fontSize: 11, color: '#787878' }}>
            {hiddenByTierCount} alt-tier turnuva gizlendi
          </span>
        )}
      </div>

      {loading && <div style={{ fontSize: 13, color: '#8a8a8a' }}>Turnuvalar yukleniyor...</div>}
      {!loading && error && <div style={{ fontSize: 13, color: '#ff7d91' }}>{error}</div>}

      {!loading && !error && visibleTournaments.length === 0 && (
        <div style={{ border: '1px dashed #2d2d2d', borderRadius: 12, padding: 16, color: '#888', fontSize: 13 }}>
          Eslesen turnuva bulunamadi.
        </div>
      )}

      {!loading && !error && visibleTournaments.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10 }}>
          {visibleTournaments.map(item => (
            <button
              key={item.id}
              onClick={() => navigate(`/tournament/${item.id}`)}
              style={{ textAlign: 'left', border: '1px solid #262626', background: '#101010', color: '#f0f0f0', borderRadius: 12, padding: 12, cursor: 'pointer' }}
            >
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 7 }}>{item.name || 'Tournament'}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#9d9d9d' }}>
                <span style={{ border: '1px solid #2d2d2d', borderRadius: 999, padding: '2px 8px', background: '#141414' }}>
                  {item.game?.name || 'Esports'}
                </span>
                {item.tier && (
                  <span style={{ border: '1px solid #2d2d2d', borderRadius: 999, padding: '2px 8px', background: '#141414' }}>
                    Tier {item.tier}
                  </span>
                )}
                {item.region && (
                  <span style={{ border: '1px solid #2d2d2d', borderRadius: 999, padding: '2px 8px', background: '#141414' }}>
                    {item.region}
                  </span>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#b5b5b5' }}>
                {fmtDate(item.begin_at)}
                {item.end_at ? ` - ${fmtDate(item.end_at)}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
