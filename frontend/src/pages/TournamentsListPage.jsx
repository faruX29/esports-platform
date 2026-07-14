import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { GAMES } from '../context/GameContext'
import { normalizeGameId } from '../utils/gameUtils'
import InitialsImage from '../components/InitialsImage'

// Oyun etiketi normalize (DB'de "Cs-Go"/"League-Of-Legends" gibi çirkin slug'lar var).
function gameMeta(game) {
  const canonical = normalizeGameId(game?.slug ?? game?.name)
  const g = GAMES.find(x => x.id === canonical)
  return { label: g?.shortLabel || g?.label || game?.name || 'Esports', color: g?.color || '#8a8a8a' }
}

const TIER_COLORS = { S: '#F0A500', A: '#C0C7D0', B: '#7f8c9a', C: '#5c5c5c', D: '#454545' }

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
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showAllTiers, setShowAllTiers] = useState(false)
  const [tournaments, setTournaments] = useState([])

  // Arama debounce (server-side sorgu için)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let cancelled = false

    async function loadTournaments() {
      setLoading(true)
      setError('')
      try {
        // Arama varsa TÜM arşivde (2800 turnuva) ilike ile ara; yoksa son 300.
        let q = supabase
          .from('tournaments')
          .select('id,name,tier,region,begin_at,end_at,game:games(id,name,slug)')
        if (debouncedSearch) q = q.ilike('name', `%${debouncedSearch}%`)
        q = q.order('begin_at', { ascending: false, nullsFirst: false })
             .limit(debouncedSearch ? 150 : 300)

        const { data, error: queryError } = await q
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
  }, [debouncedSearch])

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

  // Kartları ayırt edilebilir yapmak için katılan takım logolarını çek (isim sadece
  // "Playoffs"/"Group A" olduğu için lig belli olmuyordu → logolar bağlam veriyor).
  const [teamsByTournament, setTeamsByTournament] = useState({})
  const visibleIdsKey = useMemo(
    () => visibleTournaments.map(t => t.id).slice(0, 120).join(','),
    [visibleTournaments],
  )

  useEffect(() => {
    const ids = visibleIdsKey ? visibleIdsKey.split(',').map(Number) : []
    if (!ids.length) { setTeamsByTournament({}); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('matches')
        .select('tournament_id,team_a:teams!matches_team_a_id_fkey(id,name,logo_url),team_b:teams!matches_team_b_id_fkey(id,name,logo_url)')
        .in('tournament_id', ids)
        .limit(4000)
      if (cancelled) return
      const acc = {}
      for (const m of (data || [])) {
        const bucket = acc[m.tournament_id] || (acc[m.tournament_id] = { seen: new Set(), list: [] })
        for (const t of [m.team_a, m.team_b]) {
          if (t?.id && !bucket.seen.has(t.id) && bucket.list.length < 6) {
            bucket.seen.add(t.id); bucket.list.push(t)
          }
        }
      }
      const out = {}
      for (const key in acc) out[key] = acc[key].list
      setTeamsByTournament(out)
    })()
    return () => { cancelled = true }
  }, [visibleIdsKey])

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 16px 80px', color: '#f2f2f2' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 30, letterSpacing: '.4px' }}>Turnuvalar</h1>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9c9c9c' }}>
        Aktif ve yaklaşan turnuvalar. Detay, bracket ve puan durumu için bir turnuvaya tıkla.
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
          {visibleTournaments.map(item => {
            const gm = gameMeta(item.game)
            const tierKey = normalizeTierKey(item.tier)
            const tierColor = TIER_COLORS[tierKey] || '#454545'
            const logos = teamsByTournament[item.id] || []
            return (
              <button
                key={item.id}
                onClick={() => navigate(`/tournament/${item.id}`)}
                style={{
                  position: 'relative', overflow: 'hidden', textAlign: 'left',
                  border: '1px solid #232323', background: '#101010', color: '#f0f0f0',
                  borderRadius: 12, padding: '12px 12px 12px 15px', cursor: 'pointer',
                  transition: 'border-color .15s, transform .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = `${gm.color}66`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#232323'; e.currentTarget.style.transform = 'translateY(0)' }}
              >
                {/* sol renk şeridi (oyun) */}
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: gm.color }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name || 'Tournament'}
                  </div>
                  {tierKey && (
                    <span style={{ fontSize: 10, fontWeight: 900, color: '#0b0b0b', background: tierColor, borderRadius: 5, padding: '2px 6px', flexShrink: 0, letterSpacing: '.3px' }}>
                      {tierKey}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11, color: '#8f8f8f' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: gm.color, fontWeight: 700 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: gm.color }} /> {gm.label}
                  </span>
                  {item.region && <span>· {item.region}</span>}
                </div>

                {logos.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 9 }}>
                    {logos.slice(0, 5).map(t => (
                      <InitialsImage key={t.id} src={t.logo_url} name={t.name} width={20} height={20} borderRadius={5} objectFit='contain' />
                    ))}
                    {logos.length > 5 && <span style={{ fontSize: 10, color: '#666', marginLeft: 2 }}>+{logos.length - 5}</span>}
                  </div>
                )}

                <div style={{ marginTop: 9, fontSize: 11.5, color: '#8f8f8f' }}>
                  {fmtDate(item.begin_at)}
                  {item.end_at ? ` – ${fmtDate(item.end_at)}` : ''}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
