import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import SeoHead from '../components/SeoHead'
import NewsCover, { scoreFromHero } from '../components/NewsCover'
import { getGameMeta, normalizeGameId, normalizeTier } from '../utils/newsStories'
import { buildNewsSlug } from '../utils/newsSlug'
import { isTurkishTeam } from '../constants'

const PAGE_SIZE = 24

// Oyun filtresi → DB'deki olası game_slug varyantları (hibrit şema)
const GAME_SLUGS = {
  valorant: ['valorant'],
  cs2: ['cs2', 'csgo', 'cs-go'],
  lol: ['lol', 'league-of-legends'],
}
const GAME_TABS = [
  { id: 'all', label: 'Tümü' },
  { id: 'valorant', label: 'Valorant' },
  { id: 'cs2', label: 'CS2' },
  { id: 'lol', label: 'LoL' },
]
const TYPE_TABS = [
  { id: 'all', label: 'Tümü' },
  { id: 'match', label: 'Maç Haberleri' },
  { id: 'tournament', label: 'Turnuva Özetleri' },
  { id: 'preview', label: 'Önizlemeler' },
  { id: 'transfer', label: 'Transferler' },
]

function storyIdFor(row) {
  if (row.content_type === 'transfer') return `transfer_${row.id}`
  if (row.content_type === 'tournament') return `tournament_${row.tournament_id}`
  return `match_${row.match_id}`
}

function slugFor(row) {
  return buildNewsSlug({ id: storyIdFor(row), title: row.title, matchId: row.match_id })
}

function typeTag(row) {
  if (row.content_type === 'transfer') return 'Transfer'
  if (row.content_type === 'tournament') return 'Turnuva'
  if (row.variant === 'preview') return 'Önizleme'
  if (row.variant === 'upset') return 'Sürpriz'
  return 'Maç'
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function rowToVisuals(row) {
  const gameId = normalizeGameId(row.game_slug) || 'valorant'
  const game = getGameMeta(gameId)
  return {
    gameId,
    gameLabel: game?.shortLabel || game?.label || 'ESPORTS',
    gameColor: game?.color || '#C8102E',
    gameIcon: game?.icon || null,
    tournamentName: row.tournament_name || 'Ana Sahne',
    tier: normalizeTier(row.tier),
    turkish: Boolean(isTurkishTeam?.(row.team_a_name) || isTurkishTeam?.(row.team_b_name)),
    teamA: { name: row.team_a_name, logo_url: row.team_a_logo },
    teamB: { name: row.team_b_name, logo_url: row.team_b_logo },
  }
}

/** Arşiv kartı — SEO için GERÇEK <a> (Link). Crawler'lar bu iç linkleri takip eder. */
function ArchiveCard({ row, isMobile }) {
  const visuals = rowToVisuals(row)
  return (
    <Link
      to={`/news/${slugFor(row)}`}
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        background: 'linear-gradient(180deg,var(--surface) 0%,var(--bg) 100%)',
        border: '1px solid #1f1f22',
        borderRadius: 14,
        padding: 12,
        overflow: 'hidden',
      }}
    >
      <NewsCover
        visuals={visuals}
        score={row.content_type === 'transfer' ? '➜' : row.content_type === 'tournament' ? '🏆' : scoreFromHero(row.hero_score)}
        height={isMobile ? 128 : 138}
        compact
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0 6px' }}>
        <span style={{ fontSize: 10, color: 'var(--text-1)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, padding: '3px 7px', borderRadius: 999, background: `${visuals.gameColor}22`, border: `1px solid ${visuals.gameColor}55` }}>
          {typeTag(row)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-1)', padding: '3px 7px', borderRadius: 999, background: 'rgba(255,255,255,.04)', border: '1px solid var(--line)' }}>
          {visuals.gameLabel}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-2)', padding: '3px 7px', borderRadius: 999, background: 'var(--hover)', border: '1px solid var(--line)' }}>
          Tier {visuals.tier}
        </span>
      </div>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, lineHeight: 1.3 }}>{row.title}</h3>
      {row.summary && (
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {row.summary}
        </p>
      )}
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-4)' }}>{fmtDate(row.created_at)}</div>
    </Link>
  )
}

