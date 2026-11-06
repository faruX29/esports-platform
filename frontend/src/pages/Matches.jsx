/**
 * Matches.jsx — Maçlar: Canlı / Yaklaşan / Geçmiş
 *
 * Bütün filtreler SUNUCU tarafında: oyun (GameContext), arama, turnuva, tarih,
 * takip edilen takımlar, Türk takımları. Liste güne göre gruplu, "Daha fazla
 * yükle" ile 50'şer büyür. Yenile/Otomatik düğmesi yok: canlı veri `maclar`
 * Broadcast'inden, gerisi sessiz arka plan yenilemesiyle (`useYenileme`) gelir.
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal }                     from 'react-dom'
import { Link, useSearchParams }            from 'react-router-dom'
import { supabase, subscribeToMatchesUpdates } from '../supabaseClient'
import { useYenileme, useCanliBaglanti }    from '../hooks/useYenileme'
import { useGame }                          from '../context/GameContext'
import { useUser }                          from '../context/UserContext'
import { isTurkishTeam, useTurkTakimlar }   from '../constants'
import { turkTakimlariYukle }               from '../utils/turkTakimlar'
import { normalizeGameId }                  from '../utils/gameUtils'
import { tournamentDisplayName }            from '../utils/tournamentDisplay'
import { adDili }                           from '../utils/dil'
import { FEXT, GAME_COLORS, statusStyle, yazi } from '../theme'
import Mascot                               from '../components/Mascot'
import SeoHead                              from '../components/SeoHead'
import GameLogo                             from '../components/GameLogo'
import { getBOFormat }                      from '../utils/matchFormat'
import { correctedScores }                  from '../utils/matchResult'
import { isUncertainPrediction, fextopusSonucu } from '../utils/prediction'
import { roundLabel }                       from '../utils/roundLabel'
import { KartOrtusu, UST_KATMAN }           from '../components/KartLink'
import TurkishBadge                         from '../components/TurkishBadge'
import { FlipNumber }                       from '../components/AnimatedNumber'
import { Damga, SkorParlamasi }            from '../components/Animasyon'
import { useAcilisGecisi, useDegisimSayaci } from '../hooks/useHareket'
import InitialsImage                        from '../components/InitialsImage'
import FextopusEtiketi                      from '../components/FextopusEtiketi'
import {
  CalendarDays, Clock, Search, Star, Flame, Sparkles, Trophy, Play, Check,
  ChevronDown, TriangleAlert, Loader2, X as XIcon, SlidersHorizontal, ArrowUpDown,
} from 'lucide-react'

const PAGE_SIZE = 50
const SESSIZ_YENILEME_MS = 60000

const GAME_SHORT_NAMES = { valorant: 'VALORANT', cs2: 'CS2', lol: 'LoL', dota2: 'Dota2' }
function gameDisplayName(game) {
  const id = normalizeGameId(game?.slug ?? game?.name ?? '')
  return GAME_SHORT_NAMES[id] ?? game?.name ?? '?'
}

const FALLBACK_GAME_IDS = {
  valorant: 1,
  cs2: 2,
  lol: 3,
}

// DB'de aynı oyun için MÜKERRER kayıtlar var (ör. "Counter-Strike 2" id=2 VE
// "Cs-Go" id=8; "League of Legends" id=3 VE "League-Of-Legends" id=9). Maçlar
// bu id'ler arasında bölünmüş — tek id'ye .eq atınca upcoming boş görünüyordu.
// Bu yüzden kanonik oyuna ait TÜM game_id'leri toplayıp .in ile filtreliyoruz.
function resolveGameIds(activeGame, gameNames) {
  if (!activeGame || activeGame === 'all') return []
  const canonical = normalizeGameId(activeGame) ?? String(activeGame).toLowerCase()
  const ids = (gameNames || [])
    .filter(g => normalizeGameId(g?.slug ?? g?.name) === canonical)
    .map(g => g?.id)
    .filter(id => id != null)
  if (ids.length) return [...new Set(ids)]
  const fallback = FALLBACK_GAME_IDS[canonical]
  return fallback != null ? [fallback] : []
}

const MAC_SELECT = `
  id, status, scheduled_at,
  team_a_id, team_b_id, winner_id,
  team_a_score, team_b_score,
  number_of_games, stream_url, game_id, round_info,
  prediction_team_a, prediction_team_b, prediction_confidence,
  team_a:teams!matches_team_a_id_fkey(id, name, logo_url, acronym),
  team_b:teams!matches_team_b_id_fkey(id, name, logo_url, acronym),
  tournament:tournaments(id, name, tier, league_name, event_name, display_name, region),
  game:games(id, name, slug)
`

const SEKMELER = [
  { key: 'live',     label: 'Canlı' },
  { key: 'upcoming', label: 'Yaklaşan' },
  { key: 'past',     label: 'Geçmiş' },
]

const OYUN_SIRASI = ['valorant', 'cs2', 'lol', 'dota2']
const TIER_SIRASI = { S: 0, A: 1, B: 2, C: 3, D: 4 }

function matchTimeIso(match) {
  return match?.scheduled_at ?? match?.begin_at ?? match?.created_at ?? null
}

function oyunIdsi(match) {
  return normalizeGameId(match?.game?.slug ?? match?.game?.name)
}

function saatYaz(iso) {
  const t = iso ? new Date(iso) : null
  if (!t || Number.isNaN(t.getTime())) return 'TBA'
  return t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

// PostgREST `or=(...)` söz dizimini bozan karakterler (virgül, parantez, joker)
function aramaTemizle(s) {
  return String(s || '').replace(/[,()*%\\:]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Tarih: yerel (tarayıcı) gün sınırları ─────────────────────────────────
function gunBasi(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function gunEkle(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
/** 'YYYY-AA-GG' → yerel gece yarısı (new Date('YYYY-AA-GG') UTC sayar, Türkiye'de 3 saat kayar) */
function yerelGun(str) {
  const [y, m, d] = String(str).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
function gunAnahtari(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TARIH_SECENEKLERI = {
  upcoming: [
    { key: 'bugun', label: 'Bugün' },
    { key: 'yarin', label: 'Yarın' },
    { key: '7gun',  label: '7 gün içinde' },
  ],
  past: [
    { key: 'bugun', label: 'Bugün' },
    { key: 'dun',   label: 'Dün' },
    { key: '7gun',  label: 'Son 7 gün' },
  ],
}

/** Seçili tarih filtresi → { from, to } (to hariç). */
function tarihAraligi(tarih, tab) {
  if (!tarih) return { from: null, to: null }
  const bugun = gunBasi()
  switch (tarih.key) {
    case 'bugun': return { from: bugun, to: gunEkle(bugun, 1) }
    case 'yarin': return { from: gunEkle(bugun, 1), to: gunEkle(bugun, 2) }
    case 'dun':   return { from: gunEkle(bugun, -1), to: bugun }
    case '7gun':  return tab === 'past'
      ? { from: gunEkle(bugun, -6), to: gunEkle(bugun, 1) }
      : { from: bugun, to: gunEkle(bugun, 8) }
    case 'ozel':  return {
      from: tarih.from ? yerelGun(tarih.from) : null,
      to: tarih.to ? gunEkle(yerelGun(tarih.to), 1) : null,
    }
    default: return { from: null, to: null }
  }
}

function kisaTarih(str) {
  return yerelGun(str).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
}

function tarihEtiketi(tarih, tab) {
  if (!tarih) return null
  if (tarih.key !== 'ozel') return (TARIH_SECENEKLERI[tab] || []).find(o => o.key === tarih.key)?.label ?? null
  if (tarih.from && tarih.to) return tarih.from === tarih.to ? kisaTarih(tarih.from) : `${kisaTarih(tarih.from)} – ${kisaTarih(tarih.to)}`
  if (tarih.from) return `${kisaTarih(tarih.from)} sonrası`
  if (tarih.to) return `${kisaTarih(tarih.to)} öncesi`
  return null
}

/** Gün başlığı: Bugün / Dün / Yarın / "6 Kasım Perşembe" (başka yılsa yıl da). */
function gunBasligi(d) {
  const fark = Math.round((gunBasi(d) - gunBasi()) / 86400000)
  if (fark === 0) return 'Bugün'
  if (fark === -1) return 'Dün'
  if (fark === 1) return 'Yarın'
  const ayniYil = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', ...(ayniYil ? {} : { year: 'numeric' }) })
}

function gunlereBol(maclar) {
  const gruplar = []
  for (const m of maclar) {
    const iso = matchTimeIso(m)
    const d = iso ? new Date(iso) : null
    const gecerli = d && !Number.isNaN(d.getTime())
    const anahtar = gecerli ? gunAnahtari(d) : 'tarihsiz'
    let son = gruplar[gruplar.length - 1]
    if (!son || son.anahtar !== anahtar) {
      son = { anahtar, baslik: gecerli ? gunBasligi(d) : 'Tarihi belli değil', maclar: [] }
      gruplar.push(son)
    }
    son.maclar.push(m)
  }
  return gruplar
}

// ── Sunucu filtreleri ─────────────────────────────────────────────────────
function sekmeFiltresi(query, tab, simdiIso) {
  if (tab === 'live') return query.eq('status', 'running')
  if (tab === 'upcoming') return query.eq('status', 'not_started').gt('scheduled_at', simdiIso)
  return query.eq('status', 'finished')
}

function tarihFiltresi(query, { from, to }) {
  if (from) query = query.gte('scheduled_at', from.toISOString())
  if (to) query = query.lt('scheduled_at', to.toISOString())
  return query
}

function takimKosulu(idler) {
  const liste = idler.join(',')
  return `team_a_id.in.(${liste}),team_b_id.in.(${liste})`
}

/**
 * Sekmeden bağımsız ortak filtreler (oyun, arama, takip, Türk takımları) — sayaçlar
 * da aynısını kullanır ki "Canlı 3" ile listedeki maç sayısı tutsun. Birden çok OR
 * grubu tek `or=(and(or(..),or(..)))` olarak gider (iki ayrı `or` parametresi
 * PostgREST'te birbirini ezebilir).
 */
function ortakFiltre(query, f) {
  if (f.gameIds) query = query.in('game_id', f.gameIds)
  const gruplar = []
  if (f.arama) {
    const parcalar = []
    if (f.arama.teamIds.length) parcalar.push(takimKosulu(f.arama.teamIds))
    if (f.arama.tourIds.length) parcalar.push(`tournament_id.in.(${f.arama.tourIds.join(',')})`)
    if (!parcalar.length) return query.eq('id', -1)  // eşleşme yok → boş
    gruplar.push(parcalar.join(','))
  }
  for (const idler of [f.takipIdleri, f.turkIdleri]) {
    if (!idler) continue
    if (!idler.length) return query.eq('id', -1)
    gruplar.push(takimKosulu(idler))
  }
  if (gruplar.length === 1) return query.or(gruplar[0])
  if (gruplar.length > 1) return query.or(`and(${gruplar.map(g => `or(${g})`).join(',')})`)
  return query
}

/** Turnuva açılır listesi: oyun → ana turnuva (lig + etkinlik) → aşama. */
function turnuvaGruplari(satirlar) {
  const oyunlar = new Map()
  for (const r of satirlar) {
    const t = r.tournament
    if (t?.id == null) continue
    const oyun = oyunIdsi(r) || 'diger'
    const ana = tournamentDisplayName(t, { withStage: false, game: oyun })
    const anaAnahtar = `${oyun}|${ana}`
    if (!oyunlar.has(oyun)) oyunlar.set(oyun, new Map())
    const etkinlikler = oyunlar.get(oyun)
    if (!etkinlikler.has(anaAnahtar)) {
      etkinlikler.set(anaAnahtar, { anahtar: anaAnahtar, ad: ana, tier: String(t.tier || '').toUpperCase(), sayi: 0, asamalar: new Map() })
    }
    const e = etkinlikler.get(anaAnahtar)
    e.sayi++
    const tierHarf = String(t.tier || '').toUpperCase()
    if ((TIER_SIRASI[tierHarf] ?? 9) < (TIER_SIRASI[e.tier] ?? 9)) e.tier = tierHarf
    const asama = e.asamalar.get(t.id) || { id: t.id, ad: String(t.name || '').trim() || 'Aşama', sayi: 0 }
    asama.sayi++
    e.asamalar.set(t.id, asama)
  }
  return [...oyunlar.entries()]
    .sort(([a], [b]) => (OYUN_SIRASI.indexOf(a) + 99) % 99 - (OYUN_SIRASI.indexOf(b) + 99) % 99)
    .map(([oyun, etkinlikler]) => ({
      oyun,
      etkinlikler: [...etkinlikler.values()]
        .map(e => ({ ...e, asamalar: [...e.asamalar.values()].sort((a, b) => a.ad.localeCompare(b.ad, 'tr')) }))
        .sort((a, b) => (TIER_SIRASI[a.tier] ?? 9) - (TIER_SIRASI[b.tier] ?? 9) || a.ad.localeCompare(b.ad, 'tr')),
    }))
}

// ── Küçük kancalar ───────────────────────────────────────────────────────
function useDarEkran(px = 640) {
  const sorgu = `(max-width: ${px}px)`
  const [dar, setDar] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(sorgu).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(sorgu)
    if (!mq) return undefined
    const degisti = () => setDar(mq.matches)
    mq.addEventListener('change', degisti)
    return () => mq.removeEventListener('change', degisti)
  }, [sorgu])
  return dar
}

