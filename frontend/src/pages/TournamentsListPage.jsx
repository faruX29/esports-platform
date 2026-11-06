import { useEffect, useMemo, useState } from 'react'
import SeoHead from '../components/SeoHead'
import { Radio, CalendarClock, CircleCheck } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { GAMES, useGame } from '../context/GameContext'
import { normalizeGameId } from '../utils/gameUtils'
import { KartLink } from '../components/KartLink'
import InitialsImage from '../components/InitialsImage'
import GameLogo, { GAME_ICON_PATHS } from '../components/GameLogo'
import LigSeridi from '../components/LigSeridi'
import TrBadge from '../components/TrBadge'
import { tournamentDisplayName, isGenericStageName, displayRegion } from '../utils/tournamentDisplay'
import { FEXT, yazi, oyunFg } from '../theme'
import { ligListesiGetir } from '../utils/ligler'
import { tarihAraligi } from '../utils/dil'

// Kanonik oyuna ait TÜM game_id'ler (mükerrer kayıtlar dahil: CS2 2/8, LoL 3/9).
function resolveGameIds(activeGame, games) {
  if (!activeGame || activeGame === 'all') return []
  const canonical = normalizeGameId(activeGame) ?? String(activeGame).toLowerCase()
  return [...new Set((games || [])
    .filter(g => normalizeGameId(g?.slug ?? g?.name) === canonical)
    .map(g => g?.id)
    .filter(id => id != null))]
}

// Oyun etiketi normalize (DB'de "Cs-Go"/"League-Of-Legends" gibi çirkin slug'lar var).
function gameMeta(game) {
  const canonical = normalizeGameId(game?.slug ?? game?.name)
  const g = GAMES.find(x => x.id === canonical)
  return { id: canonical, label: g?.shortLabel || g?.label || game?.name || 'Espor', color: g?.color || 'var(--text-3)' }
}

const TIER_COLORS = { S: '#F0A500', A: '#C0C7D0', B: '#7f8c9a', C: 'var(--text-4)', D: 'var(--text-5)' }

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

// Bitiş tarihi boş turnuva başlangıçtan bu kadar sonra "bitti" sayılır
const BITISSIZ_SURE_MS = 45 * 24 * 3600 * 1000

/** 'devam' | 'yaklasan' | 'bitti' — turnuvanın tarihlerinden. */
function turnuvaDurumu(t, simdi) {
  const bas = Date.parse(t?.begin_at || t?.start_date || '')
  const son = Date.parse(t?.end_at || t?.end_date || '')
  if (Number.isFinite(bas) && bas > simdi) return 'yaklasan'
  if (Number.isFinite(son)) return son >= simdi ? 'devam' : 'bitti'
  if (Number.isFinite(bas) && simdi - bas < BITISSIZ_SURE_MS) return 'devam'
  return 'bitti'
}

const GRUPLAR = [
  { key: 'devam',    baslik: 'Devam ediyor', Icon: Radio,         renk: '#FF4655', bos: 'Şu an süren turnuva yok.' },
  { key: 'yaklasan', baslik: 'Yaklaşan',     Icon: CalendarClock, renk: '#4CAF50', bos: 'Açıklanmış yaklaşan turnuva yok.' },
  { key: 'bitti',    baslik: 'Bitti',        Icon: CircleCheck,   renk: 'var(--text-3)', bos: null },
]

const tarihDegeri = (t, ...alanlar) => {
  for (const a of alanlar) { const v = Date.parse(t?.[a] || ''); if (Number.isFinite(v)) return v }
  return 0
}