export default function NewsArchivePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const game = searchParams.get('oyun') || 'all'
  const type = searchParams.get('tur') || 'all'
  const page = Math.max(1, Number(searchParams.get('sayfa')) || 1)

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 900)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const setParam = useCallback((patch) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(patch).forEach(([k, v]) => {
      if (v == null || v === 'all' || v === 1 || v === '1') next.delete(k)
      else next.set(k, String(v))
    })
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const loadPage = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('news_articles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (game !== 'all' && GAME_SLUGS[game]) q = q.in('game_slug', GAME_SLUGS[game])
      if (type === 'preview') q = q.eq('variant', 'preview')
      else if (type === 'transfer') q = q.eq('content_type', 'transfer')
      else if (type === 'tournament') q = q.eq('content_type', 'tournament')
      else if (type === 'match') q = q.eq('content_type', 'match').neq('variant', 'preview')

      const from = (page - 1) * PAGE_SIZE
      q = q.range(from, from + PAGE_SIZE - 1)

      const { data, count, error } = await q
      if (error) throw error
      setRows(data || [])
      setTotal(count || 0)
    } catch (err) {
      console.error('NewsArchivePage loadPage:', err.message || err)
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [game, type, page])

  useEffect(() => {
    loadPage()
    window.scrollTo({ top: 0 })
  }, [loadPage])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <SeoHead
        title={`Haber Arşivi${page > 1 ? ` — Sayfa ${page}` : ''}`}
        description="Tüm e-spor haberleri, maç önizlemeleri ve transfer gelişmeleri — Valorant, CS2 ve LoL için kronolojik arşiv."
        type="website"
      />
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: isMobile ? '14px 10px 34px' : '22px 16px 48px' }}>
        <div style={{ marginBottom: 16 }}>
          <Link to="/news" style={{ fontSize: 12, color: '#9db4ff', textDecoration: 'none' }}>‹ Günün Bülteni</Link>
          <h1 style={{ margin: '8px 0 4px', fontSize: isMobile ? 26 : 34 }}>Haber Arşivi</h1>
          <p style={{ margin: 0, color: 'var(--text-3)', fontSize: isMobile ? 13 : 14 }}>
            {total > 0 ? `${total} haber` : 'Tüm e-spor haberleri tek arşivde'} · maç sonuçları, önizlemeler ve transferler.
          </p>
        </div>

        {/* Filtreler */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {GAME_TABS.map(tab => {
              const active = tab.id === game
              return (
                <button key={tab.id} onClick={() => setParam({ oyun: tab.id, sayfa: 1 })}
                  style={{ padding: '7px 13px', borderRadius: 999, border: active ? '1px solid #C8102E' : '1px solid var(--line)', background: active ? 'rgba(200,16,46,.18)' : 'var(--surface)', color: active ? '#fff' : 'var(--text-3)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {tab.label}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TYPE_TABS.map(tab => {
              const active = tab.id === type
              return (
                <button key={tab.id} onClick={() => setParam({ tur: tab.id, sayfa: 1 })}
                  style={{ padding: '6px 12px', borderRadius: 999, border: active ? '1px solid #5eead4' : '1px solid var(--line)', background: active ? 'rgba(94,234,212,.14)' : 'var(--surface)', color: active ? '#ddfffb' : 'var(--text-3)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {loading && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Arşiv yükleniyor...</div>}

        {!loading && rows.length === 0 && (
          <div style={{ color: 'var(--text-4)', fontSize: 13 }}>Bu filtre için haber bulunamadı.</div>
        )}

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(280px,1fr))' }}>
          {rows.map(row => (
            <ArchiveCard key={row.id} row={row} isMobile={isMobile} />
          ))}
        </div>

        {/* Sayfalama — URL tabanlı <Link> (her sayfa crawlanabilir + paylaşılabilir) */}
        {totalPages > 1 && (
          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {page > 1 ? (
              <Link to={`?${new URLSearchParams({ ...(game !== 'all' && { oyun: game }), ...(type !== 'all' && { tur: type }), ...(page - 1 > 1 && { sayfa: page - 1 }) }).toString()}`}
                style={{ border: '1px solid var(--text-6)', background: 'var(--surface-2)', color: 'var(--text-1)', borderRadius: 8, padding: '6px 12px', textDecoration: 'none' }}>
                ‹ Önceki
              </Link>
            ) : (
              <span style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-4)', borderRadius: 8, padding: '6px 12px' }}>‹ Önceki</span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Sayfa {page} / {totalPages}</span>
            {page < totalPages ? (
              <Link to={`?${new URLSearchParams({ ...(game !== 'all' && { oyun: game }), ...(type !== 'all' && { tur: type }), sayfa: page + 1 }).toString()}`}
                style={{ border: '1px solid var(--text-6)', background: 'var(--surface-2)', color: 'var(--text-1)', borderRadius: 8, padding: '6px 12px', textDecoration: 'none' }}>
                Sonraki ›
              </Link>
            ) : (
              <span style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-4)', borderRadius: 8, padding: '6px 12px' }}>Sonraki ›</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
