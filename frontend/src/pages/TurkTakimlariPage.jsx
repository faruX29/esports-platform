/**
 * /turk-takimlari — Türk takımları merkez sayfası.
 *
 * Neden: Google'da ilk 10'a giren sayfalarımızın hepsi Türk takımı / Türkçe haber,
 * ama tek tek haberlerin ömrü kısa (bir haftada sönüyor). Bu sayfa kalıcı: her
 * Türk takımı haberinden link alır ve zamanla yükselir.
 *
 * Takım listesi tek kaynaktan (turk_takimlar görünümü). Botlara aynı içerik
 * middleware'den basılır (STATIC_ROUTES['/turk-takimlari']).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, History, Newspaper, Library, Users } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { useTurkTakimlar, isTurkishTeam, turkHaberleriniGetir } from '../constants'
import SeoHead from '../components/SeoHead'
import InitialsImage from '../components/InitialsImage'
import GameLogo from '../components/GameLogo'
import TrBadge from '../components/TrBadge'
import { normalizeGameId, getGameMeta } from '../utils/newsStories'
import { tournamentDisplayName } from '../utils/tournamentDisplay'
import { deriveWinnerTeamId, correctedScores } from '../utils/matchResult'
import { buildNewsSlug } from '../utils/newsSlug'
import { FEXT } from '../theme'

const MATCH_SELECT = `
  id, scheduled_at, status, winner_id, team_a_id, team_b_id, team_a_score, team_b_score,
  team_a:teams!matches_team_a_id_fkey(id,name,acronym,logo_url),
  team_b:teams!matches_team_b_id_fkey(id,name,acronym,logo_url),
  tournament:tournaments(id,name,tier,league_name,event_name,display_name,region),
  game:games(slug,name)
`
// Izgarada yalnız yakın zamanda oynamış ya da maçı olan takımlar: listede eski,
// dağılmış kadrolar da var ("ex-…"); onlar boş kart olarak kalabalık yapar.
const SON_MAC_GUN = 60

function fmtSaat(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtGun(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function haberStoryId(row) {
  if (row.content_type === 'transfer') return `transfer_${row.id}`
  if (row.content_type === 'haftalik') return `haftalik_${row.id}`
  if (row.content_type === 'tournament') return `tournament_${row.tournament_id}`
  return `match_${row.match_id}`
}

function haberEtiketi(row) {
  if (row.content_type === 'transfer') return 'Transfer'
  if (row.content_type === 'haftalik') return 'Haftalık'
  if (row.variant === 'preview') return 'Önizleme'
  if (row.variant === 'upset') return 'Sürpriz'
  return 'Maç'
}

// Sayfa bölümleri: sırası hem sayfanın hem soldaki asansörün sırası
const BOLUMLER = [
  { id: 'takimlar', baslik: 'Takımlar', kisa: 'Takımlar', ikon: s => <Users size={s} /> },
  { id: 'yaklasan', baslik: 'Yaklaşan maçlar', kisa: 'Yaklaşan', ikon: s => <CalendarDays size={s} /> },
  { id: 'sonuclar', baslik: 'Son sonuçlar', kisa: 'Sonuçlar', ikon: s => <History size={s} /> },
  { id: 'haberler', baslik: 'Türk takımı haberleri', kisa: 'Haberler', ikon: s => <Newspaper size={s} /> },
  { id: 'haftalik', baslik: 'Türk Espor Haftası arşivi', kisa: 'Arşiv', ikon: s => <Library size={s} /> },
]
const NAVBAR_YUKSEKLIK = 58
const MOBIL_SERIT = 50          // mobilde navbar altındaki yapışkan bölüm şeridi
const ASANSOR_TUS = 40, ASANSOR_ARA = 6
// İki sütunlu kart ızgarası (dar ekranda tek sütun)
const izgaraStil = min => ({ display: 'grid', gap: 8, gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${min}px),1fr))` })

function Bolum({ id, baslik, ikon, children, sag, vurgulu, ustPay }) {
  return (
    <section id={id} style={{ marginBottom: 26, scrollMarginTop: ustPay }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        margin: '0 -8px 10px', padding: '6px 8px', borderRadius: 10,
        // Asansörle gelince başlık kısa bir an parlar, sonra söner
        background: vurgulu ? FEXT.accentSoftBg : 'transparent',
        transition: 'background .7s ease',
      }}>
        <h2 style={{ margin: 0, fontSize: 13, color: 'var(--accent-fg)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 7 }}>
          {ikon(15)} {baslik}
        </h2>
        {sag}
      </div>
      {children}
    </section>
  )
}

/** Masaüstü: solda yapışkan ikon sütunu; vurgu kutusu aktif bölüme kayar (asansör). */
function Asansor({ aktif, onGit }) {
  const [uzerinde, setUzerinde] = useState(null)
  const sira = Math.max(0, BOLUMLER.findIndex(b => b.id === aktif))
  return (
    <nav aria-label="Sayfa bölümleri" style={{ position: 'sticky', top: NAVBAR_YUKSEKLIK + 20, alignSelf: 'start' }}>
      <div style={{ position: 'relative', display: 'grid', gap: ASANSOR_ARA, padding: ASANSOR_ARA, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)' }}>
        <span aria-hidden="true" style={{
          position: 'absolute', left: ASANSOR_ARA, top: ASANSOR_ARA, width: ASANSOR_TUS, height: ASANSOR_TUS,
          borderRadius: 10, background: FEXT.accentSoftBg, border: `1px solid ${FEXT.accentBorder}`, boxSizing: 'border-box',
          transform: `translateY(${sira * (ASANSOR_TUS + ASANSOR_ARA)}px)`,
          transition: 'transform .38s cubic-bezier(.34,1.12,.5,1)', pointerEvents: 'none',
        }} />
        {BOLUMLER.map(b => {
          const secili = b.id === aktif
          const acik = uzerinde === b.id
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onGit(b.id)}
              aria-label={b.baslik}
              aria-current={secili ? 'true' : undefined}
              onMouseEnter={() => setUzerinde(b.id)}
              onMouseLeave={() => setUzerinde(null)}
              onFocus={() => setUzerinde(b.id)}
              onBlur={() => setUzerinde(null)}
              style={{
                position: 'relative', width: ASANSOR_TUS, height: ASANSOR_TUS, display: 'grid', placeItems: 'center',
                border: 'none', background: 'transparent', borderRadius: 10, cursor: 'pointer', padding: 0,
                color: secili ? 'var(--accent-fg)' : 'var(--text-3)', transition: 'color .2s',
              }}
            >
              {b.ikon(18)}
              <span style={{
                position: 'absolute', left: ASANSOR_TUS + 12, top: '50%', zIndex: 5,
                transform: `translate(${acik ? 0 : -4}px,-50%)`, opacity: acik ? 1 : 0,
                transition: 'opacity .15s, transform .15s', pointerEvents: 'none', whiteSpace: 'nowrap',
                fontSize: 12, fontWeight: 700, color: 'var(--text-1)', background: 'var(--surface-2)',
                border: '1px solid var(--line)', borderRadius: 8, padding: '5px 9px',
              }}>
                {b.baslik}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** Mobil: navbar altında yapışkan, yatay kayan bölüm şeridi. */
function MobilAsansor({ aktif, onGit }) {
  const seritRef = useRef(null)
  // Aktif çip şeridin dışında kalmasın (scrollIntoView sayfanın kaymasını bölebilir → elle)
  useEffect(() => {
    const serit = seritRef.current
    const cip = serit?.querySelector('[aria-current="true"]')
    if (!serit || !cip) return
    const hedef = cip.offsetLeft - (serit.clientWidth - cip.offsetWidth) / 2
    serit.scrollTo({ left: Math.max(0, hedef), behavior: 'smooth' })
  }, [aktif])
  return (
    <nav ref={seritRef} aria-label="Sayfa bölümleri" style={{
      position: 'sticky', top: NAVBAR_YUKSEKLIK, zIndex: 20, height: MOBIL_SERIT, boxSizing: 'border-box',
      margin: '0 -16px 14px', padding: '8px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--line)',
      display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      {BOLUMLER.map(b => {
        const secili = b.id === aktif
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onGit(b.id)}
            aria-current={secili ? 'true' : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '0 11px', borderRadius: 999,
              border: `1px solid ${secili ? FEXT.accentBorder : 'var(--line)'}`,
              background: secili ? FEXT.accentSoftBg : 'var(--surface)',
              color: secili ? 'var(--accent-fg)' : 'var(--text-3)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'background .2s, color .2s, border-color .2s',
            }}
          >
            {b.ikon(14)} {b.kisa}
          </button>
        )
      })}
    </nav>
  )
}

function Bos({ children }) {
  return <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '10px 2px' }}>{children}</div>
}

/** Yüklenirken yer tutan kutular: yükseklik gerçek satırla (~62px) aynı → alttaki bölümler itilmez (CLS). */
function Iskelet({ adet, min }) {
  return (
    <div style={izgaraStil(min)} aria-hidden="true">
      {Array.from({ length: adet }, (_, i) => (
        <div key={i} style={{ height: 62, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', animation: 'pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  )
}

/** Maç satırı: Türk tarafı TR rozetli; sonuçta Türk takımının kazanıp kaybettiği kenar renginden okunur. */
function MacSatiri({ m }) {
  const bitti = m.status === 'finished'
  const canli = m.status === 'running'
  const kazanan = bitti ? deriveWinnerTeamId(m) : null
  const skor = correctedScores(m)
  const trA = isTurkishTeam(m.team_a), trB = isTurkishTeam(m.team_b)
  let kenar = 'var(--line)'
  if (bitti && kazanan != null && trA !== trB) {
    const trKazandi = kazanan === Number(trA ? m.team_a_id : m.team_b_id)
    kenar = trKazandi ? 'rgba(64,196,110,.55)' : 'rgba(255,70,85,.5)'
  }
  const gameId = normalizeGameId(m.game?.slug ?? m.game?.name)
  const takim = (tm, tr, sag) => {
    const kazandi = bitti && kazanan != null && kazanan === Number(tm?.id)
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flexDirection: sag ? 'row-reverse' : 'row', fontWeight: kazandi ? 800 : 600, color: kazandi || !bitti ? 'var(--text-1)' : 'var(--text-3)' }}>
        <InitialsImage src={tm?.logo_url} name={tm?.name} width={20} height={20} borderRadius={5} objectFit='contain' />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tm?.name || 'TBD'}</span>
        {tr && <TrBadge style={{ margin: 0 }} />}
      </span>
    )
  }
  return (
    <Link
      to={`/match/${m.id}`}
      style={{ display: 'grid', gap: 4, padding: '10px 12px', borderRadius: 10, border: `1px solid ${kenar}`, background: 'var(--surface)', color: 'var(--text-1)', textDecoration: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>{takim(m.team_a, trA, true)}</div>
        <div style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', minWidth: 58, textAlign: 'center', color: canli ? FEXT.status.live.color : 'var(--text-1)', fontSize: bitti || canli ? 13 : 11 }}>
          {bitti || canli ? `${skor.team_a_score ?? '-'} - ${skor.team_b_score ?? '-'}` : fmtSaat(m.scheduled_at)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>{takim(m.team_b, trB, false)}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--text-3)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {gameId && <GameLogo game={gameId} size={12} color={getGameMeta(gameId).color} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tournamentDisplayName(m.tournament, { game: gameId })}
          </span>
        </span>
        <span style={{ whiteSpace: 'nowrap' }}>
          {canli ? 'Canlı' : bitti ? fmtGun(m.scheduled_at) : ''}
        </span>
      </div>
    </Link>
  )
}

/** Takım kartı: sıradaki maç (yoksa son sonuç). */
function TakimKarti({ t, sonraki, son }) {
  const gameId = normalizeGameId(t.game?.slug ?? t.game?.name)
  let satir = null
  if (sonraki) {
    const rakip = Number(sonraki.team_a_id) === Number(t.id) ? sonraki.team_b : sonraki.team_a
    satir = (
      <span style={{ color: sonraki.status === 'running' ? FEXT.status.live.color : 'var(--text-2)' }}>
        {sonraki.status === 'running' ? 'Şu an canlı' : fmtSaat(sonraki.scheduled_at)} · {rakip?.acronym || rakip?.name || 'TBD'}
      </span>
    )
  } else if (son) {
    const bizA = Number(son.team_a_id) === Number(t.id)
    const rakip = bizA ? son.team_b : son.team_a
    const sk = correctedScores(son)
    const kazanan = deriveWinnerTeamId(son)
    const sonuc = kazanan == null ? 'B' : kazanan === Number(t.id) ? 'G' : 'M'
    satir = (
      <span style={{ color: 'var(--text-3)' }}>
        Son: <b style={{ color: sonuc === 'G' ? FEXT.good : sonuc === 'M' ? FEXT.danger : 'var(--text-2)' }}>{sonuc}</b>{' '}
        {bizA ? `${sk.team_a_score ?? '-'}-${sk.team_b_score ?? '-'}` : `${sk.team_b_score ?? '-'}-${sk.team_a_score ?? '-'}`} · {rakip?.acronym || rakip?.name || 'TBD'}
      </span>
    )
  }
  return (
    <Link
      to={`/team/${t.id}`}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-1)', textDecoration: 'none', minWidth: 0 }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-fg)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)' }}
    >
      <InitialsImage src={t.logo_url} name={t.name} width={36} height={36} borderRadius={8} objectFit='contain' style={{ flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 800, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name?.trim()}</span>
          {gameId && <GameLogo game={gameId} size={12} color={getGameMeta(gameId).color} />}
        </div>
        <div style={{ fontSize: 11, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{satir}</div>
      </div>
    </Link>
  )
}

function HaberSatiri({ row }) {
  return (
    <Link
      to={`/news/${buildNewsSlug({ id: haberStoryId(row), title: row.title, matchId: row.match_id })}`}
      style={{ display: 'grid', gap: 4, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-1)', textDecoration: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-3)' }}>
        <span style={{ fontWeight: 800, color: 'var(--accent-fg)', textTransform: 'uppercase', letterSpacing: '.6px' }}>{haberEtiketi(row)}</span>
        <span>{fmtGun(row.created_at)}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{row.title}</div>
    </Link>
  )
}

export default function TurkTakimlariPage() {
  const takimlar = useTurkTakimlar()
  const [maclar, setMaclar] = useState(null)   // { yaklasan, son }
  const [haberler, setHaberler] = useState(null)
  const [haftalik, setHaftalik] = useState(null)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 900)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const idler = useMemo(() => takimlar.map(t => t.id), [takimlar])

  // ── Asansör: kaydırırken aktif bölümü izle; tıklayınca yumuşak kaydır ──
  const ustPay = NAVBAR_YUKSEKLIK + (isMobile ? MOBIL_SERIT + 10 : 16)
  const [aktif, setAktif] = useState(BOLUMLER[0].id)
  const [vurgu, setVurgu] = useState(null)
  const kayiyorRef = useRef(false)   // tıklamayla kayarken ara bölümler aktif olmasın
  const zamanRef = useRef(null)

  useEffect(() => {
    let zaman = 0
    const hesapla = () => {
      zaman = 0
      if (kayiyorRef.current) return
      // Sayfa sonuna gelindiyse son bölüm (kısa bölüm hiçbir zaman tepeye çıkamaz)
      const altta = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      let secili = BOLUMLER[0].id
      if (altta) secili = BOLUMLER[BOLUMLER.length - 1].id
      else {
        for (const b of BOLUMLER) {
          const el = document.getElementById(b.id)
          if (el && el.getBoundingClientRect().top <= ustPay + 40) secili = b.id
        }
      }
      setAktif(secili)
    }
    // Kısa zamanlayıcıyla seyreltilir (rAF arka plan sekmesinde hiç çalışmıyor)
    const onScroll = () => { if (!zaman) zaman = setTimeout(hesapla, 60) }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(zaman) }
  }, [ustPay])

  useEffect(() => () => clearTimeout(zamanRef.current), [])

  const bolumeGit = useCallback(id => {
    const el = document.getElementById(id)
    if (!el) return
    const azHareket = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    kayiyorRef.current = true
    setAktif(id)
    setVurgu(id)
    el.scrollIntoView({ behavior: azHareket ? 'auto' : 'smooth', block: 'start' })
    clearTimeout(zamanRef.current)
    zamanRef.current = setTimeout(() => { kayiyorRef.current = false; setVurgu(null) }, 900)
  }, [])

  useEffect(() => {
    if (!idler.length) return
    let cancelled = false
    const liste = idler.join(',')
    const takimFiltresi = `team_a_id.in.(${liste}),team_b_id.in.(${liste})`
    const simdi = Date.now()
    ;(async () => {
      const bitenler = sel => supabase.from('matches').select(sel)
        .or(takimFiltresi)
        .eq('status', 'finished')
        .gte('scheduled_at', new Date(simdi - SON_MAC_GUN * 86400000).toISOString())
        .order('scheduled_at', { ascending: false })
      const [yaklasanRes, sonRes, kimlikRes] = await Promise.all([
        supabase.from('matches').select(MATCH_SELECT)
          .or(takimFiltresi)
          .in('status', ['not_started', 'running'])
          .gte('scheduled_at', new Date(simdi - 6 * 3600000).toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(60),
        bitenler(MATCH_SELECT).limit(80),
        // 80 maç 60 günün ancak ~2 haftasına yetiyor: iki haftadır oynamayan takım
        // (Galatasaray) ızgaradan düşüyordu → takım başına son maçı kimlikten bul
        bitenler('id,team_a_id,team_b_id').limit(1000),
      ])
      if (yaklasanRes.error) console.error('Türk takımları yaklaşan maçlar:', yaklasanRes.error.message)
      if (sonRes.error) console.error('Türk takımları son maçlar:', sonRes.error.message)
      if (kimlikRes.error) console.error('Türk takımları maç kimlikleri:', kimlikRes.error.message)
      const son = sonRes.data || []
      const kapsanan = new Set(son.flatMap(m => [m.team_a_id, m.team_b_id]))
      const turkId = new Set(idler)
      const eksik = new Set()
      for (const m of kimlikRes.data || []) {
        for (const id of [m.team_a_id, m.team_b_id]) {
          if (turkId.has(id) && !kapsanan.has(id)) { eksik.add(m.id); kapsanan.add(id) }
        }
      }
      let ek = []
      if (eksik.size) {
        const ekRes = await supabase.from('matches').select(MATCH_SELECT)
          .in('id', [...eksik]).order('scheduled_at', { ascending: false })
        if (ekRes.error) console.error('Türk takımları eski son maçlar:', ekRes.error.message)
        ek = ekRes.data || []
      }
      // "Son sonuçlar" listesi yalnız ilk 80'i gösterir; ek maçlar yalnız ızgaraya
      if (!cancelled) setMaclar({ yaklasan: yaklasanRes.data || [], son, sonEk: ek })
    })()
    return () => { cancelled = true }
  }, [idler])

  useEffect(() => {
    let cancelled = false
    turkHaberleriniGetir({ limit: 20, gun: 45 })
      .then(rows => { if (!cancelled) setHaberler(rows.filter(r => r.content_type !== 'haftalik').slice(0, 10)) })
      .catch(err => {
        console.error('Türk takımı haberleri:', err.message || err)
        if (!cancelled) setHaberler([])
      })
    supabase.from('news_articles').select('id,title,summary,created_at,content_type,variant,match_id,tournament_id')
      .eq('content_type', 'haftalik').eq('variant', 'turk_haftasi')
      .order('created_at', { ascending: false }).limit(12)
      .then(({ data, error }) => {
        if (error) console.error('Haftalık özet arşivi:', error.message)
        if (!cancelled) setHaftalik(data || [])
      })
    return () => { cancelled = true }
  }, [])

  // Takım → sıradaki / son maç; ızgara sırası: canlı/yakın maçı olan önce
  const izgara = useMemo(() => {
    if (!maclar) return []
    const sonraki = new Map(), son = new Map()
    for (const m of maclar.yaklasan) {
      for (const id of [m.team_a_id, m.team_b_id]) if (!sonraki.has(id)) sonraki.set(id, m)
    }
    for (const m of [...maclar.son, ...(maclar.sonEk || [])]) {
      for (const id of [m.team_a_id, m.team_b_id]) if (!son.has(id)) son.set(id, m)
    }
    return takimlar
      .filter(t => sonraki.has(t.id) || son.has(t.id))
      .map(t => ({ t, sonraki: sonraki.get(t.id), son: son.get(t.id) }))
      .sort((a, b) => {
        if (!!a.sonraki !== !!b.sonraki) return a.sonraki ? -1 : 1
        if (a.sonraki) return new Date(a.sonraki.scheduled_at) - new Date(b.sonraki.scheduled_at)
        return new Date(b.son.scheduled_at) - new Date(a.son.scheduled_at)
      })
  }, [maclar, takimlar])

  const bolum = id => BOLUMLER.find(b => b.id === id)
  const bolumProps = id => ({ ...bolum(id), vurgulu: vurgu === id, ustPay })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <SeoHead
        title="Türk Espor Takımları: BBL, Eternal Fire, FUT, Galatasaray Maçları"
        description="BBL Esports, Eternal Fire, FUT Esports, Galatasaray Esports ve diğer Türk takımlarının VALORANT, CS2 ve LoL maç programı, sonuçları, kadro ve transfer haberleri tek sayfada."
        type="website"
      />
      <div style={{
        maxWidth: 1180, margin: '0 auto', padding: isMobile ? '14px 16px 34px' : '22px 16px 48px',
        // Masaüstü: solda asansör sütunu, sağda içerik
        display: isMobile ? 'block' : 'grid', gridTemplateColumns: isMobile ? undefined : `${ASANSOR_TUS + ASANSOR_ARA * 2 + 2}px minmax(0,1fr)`, gap: 20,
      }}>
        {!isMobile && <Asansor aktif={aktif} onGit={bolumeGit} />}

        <div style={{ minWidth: 0 }}>
          <div style={{ borderRadius: 18, border: '1px solid var(--surface-2)', overflow: 'hidden', marginBottom: isMobile ? 12 : 20, background: 'var(--surface)' }}>
            <div style={{ height: 4, background: FEXT.accentGrad }} />
            <div style={{ padding: isMobile ? 16 : 20 }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? 26 : 34, lineHeight: 1.1 }}>Türk Takımları</h1>
              <p style={{ margin: '8px 0 0', color: 'var(--text-3)', fontSize: isMobile ? 13 : 14, lineHeight: 1.6, maxWidth: 720 }}>
                Türk espor takımlarının yaklaşan maçları, son sonuçları ve haberleri. Liste, Türkiye kayıtlı takımlar
                ile kadrosunun çoğu Türk oyunculardan oluşan takımları kapsar.
              </p>
            </div>
          </div>

          {isMobile && <MobilAsansor aktif={aktif} onGit={bolumeGit} />}

          <Bolum {...bolumProps('takimlar')}>
            {!maclar ? <Iskelet adet={6} min={240} /> : izgara.length === 0 ? <Bos>Son günlerde maçı olan Türk takımı yok.</Bos> : (
              <div style={{ ...izgaraStil(240), gap: 10 }}>
                {izgara.map(({ t, sonraki, son }) => <TakimKarti key={t.id} t={t} sonraki={sonraki} son={son} />)}
              </div>
            )}
          </Bolum>

          <Bolum {...bolumProps('yaklasan')}>
            {!maclar ? <Iskelet adet={6} min={400} /> : maclar.yaklasan.length === 0 ? <Bos>Planlanmış Türk maçı yok.</Bos> : (
              <div style={izgaraStil(400)}>
                {maclar.yaklasan.slice(0, 12).map(m => <MacSatiri key={m.id} m={m} />)}
              </div>
            )}
          </Bolum>

          <Bolum {...bolumProps('sonuclar')}>
            {!maclar ? <Iskelet adet={12} min={400} /> : maclar.son.length === 0 ? <Bos>Son {SON_MAC_GUN} günde sonuç yok.</Bos> : (
              <div style={izgaraStil(400)}>
                {maclar.son.slice(0, 12).map(m => <MacSatiri key={m.id} m={m} />)}
              </div>
            )}
          </Bolum>

          <Bolum
            {...bolumProps('haberler')}
            sag={<Link to="/news" style={{ fontSize: 12, color: 'var(--text-3)', textDecoration: 'none' }}>Tüm haberler ›</Link>}
          >
            {!haberler ? <Iskelet adet={10} min={340} /> : haberler.length === 0 ? <Bos>Son günlerde Türk takımı haberi yok.</Bos> : (
              <div style={izgaraStil(340)}>
                {haberler.map(row => <HaberSatiri key={row.id} row={row} />)}
              </div>
            )}
          </Bolum>

          <Bolum {...bolumProps('haftalik')}>
            {!haftalik ? <Iskelet adet={1} min={340} /> : haftalik.length === 0 ? <Bos>Haftalık özet her Pazartesi sabahı yayımlanır.</Bos> : (
              <div style={izgaraStil(340)}>
                {haftalik.map(row => <HaberSatiri key={row.id} row={row} />)}
              </div>
            )}
          </Bolum>
        </div>
      </div>
    </div>
  )
}