// ── Stil yardımcıları ────────────────────────────────────────────────────
function kapsulStil(aktif) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 36, padding: '0 14px', borderRadius: 999,
    border: `1px solid ${aktif ? FEXT.accentBorder : 'var(--line)'}`,
    background: aktif ? FEXT.accentSoftBg : 'var(--surface)',
    color: aktif ? 'var(--accent-fg)' : 'var(--text-2)',
    fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'background .15s, border-color .15s, color .15s',
  }
}

const panelStil = {
  position: 'absolute', top: 'calc(100% + 6px)', zIndex: 40,
  maxWidth: 'calc(100vw - 32px)',
  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14,
  boxShadow: '0 14px 36px var(--shadow)', padding: 8,
}

function secenekStil(secili) {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '9px 10px', borderRadius: 9, border: 'none', cursor: 'pointer',
    background: secili ? FEXT.accentSoftBg : 'transparent',
    color: secili ? 'var(--accent-fg)' : 'var(--text-2)',
    fontSize: 13, fontWeight: secili ? 700 : 500,
  }
}

function hoverArkaPlan(secili) {
  return {
    onMouseEnter: e => { if (!secili) e.currentTarget.style.background = 'var(--hover)' },
    onMouseLeave: e => { if (!secili) e.currentTarget.style.background = 'transparent' },
  }
}