function fmtDate(iso) {
  if (!iso) return 'Tarih yok'
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return 'Tarih yok'
  return dt.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function TournamentsListPage() {
  const { activeGame } = useGame()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showAllTiers, setShowAllTiers] = useState(false)
  const [tournaments, setTournaments] = useState([])
  const [games, setGames] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [teamsByTournament, setTeamsByTournament] = useState({})

  const PAGE_SIZE = 30

  // Kalıcı lig sayfaları (/lig/<slug>): adresi yıldan yıla değişmeyen fikstür sayfaları
  const [ligler, setLigler] = useState(null) // null = yükleniyor
  useEffect(() => {
    let iptal = false
    ligListesiGetir().then(l => { if (!iptal) setLigler(l) })
    return () => { iptal = true }
  }, [])
  const gorunenLigler = useMemo(() => {
    if (!ligler) return null
    const secili = activeGame && activeGame !== 'all' ? normalizeGameId(activeGame) : null
    return secili ? ligler.filter(l => normalizeGameId(l.oyun) === secili) : ligler
  }, [ligler, activeGame])

  // Oyun listesini bir kez çek (aktif oyun → game_id çözümü için).
  useEffect(() => {
    supabase.from('games').select('id,name,slug').then(({ data }) => setGames(data || []))
  }, [])

  // Arama debounce (server-side sorgu için)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  // Filtre (arama / oyun / tier) değişince başa dön + logo önbelleğini temizle.
  useEffect(() => { setPage(0); setTeamsByTournament({}) }, [debouncedSearch, activeGame, showAllTiers])

  useEffect(() => {
    let cancelled = false
    // Belirli oyun seçiliyken games henüz gelmediyse bekle (yanlışlıkla "hepsini" göstermemek için).
    if (activeGame && activeGame !== 'all' && games.length === 0) return

    async function loadTournaments() {
      page === 0 ? setLoading(true) : setLoadingMore(true)
      setError('')
      try {
        const gameIds = resolveGameIds(activeGame, games)
        let q = supabase
          .from('tournaments')
          .select('id,name,tier,region,begin_at,end_at,start_date,end_date,league_name,event_name,display_name,turk_ligi,game:games(id,name,slug)')
        if (debouncedSearch) {
          // Aşama adı çoğu zaman "Playoffs" → lig ve etkinlik adında da ara ("TCL", "Worlds")
          const desen = `*${debouncedSearch.replace(/[,()*]/g, ' ')}*`
          q = q.or(`name.ilike.${desen},league_name.ilike.${desen},event_name.ilike.${desen}`)
        }
        if (gameIds.length) q = q.in('game_id', gameIds)
        // Seviye filtresi SUNUCU-taraflı (sayfa dolu gelsin): S/A + Türk ligleri (TCL,
        // TESFED tier D; `turk_ligi` hesaplanan alanı, ligler.sql). İkinci `or` parametresi
        // aramanınkiyle VE'lenir.
        if (!showAllTiers) q = q.or('tier.in.(S,s,A,a),turk_ligi.is.true')
        // begin_at DESC + sayfalama → eski turnuvalara "Daha fazla" ile inilebilir.
        q = q.order('begin_at', { ascending: false, nullsFirst: false })
             .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

        const { data, error: queryError } = await q
        if (queryError) throw queryError
        if (cancelled) return
        setHasMore((data || []).length === PAGE_SIZE)
        setTournaments(prev => (page === 0 ? (data || []) : [...prev, ...(data || [])]))
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError?.message || 'Turnuvalar yuklenemedi.')
          if (page === 0) setTournaments([])
        }
      } finally {
        if (!cancelled) { setLoading(false); setLoadingMore(false) }
      }
    }

    loadTournaments()
    return () => { cancelled = true }
  }, [debouncedSearch, activeGame, page, games, showAllTiers])

  // Gruplama anı: sayfa açılışı (liste yeniden çekilince de aynı an yeterli)
  const [simdi] = useState(() => Date.now())

  const visibleTournaments = useMemo(() => (
    showAllTiers ? tournaments : tournaments.filter(t => isHeroTier(t?.tier) || t?.turk_ligi === true)
  ), [tournaments, showAllTiers])

  // Devam ediyor / Yaklaşan / Bitti. Liste başlangıca göre yeniden eskiye geliyor;
  // yaklaşanlar en yakını önce, bitenler gelen sırada (sayfalama bozulmasın).
  const gruplar = useMemo(() => {
    const g = { devam: [], yaklasan: [], bitti: [] }
    for (const t of visibleTournaments) g[turnuvaDurumu(t, simdi)].push(t)
    g.yaklasan.sort((a, b) => tarihDegeri(a, 'begin_at', 'start_date') - tarihDegeri(b, 'begin_at', 'start_date'))
    g.devam.sort((a, b) => tarihDegeri(a, 'end_at', 'end_date') - tarihDegeri(b, 'end_at', 'end_date'))
    return g
  }, [visibleTournaments, simdi])

  // Kartlara katılan takım logolarını çek (isim sadece "Playoffs"/"Group A" → logolar bağlam verir).
  // ARTIMLI: sadece henüz logosu ÇEKİLMEMİŞ turnuvaları sorgula (60'lık parça). Böylece "Daha
  // fazla" ile liste büyüdükçe üstteki turnuvalar truncate'e takılmaz, her turnuva kapsanır.
  useEffect(() => {
    const missing = visibleTournaments.map(t => t.id).filter(id => !(id in teamsByTournament))
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      const chunk = missing.slice(0, 60)
      const { data } = await supabase
        .from('matches')
        .select('tournament_id,team_a:teams!matches_team_a_id_fkey(id,name,logo_url),team_b:teams!matches_team_b_id_fkey(id,name,logo_url)')
        .in('tournament_id', chunk)
        .limit(3000)
      if (cancelled) return
      // Sorgulanan her turnuvaya anahtar ver (maçsız olsa da) → tekrar sorgulanmaz, döngü olmaz.
      const acc = {}
      for (const id of chunk) acc[id] = { seen: new Set(), list: [] }
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
      setTeamsByTournament(prev => ({ ...prev, ...out }))
    })()
    return () => { cancelled = true }
  }, [visibleTournaments, teamsByTournament])

  const kart = item => {
    const gm = gameMeta(item.game)
    const tierKey = normalizeTierKey(item.tier)
    const tierColor = TIER_COLORS[tierKey] || 'var(--text-5)'
    const logos = teamsByTournament[item.id] || []
    return (
      <KartLink
        key={item.id}
        to={`/tournament/${item.id}`}
        style={{
          position: 'relative', overflow: 'hidden', textAlign: 'left', lineHeight: 'normal',
          border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-1)',
          borderRadius: 12, padding: '12px 12px 12px 15px', cursor: 'pointer',
          transition: 'border-color .15s, transform .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = `${gm.color}66`; e.currentTarget.style.transform = 'translateY(-2px)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = 'translateY(0)' }}
      >
        {/* sol renk şeridi (oyun) */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: gm.color }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tournamentDisplayName(item, { game: gm.id })}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            {item.turk_ligi && <TrBadge style={{ margin: 0, fontSize: yazi(10) }} />}
            {tierKey && (
              <span style={{ fontSize: yazi(10), fontWeight: 900, color: '#0b0f19', background: tierColor, borderRadius: 5, padding: '2px 6px', letterSpacing: '.3px' }}>
                {tierKey}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: yazi(11), color: 'var(--text-3)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: oyunFg(gm.id), fontWeight: 700 }}>
            {GAME_ICON_PATHS[gm.id] ? <GameLogo game={gm.id} size={13} color={gm.color} /> : <span style={{ width: 6, height: 6, borderRadius: '50%', background: gm.color }} />} {gm.label}
          </span>
          {item.region && !isGenericStageName(item.name) && <span>· {displayRegion(item.region, gm.id)}</span>}
        </div>

        {logos.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 9 }}>
            {logos.slice(0, 5).map(t => (
              <InitialsImage key={t.id} src={t.logo_url} name={t.name} width={20} height={20} borderRadius={5} objectFit='contain' />
            ))}
            {logos.length > 5 && <span style={{ fontSize: yazi(10), color: 'var(--text-4)', marginLeft: 2 }}>+{logos.length - 5}</span>}
          </div>
        )}

        <div style={{ marginTop: 9, fontSize: yazi(11.5), color: 'var(--text-3)' }}>
          {tarihAraligi(
            (item.begin_at || item.start_date) && fmtDate(item.begin_at || item.start_date),
            (item.end_at || item.end_date) && fmtDate(item.end_at || item.end_date),
          ) || 'Tarih yok'}
        </div>
      </KartLink>
    )
  }

  const izgara = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 10 }

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '24px 16px 80px', color: 'var(--text-1)' }}>
      {/* Sekme başlığı: bu sayfalar genel "feXt — Espor Maçları…" başlığında kalıyordu */}
      <SeoHead title="Turnuvalar — Devam Eden, Yaklaşan ve Biten Espor Turnuvaları" description="Devam eden, yaklaşan ve biten S/A seviyesi espor turnuvaları ve Türk ligleri; eleme ağacı, fikstür ve puan durumu." type="website" />
      <h1 style={{ margin: '0 0 8px', fontSize: 30, letterSpacing: '.4px' }}>Turnuvalar</h1>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-3)' }}>
        Devam eden, yaklaşan ve biten turnuvalar. Fikstür, eleme ağacı ve puan durumu için bir turnuvaya tıkla.
      </p>

      {/* Lig şeridi: yüklenirken yer tutar (CLS), boşsa hiç çizilmez */}
      {(gorunenLigler === null || gorunenLigler.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          <LigSeridi ligler={gorunenLigler} />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder='Turnuva ya da lig ara...'
          aria-label='Turnuva ya da lig ara'
          style={{ height: 40, width: '100%', maxWidth: 420, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-1)', padding: '0 12px', outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {/* Ana sayfadaki seviye filtresiyle AYNI davranış: aktif seçimin
            kapsülü kayarak geçiyor, butonlar kendi arka planını taşımıyor. */}
        <div style={{
          position: 'relative',
          display: 'inline-flex',
          borderRadius: 999,
          padding: 3,
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
        }}>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 3, bottom: 3, left: 3,
              width: 'calc(50% - 3px)',
              borderRadius: 999,
              background: FEXT.accentSoftBg,
              border: `1px solid ${FEXT.accentBorder}`,
              transform: showAllTiers ? 'translateX(100%)' : 'translateX(0)',
              transition: 'transform .28s cubic-bezier(.2,.8,.3,1)',
              pointerEvents: 'none',
            }}
          />
          {[
            { key: false, label: 'Öne çıkanlar' },
            { key: true,  label: 'Tümü' },
          ].map(opt => {
            const active = showAllTiers === opt.key
            return (
              <button
                key={String(opt.key)}
                onClick={() => setShowAllTiers(opt.key)}
                aria-pressed={active}
                style={{
                  position: 'relative',
                  minWidth: 112,
                  border: 'none',
                  background: 'transparent',
                  color: active ? 'var(--accent-fg)' : 'var(--text-4)',
                  borderRadius: 999,
                  fontSize: yazi(11),
                  fontWeight: 800,
                  letterSpacing: '.2px',
                  padding: '8px 14px',
                  minHeight: 36,
                  cursor: 'pointer',
                  transition: 'color .2s',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <span style={{ fontSize: yazi(11), color: 'var(--text-3)' }}>
          {showAllTiers ? 'Küçük turnuvalar ve elemeler dahil' : 'S ve A seviyesi turnuvalar + Türk ligleri'}
        </span>
      </div>

      {/* Yükleniyor: kart iskeleti (CLS) */}
      {loading && (
        <div aria-busy="true" aria-label="Turnuvalar yükleniyor">
          <div style={{ width: 120, height: 14, borderRadius: 6, background: 'var(--surface-2)', marginBottom: 10 }} />
          <div style={izgara}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{
                height: 118, borderRadius: 12, border: '1px solid var(--line)',
                background: 'linear-gradient(90deg,var(--surface) 25%,var(--surface-2) 50%,var(--surface) 75%)',
                backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
              }} />
            ))}
          </div>
        </div>
      )}
      {!loading && error && <div style={{ fontSize: 13, color: 'var(--danger-fg)' }}>{error}</div>}

      {!loading && !error && visibleTournaments.length === 0 && (
        <div style={{ border: '1px dashed var(--line)', borderRadius: 12, padding: 16, color: 'var(--text-3)', fontSize: 13 }}>
          Eşleşen turnuva bulunamadı.
        </div>
      )}

      {!loading && !error && visibleTournaments.length > 0 && GRUPLAR.map(g => {
        const liste = gruplar[g.key]
        // Boş grup: aramada hiç çizilmez; aramasız yalnız kısa not (bitenler hep dolu)
        if (!liste.length && (debouncedSearch || !g.bos)) return null
        return (
          <section key={g.key} aria-labelledby={`grup-${g.key}`} style={{ marginBottom: 26 }}>
            <h2 id={`grup-${g.key}`} style={{
              margin: '0 0 10px', fontSize: 13, fontWeight: 800, letterSpacing: '.3px',
              display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-2)',
            }}>
              <g.Icon size={14} color={g.renk} />
              {g.baslik}
              {liste.length > 0 && (
                <span style={{ fontSize: yazi(11), fontWeight: 700, color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>
                  {liste.length}{g.key === 'bitti' && hasMore ? '+' : ''}
                </span>
              )}
            </h2>
            {liste.length > 0
              ? <div style={izgara}>{liste.map(kart)}</div>
              : <div style={{ fontSize: 12, color: 'var(--text-4)' }}>{g.bos}</div>}
          </section>
        )
      })}

      {!loading && !error && hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={loadingMore}
            style={{
              borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)',
              color: loadingMore ? 'var(--text-4)' : 'var(--text-1)', fontSize: 12, fontWeight: 700,
              padding: '10px 20px', cursor: loadingMore ? 'default' : 'pointer',
            }}
          >
            {loadingMore ? 'Yükleniyor...' : 'Daha fazla göster (eski turnuvalar)'}
          </button>
        </div>
      )}
    </div>
  )
}