/* Başlamamış maç için geri sayım — kendi aralığını yönetir (30 sn), yalnız sayaç çizilir. */
function Countdown({ target }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  const ts = target ? new Date(target).getTime() : 0
  if (!ts) return null
  const diff = ts - now
  if (diff <= 0) return <span style={{ fontSize: yazi(10), color: FEXT.good, fontWeight: 700 }}>Başlıyor</span>
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const label = d > 0 ? `${d}g ${h}s` : h > 0 ? `${h}s ${m}dk` : `${m}dk`
  return (
    <span style={{ fontSize: yazi(10), color: 'var(--text-3)', fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Clock size={10} /> {label}
    </span>
  )
}

// ── Sekmeler: sayılı, kayan kapsül (Turnuvalar S/A geçişiyle aynı dil) ────
function Sekmeler({ aktif, sayilar, onSec }) {
  const i = Math.max(0, SEKMELER.findIndex(s => s.key === aktif))
  const canliAktif = aktif === 'live'
  return (
    <div role="tablist" aria-label="Maç durumu" style={{
      position: 'relative', display: 'inline-grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      borderRadius: 999, padding: 3, background: 'var(--surface-2)', border: '1px solid var(--line)',
      width: 'min(100%, 420px)',
    }}>
      {aktif && (
        <span aria-hidden="true" style={{
          position: 'absolute', top: 3, bottom: 3, left: 3,
          width: 'calc((100% - 6px) / 3)', borderRadius: 999,
          background: canliAktif ? FEXT.status.live.bg : FEXT.accentSoftBg,
          border: `1px solid ${canliAktif ? 'rgba(255,70,85,.45)' : FEXT.accentBorder}`,
          transform: `translateX(${i * 100}%)`,
          transition: 'transform .28s cubic-bezier(.2,.8,.3,1), background .2s, border-color .2s',
          pointerEvents: 'none',
        }} />
      )}
      {SEKMELER.map(s => {
        const secili = aktif === s.key
        const sayi = s.key === 'past' ? null : sayilar[s.key]
        const canli = s.key === 'live'
        return (
          <button
            key={s.key} type="button" role="tab" aria-selected={secili}
            onClick={() => onSec(s.key)}
            style={{
              position: 'relative', border: 'none', background: 'transparent', borderRadius: 999,
              minHeight: 38, padding: '8px 10px', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              fontSize: 13, fontWeight: 800, letterSpacing: '.2px',
              color: secili ? (canli ? 'var(--canli-fg)' : 'var(--accent-fg)') : 'var(--text-3)',
              transition: 'color .2s',
            }}
          >
            {canli && (
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: sayi ? FEXT.status.live.color : 'var(--text-5)',
                animation: sayi ? 'pulse 1.4s infinite' : 'none',
              }} />
            )}
            {s.label}
            {sayi != null && (
              <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {sayi.toLocaleString('tr-TR')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Kapsül düğme + altında açılan panel. Dışarı tıklama ve Esc kapatır. */
function Acilir({ etiket, Icon, aktif, children, genislik = 300, sag = false }) {
  const [acik, setAcik] = useState(false)
  const kutu = useRef(null)
  useEffect(() => {
    if (!acik) return undefined
    const disari = e => { if (!kutu.current?.contains(e.target)) setAcik(false) }
    const esc = e => { if (e.key === 'Escape') setAcik(false) }
    document.addEventListener('mousedown', disari)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', disari)
      document.removeEventListener('keydown', esc)
    }
  }, [acik])
  return (
    <div ref={kutu} style={{ position: 'relative' }}>
      <button type="button" aria-expanded={acik} aria-haspopup="dialog" onClick={() => setAcik(v => !v)} style={kapsulStil(aktif)}>
        {Icon && <Icon size={14} />}
        <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{etiket}</span>
        <ChevronDown size={14} style={{ transform: acik ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }} />
      </button>
      {acik && (
        <div role="dialog" aria-label={typeof etiket === 'string' ? etiket : undefined} style={{ ...panelStil, width: genislik, ...(sag ? { right: 0 } : { left: 0 }) }}>
          {children(() => setAcik(false))}
        </div>
      )}
    </div>
  )
}

function TurnuvaListesi({ gruplar, yukleniyor, secili, onSec }) {
  const [ara, setAra] = useState('')
  const toplam = (gruplar || []).reduce((n, g) => n + g.etkinlikler.length, 0)
  const q = ara.trim().toLocaleLowerCase('tr-TR')
  const suzulmus = useMemo(() => {
    if (!q) return gruplar || []
    return (gruplar || [])
      .map(g => ({ ...g, etkinlikler: g.etkinlikler.filter(e => e.ad.toLocaleLowerCase('tr-TR').includes(q) || e.asamalar.some(a => a.ad.toLocaleLowerCase('tr-TR').includes(q))) }))
      .filter(g => g.etkinlikler.length)
  }, [gruplar, q])

  if (yukleniyor || !gruplar) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 4 }} aria-hidden="true">
        {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 34, borderRadius: 9, background: 'var(--surface-2)', animation: 'pulse 1.4s ease-in-out infinite' }} />)}
      </div>
    )
  }
  if (!toplam) return <div style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-3)' }}>Bu görünümde turnuva yok.</div>

  return (
    <div>
      {toplam > 8 && (
        <div style={{ position: 'relative', margin: '2px 2px 6px' }}>
          <Search size={13} color="var(--text-4)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            value={ara} onChange={e => setAra(e.target.value)} placeholder="Turnuva ara" aria-label="Turnuva ara"
            style={{ width: '100%', boxSizing: 'border-box', height: 34, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, padding: '0 12px 0 30px', outline: 'none' }}
          />
        </div>
      )}
      <div style={{ maxHeight: 340, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <button type="button" onClick={() => onSec(null)} style={secenekStil(!secili)} {...hoverArkaPlan(!secili)}>
          Tüm turnuvalar
        </button>
        {suzulmus.map(g => (
          <div key={g.oyun} style={{ marginTop: 6 }}>
            <div lang="en" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 4px', fontSize: yazi(10), fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--text-4)' }}>
              <GameLogo game={g.oyun} size={12} color={GAME_COLORS[g.oyun] || 'currentColor'} />
              {GAME_SHORT_NAMES[g.oyun] ?? 'Diğer'}
            </div>
            {g.etkinlikler.map(e => {
              const eSecili = secili?.anahtar === e.anahtar
              const asamaliMi = e.asamalar.length > 1 || (e.asamalar[0] && e.asamalar[0].ad !== e.ad)
              return (
                <div key={e.anahtar}>
                  <button
                    type="button" lang={adDili(e.ad)}
                    onClick={() => onSec({ anahtar: e.anahtar, ids: e.asamalar.map(a => a.id), etiket: e.ad })}
                    style={secenekStil(eSecili)} {...hoverArkaPlan(eSecili)}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.ad}</span>
                    <span style={{ fontSize: yazi(11), color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>{e.sayi}</span>
                  </button>
                  {asamaliMi && e.asamalar.map(a => {
                    const aAnahtar = `${e.anahtar}#${a.id}`
                    const aSecili = secili?.anahtar === aAnahtar
                    return (
                      <button
                        key={a.id} type="button" lang={adDili(a.ad)}
                        onClick={() => onSec({ anahtar: aAnahtar, ids: [a.id], etiket: `${e.ad} · ${a.ad}` })}
                        style={{ ...secenekStil(aSecili), padding: '6px 10px 6px 26px', fontSize: 12, color: aSecili ? 'var(--accent-fg)' : 'var(--text-3)' }}
                        {...hoverArkaPlan(aSecili)}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.ad}</span>
                        <span style={{ fontSize: yazi(11), color: 'var(--text-5)', fontVariantNumeric: 'tabular-nums' }}>{a.sayi}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
        {!suzulmus.length && <div style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-3)' }}>Eşleşen turnuva yok.</div>}
      </div>
    </div>
  )
}

function TarihSecici({ tab, tarih, onSec }) {
  const [from, setFrom] = useState(tarih?.key === 'ozel' ? tarih.from || '' : '')
  const [to, setTo] = useState(tarih?.key === 'ozel' ? tarih.to || '' : '')
  const girdiStil = { flex: 1, minWidth: 0, height: 34, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 12, padding: '0 8px', outline: 'none', colorScheme: 'dark light' }
  return (
    <div>
      <button type="button" onClick={() => onSec(null)} style={secenekStil(!tarih)} {...hoverArkaPlan(!tarih)}>Tüm tarihler</button>
      {(TARIH_SECENEKLERI[tab] || []).map(o => {
        const secili = tarih?.key === o.key
        return <button key={o.key} type="button" onClick={() => onSec({ key: o.key })} style={secenekStil(secili)} {...hoverArkaPlan(secili)}>{o.label}</button>
      })}
      <div style={{ borderTop: '1px solid var(--line)', margin: '6px 4px 0', padding: '10px 6px 4px' }}>
        <div style={{ fontSize: yazi(11), fontWeight: 700, color: 'var(--text-4)', marginBottom: 6 }}>Özel aralık</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="date" aria-label="Başlangıç tarihi" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={girdiStil} />
          <span style={{ color: 'var(--text-4)', fontSize: 12 }}>–</span>
          <input type="date" aria-label="Bitiş tarihi" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={girdiStil} />
        </div>
        <button
          type="button" disabled={!from && !to}
          onClick={() => onSec({ key: 'ozel', from: from || null, to: to || null })}
          style={{ marginTop: 8, width: '100%', height: 34, borderRadius: 999, border: 'none', background: !from && !to ? 'var(--surface-2)' : FEXT.accent, color: !from && !to ? 'var(--text-5)' : '#fff', fontSize: 13, fontWeight: 700, cursor: !from && !to ? 'not-allowed' : 'pointer' }}
        >Uygula</button>
      </div>
    </div>
  )
}

function siralamaSecenekleri(tab) {
  return tab === 'past'
    ? [{ asc: false, label: 'En yeni önce' }, { asc: true, label: 'En eski önce' }]
    : [{ asc: true, label: 'En yakın önce' }, { asc: false, label: 'En uzak önce' }]
}

function SiralaSecici({ tab, artan, onSec }) {
  return siralamaSecenekleri(tab).map(o => {
    const secili = o.asc === artan
    return (
      <button key={String(o.asc)} type="button" onClick={() => onSec(o.asc)} style={secenekStil(secili)} {...hoverArkaPlan(secili)}>
        <span style={{ flex: 1 }}>{o.label}</span>
        {secili && <Check size={14} />}
      </button>
    )
  })
}

const TAKIP_IPUCU = 'Henüz takım takip etmiyorsun. Maç kartlarındaki yıldıza basınca takım takip edilir; maçları burada toplanır.'

/** Mobil: tüm filtreler alttan açılan panelde. Seçimler anında uygulanır.
 *  body'ye portal: <main>'in giriş animasyonu (transform) fixed konumu sayfanın dibine taşıyordu. */
function FiltrePaneli({ acik, onKapat, sonucSayisi, yukleniyor, children }) {
  useEffect(() => {
    if (!acik) return undefined
    const onceki = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = e => { if (e.key === 'Escape') onKapat() }
    document.addEventListener('keydown', esc)
    return () => {
      document.body.style.overflow = onceki
      document.removeEventListener('keydown', esc)
    }
  }, [acik, onKapat])
  if (!acik) return null
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
      <div onClick={onKapat} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)', animation: 'fadeIn .18s ease-out' }} />
      <div role="dialog" aria-modal="true" aria-label="Filtreler" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '84vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', borderRadius: '18px 18px 0 0', borderTop: '1px solid var(--line)',
        boxShadow: '0 -12px 32px var(--shadow)', animation: 'sheetUp .24s cubic-bezier(.2,.8,.3,1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>Filtreler</span>
          <button type="button" onClick={onKapat} aria-label="Kapat" style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 6, display: 'inline-flex' }}><XIcon size={20} /></button>
        </div>
        <div style={{ overflowY: 'auto', padding: '0 12px 12px', flex: 1 }}>
          {children}
        </div>
        <div style={{ padding: '10px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)' }}>
          <button type="button" onClick={onKapat} style={{ width: '100%', height: 44, borderRadius: 999, border: 'none', background: FEXT.accent, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            {yukleniyor ? 'Yükleniyor…' : sonucSayisi == null ? 'Maçları göster' : `${sonucSayisi.toLocaleString('tr-TR')} maçı göster`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PanelBolum({ baslik, children }) {
  return (
    <div style={{ padding: '10px 4px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontSize: yazi(11), fontWeight: 800, color: 'var(--text-4)', letterSpacing: '.4px', margin: '0 6px 6px' }}>{baslik}</div>
      {children}
    </div>
  )
}

/** Seçili filtre kapsülü (çarpıyla kaldırılır). */
function SeciliKapsul({ children, onKaldir, lang }) {
  return (
    <span lang={lang} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 4px 0 11px', borderRadius: 999,
      background: FEXT.accentSoftBg, border: `1px solid ${FEXT.accentBorder}`, color: 'var(--accent-fg)',
      fontSize: 12, fontWeight: 600, maxWidth: '100%',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      <button type="button" onClick={onKaldir} aria-label="Filtreyi kaldır" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 3, display: 'inline-flex', borderRadius: 999 }}>
        <XIcon size={13} />
      </button>
    </span>
  )
}

/** Yüklenirken yer tutan kartlar: yükseklik gerçek kartla aynı → liste gelince sayfa itilmez (CLS). */
function KartIskeleti({ adet = 6 }) {
  return (
    <div style={izgaraStil} aria-hidden="true">
      {Array.from({ length: adet }, (_, i) => (
        <div key={i} style={{ height: 252, borderRadius: 18, border: '1.5px solid var(--line)', background: 'var(--surface)', animation: 'pulse 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  )
}

const izgaraStil = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 16 }

function TakimTarafi({ match, taraf, takipte, onTakip }) {
  const takim = taraf === 'a' ? match.team_a : match.team_b
  const takimId = taraf === 'a' ? match.team_a_id : match.team_b_id
  const turk = isTurkishTeam(takim)
  const skorVar = (match.status === 'finished' || match.status === 'running') && match.team_a_score != null
  const cs = skorVar ? correctedScores(match) : null
  const skor = cs ? (taraf === 'a' ? cs.team_a_score : cs.team_b_score) : null
  const kazandi = match.status === 'finished' && match.winner_id != null && Number(match.winner_id) === Number(takimId)
  // Takım tarafı kendi linki (takım sayfası), kartın maç örtüsünün üstünde; yıldız linkin
  // dışında kardeş öğe (<a> içinde <button> olmasın).
  const Govde = takimId ? Link : 'div'
  return (
    <div style={{ ...UST_KATMAN, flex: 1, minWidth: 0, textAlign: 'center' }}>
      <button
        type="button"
        onClick={() => onTakip(takimId)}
        aria-label={`${takim?.name || 'Takım'} ${takipte ? 'takipten çık' : 'takip et'}`}
        aria-pressed={takipte}
        style={{ position: 'absolute', top: 0, [taraf === 'a' ? 'left' : 'right']: 2, background: 'none', border: 'none', cursor: 'pointer', padding: 2, minWidth: 24, minHeight: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Star size={15} fill={takipte ? '#FFD700' : 'none'} color={takipte ? '#FFD700' : 'var(--text-4)'} />
      </button>
      <Govde
        {...(takimId ? { to: `/team/${takimId}` } : {})}
        style={{ display: 'block', padding: '8px 4px', color: 'inherit', textDecoration: 'none', cursor: takimId ? 'pointer' : 'default' }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '.75' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
      >
      <InitialsImage
        src={takim?.logo_url}
        name={takim?.name ?? '?'}
        width={52} height={52}
        borderRadius={8}
        style={{ margin: '0 auto 8px' }}
        imgStyle={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }}
      />
      <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word', color: turk ? 'var(--tr-fg)' : 'var(--text-1)' }}>
        {takim?.name}
      </div>
      {skor != null && (
        <div style={{ fontSize: 22, fontWeight: 800, color: kazandi ? FEXT.good : 'var(--text-2)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          {match.status === 'running' ? <FlipNumber value={skor} /> : skor}
        </div>
      )}
      </Govde>
    </div>
  )
}

/** Bitmemiş maçın Fextopus çubuğu: ekrana girince %50/%50'den hedefe kayar (UX P2 A2). */
function KartOlasilikCubugu({ match, belirsiz }) {
  const hedef = Math.round(Number(match.prediction_team_a) * 100)
  const [ref, pA] = useAcilisGecisi(hedef)
  const a = Math.round(pA)
  return (
    <div ref={ref} style={{ marginBottom: 10 }}>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ width: `${pA}%`, height: '100%', background: belirsiz ? 'var(--track)' : 'linear-gradient(90deg,#667eea,#764ba2)' }} />
      </div>
      {belirsiz ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}><FextopusEtiketi belirsiz /></div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: yazi(10), color: 'var(--text-4)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ color: match.prediction_team_a >= match.prediction_team_b ? 'var(--indigo-fg)' : undefined }}>%{a}</span>
          <FextopusEtiketi />
          <span style={{ color: match.prediction_team_b > match.prediction_team_a ? 'var(--indigo-fg)' : undefined }}>%{100 - a}</span>
        </div>
      )}
    </div>
  )
}

function MacKarti({ match, gruplu, isTeamFollowed, onTakip }) {
  const statusBadge = statusStyle(match.status, match.scheduled_at)
  const isLive      = match.status === 'running'
  const bitti       = match.status === 'finished'
  const hasTurkish  = isTurkishTeam(match.team_a) || isTurkishTeam(match.team_b)
  const isHotPick   = !bitti && (match.prediction_confidence ?? 0) > 0.80
  const oyun        = oyunIdsi(match)
  const turnuvaAdi  = match.tournament ? tournamentDisplayName(match.tournament, { game: oyun }) : '—'
  const tahminVar   = match.prediction_team_a != null && match.prediction_team_b != null
  const predUncertain = tahminVar && isUncertainPrediction(match.prediction_team_a, match.prediction_team_b, match.prediction_confidence)
  const sonuc       = bitti ? fextopusSonucu(match) : null
  const bo          = getBOFormat(match.team_a_score, match.team_b_score, match.number_of_games)
  const tur         = roundLabel(match)
  // Canlı skor değişince kart 1 sn parlar (yalnız canlıyken; liste yenilemesi yeni kart açar, saymaz)
  const parlama     = useDegisimSayaci(isLive ? `${match.team_a_score}-${match.team_b_score}` : null, match.id)

  const kenar = isLive ? 'rgba(255,70,85,.6)' : isHotPick ? 'rgba(255,100,50,.5)' : hasTurkish ? 'rgba(224,69,94,.5)' : 'var(--line)'
  const golge = isLive ? '0 0 20px rgba(255,70,85,.2)' : isHotPick ? '0 0 14px rgba(255,100,50,.12)' : hasTurkish ? '0 0 14px rgba(224,69,94,.10)' : 'none'
  const rozet = { padding: '2px 8px', borderRadius: 6, fontSize: yazi(10), fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }

  return (
    <div
      style={{
        position: 'relative', borderRadius: 18, padding: '18px 18px 14px',
        background: 'var(--surface)', border: `1.5px solid ${kenar}`, boxShadow: golge,
        cursor: 'pointer',
        transition: 'transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, border-color .2s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform   = 'translateY(-5px) scale(1.012)'
        e.currentTarget.style.boxShadow   = '0 12px 32px rgba(194,92,208,.22)'
        e.currentTarget.style.borderColor = FEXT.accent
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform   = 'none'
        e.currentTarget.style.boxShadow   = golge
        e.currentTarget.style.borderColor = kenar
      }}
    >
      {/* Kartın tamamı maç linki; takım tarafları, yıldız ve "İzle" UST_KATMAN ile üstünde */}
      <KartOrtusu to={`/match/${match.id}`} label={`${match.team_a?.name ?? ''} - ${match.team_b?.name ?? ''} maç detayı`} />
      <SkorParlamasi n={parlama} radius={17} />
      {/* Üst satır */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          <span lang="en" style={{ ...rozet, padding: '2px 9px', textTransform: 'uppercase', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-4)' }}>
            <GameLogo game={oyun} size={11} color={GAME_COLORS[oyun] || 'currentColor'} />
            {gameDisplayName(match.game)}
          </span>
          {hasTurkish && <TurkishBadge compact />}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {bo && <span style={{ ...rozet, background: 'var(--hover)', border: '1px solid var(--line)', color: 'var(--text-4)' }}>{bo}</span>}
          {isHotPick && (
            <span style={{ ...rozet, fontWeight: 800, background: 'rgba(255,100,50,.2)', border: '1px solid rgba(255,100,50,.5)', color: '#ff8c42' }}>
              <Flame size={11} /> Sıcak
            </span>
          )}
          {/* Bitmemiş maçta oran rozeti; bitmişte oran alttaki tek satırda */}
          {tahminVar && !bitti && (
            predUncertain ? (
              <span style={{ ...rozet, background: 'var(--hover)', border: '1px solid var(--line-2)', color: 'var(--text-3)' }}>
                <Sparkles size={11} /> Başa baş
              </span>
            ) : (
              <span style={{ ...rozet, background: 'rgba(102,126,234,.2)', border: '1px solid rgba(102,126,234,.5)', color: 'var(--indigo-fg)' }}>
                <Sparkles size={11} /> %{Math.round(Math.max(match.prediction_team_a, match.prediction_team_b) * 100)}
              </span>
            )
          )}
          <span style={{ ...rozet, background: statusBadge.bg, border: `1px solid ${statusBadge.color}44`, color: statusBadge.fg, animation: isLive ? 'pulse 1.5s infinite' : 'none' }}>
            {statusBadge.text}
          </span>
        </div>
      </div>

      {/* Takımlar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <TakimTarafi match={match} taraf="a" takipte={isTeamFollowed(match.team_a_id)} onTakip={onTakip} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: yazi(11), fontWeight: 800, color: FEXT.accentText, letterSpacing: '2px' }}>VS</span>
          <div style={{ width: 1, height: 24, background: 'var(--line)' }} />
          {match.status === 'not_started' && <Countdown target={matchTimeIso(match)} />}
        </div>
        <TakimTarafi match={match} taraf="b" takipte={isTeamFollowed(match.team_b_id)} onTakip={onTakip} />
      </div>

      {/* Fextopus: bitmemişte olasılık çubuğu, bitmişte "bildi / yanıldı" */}
      {tahminVar && !bitti && <KartOlasilikCubugu match={match} belirsiz={predUncertain} />}
      {sonuc && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, padding: '6px 10px', borderRadius: 10, background: 'var(--surface-2)', fontSize: yazi(11) }}>
          <span style={{ color: 'var(--text-3)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Sparkles size={11} color="#818cf8" style={{ flexShrink: 0 }} />
            {sonuc.belirsiz ? 'Fextopus başa baş gördü' : <>Fextopus: <b style={{ color: 'var(--text-2)' }}>{sonuc.favoriAd}</b> %{sonuc.oran}</>}
          </span>
          {!sonuc.belirsiz && (
            <Damga style={{ flexShrink: 0 }}>
              <span style={{
                ...rozet, fontWeight: 800,
                background: sonuc.bildi ? 'rgba(70,182,88,.14)' : 'rgba(255,70,85,.12)',
                border: `1px solid ${sonuc.bildi ? 'rgba(70,182,88,.45)' : 'rgba(255,70,85,.4)'}`,
                color: sonuc.bildi ? 'var(--success-fg)' : 'var(--danger-fg)',
              }}>
                {sonuc.bildi ? <><Check size={11} /> Bildi</> : <><XIcon size={11} /> Yanıldı</>}
              </span>
            </Damga>
          )}
        </div>
      )}

      {/* Alt satır */}
      {/* Ad sığmazsa aşama/yayın çipleri alt satıra iner ("IEM Beijin…" kesilmesin); ad ancak tüm satırı aşarsa kısalır */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--surface-2)', paddingTop: 10, gap: '6px 8px' }}>
        <div title={turnuvaAdi} style={{ fontSize: yazi(11), color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: 0, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Trophy size={12} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{turnuvaAdi}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
          {tur && (
            <span style={{ fontSize: yazi(10), fontWeight: 700, color: FEXT.accentText, background: FEXT.accentSoftBg, border: `1px solid ${FEXT.accentBorder}`, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{tur}</span>
          )}
          {match.stream_url && !bitti && (
            <a
              href={match.stream_url} target="_blank" rel="noopener noreferrer"
              style={{ ...UST_KATMAN, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: yazi(10), fontWeight: 700, color: 'var(--ai)', background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.35)', borderRadius: 6, padding: '2px 8px', textDecoration: 'none' }}
            >
              <Play size={10} fill="currentColor" /> İzle
            </a>
          )}
          <div style={{ fontSize: yazi(11), fontWeight: 600, color: isLive ? 'var(--canli-fg)' : 'var(--yesil-fg)', background: isLive ? 'rgba(255,70,85,.1)' : 'rgba(70,182,88,.1)', padding: '2px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 5, fontVariantNumeric: 'tabular-nums' }}>
            {isLive
              ? <><span style={{ width: 6, height: 6, borderRadius: '50%', background: FEXT.danger, animation: 'pulse 1.4s infinite' }} /> CANLI</>
              : gruplu
                ? saatYaz(matchTimeIso(match))
                : new Date(matchTimeIso(match) || 0).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Matches() {
  const turkTakimlar = useTurkTakimlar()  // Türk takımı listesi yüklenince yeniden çiz
  const { activeGame } = useGame()
  // Takip = site geneli takip sistemi (DB); herhangi bir yerde takip edilen takım burada da sayılır.
  const { followedTeamIds, toggleTeamFollow, isTeamFollowed } = useUser()
  const [searchParams, setSearchParams] = useSearchParams()   // /matches?tab=past&q=Fnatic&turk=1&takip=1
  const darEkran = useDarEkran()
  const canliBagli = useCanliBaglanti()

  // URL'de sekme yoksa sayaçlar gelince seçilir: canlı maç varsa Canlı, yoksa Yaklaşan.
  const urlSekme = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(() => (SEKMELER.some(s => s.key === urlSekme) ? urlSekme : null))
  const [sekmeElle, setSekmeElle] = useState(() => SEKMELER.some(s => s.key === urlSekme))
  const [searchQuery, setSearchQuery]         = useState(() => searchParams.get('q') || '')
  const [debouncedSearch, setDebouncedSearch] = useState(() => aramaTemizle(searchParams.get('q')))
  const [aramaSonucu, setAramaSonucu]         = useState(null)   // { q, teamIds, tourIds }
  const [siralama, setSiralama]               = useState(null)   // null = sekmenin varsayılanı
  const [tarih, setTarih]                     = useState(null)   // null | { key, from?, to? }
  const [turnuva, setTurnuva]                 = useState(null)   // null | { anahtar, ids, etiket }
  const [takip, setTakip]                     = useState(() => searchParams.get('takip') === '1')
  const [turk, setTurk]                       = useState(() => searchParams.get('turk') === '1')
  const [turkHazir, setTurkHazir]             = useState(false)
  const [takipIpucu, setTakipIpucu]           = useState(false)
  const [panelAcik, setPanelAcik]             = useState(false)

  const [matches, setMatches]       = useState([])
  const [totalCount, setTotalCount] = useState(null)   // null: sayım henüz gelmedi
  const [sonSayfaDolu, setSonSayfaDolu] = useState(false) // sayım gelene dek "Daha fazla" ipucu
  const [yukleniyor, setYukleniyor] = useState('yeni')   // 'yeni' | 'daha' | null
  const [error, setError]           = useState(null)
  const [sayilar, setSayilar]       = useState({ live: null, upcoming: null })
  const [gameNames, setGameNames]   = useState(null)       // DB'deki oyun kayıtları (mükerrer id'ler)
  const [turnuvaSatirlari, setTurnuvaSatirlari] = useState({ anahtar: null, gruplar: null })

  const artan = siralama ?? (activeTab !== 'past')
  const takipEtkin = takip && followedTeamIds.length > 0

  // Arama girdisini debounce et (sunucu sorgusu için)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(aramaTemizle(searchQuery)), 350)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Arama → takım ve turnuva id'leri (tüm arşivde; turnuvada lig/etkinlik adı da)
  useEffect(() => {
    if (!debouncedSearch) return undefined
    let iptal = false
    const like = `%${debouncedSearch}%`
    Promise.all([
      supabase.from('teams').select('id').ilike('name', like).limit(80),
      supabase.from('tournaments').select('id').or(`name.ilike.${like},league_name.ilike.${like},event_name.ilike.${like}`).limit(150),
    ]).then(([teamsRes, toursRes]) => {
      if (iptal) return
      if (teamsRes.error) console.error('Maç araması (takım):', teamsRes.error)
      if (toursRes.error) console.error('Maç araması (turnuva):', toursRes.error)
      setAramaSonucu({
        q: debouncedSearch,
        teamIds: (teamsRes.data || []).map(t => t.id),
        tourIds: (toursRes.data || []).map(t => t.id),
      })
    })
    return () => { iptal = true }
  }, [debouncedSearch])

  // Oyun kayıtlarını bir kez çek (oyun filtresi mükerrer id'leri .in ile kapsasın)
  useEffect(() => {
    let iptal = false
    supabase.from('games').select('id, name, slug').then(({ data, error: e }) => {
      if (e) console.error('games okunamadı:', e)
      if (!iptal) setGameNames(data || [])
    })
    return () => { iptal = true }
  }, [])

  useEffect(() => {
    let iptal = false
    turkTakimlariYukle().then(() => { if (!iptal) setTurkHazir(true) })
    return () => { iptal = true }
  }, [])

  // ── Filtre bağlamı ve anahtarlar ──────────────────────────────────────
  const oyunHazir = activeGame === 'all' || gameNames != null
  const aramaHazir = !debouncedSearch || aramaSonucu?.q === debouncedSearch
  const hazir = oyunHazir && aramaHazir && (!turk || turkHazir)

  const filtre = useMemo(() => ({
    gameIds: activeGame === 'all' ? null : resolveGameIds(activeGame, gameNames || []),
    arama: debouncedSearch && aramaSonucu?.q === debouncedSearch ? aramaSonucu : null,
    takipIdleri: takipEtkin ? followedTeamIds : null,
    turkIdleri: turk ? turkTakimlar.map(t => t.id) : null,
  }), [activeGame, gameNames, debouncedSearch, aramaSonucu, takipEtkin, followedTeamIds, turk, turkTakimlar])

  const ortakAnahtar = JSON.stringify(filtre)
  const listeAnahtari = JSON.stringify([ortakAnahtar, activeTab, artan, tarih, turnuva?.ids])

  // ── Veri: sayaçlar ────────────────────────────────────────────────────
  const sayiIstekNo = useRef(0)
  async function sayilariGetir() {
    if (!hazir) return
    const no = ++sayiIstekNo.current
    const simdiIso = new Date().toISOString()
    const say = tab => ortakFiltre(sekmeFiltresi(supabase.from('matches').select('id', { count: 'exact', head: true }), tab, simdiIso), filtre)
    const [c, y] = await Promise.all([say('live'), say('upcoming')])
    if (no !== sayiIstekNo.current) return
    if (c.error || y.error) {
      console.error('Maç sayaçları:', c.error || y.error)
      setSayilar(s => (s.live == null ? { live: 0, upcoming: 0 } : s))
      return
    }
    setSayilar({ live: c.count ?? 0, upcoming: y.count ?? 0 })
  }

  // ── Veri: liste ───────────────────────────────────────────────────────
  // mod: 'yeni' (filtre değişti, baştan) | 'daha' (sonraki 50) | 'sessiz' (arka planda tazele)
  const istekNo = useRef(0)
  const sayimIstekNo = useRef(0)
  const maclarRef = useRef(matches)
  useEffect(() => { maclarRef.current = matches }, [matches])

  async function maclariGetir(mod = 'yeni') {
    if (!hazir || !activeTab) return
    const no = ++istekNo.current
    const mevcut = maclarRef.current.length
    const from = mod === 'daha' ? mevcut : 0
    const to = mod === 'daha' ? mevcut + PAGE_SIZE - 1 : mod === 'sessiz' ? Math.max(mevcut, PAGE_SIZE) - 1 : PAGE_SIZE - 1
    if (mod !== 'sessiz') setYukleniyor(mod)
    if (mod === 'yeni') setError(null)
    const simdiIso = new Date().toISOString()
    const suz = q => {
      q = sekmeFiltresi(q, activeTab, simdiIso)
      if (activeTab !== 'live') q = tarihFiltresi(q, tarihAraligi(tarih, activeTab))
      if (turnuva?.ids?.length) q = q.in('tournament_id', turnuva.ids)
      return ortakFiltre(q, filtre)
    }
    // Toplam sayı ayrı istekte: Geçmiş'te ~40 bin satırlık count(*) önbellek soğukken saniyeler
    // sürüp listeyi de bekletiyordu (UX P3, ilk açılış ~8 sn; liste sorgusu ~3 ms). Liste önce çizilir.
    if (mod !== 'daha') {
      const sayimNo = ++sayimIstekNo.current
      if (mod === 'yeni') setTotalCount(null)
      suz(supabase.from('matches').select('id', { count: 'exact', head: true })).then(({ count, error: e }) => {
        if (sayimNo !== sayimIstekNo.current) return
        if (e) { console.error('Maç sayısı alınamadı:', e); return }
        setTotalCount(count ?? 0)
      })
    }
    try {
      const q = suz(supabase.from('matches').select(MAC_SELECT))
        .order('scheduled_at', { ascending: artan }).order('id', { ascending: artan }).range(from, to)
      const { data, error: e } = await q
      if (no !== istekNo.current) return
      if (e) throw e
      const gelen = data || []
      setMatches(prev => {
        if (mod !== 'daha') return gelen
        const var_ = new Set(prev.map(m => m.id))
        return [...prev, ...gelen.filter(m => !var_.has(m.id))]
      })
      if (mod !== 'sessiz') setSonSayfaDolu(gelen.length >= (to - from + 1))
    } catch (err) {
      if (no !== istekNo.current) return
      console.error('Maçlar alınamadı:', err)
      if (mod !== 'sessiz') setError('Maçlar alınamadı')
    } finally {
      if (no === istekNo.current && mod !== 'sessiz') setYukleniyor(null)
    }
  }

  // Son sürümlere ref ile eriş (Realtime ve yenileme kapanışları bayatlamasın)
  const getirRef = useRef({ maclariGetir, sayilariGetir, activeTab })
  useEffect(() => { getirRef.current = { maclariGetir, sayilariGetir, activeTab } })

  useEffect(() => { sayilariGetir() }, [ortakAnahtar, hazir])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { maclariGetir('yeni') }, [listeAnahtari, hazir])  // eslint-disable-line react-hooks/exhaustive-deps

  // Sekme otomatik: canlı maç varsa Canlı, yoksa Yaklaşan
  useEffect(() => {
    if (activeTab || sayilar.live == null) return
    setActiveTab(sayilar.live > 0 ? 'live' : 'upcoming')
  }, [activeTab, sayilar.live])

  // URL'yi filtrelerle eş tut (paylaşılabilir; geri tuşu geçmişini kirletmez)
  useEffect(() => {
    const p = new URLSearchParams(searchParams)
    const yaz = (k, v) => { if (v) p.set(k, v); else p.delete(k) }
    yaz('tab', sekmeElle ? activeTab : null)
    yaz('q', debouncedSearch)
    yaz('turk', turk ? '1' : null)
    yaz('takip', takip ? '1' : null)
    if (p.toString() !== searchParams.toString()) setSearchParams(p, { replace: true })
  }, [activeTab, sekmeElle, debouncedSearch, turk, takip])  // eslint-disable-line react-hooks/exhaustive-deps

  // Canlı veri: tek ortak `maclar` kanalı. Skor yerinde güncellenir; durum değişince
  // (başladı/bitti) sayaçlar ve liste birkaç saniye sonra sessizce tazelenir.
  useEffect(() => {
    let zamanlayici = null
    const tazelePlanla = () => {
      clearTimeout(zamanlayici)
      zamanlayici = setTimeout(() => {
        const g = getirRef.current
        g.sayilariGetir()
        if (g.activeTab !== 'past') g.maclariGetir('sessiz')
      }, 4000)
    }
    const unsub = subscribeToMatchesUpdates(payload => {
      if (payload?.eventType === 'RESYNC') { tazelePlanla(); return }
      const yeni = payload?.new
      if (!yeni?.id) return
      const tab = getirRef.current.activeTab
      const durum = String(yeni.status || '').toLowerCase()
      const eskiDurum = payload?.old?.status != null ? String(payload.old.status).toLowerCase() : null
      const sekmede = tab === 'live' ? durum === 'running' : tab === 'upcoming' ? durum === 'not_started' : durum === 'finished'
      if (sekmede) {
        // Takım/turnuva nesneleri korunur; yayın satırı yalnız düz alanları taşır
        setMatches(prev => prev.some(m => m.id === yeni.id) ? prev.map(m => m.id === yeni.id ? { ...m, ...yeni } : m) : prev)
      } else {
        setMatches(prev => prev.filter(m => m.id !== yeni.id))
      }
      if (eskiDurum !== durum) tazelePlanla()
    })
    return () => { clearTimeout(zamanlayici); unsub() }
  }, [])

  // Sessiz arka plan yenilemesi (gizli sekmede durur). Geçmiş listesi sık değişmez → yalnız sayaçlar.
  useYenileme(() => {
    sayilariGetir()
    if (activeTab !== 'past') maclariGetir('sessiz')
  }, SESSIZ_YENILEME_MS, hazir && !!activeTab)

  // Turnuva seçenekleri: açılır liste açılınca yüklenir (sekme + ortak filtre + tarih kapsamında)
  const turnuvaAnahtari = JSON.stringify([ortakAnahtar, activeTab, tarih])
  async function turnuvalariYukle() {
    if (!hazir || !activeTab || turnuvaSatirlari.anahtar === turnuvaAnahtari) return
    const anahtar = turnuvaAnahtari
    setTurnuvaSatirlari({ anahtar, gruplar: null })
    let q = supabase.from('matches').select('tournament_id, tournament:tournaments(id, name, tier, league_name, event_name, display_name, region), game:games(slug, name)')
    q = sekmeFiltresi(q, activeTab, new Date().toISOString())
    if (activeTab !== 'live') {
      // Geçmişte tarih seçilmemişse son 14 gün (tüm arşivin turnuvaları listeyi boğar)
      const aralik = tarihAraligi(tarih, activeTab)
      q = tarihFiltresi(q, activeTab === 'past' && !tarih ? { from: gunEkle(gunBasi(), -13), to: null } : aralik)
    }
    q = ortakFiltre(q, filtre).order('scheduled_at', { ascending: activeTab !== 'past' }).limit(1000)
    const { data, error: e } = await q
    if (e) console.error('Turnuva seçenekleri:', e)
    setTurnuvaSatirlari(s => (s.anahtar === anahtar ? { anahtar, gruplar: turnuvaGruplari(data || []) } : s))
  }

  // ── Eylemler ──────────────────────────────────────────────────────────
  function sekmeSec(key) {
    if (key === activeTab) return
    setSekmeElle(true)
    setActiveTab(key)
    setSiralama(null)
    setTarih(null)       // tarih seçenekleri sekmeye göre değişir
    setTurnuva(null)     // turnuva seçenekleri de
    setMatches([])
    setTotalCount(0)
  }

  function takipDegistir() {
    if (!followedTeamIds.length) { setTakipIpucu(v => !v); return }
    setTakip(v => !v)
  }

  function filtreleriTemizle() {
    setTarih(null); setTurnuva(null); setTakip(false); setTurk(false); setSiralama(null)
    setSearchQuery(''); setTakipIpucu(false)
  }

  const tarihYazi = activeTab !== 'live' ? tarihEtiketi(tarih, activeTab) : null
  const seciliFiltreler = [
    turnuva && { k: 'turnuva', etiket: turnuva.etiket, lang: adDili(turnuva.etiket), kaldir: () => setTurnuva(null) },
    tarihYazi && { k: 'tarih', etiket: tarihYazi, kaldir: () => setTarih(null) },
    takipEtkin && { k: 'takip', etiket: 'Takip ettiklerim', kaldir: () => setTakip(false) },
    turk && { k: 'turk', etiket: 'Türk takımları', kaldir: () => setTurk(false) },
  ].filter(Boolean)
  const filtreVar = seciliFiltreler.length > 0 || !!debouncedSearch

  const gruplar = useMemo(
    () => (activeTab === 'live' ? [{ anahtar: 'canli', baslik: null, maclar: matches }] : gunlereBol(matches)),
    [matches, activeTab],
  )

  const ilkYukleme = (yukleniyor === 'yeni' && matches.length === 0) || !activeTab || !hazir
  const sonucYazi = totalCount == null ? '' : `${totalCount.toLocaleString('tr-TR')} maç`
  const dahaVar = totalCount == null ? sonSayfaDolu : matches.length < totalCount

  // ── Filtre parçaları (masaüstü açılır + mobil panel ortak) ────────────
  const turnuvaListesi = kapat => (
    <TurnuvaListesi
      gruplar={turnuvaSatirlari.anahtar === turnuvaAnahtari ? turnuvaSatirlari.gruplar : null}
      yukleniyor={turnuvaSatirlari.anahtar === turnuvaAnahtari && !turnuvaSatirlari.gruplar}
      secili={turnuva}
      onSec={v => { setTurnuva(v); kapat?.() }}
    />
  )
  const takipKapsulu = (
    <button type="button" onClick={takipDegistir} aria-pressed={takipEtkin} style={kapsulStil(takipEtkin)}>
      <Star size={14} fill={takipEtkin ? '#FFD700' : 'none'} color={takipEtkin ? '#FFD700' : 'currentColor'} />
      Takip ettiklerim
      {followedTeamIds.length > 0 && <span style={{ fontSize: yazi(11), opacity: 0.75 }}>{followedTeamIds.length}</span>}
    </button>
  )
  const turkKapsulu = (
    <button type="button" onClick={() => setTurk(v => !v)} aria-pressed={turk} style={kapsulStil(turk)}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: '#E0455E' }} />
      Türk takımları
    </button>
  )
  const takipIpucuKutusu = takipIpucu && !followedTeamIds.length && (
    <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: 520, margin: '10px auto 0', padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
      <Star size={15} color="#FFD700" style={{ flexShrink: 0, marginTop: 2 }} />
      <span style={{ flex: 1 }}>{TAKIP_IPUCU}</span>
      <button type="button" onClick={() => setTakipIpucu(false)} aria-label="Kapat" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', padding: 0, display: 'inline-flex' }}><XIcon size={14} /></button>
    </div>
  )

  const aramaKutusu = (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, maxWidth: darEkran ? 'none' : 340 }}>
      <Search size={15} color="var(--text-4)" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      <input
        type="search" placeholder="Takım veya turnuva ara" aria-label="Takım veya turnuva ara"
        value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
        style={{ width: '100%', height: 36, padding: '0 34px 0 36px', borderRadius: 999, border: `1px solid ${searchQuery ? FEXT.accentBorder : 'var(--line)'}`, background: 'var(--surface)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
      />
      {searchQuery && (
        <button type="button" onClick={() => setSearchQuery('')} aria-label="Aramayı temizle" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'inline-flex', padding: 3 }}><XIcon size={15} /></button>
      )}
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: darEkran ? '18px 16px' : '24px 20px', maxWidth: '1440px', margin: '0 auto' }}>
      <SeoHead
        title="Maçlar: canlı skorlar ve fikstür"
        description="VALORANT, CS2 ve League of Legends maçları: canlı skorlar, yaklaşan fikstür, geçmiş sonuçlar ve Fextopus tahminleri."
        type="website"
      />

      {/* Başlık */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: darEkran ? 24 : 28, fontWeight: 800, margin: '0 0 6px', display: 'inline-flex', alignItems: 'center', gap: 10 }}><CalendarDays size={darEkran ? 22 : 26} color={FEXT.accent} /> Maçlar</h1>
        <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
          Tüm espor maçları: canlı, yaklaşan ve geçmiş
        </p>
      </div>

      {/* Satır 1: sekmeler */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
        <Sekmeler aktif={activeTab} sayilar={sayilar} onSec={sekmeSec} />
      </div>

      {/* Satır 2: arama + filtreler */}
      {darEkran ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {aramaKutusu}
          <button type="button" onClick={() => { setPanelAcik(true); turnuvalariYukle() }} style={{ ...kapsulStil(seciliFiltreler.length > 0), flexShrink: 0 }}>
            <SlidersHorizontal size={14} /> Filtreler{seciliFiltreler.length > 0 ? ` (${seciliFiltreler.length})` : ''}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
          {aramaKutusu}
          <div onClickCapture={turnuvalariYukle}>
            <Acilir etiket="Turnuva" Icon={Trophy} aktif={!!turnuva} genislik={340}>
              {turnuvaListesi}
            </Acilir>
          </div>
          {activeTab !== 'live' && (
            <Acilir etiket="Tarih" Icon={CalendarDays} aktif={!!tarihYazi} genislik={280}>
              {kapat => <TarihSecici tab={activeTab} tarih={tarih} onSec={v => { setTarih(v); kapat() }} />}
            </Acilir>
          )}
          {takipKapsulu}
          {turkKapsulu}
          {activeTab !== 'live' && (
            <Acilir etiket={siralamaSecenekleri(activeTab).find(o => o.asc === artan)?.label ?? 'Sırala'} Icon={ArrowUpDown} aktif={siralama != null} genislik={220} sag>
              {kapat => <SiralaSecici tab={activeTab} artan={artan} onSec={v => { setSiralama(v); kapat() }} />}
            </Acilir>
          )}
        </div>
      )}
      {takipIpucuKutusu}

      {/* Seçili filtreler + sonuç sayısı + canlılık */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, margin: '12px 0 18px', minHeight: 28 }}>
        {seciliFiltreler.map(f => <SeciliKapsul key={f.k} lang={f.lang} onKaldir={f.kaldir}>{f.etiket}</SeciliKapsul>)}
        {filtreVar && (
          <button type="button" onClick={filtreleriTemizle} style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, padding: '4px 6px' }}>
            Filtreleri temizle
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-4)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {!ilkYukleme && sonucYazi}
          {canliBagli && activeTab !== 'past' && (
            <>
              {!ilkYukleme && sonucYazi && <span aria-hidden="true">·</span>}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: FEXT.good, animation: 'pulse 2s infinite' }} />
                canlı güncelleniyor
              </span>
            </>
          )}
        </span>
      </div>

      {/* Liste */}
      {error ? (
        <div role="alert" style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--danger-fg)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}><TriangleAlert size={18} /> Maçlar alınamadı</div>
          <div style={{ marginTop: 14 }}>
            <button type="button" onClick={() => maclariGetir('yeni')} style={{ ...kapsulStil(false), margin: '0 auto' }}>Tekrar dene</button>
          </div>
        </div>
      ) : ilkYukleme ? (
        <KartIskeleti adet={6} />
      ) : matches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 16px', color: 'var(--text-4)' }}>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Mascot size={88} dim /></div>
          <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-3)' }}>
            {filtreVar ? 'Bu filtrelerle maç yok' : activeTab === 'live' ? 'Şu an canlı maç yok' : 'Maç bulunamadı'}
          </h2>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
            {filtreVar && <button type="button" onClick={filtreleriTemizle} style={kapsulStil(false)}>Filtreleri temizle</button>}
            {activeTab === 'live' && sayilar.upcoming > 0 && (
              <button type="button" onClick={() => sekmeSec('upcoming')} style={kapsulStil(true)}>Yaklaşan maçlar ({sayilar.upcoming.toLocaleString('tr-TR')})</button>
            )}
          </div>
        </div>
      ) : (
        <div className="content-in" style={{ opacity: yukleniyor === 'yeni' ? 0.55 : 1, transition: 'opacity .2s' }}>
          {gruplar.map(g => (
            <section key={g.anahtar} style={{ marginBottom: 24 }} aria-label={g.baslik || 'Canlı maçlar'}>
              {g.baslik && (
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px', fontSize: 14, fontWeight: 800, color: 'var(--text-2)' }}>
                  {g.baslik}
                  <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                </h2>
              )}
              <div style={izgaraStil}>
                {g.maclar.map(match => (
                  <MacKarti
                    key={match.id} match={match} gruplu={!!g.baslik}
                    isTeamFollowed={isTeamFollowed} onTakip={toggleTeamFollow}
                  />
                ))}
              </div>
            </section>
          ))}

          {dahaVar && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <button
                type="button" onClick={() => maclariGetir('daha')} disabled={yukleniyor === 'daha'}
                style={{ ...kapsulStil(false), height: 42, padding: '0 22px', fontWeight: 700, cursor: yukleniyor === 'daha' ? 'wait' : 'pointer' }}
              >
                {yukleniyor === 'daha' && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />}
                Daha fazla yükle
              </button>
              <span style={{ fontSize: yazi(11), color: 'var(--text-5)' }}>
                {matches.length.toLocaleString('tr-TR')}{totalCount != null && ` / ${totalCount.toLocaleString('tr-TR')}`} maç gösteriliyor
              </span>
            </div>
          )}
        </div>
      )}

      {/* Mobil filtre paneli */}
      <FiltrePaneli acik={panelAcik && darEkran} onKapat={() => setPanelAcik(false)} sonucSayisi={totalCount} yukleniyor={yukleniyor === 'yeni'}>
        <PanelBolum baslik="Göster">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 4px' }}>
            {takipKapsulu}
            {turkKapsulu}
          </div>
          {takipIpucu && !followedTeamIds.length && <div style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 6px 0', lineHeight: 1.5 }}>{TAKIP_IPUCU}</div>}
        </PanelBolum>
        {activeTab !== 'live' && (
          <PanelBolum baslik="Tarih">
            <TarihSecici tab={activeTab} tarih={tarih} onSec={setTarih} />
          </PanelBolum>
        )}
        <PanelBolum baslik="Turnuva">
          {turnuvaListesi()}
        </PanelBolum>
        {activeTab !== 'live' && (
          <PanelBolum baslik="Sırala">
            <SiralaSecici tab={activeTab} artan={artan} onSec={setSiralama} />
          </PanelBolum>
        )}
      </FiltrePaneli>

      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes sheetUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @media (prefers-reduced-motion: reduce) { [role="dialog"] { animation: none !important } }
      `}</style>
    </div>
  )
}

export default Matches
