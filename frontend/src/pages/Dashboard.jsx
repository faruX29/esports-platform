/**
 * Dashboard.jsx — Bento Grid Layout
 * Ticker → Live Grid → Son Sonuçlar → Maç Programı → Takip Ettiklerim → Quick Links
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ondalik, yuzde } from '../utils/dil'
import { Link }                             from 'react-router-dom'
import { supabase, subscribeToMatchesUpdates } from '../supabaseClient'
import { useYenileme, useCanliBaglanti }     from '../hooks/useYenileme'
import { anaSayfaAkisiniGetir }             from '../utils/anaSayfaAkisi'
import { useGame, gameMatchesFilter, GAMES } from '../context/GameContext'
import { isTurkishTeam, useTurkTakimlar }       from '../constants'
import { useUser }                          from '../context/UserContext'
import { useAuth }                          from '../context/AuthContext'
import BRANDING                             from '../branding.config'
import { Radio, Flag, CalendarDays, Sparkles, Zap, SlidersHorizontal, Clock, CircleCheck, Shield, Trophy, FlaskConical, Newspaper, Star, TriangleAlert, Play, ChevronRight } from 'lucide-react'
import { buildNewsSlug }                   from '../utils/newsSlug'
import { calculatePredictionAccuracy } from '../utils/accuracyTracker'
import { memo }                             from 'react'
import InitialsImage                        from '../components/InitialsImage'
import DragScroll                          from '../components/DragScroll'
import TrBadge                              from '../components/TrBadge'
import TurkishBadge                          from '../components/TurkishBadge'
import { normalizeGameId }                  from '../utils/gameUtils'
import { tournamentDisplayName }            from '../utils/tournamentDisplay'
import { getBOFormat }                       from '../utils/matchFormat'
import { FEXT, statusStyle, SAATI_GECTI_ESIGI_MS, yazi } from '../theme'
import { correctedScores }                   from '../utils/matchResult'
import { isUncertainPrediction }             from '../utils/prediction'
import { KartLink, KartOrtusu, UST_KATMAN }  from '../components/KartLink'
import PredictionAccuracyBadge              from '../components/PredictionAccuracyBadge'
import { CountUp, FlipNumber }              from '../components/AnimatedNumber'
import { Asansor, MobilAsansor, useAsansor, ASANSOR_SUTUN } from '../components/Asansor'
import { izleEtiketi }                      from '../utils/yayin'
import { Sirayla }                         from '../components/Animasyon'
import FextopusEtiketi                      from '../components/FextopusEtiketi'
import FextopusIcon                         from '../components/FextopusIcon'

/** Satırlarda turnuva adı: yalnız aşama ("Regular Season") değil lig + etkinlik.
 *  Dar yerde aşamasız (withStage=false), tam ad title'da. */
function turnuvaAdi(m, withStage = true) {
  if (!m?.tournament) return ''
  return tournamentDisplayName(m.tournament, { withStage, game: normalizeGameId(m.game?.slug ?? m.game?.name) })
}

const MVP_HIDE_DREAM_TEAM = true
const MVP_HIDE_PREDICTIONS = false
const DASHBOARD_TICKER_CACHE_KEY = 'dashboard_live_ticker_cache_v2'
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000
const DASHBOARD_PREF_WIZARD_SEEN_KEY = 'dashboard_pref_wizard_seen_v1'
// Tam akış yenileme: canlı kanal bağlıyken seyrek (skor yayınla gelir), değilse dakikada bir.
const DASHBOARD_YENILEME_CANLI_MS = 5 * 60 * 1000
const DASHBOARD_YENILEME_YEDEK_MS = 60 * 1000
// Yayındaki ardışık yapısal olayları (maç bitti/başladı) tek yenilemede topla.
const DASHBOARD_YAYIN_TOPLAMA_MS = 4 * 1000
// get_home_feed (ana_sayfa_akisi.sql) ve yedek sorgular (anaSayfaAkisi.js) ile aynı sınırlar
const AKIS_YAKLASAN_SINIRI = 30
const AKIS_BITEN_SINIRI = 100
const DASHBOARD_GLOBAL_ERROR_TEXT = 'Sunucuyla bağlantı kesildi, tekrar deneniyor...'
const POPULAR_TEAM_SEARCH_TERMS = ['galatasaray', 'eternal fire', 'fut', 'bbl', 'fenerbahce', 'sangal', 'g2', 'fnatic', 'navi']
const PREFERENCE_GAMES = GAMES.filter(game => ['valorant', 'cs2', 'lol'].includes(game.id))
const UPCOMING_WINDOW_DAYS = 7
// Bölüm başlığındaki "Tümü →": dokunma alanı ≥24 px, negatif kenar boşluğu satırı büyütmesin diye
const TUMU_LINK = {
  fontSize: yazi(10), color: 'var(--text-5)', textDecoration: 'none',
  display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '0 6px', margin: '-6px -6px',
}
// Canlı bölümde en fazla bu kadar kart/satır; kalanı "Tüm canlı maçlar (N)" linkinde
const CANLI_GOSTER = 4

/* ── FormStrip ────────────────────────────────────────────────────────────── */
function FormStrip({ form, className }) {
  if (!form?.length) return null
  return (
    // UX P2 A10: rozetler soldan sağa sırayla belirir
    <Sirayla className={className} style={{ display: 'flex', gap: 2, marginTop: 3 }}>
      {form.map((r, i) => (
        <span key={i} title={r === 'W' ? 'Galibiyet' : 'Mağlubiyet'} style={{
          width: 13, height: 13, borderRadius: 3, flexShrink: 0,
          background: r === 'W' ? 'rgba(76,175,80,.85)' : 'rgba(255,70,85,.75)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: yazi(7), fontWeight: 900, color: '#fff', letterSpacing: 0,
        }}>{r === 'W' ? 'G' : 'M'}</span>
      ))}
    </Sirayla>
  )
}

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(90deg,var(--surface) 25%,var(--line) 50%,var(--surface) 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
    }} />
  )
}

/* ── Yardımcılar ──────────────────────────────────────────────────────────── */
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

// Upcoming maçlar günler sonra olabildiği için sadece saat kafa karıştırıyordu.
// Bugün → saat; yarın → "Yarın HH:MM"; sonrası → "14 Tem HH:MM".
function fmtWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const dayStart = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((dayStart(d) - dayStart(now)) / 86400000)
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  if (dayDiff === 0) return time
  if (dayDiff === 1) return `Yarın ${time}`
  return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} ${time}`
}

function normalizeMatchStatus(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'upcoming') return 'not_started'
  return normalized
}

function isUpcomingStatus(status) {
  const normalized = normalizeMatchStatus(status)
  return normalized === 'not_started'
}

function matchesDashboardGame(matchRow, activeGameId) {
  const gameName = String(matchRow?.game?.name || '')
  const gameSlug = String(matchRow?.game?.slug || '')
  const combined = `${gameName} ${gameSlug}`.trim()
  return gameMatchesFilter(combined, activeGameId)
}

// Satır rozetinde oyun kısaltması: "CS2", "LoL", "VAL" (eskiden adın ilk 3 harfi: "COU", "LEA")
function oyunKisa(m) {
  const meta = GAMES.find(g => g.id === normalizeGameId(m?.game?.slug ?? m?.game?.name))
  return meta?.shortLabel || (m?.game?.name ? String(m.game.name).slice(0, 4) : '—')
}

// Ana sayfa önceliği: takip edilen > Türk takımı > S/A turnuva > diğer (küçük = önde).
// Canlı bölümün sırası, "Son Sonuçlar" ve şeridin sonuç satırları aynı ölçütü kullanır.
function onemSirasi(m, favSet) {
  if (favSet?.size) {
    const a = String(m?.team_a_id ?? m?.team_a?.id ?? '')
    const b = String(m?.team_b_id ?? m?.team_b?.id ?? '')
    if (favSet.has(a) || favSet.has(b)) return 0
  }
  if (isTurkishTeam(m?.team_a) || isTurkishTeam(m?.team_b)) return 1
  const k = normalizeTierKey(m?.tournament?.tier)
  return k === 'S' || k === 'A' ? 2 : 3
}

function getStatusBadge(status, scheduledAt) {
  return statusStyle(status, scheduledAt)
}

function normalizeTierKey(value) {
  if (!value) return null
  const normalized = String(value)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-')

  if (normalized === 'S' || normalized.includes('S-TIER') || normalized.includes('TIER-S')) return 'S'
  if (normalized === 'A' || normalized.includes('A-TIER') || normalized.includes('TIER-A')) return 'A'
  if (normalized === 'B' || normalized.includes('B-TIER') || normalized.includes('TIER-B')) return 'B'
  if (normalized === 'C' || normalized.includes('C-TIER') || normalized.includes('TIER-C')) return 'C'

  const compact = normalized.replace(/-/g, '')
  return ['S', 'A', 'B', 'C', 'D', 'E'].includes(compact[0]) ? compact[0] : null
}

function isHeroTier(rawTier) {
  if (rawTier == null) return true
  const key = normalizeTierKey(rawTier)
  return key === null || key === 'S' || key === 'A'
}

function filterMatchesByTournamentTier(matches = [], showAll = false) {
  if (showAll) return matches
  return matches.filter(match => isHeroTier(match?.tournament?.tier))
}

function safeReadCache(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function safeWriteCache(key, payload) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // Ignore quota/storage errors and continue with network data.
  }
}

function isFreshCache(payload, scope) {
  if (!payload || payload.scope !== scope) return false
  const ts = Number(payload.updatedAt || 0)
  if (!Number.isFinite(ts) || ts <= 0) return false
  return (Date.now() - ts) <= DASHBOARD_CACHE_TTL_MS
}

function patchMatchCollection(rows = [], incoming = {}) {
  if (!incoming?.id) return rows
  return (rows || []).map(match => {
    if (match.id !== incoming.id) return match
    return {
      ...match,
      status: normalizeMatchStatus(incoming.status ?? match.status),
      scheduled_at: incoming.scheduled_at ?? match.scheduled_at,
      winner_id: incoming.winner_id ?? match.winner_id,
      team_a_score: incoming.team_a_score ?? match.team_a_score,
      team_b_score: incoming.team_b_score ?? match.team_b_score,
      team_a_id: incoming.team_a_id ?? match.team_a_id,
      team_b_id: incoming.team_b_id ?? match.team_b_id,
      prediction_team_a: incoming.prediction_team_a ?? match.prediction_team_a,
      prediction_team_b: incoming.prediction_team_b ?? match.prediction_team_b,
      prediction_confidence: incoming.prediction_confidence ?? match.prediction_confidence,
    }
  })
}

// Yayın satırını listedeki maça uygula; maç listede yoksa AYNI diziyi döndür
// (gereksiz render ve bağımlı effect tetiklenmesin).
function maclariYamala(rows, incoming) {
  if (!incoming?.id || !(rows || []).some(m => m.id === incoming.id)) return rows
  return patchMatchCollection(rows, incoming)
}

function zamanDamgasi(iso) {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? t : 0
}

// Ana sayfanın yaklaşan penceresi (get_home_feed ile aynı): şimdi-6 sa … şimdi+7 gün.
function yaklasanPencerede(iso) {
  const t = zamanDamgasi(iso)
  const now = Date.now()
  return t >= now - (6 * 60 * 60 * 1000) && t <= now + (UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

// Şerit YALNIZ gerçek veriden kurulur: canlı skor, yayımlanmış haber başlığı, biten
// maçın skoru, yaklaşan maçın saati. Eskiden newsStories şablonları "kritik roundlarda
// oyunu çevirdi" gibi veriye dayanmayan cümleler ve "Scout: X MVP 0" satırları
// üretiyordu; "MVP" denen sayı aslında alınan harita sayısıydı (UX denetimi, 3 Kas).
function tickerTakipte(match, followedTeamIds) {
  if (!followedTeamIds?.length) return false
  const ids = new Set(followedTeamIds.map(String))
  return ids.has(String(match?.team_a_id ?? match?.team_a?.id)) || ids.has(String(match?.team_b_id ?? match?.team_b?.id))
}

function tickerSaat(iso) {
  const d = new Date(iso || '')
  if (Number.isNaN(d.getTime())) return ''
  const bugun = new Date()
  const ayniGun = d.toDateString() === bugun.toDateString()
  const saat = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  return ayniGun ? saat : `${d.toLocaleDateString('tr-TR', { weekday: 'short' })} ${saat}`
}

function haberSatiriId(row) {
  if (row.content_type === 'transfer') return `transfer_${row.id}`
  if (row.content_type === 'tournament') return `tournament_${row.tournament_id}`
  if (row.content_type === 'haftalik') return `haftalik_${row.id}`
  return `match_${row.match_id}`
}

function buildTickerLines({ running, finished, upcoming, haberler, followedTeamIds = [] }) {
  // Takip edilen takımın satırı kendi grubunun başına geçer.
  const takipOnce = list => [...(list || [])].sort((x, y) => tickerTakipte(y, followedTeamIds) - tickerTakipte(x, followedTeamIds))
  const lines = []
  takipOnce(running).forEach(m => lines.push({
    id: `live_${m.id}`, kind: 'live', followed: tickerTakipte(m, followedTeamIds),
    text: `${m.team_a?.name || '?'} ${m.team_a_score ?? 0}:${m.team_b_score ?? 0} ${m.team_b?.name || '?'}`,
    href: `/match/${m.id}`,
  }))
  ;(haberler || []).forEach(row => {
    const id = haberSatiriId(row)
    lines.push({ id: `news_${row.id}`, kind: 'news', text: row.title, href: `/news/${buildNewsSlug({ id, title: row.title })}` })
  })
  takipOnce(finished).slice(0, 6).forEach(m => {
    const cs = correctedScores(m)
    lines.push({
      id: `result_${m.id}`, kind: 'result', followed: tickerTakipte(m, followedTeamIds),
      text: `${m.team_a?.name || '?'} ${cs.team_a_score ?? 0}:${cs.team_b_score ?? 0} ${m.team_b?.name || '?'}`,
      href: `/match/${m.id}`,
    })
  })
  // Saati 30 dk'dan fazla geçmiş ama hâlâ 'not_started' kayıt "yaklaşan" değildir.
  const yaklasanEsik = Date.now() - 30 * 60 * 1000
  takipOnce(upcoming).filter(m => zamanDamgasi(m.scheduled_at) > yaklasanEsik).slice(0, 5).forEach(m => lines.push({
    id: `upcoming_${m.id}`, kind: 'upcoming', followed: tickerTakipte(m, followedTeamIds),
    text: `${tickerSaat(m.scheduled_at)} · ${m.team_a?.name || '?'} – ${m.team_b?.name || '?'}`,
    href: `/match/${m.id}`,
  }))
  return lines
}

const PreferencePickerModal = memo(function PreferencePickerModal({
  open,
  onClose,
  onSave,
  gameIds,
  teamIds,
  popularTeams,
  loading,
}) {
  const [selectedGames, setSelectedGames] = useState(gameIds || [])
  const [selectedTeams, setSelectedTeams] = useState(teamIds || [])
  const [teamSearch, setTeamSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  // Görülen tüm takım objelerini sakla (arama temizlense de seçili takım görünür/kaydedilebilir kalsın).
  const [seenTeams, setSeenTeams] = useState({})
  const searchDebounceRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setSelectedGames(gameIds || [])
    setSelectedTeams(teamIds || [])
    setTeamSearch('')
    setSearchResults([])
  }, [open, gameIds, teamIds])

  // Popüler takımları "görülenler"e ekle.
  useEffect(() => {
    if (!open) return
    setSeenTeams(prev => {
      const next = { ...prev }
      for (const team of (popularTeams || [])) if (team?.id != null) next[team.id] = team
      return next
    })
  }, [open, popularTeams])

  // Zaten takip edilen ama popüler listede olmayan takımlar (ör. kayıttan önce
  // anonim takip edilip hesaba devredilen) görülenlerde yoksa listede hiç
  // çıkmıyordu: seçili olduğu halde kullanıcı göremiyordu. Eksikleri çek.
  useEffect(() => {
    if (!open) return
    const eksik = (teamIds || []).filter(id => !seenTeams[id])
    if (!eksik.length) return
    let iptal = false
    supabase
      .from('teams')
      .select('id,name,acronym,logo_url,game_id,game:games(id,name,slug)')
      .in('id', eksik)
      .then(({ data, error }) => {
        if (iptal) return
        if (error) { console.warn('PreferencePickerModal secili takimlar:', error.message); return }
        setSeenTeams(prev => {
          const next = { ...prev }
          for (const team of (data || [])) if (team?.id != null) next[team.id] = team
          return next
        })
      })
    return () => { iptal = true }
    // seenTeams bilerek bağımlılık değil: yalnız prop'tan gelen takip listesi değişince çek
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teamIds])

  // Canlı Supabase araması — tüm takımlar (yalnızca popülerler değil) takip edilebilsin.
  useEffect(() => {
    if (!open) return
    const q = String(teamSearch || '').trim()
    if (q.length < 2) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('teams')
        .select('id,name,acronym,logo_url,game_id,game:games(id,name,slug)')
        .or(`name.ilike.%${q}%,acronym.ilike.%${q}%`)
        .order('name', { ascending: true })
        .limit(14)
      setSearchResults(data || [])
      setSeenTeams(prev => {
        const next = { ...prev }
        for (const team of (data || [])) if (team?.id != null) next[team.id] = team
        return next
      })
      setSearching(false)
    }, 250)
    return () => clearTimeout(searchDebounceRef.current)
  }, [teamSearch, open])

  if (!open) return null

  const searchActive = String(teamSearch || '').trim().length >= 2
  const baseList = searchActive ? searchResults : (popularTeams || [])
  // Seçili olup listede olmayan takımları da başa ekle (arama temizlense bile görünsün).
  const selectedNotInList = selectedTeams
    .filter(id => !baseList.some(team => team.id === id))
    .map(id => seenTeams[id])
    .filter(Boolean)
  const displayedTeams = [...selectedNotInList, ...baseList]

  const toggleGame = gameId => {
    setSelectedGames(prev => prev.includes(gameId)
      ? prev.filter(id => id !== gameId)
      : [...prev, gameId])
  }

  const toggleTeam = team => {
    const teamId = team?.id
    if (teamId == null) return
    setSeenTeams(prev => ({ ...prev, [teamId]: team }))
    setSelectedTeams(prev => prev.includes(teamId)
      ? prev.filter(id => id !== teamId)
      : [...prev, teamId])
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1200,
      background: 'rgba(6,6,6,.72)',
      display: 'grid',
      placeItems: 'center',
      padding: '16px',
    }}>
      {/* Panel eski temadan kalma kırmızı/lacivert renkleri taşıyordu (#2b3a58
          kenarlık, kırmızı radial gradient) ve başlıkta İngilizce "For You"
          geçiyordu. 5 Eyl: tamamen marka moruna ve Türkçeye çevrildi. */}
      <div style={{
        width: 'min(720px, 100%)',
        maxHeight: '85vh',
        overflowY: 'auto',
        borderRadius: 18,
        border: `1px solid ${FEXT.accentBorder}`,
        background: `radial-gradient(circle at 14% 12%, ${FEXT.accentGlow}, transparent 46%), var(--surface)`,
        boxShadow: '0 28px 70px rgba(0,0,0,.55)',
        animation: 'prefModalIn .26s cubic-bezier(.2,.8,.3,1)',
      }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: yazi(11), fontWeight: 800, letterSpacing: '.9px', color: 'var(--accent-fg)', textTransform: 'uppercase' }}>
            Takip Tercihleri
          </div>
          <h3 style={{ margin: '8px 0 0', fontSize: 22, color: 'var(--text-1)' }}>Akışını özelleştir</h3>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Takip ettiğin oyun ve takımları seç. Ana sayfadaki haber akışı ve
            Hızlı Erişim bu seçimlere göre sıralanır.
          </p>
        </div>

        <div style={{ padding: '14px 16px 18px' }}>
          <div style={{ fontSize: yazi(10), color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>Oyunlar</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {PREFERENCE_GAMES.map(game => {
              const active = selectedGames.includes(game.id)
              return (
                <button
                  key={game.id}
                  onClick={() => toggleGame(game.id)}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${active ? game.color : 'var(--line-2)'}`,
                    background: active ? `${game.color}2b` : 'var(--surface-2)',
                    color: active ? game.color : 'var(--text-3)',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '7px 11px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ marginRight: 5 }}>{game.icon}</span>
                  {game.shortLabel}
                </button>
              )
            })}
          </div>

          <div style={{ fontSize: yazi(10), color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 8 }}>
            {searchActive ? 'Arama Sonuçları' : 'Popüler Takımlar'}
          </div>
          <div style={{ marginBottom: 10 }}>
            <input
              value={teamSearch}
              onChange={event => setTeamSearch(event.target.value)}
              placeholder='Tüm takımlarda ara... (min. 2 harf)'
              style={{
                width: '100%',
                borderRadius: 9,
                border: '1px solid var(--line-2)',
                background: 'var(--surface-2)',
                color: 'var(--text-1)',
                fontSize: 12,
                padding: '8px 10px',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
            {displayedTeams.map(team => {
              const active = selectedTeams.includes(team.id)
              const teamGameId = normalizeGameId(team?.game?.slug ?? team?.game?.name ?? team?.game_id)
              const gameMeta = PREFERENCE_GAMES.find(game => game.id === teamGameId)
              return (
                <button
                  key={team.id}
                  onClick={() => toggleTeam(team)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: 11,
                    border: `1px solid ${active ? FEXT.accentBorder : 'var(--line)'}`,
                    background: active ? FEXT.accentSoftBg : 'var(--surface-2)',
                    color: active ? 'var(--accent-fg)' : 'var(--text-3)',
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    cursor: 'pointer',
                    transition: 'background .16s, border-color .16s, color .16s, transform .16s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = FEXT.accentBorder }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = 'var(--line)' }}
                >
                  <InitialsImage
                    src={team.logo_url}
                    alt={team.name || ''}
                    name={team.name}
                    width={22}
                    height={22}
                    borderRadius={6}
                    objectFit='contain'
                  />
                  <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
                    <span style={{ fontSize: yazi(10), color: active ? 'var(--accent-fg)' : 'var(--text-5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: gameMeta?.color || 'var(--text-4)', flexShrink: 0 }} /> {gameMeta?.label || team?.game?.name || 'Oyun bilinmiyor'}
                    </span>
                  </span>
                </button>
              )
            })}
            {searchActive && searching && displayedTeams.length === 0 && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
                {[1, 2, 3].map(i => <Sk key={i} h="36px" r="10px" />)}
              </div>
            )}
            {searchActive && !searching && displayedTeams.length === 0 && (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-5)', border: '1px dashed var(--line)', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                "{teamSearch.trim()}" için takım bulunamadı.
              </div>
            )}
            {!searchActive && !loading && (!popularTeams || popularTeams.length === 0) && (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-5)', border: '1px dashed var(--line)', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                Takım önerileri yüklenemedi. Yukarıdan arayarak takım ekleyebilirsin.
              </div>
            )}
            {!searchActive && loading && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
                {[1, 2, 3, 4, 5, 6].map(i => <Sk key={i} h="36px" r="10px" />)}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '0 16px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              borderRadius: 10,
              border: '1px solid var(--line)',
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            Daha Sonra
          </button>
          <button
            onClick={() => {
              const teamGameMap = {}
              for (const teamId of selectedTeams) {
                const team = seenTeams[teamId]
                const gameId = normalizeGameId(team?.game?.slug ?? team?.game?.name ?? team?.game_id)
                if (gameId) teamGameMap[String(teamId)] = gameId
              }

              const mergedGameIds = [...new Set([
                ...(selectedGames || []),
                ...Object.values(teamGameMap),
              ])]

              onSave({ gameIds: mergedGameIds, teamIds: selectedTeams, teamGameMap })
            }}
            style={{
              borderRadius: 10,
              border: '1px solid rgba(194,92,208,.72)',
              background: 'linear-gradient(135deg, rgba(194,92,208,.3), rgba(194,92,208,.15))',
              color: 'var(--accent-fg)',
              fontSize: 12,
              fontWeight: 800,
              padding: '8px 12px',
              cursor: 'pointer',
              transition: 'filter .16s, transform .16s',
            }}
            onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.18)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.transform = 'translateY(0)' }}
          >
            Tercihleri Kaydet
          </button>
        </div>
      </div>
    </div>
  )
})

// Şerit satır türleri: emoji yerine renkli kısa etiket.
const TICKER_TUR = {
  live:     { etiket: 'CANLI',    renk: 'var(--canli-fg)' },
  news:     { etiket: 'HABER',    renk: FEXT.accentText },
  result:   { etiket: 'SONUÇ',    renk: 'var(--text-3)' },
  upcoming: { etiket: 'YAKLAŞAN', renk: 'var(--mavi-fg)' },
}

const LiveTicker = memo(function LiveTicker({ items, loading }) {
  const [ripple, setRipple] = useState({ key: null, token: 0, x: 0, y: 0 })
  // Üzerine gelince ya da klavyeyle odaklanınca kayma durur (WCAG 2.2.2).
  const [durdu, setDurdu] = useState(false)
  const safeItems = (items || []).filter(Boolean)
  const normalized = safeItems.map((item, idx) => (typeof item === 'string'
    ? { id: `text_${idx}`, text: item, href: null }
    : {
      id: item.id || `line_${idx}`,
      kind: item.kind || null,
      followed: Boolean(item.followed),
      text: item.text || '',
      href: item.href || null,
    }))
  const lines = safeItems.length > 0
    ? normalized
    : [
      { id: 'boot_live', kind: 'live', text: 'Canlı skorlar yükleniyor…', href: null },
      { id: 'boot_news', kind: 'news', text: 'Son haberler yükleniyor…', href: null },
    ]
  const speedSeconds = Math.min(75, Math.max(24, lines.length * 4.2))

  const handleLineClick = (event, line, idx) => {
    if (!line?.href) return

    const rect = event.currentTarget.getBoundingClientRect()
    const token = Date.now()
    setRipple({
      key: `${line.id}_${idx}`,
      token,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })

    window.setTimeout(() => {
      setRipple(prev => (prev.token === token ? { key: null, token: 0, x: 0, y: 0 } : prev))
    }, 420)
    // Gezinmeyi <Link> yapar (orta tık yeni sekme); burada yalnız dalga efekti.
  }

  return (
    <div style={{ marginBottom: 18, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderBottom: '1px solid var(--line)', background: 'rgba(255,255,255,.02)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff4655', animation: 'liveNeonBlink 1.05s infinite' }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Son Haberler &amp; Canlı Akış {loading ? '· senkronize ediliyor' : ''}
        </span>
      </div>

      <div
        style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}
        onMouseEnter={() => setDurdu(true)}
        onMouseLeave={() => setDurdu(false)}
        onFocus={() => setDurdu(true)}
        onBlur={() => setDurdu(false)}
      >
        <div style={{ display: 'inline-flex', minWidth: 'max-content', animation: `tickerScroll ${speedSeconds}s linear infinite`, animationPlayState: durdu ? 'paused' : 'running' }}>
          {[...lines, ...lines].map((line, idx) => {
            const Satir = line.href ? Link : 'span'
            return (
            <Satir
              key={`${line.id}_${idx}`}
              {...(line.href ? { to: line.href } : {})}
              onClick={event => handleLineClick(event, line, idx)}
              // Döngü için ikinci kopya: ekran okuyucu ve Tab sırası yalnız ilkini görür.
              aria-hidden={idx >= lines.length || undefined}
              tabIndex={idx >= lines.length ? -1 : undefined}
              style={{
                position: 'relative',
                overflow: 'hidden',
                display: 'inline-block',
                textDecoration: 'none',
                lineHeight: 'normal',
                fontSize: 13.5,
                fontWeight: 500,
                color: line.href ? 'var(--text-1)' : 'var(--text-3)',
                padding: '13px 20px',
                borderRight: '1px solid var(--hover-strong)',
                borderTop: 'none',
                borderBottom: 'none',
                borderLeft: 'none',
                background: 'transparent',
                cursor: line.href ? 'pointer' : 'default',
                transition: 'background .16s, transform .16s, color .16s',
              }}
              onMouseEnter={e => {
                if (!line.href) return
                e.currentTarget.style.background = 'var(--hover-strong)'
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={e => {
                if (!line.href) return
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.color = 'var(--text-1)'
              }}
            >
              {TICKER_TUR[line.kind] && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 8, fontSize: yazi(10), fontWeight: 800, letterSpacing: '.6px', color: TICKER_TUR[line.kind].renk, verticalAlign: 1 }}>
                  {line.kind === 'live' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: TICKER_TUR.live.renk }} />}
                  {TICKER_TUR[line.kind].etiket}
                </span>
              )}
              {line.followed && <Star size={12} fill="#FFD700" color="#FFD700" aria-label="Takip ettiğin takım" style={{ marginRight: 6, verticalAlign: -1 }} />}
              {line.text}
              {ripple.key === `${line.id}_${idx}` && (
                <span
                  style={{
                    position: 'absolute',
                    left: ripple.x,
                    top: ripple.y,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,.55)',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                    animation: 'dashRipple .42s ease-out forwards',
                  }}
                />
              )}
            </Satir>
            )
          })}
        </div>
      </div>
    </div>
  )
})

/**
 * QuickAccessBar — takip edilen takım/oyuncular.
 *
 * Eskiden 42px yuvarlak avatarlardan ibaretti: kullanıcı logodan takımı
 * tanımak zorundaydı ve satır kimliksiz duruyordu. Artık ad + oyun yazan
 * yatay kartlar; hover'da marka moru. Başlık satırı burada DEĞİL — Dashboard
 * onu "Tercihlerin" butonuyla aynı satırda çiziyor (eskiden tercih butonu
 * tek başına tam satır kaplayıp bu barı bir satır aşağı itiyordu).
 */
const hizliErisimAdresi = entry => entry.matchId
  ? `/match/${entry.matchId}`
  : entry.type === 'team' ? `/team/${entry.id}` : `/player/${entry.id}`

const QuickAccessBar = memo(function QuickAccessBar({ entries, loading }) {
  const [ripple, setRipple] = useState({ key: null, token: 0, x: 0, y: 0 })

  const handleEntryOpen = (event, entry) => {
    const key = `${entry.type}_${entry.id}`
    const rect = event.currentTarget.getBoundingClientRect()
    const token = Date.now()
    setRipple({
      key,
      token,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })

    window.setTimeout(() => {
      setRipple(prev => (prev.token === token ? { key: null, token: 0, x: 0, y: 0 } : prev))
    }, 420)
    // Gezinmeyi <Link> yapar; burada yalnız dalga efekti.
  }

  if (loading) {
    return (
      <div className="fav-scroll" style={{ marginBottom: 16, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 3 }}>
        {[1, 2, 3, 4].map(i => <Sk key={i} w="164px" h="48px" r="12px" />)}
      </div>
    )
  }

  if (!entries?.length) return null

  return (
    <div className="fav-scroll" style={{ marginBottom: 16, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 3 }}>
      {entries.map((entry, idx) => {
        const key = `${entry.type}_${entry.id}`
        return (
          <Link
            key={key}
            to={hizliErisimAdresi(entry)}
            onClick={event => handleEntryOpen(event, entry)}
            title={entry.label}
            style={{
              textDecoration: 'none',
              color: 'inherit',
              lineHeight: 'normal',
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              flexShrink: 0,
              maxWidth: 208,
              padding: '7px 14px 7px 8px',
              borderRadius: 12,
              textAlign: 'left',
              border: `1px solid ${entry.isLive ? 'rgba(255,70,85,.4)' : 'var(--line)'}`,
              background: 'var(--surface)',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden',
              // Kademeli giriş: kartlar sırayla süzülerek gelir (statik blok hissini kırar).
              animation: `quickCardIn .34s cubic-bezier(.2,.8,.3,1) ${Math.min(idx, 8) * 45}ms both`,
              transition: 'transform .18s cubic-bezier(.2,.8,.3,1), border-color .18s, background .18s, box-shadow .18s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.borderColor = FEXT.accentBorder
              e.currentTarget.style.background = FEXT.accentSoftBg
              e.currentTarget.style.boxShadow = `0 6px 18px -8px ${FEXT.accentGlow}`
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.borderColor = entry.isLive ? 'rgba(255,70,85,.4)' : 'var(--line)'
              e.currentTarget.style.background = 'var(--surface)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <span style={{
              position: 'relative',
              width: 32, height: 32, flexShrink: 0,
              borderRadius: entry.type === 'player' ? '50%' : 9,
              overflow: 'hidden',
              background: 'var(--surface-2)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {entry.image
                ? <img src={entry.image} alt="" style={{ width: '100%', height: '100%', objectFit: entry.type === 'player' ? 'cover' : 'contain' }} />
                : <span style={{ fontSize: yazi(11), fontWeight: 800, color: 'var(--text-4)' }}>{entry.fallback || '?'}</span>}
            </span>

            <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
              <span style={{
                fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {entry.label}
              </span>
              <span style={{
                fontSize: yazi(10), fontWeight: 600, letterSpacing: '.2px',
                // --danger-fg: açık temada sabit pembe beyaz zeminde kayboluyordu.
                color: entry.isLive ? 'var(--danger-fg)' : 'var(--text-5)',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: entry.isLive ? '#ff4655' : (entry.gameColor || 'var(--text-5)'),
                  animation: entry.isLive ? 'liveNeonBlink 1.05s infinite' : 'none',
                }} />
                {entry.isLive ? 'Canlı maç' : (entry.gameLabel || (entry.type === 'player' ? 'Oyuncu' : 'Takım'))}
              </span>
            </span>

            {ripple.key === key && (
              <span
                style={{
                  position: 'absolute',
                  left: ripple.x,
                  top: ripple.y,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: 'rgba(194,92,208,.45)',
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                  animation: 'dashRipple .42s ease-out forwards',
                }}
              />
            )}
          </Link>
        )
      })}
    </div>
  )
})

function WinBar({ predA, predB, confidence }) {
  // Kart göründüğünde bar 0'dan hedefe doğru dolar — günlük radar videolarındaki
  // dolum efektinin sitedeki karşılığı. Sonraki (canlı) güncellemeler yine aynı
  // transition üzerinden akar; animasyon donmuş bir değere kilitlemez.
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setGrown(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  if (predA == null || predB == null) return null
  const total = (predA + predB) || 1
  const pctA  = Math.round((predA / total) * 100)
  const pctB  = 100 - pctA
  const uncertain = isUncertainPrediction(predA, predB, confidence)
  const aFav  = !uncertain && pctA > pctB
  const bFav  = !uncertain && pctB > pctA
  const isHot = !uncertain && confidence != null && confidence > 0.80

  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
      {/* İnce progress bar */}
      <div style={{
        display: 'flex', height: 3, borderRadius: 2,
        overflow: 'hidden', background: 'var(--line)',
        marginBottom: 3,
      }}>
        <div style={{ width: grown ? `${pctA}%` : 0, background: aFav ? 'var(--ai)' : 'var(--track)', transition: 'width .75s cubic-bezier(.2,.8,.3,1)' }} />
        <div style={{ width: grown ? `${pctB}%` : 0, background: bFav ? 'var(--ai)' : 'var(--track)', transition: 'width .75s cubic-bezier(.2,.8,.3,1)' }} />
      </div>

      {/* Yüzde + Fextopus etiketi */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: yazi(8), color: aFav ? 'var(--ai)' : 'var(--text-5)', fontWeight: aFav ? 700 : 400 }}>
          {uncertain ? '' : `%${pctA}`}
        </span>
        <FextopusEtiketi belirsiz={uncertain} sicak={isHot} boyut={9} />
        <span style={{ fontSize: yazi(8), color: bFav ? 'var(--ai)' : 'var(--text-5)', fontWeight: bFav ? 700 : 400 }}>
          {uncertain ? '' : `%${pctB}`}
        </span>
      </div>
    </div>
  )
}

// Risk/güven etiketleri ("Dengeli"/"Riskli Maç"/"Yüksek Güven") KALDIRILDI —
// altındaki AI tahmin barı zaten sonucu gösteriyordu, etiket gereksiz + rengarenk
// duruyordu (kurucu kararı). Bar korunuyor. İleride Gemini maç yorumu düşünülebilir.
function MatchImpactPill() {
  return null
}

/* ── LiveMatchCard ────────────────────────────────────────────────────────── */
const LiveMatchCard = memo(function LiveMatchCard({ match: m, favs, onToggleFav, teamForms, oncelikli = false }) {
  useTurkTakimlar()  // Türk takımı listesi yüklenince yeniden çiz
  const isLive     = m.status === 'running'
  const isFin      = m.status === 'finished'
  const aggressiveLiveMode = isLive && !isFin
  const aId        = m.team_a_id || m.team_a?.id
  const bId        = m.team_b_id || m.team_b?.id
  const formA      = teamForms?.get(aId) || []
  const formB      = teamForms?.get(bId) || []
  const aWon       = isFin && m.winner_id === aId
  const bWon       = isFin && m.winner_id === bId
  const favA       = favs.includes(aId)
  const favB       = favs.includes(bId)
  const turkA      = isTurkishTeam(m.team_a)
  const turkB      = isTurkishTeam(m.team_b)
  const hasTurkish = turkA || turkB

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 16,
        padding: '14px 16px',
        background: 'linear-gradient(160deg,var(--surface-2),var(--surface))',
        cursor: 'pointer',
        border: '1px solid var(--line)',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        transition: 'border-color .2s, transform .2s cubic-bezier(.34,1.4,.64,1), box-shadow .2s',
        /* üst vurgu şeridi köşe yarıçapına göre kırpılsın (sol-üst kayma fix) */
        overflow: 'hidden',
        /* Dikey flex: alt şerit (İzle / Maç detayı) hep en altta → aynı satırdaki
           kartlar eş boy; eskiden yayını olmayan kart kısa kalıyordu. */
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'rgba(194,92,208,.55)'
        e.currentTarget.style.transform = 'translateY(-4px) scale(1.008)'
        e.currentTarget.style.boxShadow = '0 14px 34px rgba(194,92,208,.22)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--line)'
        e.currentTarget.style.transform = 'translateY(0) scale(1)'
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.35)'
      }}
    >
      {/* Kartın tamamı maç linki; yıldız ve yayın linki UST_KATMAN ile üstünde */}
      <KartOrtusu to={`/match/${m.id}`} label={`${m.team_a?.name ?? ''} - ${m.team_b?.name ?? ''} maç detayı`} />

      {/* Üst ince kırmızı vurgu — yavaş süzülen soft hareket (glow yok) */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: 'linear-gradient(90deg, transparent, rgba(255,70,85,.85) 30%, rgba(255,70,85,.35) 55%, transparent)',
        backgroundSize: '220% 100%',
        animation: 'liveAccentDrift 5.5s ease-in-out infinite alternate',
      }} />

      {/* Oyun + CANLI */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span lang="en" style={{
            padding: '2px 7px', borderRadius: 5, fontSize: yazi(9), fontWeight: 700,
            letterSpacing: '.7px', textTransform: 'uppercase',
            background: 'rgba(255,70,85,.15)', color: 'var(--canli-fg)',
            whiteSpace: 'nowrap',
          }}>
            {m.game?.name || '—'}
          </span>
          <MatchImpactPill match={m} />
          {getBOFormat(m.team_a_score, m.team_b_score, m.number_of_games) && (
            <span style={{ fontSize: yazi(8), fontWeight: 700, color: 'var(--text-5)', background: 'var(--hover)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
              {getBOFormat(m.team_a_score, m.team_b_score, m.number_of_games)}
            </span>
          )}
          {hasTurkish && <TurkishBadge compact />}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: yazi(10), fontWeight: 800, color: 'var(--canli-fg)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF4655', animation: 'liveNeonBlink 1.05s infinite' }} />
          CANLI
        </span>
      </div>

      {/* Teams + Score — 3 sütunlu grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 6,
        marginBottom: 4,   /* WinBar için küçük boşluk */
      }}>
        {/* Team A */}
        <div style={{ textAlign: 'center', minWidth: 0 }}>
          <div style={{ opacity: isFin && bWon ? 0.45 : 1 }}>
          <InitialsImage
            src={m.team_a?.logo_url}
            alt={m.team_a?.name || ''}
            name={m.team_a?.name}
            priority={oncelikli}
            width={36}
            height={36}
            borderRadius={8}
            objectFit='contain'
            style={{ margin: '0 auto 4px' }}
          />
          <div style={{
            fontSize: yazi(10), fontWeight: 700, lineHeight: 1.2,
            color: aWon ? '#4CAF50' : favA ? '#FFD700' : 'var(--text-2)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {m.team_a?.name || '?'}{turkA && <TrBadge />}
          </div>
          {formA.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <FormStrip form={formA} />
            </div>
          )}
          </div>
          {favA && (
            <button
              onClick={() => onToggleFav(aId)}
              aria-label={`${m.team_a?.name ?? 'Takım'} takibini bırak`}
              style={{ ...UST_KATMAN, background: 'none', border: 'none', cursor: 'pointer', color: '#FFD700', padding: '1px 0', display: 'flex', justifyContent: 'center', margin: '0 auto' }}
            ><Star size={11} strokeWidth={2} fill="#FFD700" /></button>
          )}
        </div>

        {/* Score */}
        <div style={{
          textAlign: 'center',
          flexShrink: 0,
          padding: aggressiveLiveMode ? '5px 10px' : '0 4px',
          borderRadius: aggressiveLiveMode ? 9 : 0,
          border: aggressiveLiveMode ? '1px solid var(--line)' : 'none',
          background: aggressiveLiveMode ? 'var(--hover)' : 'transparent',
          boxShadow: 'none',
        }}>
          <div style={{
            fontSize: aggressiveLiveMode ? 28 : 20,
            fontWeight: 900,
            color: 'var(--text-1)',
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px', lineHeight: 1,
            textShadow: 'none',
          }}>
            {/* Realtime abonelik skoru güncellediğinde rakam takla atıyor —
                canlılık hissi veriyor ve değişimi gözden kaçırtmıyor. */}
            <FlipNumber value={m.team_a_score ?? 0} />
            <span style={{ color: 'var(--text-5)', margin: '0 3px' }}>:</span>
            <FlipNumber value={m.team_b_score ?? 0} />
          </div>
          <div style={{
            fontSize: yazi(8), color: 'var(--text-4)', marginTop: 3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 72,
          }} title={turnuvaAdi(m)}>
            {turnuvaAdi(m, false)}
          </div>
        </div>

        {/* Team B */}
        <div style={{ textAlign: 'center', minWidth: 0 }}>
          <div style={{ opacity: isFin && aWon ? 0.45 : 1 }}>
          <InitialsImage
            src={m.team_b?.logo_url}
            alt={m.team_b?.name || ''}
            name={m.team_b?.name}
            priority={oncelikli}
            width={36}
            height={36}
            borderRadius={8}
            objectFit='contain'
            style={{ margin: '0 auto 4px' }}
          />
          <div style={{
            fontSize: yazi(10), fontWeight: 700, lineHeight: 1.2,
            color: bWon ? '#4CAF50' : favB ? '#FFD700' : 'var(--text-2)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {m.team_b?.name || '?'}{turkB && <TrBadge />}
          </div>
          {formB.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <FormStrip form={formB} />
            </div>
          )}
          </div>
          {favB && (
            <button
              onClick={() => onToggleFav(bId)}
              aria-label={`${m.team_b?.name ?? 'Takım'} takibini bırak`}
              style={{ ...UST_KATMAN, background: 'none', border: 'none', cursor: 'pointer', color: '#FFD700', padding: '1px 0', display: 'flex', justifyContent: 'center', margin: '0 auto' }}
            ><Star size={11} strokeWidth={2} fill="#FFD700" /></button>
          )}
        </div>
      </div>

      {/* ── AI WinBar — kartın en altında ince şerit ── */}
      {!MVP_HIDE_PREDICTIONS && (
        <WinBar
          predA={m.prediction_team_a}
          predB={m.prediction_team_b}
          confidence={m.prediction_confidence}
        />
      )}

      {/* ── Alt şerit: yayın varsa platform adıyla "izle", yoksa maç detayı (kart boyu sabit) ── */}
      <div style={{ marginTop: 'auto', paddingTop: 10 }}>
        <div style={{ paddingTop: 10, borderTop: '1px solid rgba(255,70,85,.15)' }}>
          {m.stream_url ? (
            <a
              href={m.stream_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                ...UST_KATMAN,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                borderRadius: 8, minHeight: 40,
                background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)',
                color: 'var(--ai)', fontSize: yazi(11.5), fontWeight: 800,
                textDecoration: 'none', transition: 'background .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(167,139,250,.22)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(167,139,250,.12)'}
            >
              <Play size={12} fill="currentColor" strokeWidth={0} /> {izleEtiketi(m.stream_url)}
            </a>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              borderRadius: 8, minHeight: 40, boxSizing: 'border-box',
              background: 'var(--hover)', border: '1px solid var(--line)',
              color: 'var(--text-4)', fontSize: yazi(11.5), fontWeight: 700,
            }}>
              Maç detayı <ChevronRight size={13} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

/* ── UpcomingRow ──────────────────────────────────────────────────────────── */
const UpcomingRow = memo(function UpcomingRow({ match: m, teamForms, showDate }) {
  useTurkTakimlar()  // Türk takımı listesi yüklenince yeniden çiz
  const badge = getStatusBadge(m.status, m.scheduled_at)
  const isLive = m.status === 'running'
  const turkA = isTurkishTeam(m.team_a)
  const turkB = isTurkishTeam(m.team_b)
  const aId   = m.team_a_id || m.team_a?.id
  const bId   = m.team_b_id || m.team_b?.id
  const formA = teamForms?.get(aId) || []
  const formB = teamForms?.get(bId) || []
  return (
    <KartLink
      to={`/match/${m.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px', borderRadius: 12, cursor: 'pointer',
        background: 'var(--surface)',
        border: isLive ? '1px solid rgba(255,70,85,.5)' : '1px solid var(--line)',
        boxShadow: 'none',
        transition: 'background .15s, border-color .15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--surface-2)'
        e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.7)' : 'var(--line-2)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--surface)'
        e.currentTarget.style.borderColor = isLive ? 'rgba(255,70,85,.5)' : 'var(--line)'
      }}
    >
      {/* Saat (My Feed'de tarih de görünsün — grup başlığı yok) */}
      <div style={{ fontSize: yazi(10), color: 'var(--text-3)', flexShrink: 0, width: showDate ? 66 : 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums', lineHeight: 1.25 }}>
        {showDate ? fmtWhen(m.scheduled_at) : fmtTime(m.scheduled_at)}
      </div>

      {/* Oyun etiketi */}
      <span lang="en" style={{ fontSize: yazi(8), padding: '2px 0', width: 34, textAlign: 'center', borderRadius: 4, background: 'var(--line)', color: 'var(--text-3)', fontWeight: 700, letterSpacing: '.4px', flexShrink: 0 }}>
        {oyunKisa(m)}
      </span>

      {/* Canlı noktası — canlı olmasa da yer tutar ki "vs" sütunu kaymasın */}
      <span style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: '#ff4655',
        animation: 'liveNeonBlink 1.05s infinite',
        flexShrink: 0,
        visibility: isLive ? 'visible' : 'hidden',
      }} />

      {/* Teams — masaüstünde 3 sütun (A | vs | B) → "vs"ler alt alta hizalanır.
          Mobilde CSS ile dikey flex'e döner (TeamA / vs / TeamB). */}
      <div className="matchup" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
        <div className="matchup-team matchup-a" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <InitialsImage
            src={m.team_a?.logo_url}
            alt={m.team_a?.name || ''}
            name={m.team_a?.name}
            width={18}
            height={18}
            borderRadius={4}
            objectFit='contain'
          />
          <div className="matchup-name" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: turkA ? 'var(--tr-fg)' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.team_a?.name || '?'}{turkA && <TrBadge />}
            </span>
            {formA.length > 0 && <FormStrip form={formA} className="hide-sm" />}
          </div>
        </div>
        <span className="matchup-vs" style={{ fontSize: yazi(9), color: 'var(--text-5)', flexShrink: 0, textAlign: 'center' }}>vs</span>
        <div className="matchup-team" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <InitialsImage
            src={m.team_b?.logo_url}
            alt={m.team_b?.name || ''}
            name={m.team_b?.name}
            width={18}
            height={18}
            borderRadius={4}
            objectFit='contain'
          />
          <div className="matchup-name" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: turkB ? 'var(--tr-fg)' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.team_b?.name || '?'}{turkB && <TrBadge />}
            </span>
            {formB.length > 0 && <FormStrip form={formB} className="hide-sm" />}
          </div>
        </div>
      </div>

      {/* Turnuva — sabit genişlik: sağ blok her satırda aynı yer kaplasın ki
          ortadaki "vs" sütunu satırlar boyunca kaymasın. */}
      <div className="row-tour" title={turnuvaAdi(m)} style={{ fontSize: yazi(9), color: 'var(--text-4)', flexShrink: 0, width: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
        {turnuvaAdi(m, false)}
      </div>

      <MatchImpactPill match={m} compact />

      {/* Badge — mobilde gizli (Maç Programı zaten "yaklaşan"; canlıyı kırmızı nokta belli eder) */}
      <span className="hide-sm" style={{ padding: '2px 0', width: 58, textAlign: 'center', borderRadius: 6, fontSize: yazi(8), fontWeight: 700, color: badge.color, background: badge.bg, flexShrink: 0 }}>
        {badge.kisa || badge.text}
      </span>
    </KartLink>
  )
})

/* ── SkorSatiri — mobilde canlı ve biten maç için kompakt satır ──────────────
   Takımlar alt alta, ad tam genişlikte (yan yana düzende "The..." / "Natus..."
   diye kesiliyordu); canlı kart yerine ~70 px, birkaç canlı maç tek ekranda. */
const SkorSatiri = memo(function SkorSatiri({ match: m, favs }) {
  useTurkTakimlar()  // Türk takımı listesi yüklenince yeniden çiz
  const canli   = m.status === 'running'
  const cs      = canli ? m : correctedScores(m)
  const kazanan = !canli && m.winner_id != null ? Number(m.winner_id) : null
  const favSet  = new Set((favs || []).map(Number))
  const takimlar = [
    { t: m.team_a, id: Number(m.team_a_id || m.team_a?.id), skor: cs.team_a_score, yan: 'a' },
    { t: m.team_b, id: Number(m.team_b_id || m.team_b?.id), skor: cs.team_b_score, yan: 'b' },
  ]
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 10px 9px 8px', borderRadius: 12, cursor: 'pointer',
        background: 'var(--surface)',
        border: `1px solid ${canli ? 'rgba(255,70,85,.35)' : 'var(--line)'}`,
      }}
    >
      {/* Satırın tamamı maç linki; yayın düğmesi UST_KATMAN ile üstünde */}
      <KartOrtusu to={`/match/${m.id}`} label={`${m.team_a?.name ?? ''} - ${m.team_b?.name ?? ''} maç detayı`} />
      <div style={{ width: 44, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {canli ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: yazi(9), fontWeight: 800, color: 'var(--canli-fg)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF4655', animation: 'liveNeonBlink 1.05s infinite' }} />
            CANLI
          </span>
        ) : (
          <span style={{ fontSize: yazi(9.5), color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, textAlign: 'center' }}>
            {fmtWhen(m.scheduled_at)}
          </span>
        )}
        <span lang="en" style={{ fontSize: yazi(8), fontWeight: 700, color: 'var(--text-5)', letterSpacing: '.4px' }}>{oyunKisa(m)}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
        {takimlar.map(({ t, id, skor, yan }) => {
          const kazandi  = kazanan != null && kazanan === id
          const kaybetti = kazanan != null && kazanan !== id
          return (
            <div key={yan} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
              <InitialsImage src={t?.logo_url} alt={t?.name || ''} name={t?.name} width={16} height={16} borderRadius={4} objectFit='contain' />
              <span style={{
                flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: kazandi ? 800 : 600,
                color: kaybetti ? 'var(--text-5)' : favSet.has(id) ? '#FFD700' : 'var(--text-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {t?.name || '?'}{isTurkishTeam(t) && <TrBadge />}
              </span>
              <span style={{
                fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums', minWidth: 14, textAlign: 'right',
                color: kazandi ? 'var(--yesil-fg)' : kaybetti ? 'var(--text-5)' : 'var(--text-1)',
              }}>
                {canli ? <FlipNumber value={skor ?? 0} /> : (skor ?? '–')}
              </span>
            </div>
          )
        })}
        <div title={turnuvaAdi(m)} style={{ fontSize: yazi(9.5), color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {turnuvaAdi(m, false)}
        </div>
      </div>

      {canli && m.stream_url && (
        <a
          href={m.stream_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={izleEtiketi(m.stream_url)}
          title={izleEtiketi(m.stream_url)}
          style={{
            ...UST_KATMAN,
            flexShrink: 0, width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 10,
            background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', color: 'var(--ai)',
          }}
        >
          <Play size={14} fill="currentColor" strokeWidth={0} />
        </a>
      )}
    </div>
  )
})

/* ── ResultRow — biten maç, skor odaklı (Son Sonuçlar) ────────────────────── */
const ResultRow = memo(function ResultRow({ match: m }) {
  useTurkTakimlar()  // Türk takımı listesi yüklenince yeniden çiz
  const cs   = correctedScores(m)
  const aId  = Number(m.team_a_id || m.team_a?.id)
  const bId  = Number(m.team_b_id || m.team_b?.id)
  const aWon = m.winner_id != null && Number(m.winner_id) === aId
  const bWon = m.winner_id != null && Number(m.winner_id) === bId
  const turkA = isTurkishTeam(m.team_a)
  const turkB = isTurkishTeam(m.team_b)
  const tierLetter = String(m.tournament?.tier || '').toUpperCase().replace(/[^SABCDE]/g, '').charAt(0)
  const isHero = tierLetter === 'S' || tierLetter === 'A'
  return (
    <KartLink
      to={`/match/${m.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 12px', borderRadius: 12, cursor: 'pointer',
        background: 'var(--surface)', border: '1px solid var(--line)', transition: 'background .15s, border-color .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.borderColor = 'var(--line-2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.borderColor = 'var(--line)' }}
    >
      {/* Tarih/saat — bugünse sadece saat, öncesi "13 Tem HH:MM" */}
      <span style={{ fontSize: yazi(9.5), color: 'var(--text-4)', flexShrink: 0, width: 62, textAlign: 'center', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
        {fmtWhen(m.scheduled_at)}
      </span>

      <span lang="en" style={{ fontSize: yazi(8), padding: '2px 0', width: 34, textAlign: 'center', borderRadius: 4, background: 'var(--line)', color: 'var(--text-3)', fontWeight: 700, letterSpacing: '.4px', flexShrink: 0 }}>
        {oyunKisa(m)}
      </span>

      {/* Team A (sağa hizalı, merkeze doğru) */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: aWon ? 800 : 600, color: aWon ? 'var(--text-1)' : 'var(--text-5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130, textAlign: 'right' }}>
          {m.team_a?.name || '?'}{turkA && <TrBadge />}
        </span>
        <InitialsImage src={m.team_a?.logo_url} alt={m.team_a?.name || ''} name={m.team_a?.name} width={18} height={18} borderRadius={4} objectFit='contain' />
      </div>

      {/* Skor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontWeight: 900, fontSize: 15 }}>
        <span style={{ color: aWon ? 'var(--yesil-fg)' : 'var(--text-5)' }}>{cs.team_a_score ?? '–'}</span>
        <span style={{ color: 'var(--track)', fontSize: yazi(11) }}>:</span>
        <span style={{ color: bWon ? 'var(--yesil-fg)' : 'var(--text-5)' }}>{cs.team_b_score ?? '–'}</span>
      </div>

      {/* Team B */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <InitialsImage src={m.team_b?.logo_url} alt={m.team_b?.name || ''} name={m.team_b?.name} width={18} height={18} borderRadius={4} objectFit='contain' />
        <span style={{ fontSize: 12, fontWeight: bWon ? 800 : 600, color: bWon ? 'var(--text-1)' : 'var(--text-5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
          {m.team_b?.name || '?'}{turkB && <TrBadge />}
        </span>
      </div>

      {/* Tier rozeti (S/A vurgusu) */}
      {tierLetter && (
        <span style={{
          flexShrink: 0, fontSize: yazi(9), fontWeight: 800, borderRadius: 5, padding: '2px 6px',
          color: isHero ? 'var(--altin-fg)' : 'var(--text-5)',
          background: isHero ? 'rgba(240,192,64,.12)' : 'var(--surface-2)',
          border: isHero ? '1px solid rgba(240,192,64,.35)' : '1px solid #2b3a58',
        }}>{tierLetter}</span>
      )}
    </KartLink>
  )
})

/* ══════════════════════════════════════════════════════════════════════════════
   Dashboard — default export
══════════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { activeGame } = useGame()
  const {
    followedTeamIds,
    followedPlayerIds,
    followedGames,
    toggleTeamFollow,
    setFollowedTeams,
    setFollowedGames,
  } = useUser()
  const { isAuthenticated } = useAuth()
  const turkListesi = useTurkTakimlar()

  // Ham akış (get_home_feed): oyun/seviye filtresi aşağıda useMemo ile uygulanır.
  // Canlı yayın bu listeleri yerinde yamar; liveMatches vb. bunlardan türetilir.
  const [canliHam,    setCanliHam]    = useState([])
  const [yaklasanHam, setYaklasanHam] = useState([])
  const [bitenHam,    setBitenHam]    = useState([])
  const [turnuvaHam,  setTurnuvaHam]  = useState([])
  const [akisHazir,   setAkisHazir]   = useState(false)
  const [teamFormMap,          setTeamFormMap]          = useState(new Map())
  const [expandedScheduleGroups, setExpandedScheduleGroups] = useState(new Set())
  const [takipHam,        setTakipHam]        = useState([])
  const [showAllTournamentTiers, setShowAllTournamentTiers] = useState(true)
  const [quickAccess, setQuickAccess] = useState([])
  const [quickLoading, setQuickLoading] = useState(false)
  const [tickerItems, setTickerItems] = useState([])
  const [tickerLoading, setTickerLoading] = useState(false)
  const [showAllResults, setShowAllResults] = useState(false)  // Son Sonuçlar: 6 göster / hepsini aç
  const [dreamTeam, setDreamTeam] = useState([])
  const [dreamLoading, setDreamLoading] = useState(false)
  const [stats,           setStats]           = useState({ live: 0, today: 0, todayDone: 0, teams: 0 })
  const [loading,         setLoading]         = useState(true)
  const [globalError, setGlobalError] = useState('')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 920)
  const [showPreferenceWizard, setShowPreferenceWizard] = useState(false)
  const [popularTeams, setPopularTeams] = useState([])
  const [popularTeamsLoading, setPopularTeamsLoading] = useState(false)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 920)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const showGlobalConnectionWarning = useCallback((scope, error) => {
    console.error(`${scope}:`, error?.message || error)
    setGlobalError(DASHBOARD_GLOBAL_ERROR_TEXT)
  }, [])

  useEffect(() => {
    if (!globalError) return undefined
    const timer = window.setTimeout(() => setGlobalError(''), 5500)
    return () => window.clearTimeout(timer)
  }, [globalError])

  const markPreferenceWizardSeen = useCallback(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DASHBOARD_PREF_WIZARD_SEEN_KEY, '1')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Prompt'u SADECE giriş yapmış kullanıcıya aç (kayıt sonrası onboarding anı).
    // Anonim ilk ziyaretçi bloke edilmez → içeriği hemen görür (bounce↓, kayıt teşviki↑).
    // Anonim yine de üstteki "Tercihleri Düzenle" ile manuel açabilir.
    if (!isAuthenticated) return
    const seen = window.localStorage.getItem(DASHBOARD_PREF_WIZARD_SEEN_KEY)
    if (!seen) setShowPreferenceWizard(true)
  }, [isAuthenticated])

  useEffect(() => {
    if (!showPreferenceWizard) return

    let cancelled = false

    async function fetchPopularTeams() {
      setPopularTeamsLoading(true)
      try {
        const searchFilter = POPULAR_TEAM_SEARCH_TERMS.map(term => `name.ilike.%${term}%`).join(',')

        let { data, error } = await supabase
          .from('teams')
          .select('id,name,logo_url,game_id,game:games(id,name,slug)')
          .or(searchFilter)
          .limit(18)

        if (error) throw error

        if (!data || data.length === 0) {
          const fallbackRes = await supabase
            .from('teams')
            .select('id,name,logo_url,game_id,game:games(id,name,slug)')
            .order('name', { ascending: true })
            .limit(12)

          if (fallbackRes.error) throw fallbackRes.error
          data = fallbackRes.data || []
        }

        const rank = name => {
          const normalized = String(name || '').toLowerCase()
          const idx = POPULAR_TEAM_SEARCH_TERMS.findIndex(term => normalized.includes(term))
          return idx < 0 ? 99 : idx
        }

        const prepared = [...(data || [])]
          .sort((a, b) => {
            const diff = rank(a.name) - rank(b.name)
            if (diff !== 0) return diff
            return String(a.name || '').localeCompare(String(b.name || ''), 'tr')
          })
          .slice(0, 12)

        if (!cancelled) setPopularTeams(prepared)
      } catch (e) {
        if (!cancelled) setPopularTeams([])
        console.error('Dashboard preferences teams fetch:', e?.message || e)
      } finally {
        if (!cancelled) setPopularTeamsLoading(false)
      }
    }

    fetchPopularTeams()
    return () => { cancelled = true }
  }, [showPreferenceWizard])

  const handlePreferenceWizardClose = useCallback(() => {
    markPreferenceWizardSeen()
    setShowPreferenceWizard(false)
  }, [markPreferenceWizardSeen])

  const handlePreferenceWizardSave = useCallback(({ gameIds, teamIds, teamGameMap }) => {
    setFollowedTeams(teamIds || [], { teamGameMap })
    setFollowedGames(gameIds || [], { teamIds, teamGameMap })
    markPreferenceWizardSeen()
    setShowPreferenceWizard(false)
  }, [setFollowedGames, setFollowedTeams, markPreferenceWizardSeen])

  // Canlı kanal bağlıyken skor/durum yayınla anında geliyor → tam yenileme seyrek.
  // Kanal kopuksa eski davranış (dakikada bir). Sekme gizliyken hiç yenilenmez.
  const canliBagli = useCanliBaglanti()
  const yenilemeAraligi = canliBagli ? DASHBOARD_YENILEME_CANLI_MS : DASHBOARD_YENILEME_YEDEK_MS

  // Tek istek: canlı, yaklaşan, biten (100), aktif turnuvalar, takım formu.
  // Eskiden 3 kademeli şelaleyle ~11 istek + dakikada ~9 yoklama isteğiydi.
  const akisIstegiRef = useRef(0)
  const akisiYukle = useCallback(async () => {
    const istek = ++akisIstegiRef.current
    try {
      const akis = await anaSayfaAkisiniGetir()
      if (istek !== akisIstegiRef.current) return  // arada daha yeni istek başladı

      setCanliHam(Array.isArray(akis?.canli) ? akis.canli : [])
      setYaklasanHam(Array.isArray(akis?.yaklasan) ? akis.yaklasan : [])
      setBitenHam(Array.isArray(akis?.biten) ? akis.biten : [])
      setTurnuvaHam(Array.isArray(akis?.turnuvalar) ? akis.turnuvalar : [])

      const formMap = new Map()
      for (const row of akis?.form || []) {
        const arr = String(row.form || '').split('').filter(c => c === 'W' || c === 'L')
        if (arr.length) formMap.set(Number(row.team_id), arr)
      }
      setTeamFormMap(formMap)
      setAkisHazir(true)
      setGlobalError('')
    } catch (e) {
      showGlobalConnectionWarning('Dashboard fetch', e)
    } finally {
      // Yalnız ilk yükleme iskelet gösterir; periyodik yenilemede kartlar yerinde kalır.
      if (istek === akisIstegiRef.current) setLoading(false)
    }
  }, [showGlobalConnectionWarning])

  useEffect(() => { akisiYukle() }, [akisiYukle])
  useYenileme(akisiYukle, yenilemeAraligi)

  // Oyun ve seviye filtresi istemcide: seçim değişince yeniden istek atılmaz.
  const oyunVeSeviye = useCallback(rows => filterMatchesByTournamentTier(
    (rows || []).filter(m => matchesDashboardGame(m, activeGame)),
    showAllTournamentTiers,
  ), [activeGame, showAllTournamentTiers])

  // Canlı + yaklaşan tek havuz: yayınla durumu değişen maç (başladı/bitti), tam
  // yenilemeyi beklemeden doğru listeye geçer ya da listeden düşer.
  const acikMaclar = useMemo(() => {
    const byId = new Map()
    for (const m of [...canliHam, ...yaklasanHam]) if (m?.id && !byId.has(m.id)) byId.set(m.id, m)
    return [...byId.values()].sort((a, b) =>
      zamanDamgasi(a.scheduled_at) - zamanDamgasi(b.scheduled_at) || Number(a.id) - Number(b.id))
  }, [canliHam, yaklasanHam])

  const liveMatches = useMemo(
    () => oyunVeSeviye(acikMaclar.filter(m => normalizeMatchStatus(m.status) === 'running')),
    [acikMaclar, oyunVeSeviye],
  )
  const upcomingMatches = useMemo(
    () => oyunVeSeviye(acikMaclar.filter(m => isUpcomingStatus(m.status))),
    [acikMaclar, oyunVeSeviye],
  )

  // Canlı bölümün sırası: takip edilen > Türk takımı > S/A > diğer; eşitlikte başlama
  // saati, sonra id (kararlı). Eskiden "Tümü"de ilk ekranı tier C/D maçlar dolduruyordu.
  const liveSirali = useMemo(() => {
    const favSet = new Set((followedTeamIds || []).map(String))
    return [...liveMatches].sort((a, b) =>
      onemSirasi(a, favSet) - onemSirasi(b, favSet)
      || zamanDamgasi(a.scheduled_at) - zamanDamgasi(b.scheduled_at)
      || Number(a.id) - Number(b.id))
    // turkListesi: Türk takımı listesi gelince sıra yeniden hesaplanır
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMatches, followedTeamIds, turkListesi])

  // Sayaçlar: "Bugün" eskiden 7 günlük yaklaşan listenin tamamını, "Toplam" canlı+yaklaşanı
  // sayıyordu (bölüm başlığı "Bugün 18 maç" derken kutu "Bugün 30"). Artık yalnız bugünün
  // maçları. Akış sınırlı (AKIS_*_SINIRI); sınıra dayandıysa sayı eksiktir → "+" ile gösterilir.
  useEffect(() => {
    const bugunStr = new Date().toDateString()
    const bugunMu = m => m?.scheduled_at && new Date(m.scheduled_at).toDateString() === bugunStr
    const bitenFiltreli = oyunVeSeviye(bitenHam.filter(m => normalizeMatchStatus(m.status) === 'finished'))
    setStats({
      live:  liveMatches.length,
      today: upcomingMatches.filter(bugunMu).length,
      todayPlus: yaklasanHam.length >= AKIS_YAKLASAN_SINIRI && bugunMu(yaklasanHam[yaklasanHam.length - 1]),
      todayDone: bitenFiltreli.filter(bugunMu).length,
      todayDonePlus: bitenHam.length >= AKIS_BITEN_SINIRI && bugunMu(bitenHam[bitenHam.length - 1]),
      teams: new Set([...liveMatches, ...upcomingMatches].flatMap(m => [m.team_a_id, m.team_b_id]).filter(Boolean)).size,
    })
  }, [liveMatches, upcomingMatches, yaklasanHam, bitenHam, oyunVeSeviye])

  // Aktif üst-tier turnuvalar: bugün begin_at–end_at arasında olan S/A turnuvalar
  // + katılan takım logoları (akışta hazır gelir). Canlı maçların altında gösterilir.
  const activeTournaments = useMemo(() => {
    let list = turnuvaHam.filter(t => {
      const k = normalizeTierKey(t.tier)
      return k === 'S' || k === 'A'
    })
    if (activeGame && activeGame !== 'all') {
      list = list.filter(t => normalizeGameId(t.game?.slug ?? t.game?.name) === activeGame)
    }
    return list.slice(0, 12).map(t => ({ ...t, teams: Array.isArray(t.teams) ? t.teams : [] }))
  }, [turnuvaHam, activeGame])

  // Fextopus isabet paneli: son 30 sonuçlanmış maç (eskiden 45 sn'de bir ayrı istek).
  const accuracyRows = useMemo(
    () => bitenHam.filter(m => m.winner_id != null).slice(0, 30),
    [bitenHam],
  )

  // Son Sonuçlar: öne çıkan biten maçlar (takip edilen, Türk takımı ya da S/A turnuva);
  // takip edilenler en üstte, sonra tarih (biten zaten tarih-desc, stable sort korunur).
  // Şeridin "SONUÇ" satırları da bu listeden: eskiden bölüm yalnız S/A, şerit her seviyeyi
  // gösteriyordu (tier C maç şeritte "haber" oluyordu). Türk takımının TCL maçı artık burada.
  const recentResults = useMemo(() => {
    const favSet = new Set((followedTeamIds || []).map(String))
    return oyunVeSeviye(bitenHam)
      .filter(m => onemSirasi(m, favSet) < 3)
      .sort((a, b) => (onemSirasi(a, favSet) === 0 ? 0 : 1) - (onemSirasi(b, favSet) === 0 ? 0 : 1))
      .slice(0, 15)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bitenHam, oyunVeSeviye, followedTeamIds, turkListesi])

  const handleToggleFav = useCallback((teamId) => {
    if (!teamId) return
    toggleTeamFollow(teamId)
  }, [toggleTeamFollow])


  // Yayın yapısal değişim bildirince (maç başladı/bitti, yeni maç, yeniden bağlanma)
  // tam akışı tazele; ardışık olayları tek isteğe topla.
  const yenidenYukleRef = useRef(null)
  const yenidenYuklePlanla = useCallback(() => {
    clearTimeout(yenidenYukleRef.current)
    yenidenYukleRef.current = setTimeout(() => { akisiYukle() }, DASHBOARD_YAYIN_TOPLAMA_MS)
  }, [akisiYukle])
  useEffect(() => () => clearTimeout(yenidenYukleRef.current), [])

  // Takip akışı yenileyicisi aşağıda tanımlı; yayın dinleyicisi en güncele ref ile erişir.
  const takipYukleRef = useRef(null)

  useEffect(() => {
    const unsubscribe = subscribeToMatchesUpdates(payload => {
      if (payload?.eventType === 'RESYNC') {
        // Bağlantı koptu ve geri geldi: aradaki değişimler kaçmış olabilir.
        yenidenYuklePlanla()
        takipYukleRef.current?.()
        return
      }

      const nextRow = payload?.new
      if (!nextRow?.id) return
      const nextStatus = normalizeMatchStatus(nextRow.status)

      if (payload.eventType === 'INSERT') {
        // Yayın satırı takım/turnuva adı taşımaz → yarım kart eklemek yerine,
        // listelere girecek yeni maç varsa akışı tazele.
        if (nextStatus === 'running' || (isUpcomingStatus(nextStatus) && yaklasanPencerede(nextRow.scheduled_at))) {
          yenidenYuklePlanla()
        }
        return
      }

      // Skor/durum/saat yerinde yamanır (takım ve turnuva nesneleri korunur).
      // Maç bir listede yoksa o liste aynı kalır → gereksiz render yok.
      setCanliHam(prev => maclariYamala(prev, nextRow))
      setYaklasanHam(prev => maclariYamala(prev, nextRow))
      setBitenHam(prev => maclariYamala(prev, nextRow))
      setTakipHam(prev => maclariYamala(prev, nextRow))

      // Başlayan/biten maç: biten listesi, form ve sayılar için tam yenileme.
      if (normalizeMatchStatus(payload?.old?.status) !== nextStatus) yenidenYuklePlanla()
    })

    return () => {
      unsubscribe?.()
    }
  }, [yenidenYuklePlanla])

  // Takip Ettiklerim: takip edilen takım/oyuncuların yakın maçları (kullanıcıya özel,
  // bu yüzden ana akıştan ayrı). Oyun/seviye filtresi istemcide uygulanır.
  const takipIstegiRef = useRef(0)
  const takipYukle = useCallback(async () => {
    const istek = ++takipIstegiRef.current
    try {
      // Takip edilen oyunculardan takım ID'lerini topla.
      let teamIds = [...followedTeamIds]

      if (followedPlayerIds.length > 0) {
        const { data: playerRows } = await supabase
          .from('players')
          .select('id, team_pandascore_id')
          .in('id', followedPlayerIds)

        const playerTeamIds = (playerRows || [])
          .map(p => p.team_pandascore_id)
          .filter(Boolean)

        teamIds = [...new Set([...teamIds, ...playerTeamIds])]
      }

      if (teamIds.length === 0) {
        if (istek === takipIstegiRef.current) setTakipHam([])
        return
      }

      const orFilter = teamIds
        .flatMap(id => [`team_a_id.eq.${id}`, `team_b_id.eq.${id}`])
        .join(',')

      const now = new Date()
      const recentUpcomingFloor = new Date(now.getTime() - (6 * 60 * 60 * 1000))
      const soon = new Date(now)
      soon.setDate(now.getDate() + UPCOMING_WINDOW_DAYS)

      const { data, error } = await supabase
        .from('matches')
        .select(`
          id, status, scheduled_at,
          team_a_id, team_b_id, winner_id,
          team_a_score, team_b_score,
          prediction_team_a, prediction_team_b, prediction_confidence,
          team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
          team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
          tournament:tournaments(id,name,tier,league_name,event_name,display_name,region),
          game:games(id,name,slug)
        `)
        .or(orFilter)
        .in('status', ['not_started', 'upcoming', 'running'])
        .gte('scheduled_at', recentUpcomingFloor.toISOString())
        .lte('scheduled_at', soon.toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(40)

      if (error) throw error
      if (istek !== takipIstegiRef.current) return
      setTakipHam(data || [])
      setGlobalError('')
    } catch (e) {
      showGlobalConnectionWarning('Dashboard my-feed fetch', e)
    }
  }, [followedTeamIds, followedPlayerIds, showGlobalConnectionWarning])

  useEffect(() => { takipYukleRef.current = takipYukle }, [takipYukle])
  useEffect(() => { takipYukle() }, [takipYukle])
  useYenileme(takipYukle, yenilemeAraligi, followedTeamIds.length > 0 || followedPlayerIds.length > 0)

  const myFeedMatches = useMemo(() => oyunVeSeviye(takipHam).filter(m => {
    const s = normalizeMatchStatus(m.status)
    return s === 'running' || isUpcomingStatus(s)
  }), [takipHam, oyunVeSeviye])
  const liveFavCount = useMemo(
    () => myFeedMatches.filter(m => normalizeMatchStatus(m.status) === 'running').length,
    [myFeedMatches],
  )

  useEffect(() => {
    let cancelled = false

    async function buildQuickAccess() {
      const hasAnyFollow = followedTeamIds.length > 0 || followedPlayerIds.length > 0
      if (!hasAnyFollow) {
        setQuickAccess([])
        setQuickLoading(false)
        return
      }

      setQuickLoading(true)
      try {
        const [playersRes, teamsRes] = await Promise.all([
          followedPlayerIds.length
            ? supabase
              .from('players')
              .select('id,nickname,image_url,team_pandascore_id')
              .in('id', followedPlayerIds)
            : { data: [], error: null },
          supabase
            .from('teams')
            // game: Hızlı Erişim kartı takımın oyununu yazıyor (sadece logo yetmiyordu).
            .select('id,name,logo_url,game_id,game:games(id,name,slug)')
            .in('id', [...new Set([...followedTeamIds, ...myFeedMatches.flatMap(m => [m.team_a_id, m.team_b_id]).filter(Boolean)])]),
        ])

        if (playersRes?.error) throw playersRes.error
        if (teamsRes?.error) throw teamsRes.error

        const teamsById = new Map((teamsRes.data || []).map(team => [String(team.id), team]))
        const teamMatchMap = new Map()
        const liveTeamSet = new Set()
        const teamFrequency = new Map()

        for (const m of myFeedMatches) {
          const ids = [m.team_a_id, m.team_b_id].filter(Boolean)
          ids.forEach(id => {
            const key = String(id)
            if (!teamMatchMap.has(key)) teamMatchMap.set(key, m.id)
            teamFrequency.set(key, (teamFrequency.get(key) || 0) + 1)
            if (m.status === 'running') liveTeamSet.add(key)
          })
        }

        // Takımın oyununu kart alt satırında göstermek için tek yerden çöz.
        const gameMetaOf = team => {
          const gid = normalizeGameId(team?.game?.slug ?? team?.game?.name ?? team?.game_id)
          const meta = GAMES.find(g => g.id === gid)
          return { gameLabel: meta?.shortLabel || meta?.label || null, gameColor: meta?.color || null }
        }

        const teamEntries = followedTeamIds.map(id => {
          const key = String(id)
          const team = teamsById.get(key)
          const freq = teamFrequency.get(key) || 0
          return {
            type: 'team',
            id,
            label: team?.name || `Takım ${id}`,
            image: team?.logo_url || null,
            fallback: String(team?.name || 'T').slice(0, 2).toUpperCase(),
            isLive: liveTeamSet.has(key),
            matchId: teamMatchMap.get(key) || null,
            ...gameMetaOf(team),
            score: (liveTeamSet.has(key) ? 100 : 0) + (freq * 8) + 40,
          }
        })

        const playerEntries = (playersRes.data || []).map(player => {
          const teamKey = player.team_pandascore_id ? String(player.team_pandascore_id) : null
          const freq = teamKey ? (teamFrequency.get(teamKey) || 0) : 0
          const meta = teamKey ? gameMetaOf(teamsById.get(teamKey)) : {}
          return {
            type: 'player',
            id: player.id,
            label: player.nickname || 'Oyuncu',
            image: player.image_url || null,
            fallback: String(player.nickname || 'P').slice(0, 2).toUpperCase(),
            isLive: teamKey ? liveTeamSet.has(teamKey) : false,
            matchId: teamKey ? (teamMatchMap.get(teamKey) || null) : null,
            ...meta,
            score: (teamKey && liveTeamSet.has(teamKey) ? 90 : 0) + (freq * 6) + 30,
          }
        })

        const merged = [...teamEntries, ...playerEntries]
          .sort((a, b) => b.score - a.score)
          .slice(0, 14)

        if (!cancelled) setQuickAccess(merged)
      } catch (e) {
        if (!cancelled) setQuickAccess([])
        console.error('Dashboard quick-access build:', e?.message || e)
      } finally {
        if (!cancelled) setQuickLoading(false)
      }
    }

    buildQuickAccess()
    return () => { cancelled = true }
  }, [followedTeamIds, followedPlayerIds, myFeedMatches])

  // Haber/canlı akış şeridi: maçlar akıştaki listelerden türetilir; haber başlıkları
  // news_articles'tan oturumda bir kez çekilir (yalnız yayımlanmış gerçek haberler).
  const haberBasliklariRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    const followScope = [...(followedTeamIds || [])].map(id => String(id)).sort().join('-') || 'none'
    const cacheScope = `${activeGame || 'all'}_${showAllTournamentTiers ? 'all' : 'hero'}_${followScope}`

    if (!akisHazir) {
      // Stale-while-revalidate: akış gelene kadar önbellekteki şeridi göster.
      const cachedTicker = safeReadCache(DASHBOARD_TICKER_CACHE_KEY)
      if (isFreshCache(cachedTicker, cacheScope) && Array.isArray(cachedTicker?.items) && cachedTicker.items.length > 0) {
        setTickerItems(cachedTicker.items)
        setTickerLoading(false)
        return undefined
      }
      setTickerLoading(true)
      return undefined
    }

    // Canlı ve sonuç satırları bölümlerle aynı liste ve sıra (önem sırası, öne çıkan sonuçlar)
    const running = liveSirali.slice(0, 7)
    const finished = recentResults
    const upcoming = oyunVeSeviye(acikMaclar.filter(m => isUpcomingStatus(m.status)).slice(0, 30))

    ;(async () => {
      if (!haberBasliklariRef.current) {
        // Haber yalnız şeridi zenginleştirir → hatası şeridi düşürmez.
        const { data, error } = await supabase
          .from('news_articles')
          .select('id,title,content_type,match_id,tournament_id,game_slug,created_at')
          .order('created_at', { ascending: false })
          .limit(16)
        if (error) console.error('Dashboard ticker news:', error.message || error)
        haberBasliklariRef.current = error ? [] : (data || [])
      }
      if (cancelled) return

      const secili = activeGame && activeGame !== 'all' ? normalizeGameId(activeGame) : null
      const haberler = haberBasliklariRef.current
        .filter(r => r.title && (!secili || !r.game_slug || normalizeGameId(r.game_slug) === secili))
        .slice(0, 5)
      const prepared = buildTickerLines({ running, finished, upcoming, haberler, followedTeamIds }).slice(0, 36)

      setTickerItems(prepared)
      setTickerLoading(false)
      safeWriteCache(DASHBOARD_TICKER_CACHE_KEY, {
        scope: cacheScope,
        updatedAt: Date.now(),
        items: prepared,
      })
    })().catch(e => {
      if (cancelled) return
      showGlobalConnectionWarning('Dashboard ticker feed', e)
      setTickerLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [akisHazir, acikMaclar, liveSirali, recentResults, oyunVeSeviye, activeGame, followedTeamIds, showAllTournamentTiers, showGlobalConnectionWarning])

  useEffect(() => {
    if (MVP_HIDE_DREAM_TEAM) {
      setDreamTeam([])
      setDreamLoading(false)
      return
    }

    let cancelled = false

    async function fetchDreamTeam() {
      setDreamLoading(true)
      try {
        const dreamGameId = ['valorant', 'cs2', 'lol'].includes(activeGame) ? activeGame : 'valorant'
        const sinceIso = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString()

        const { data: recentMatches, error: matchesErr } = await supabase
          .from('matches')
          .select('id,scheduled_at,game:games(id,name,slug)')
          .eq('status', 'finished')
          .gte('scheduled_at', sinceIso)
          .order('scheduled_at', { ascending: false })
          .limit(1200)

        if (matchesErr) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const filteredMatchIds = (recentMatches || [])
          .filter(match => gameMatchesFilter(match.game?.name || match.game?.slug || '', dreamGameId))
          .map(match => match.id)

        if (filteredMatchIds.length === 0) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const { data: statRows, error: statErr } = await supabase
          .from('player_match_stats')
          .select('id,player_id,match_id,impact_score,stats,created_at')
          .in('match_id', filteredMatchIds)
          .limit(25000)

        if (statErr) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const getImpactScore = row => {
          if (typeof row?.impact_score === 'number' && Number.isFinite(row.impact_score)) return row.impact_score
          const nested = row?.stats || {}
          const fallback = Number(nested.impact_score ?? nested.impact ?? nested.rating ?? nested.mvp_score ?? 0)
          return Number.isFinite(fallback) ? fallback : 0
        }

        const getRowTs = row => {
          const ts = row?.created_at || row?.updated_at || row?.date || null
          if (!ts) return 0
          const ms = new Date(ts).getTime()
          return Number.isFinite(ms) ? ms : 0
        }

        const byPlayer = new Map()
        for (const row of (statRows || [])) {
          const playerId = row?.player_id
          if (!playerId) continue
          if (!byPlayer.has(playerId)) {
            byPlayer.set(playerId, { totalImpact: 0, sampleMatches: 0, latestTs: 0, lastImpact: 0 })
          }

          const impact = getImpactScore(row)
          const ts = getRowTs(row)
          const entry = byPlayer.get(playerId)
          entry.totalImpact += impact
          entry.sampleMatches += 1
          if (ts >= entry.latestTs) {
            entry.latestTs = ts
            entry.lastImpact = impact
          }
        }

        const playerIds = [...byPlayer.keys()]
        if (playerIds.length === 0) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const { data: playersRows, error: playersErr } = await supabase
          .from('players')
          .select('id,nickname,image_url,team_pandascore_id')
          .in('id', playerIds)

        if (playersErr) {
          if (!cancelled) setDreamTeam([])
          return
        }

        const teamIds = [...new Set((playersRows || []).map(row => row.team_pandascore_id).filter(Boolean))]
        const { data: teamsRows } = teamIds.length
          ? await supabase.from('teams').select('id,name,logo_url').in('id', teamIds)
          : { data: [] }

        const playersMap = new Map((playersRows || []).map(row => [String(row.id), row]))
        const teamsMap = new Map((teamsRows || []).map(row => [String(row.id), row]))

        const ranked = [...byPlayer.entries()]
          .map(([playerId, agg]) => {
            const player = playersMap.get(String(playerId))
            if (!player || agg.sampleMatches <= 0) return null

            const avgImpact = agg.totalImpact / agg.sampleMatches
            const momentum = avgImpact > 0
              ? ((agg.lastImpact - avgImpact) / Math.max(Math.abs(avgImpact), 1)) * 100
              : 0

            const team = player.team_pandascore_id
              ? teamsMap.get(String(player.team_pandascore_id))
              : null

            return {
              id: player.id,
              nickname: player.nickname,
              image_url: player.image_url,
              team,
              avgImpact,
              sampleMatches: agg.sampleMatches,
              lastImpact: agg.lastImpact,
              momentum,
              score: avgImpact,
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.avgImpact - a.avgImpact)
          .slice(0, 5)

        if (!cancelled) setDreamTeam(ranked)
      } catch {
        if (!cancelled) setDreamTeam([])
      } finally {
        if (!cancelled) setDreamLoading(false)
      }
    }

    fetchDreamTeam()
    return () => { cancelled = true }
  }, [activeGame])

  const dreamGameLabel = activeGame === 'all'
    ? 'VAL'
    : activeGame === 'cs2'
      ? 'CS2'
      : activeGame === 'lol'
        ? 'LoL'
        : 'VAL'

  const accuracySummary = useMemo(
    () => calculatePredictionAccuracy(accuracyRows),
    [accuracyRows],
  )

  const preferredGameLabels = useMemo(
    () => PREFERENCE_GAMES
      .filter(game => followedGames.includes(game.id))
      .map(game => game.shortLabel),
    [followedGames],
  )

  const confidenceTone = useMemo(() => {
    const rate = accuracySummary.accuracyRate
    if (rate == null) return {
      accent: '#9aa0a6',
      border: 'rgba(120,120,120,.35)',
      bg: 'linear-gradient(120deg, rgba(120,120,120,.12), rgba(15,15,15,.95))',
      text: 'Veri toplanıyor',
    }
    if (rate >= 75) return {
      accent: '#4CAF50',
      border: 'rgba(76,175,80,.5)',
      bg: 'linear-gradient(120deg, rgba(76,175,80,.18), rgba(15,15,15,.96))',
      text: 'Fextopus güvenli bantta',
    }
    if (rate >= 60) return {
      accent: '#FFB800',
      border: 'rgba(255,184,0,.5)',
      bg: 'linear-gradient(120deg, rgba(255,184,0,.15), rgba(15,15,15,.95))',
      text: 'Fextopus dengeli bantta',
    }
    return {
      accent: '#FF4655',
      border: 'rgba(255,70,85,.5)',
      bg: 'linear-gradient(120deg, rgba(255,70,85,.16), rgba(15,15,15,.95))',
      text: 'Fextopus risk bandında',
    }
  }, [accuracySummary.accuracyRate])

  /* ── Stat tile tanımları ── */
  const statTiles = useMemo(() => [
    // value SAYI kalıyor (string '…' değil) — CountUp 0'dan sayabilsin diye.
    // Yükleniyor durumu ayrı bayrak; sayaç ancak veri gelince başlar.
    { Icon: Radio,       value: stats.live,      label: 'Canlı',       color: '#FF4655' },
    { Icon: Clock,       value: stats.today,     label: 'Bugün kalan', color: '#FFB800', arti: stats.todayPlus },
    { Icon: CircleCheck, value: stats.todayDone, label: 'Bugün biten', color: '#6366f1', arti: stats.todayDonePlus },
    { Icon: Shield,      value: stats.teams,     label: 'Takımlar',    color: '#4CAF50' },
  ], [stats])

  // ── Asansör (kurucu fikri, /turk-takimlari ile ortak bileşen): sırası sayfadaki sırayla aynı.
  // Koşullu bölümler (takip, canlı, turnuva, sonuç) yoksa asansörde de yok.
  const takipVar = followedTeamIds.length > 0 || followedPlayerIds.length > 0
  const canliBolumVar = loading || liveMatches.length > 0
  const anaBolumler = useMemo(() => [
    takipVar && { id: 'takip', baslik: 'Takip ettiklerim', kisa: 'Takip', ikon: b => <Star size={b} /> },
    canliBolumVar && { id: 'canli', baslik: 'Şu an canlı', kisa: 'Canlı', ikon: b => <Radio size={b} /> },
    activeTournaments.length > 0 && { id: 'turnuvalar', baslik: 'Aktif turnuvalar', kisa: 'Turnuvalar', ikon: b => <Trophy size={b} /> },
    recentResults.length > 0 && { id: 'sonuclar', baslik: 'Son sonuçlar', kisa: 'Sonuçlar', ikon: b => <Flag size={b} /> },
    { id: 'program', baslik: 'Maç programı', kisa: 'Program', ikon: b => <CalendarDays size={b} /> },
  ].filter(Boolean), [takipVar, canliBolumVar, activeTournaments.length, recentResults.length])
  const { aktif: aktifBolum, vurgu: vurguBolum, git: bolumeGit, ustPay } = useAsansor(anaBolumler, isMobile)
  // Asansörle gelinen bölümün başlığı kısa bir an parlar (box-shadow: yerleşim kaymaz)
  const baslikStil = id => ({
    borderRadius: 8, transition: 'background .7s ease, box-shadow .7s ease',
    background: vurguBolum === id ? FEXT.accentSoftBg : 'transparent',
    boxShadow: vurguBolum === id ? `0 0 0 6px ${FEXT.accentSoftBg}` : 'none',
  })
  const liveGorunen = liveSirali.slice(0, CANLI_GOSTER)

  return (
    <div style={{ background: 'var(--bg)', minHeight: 'calc(100vh - 58px)' }}>
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: isMobile ? '14px 12px 44px' : '20px 18px 60px', color: 'var(--text-1)' }}>
    {isMobile && <MobilAsansor bolumler={anaBolumler} aktif={aktifBolum} onGit={bolumeGit} kenar={12} />}
    <div style={isMobile ? undefined : { display: 'grid', gridTemplateColumns: `${ASANSOR_SUTUN}px minmax(0,1fr)`, gap: 20 }}>
    {!isMobile && <Asansor bolumler={anaBolumler} aktif={aktifBolum} onGit={bolumeGit} />}
    <div style={{ minWidth: 0 }}>

      {globalError && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 12,
          border: '1px solid rgba(255,140,154,.45)',
          background: 'linear-gradient(120deg, rgba(255,70,85,.18), rgba(15,15,15,.95))',
          color: '#ffd6dc',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '.15px',
          display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <TriangleAlert size={14} /> {globalError}
        </div>
      )}

      {/* Hızlı Erişim başlığı + tercih butonu AYNI satırda.
          Eskiden tercih butonu tek başına tam satır kaplıyor ve Hızlı Erişim'i
          bir satır aşağı itiyordu — üstte gereksiz boşluk oluşuyordu. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, marginBottom: 10, minHeight: 38,
      }}>
        <span style={{
          fontSize: yazi(10), fontWeight: 800, color: 'var(--text-3)',
          letterSpacing: '.9px', textTransform: 'uppercase',
        }}>
          {(quickLoading || quickAccess.length > 0) ? 'Hızlı Erişim' : ''}
        </span>

        <button
          onClick={() => setShowPreferenceWizard(true)}
          title="Akışını kişiselleştir — favori oyun ve takımlarını seç"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            borderRadius: 999,
            border: `1px solid ${FEXT.accentBorder}`,
            background: FEXT.accentSoftBg,
            color: 'var(--accent-fg)',
            fontSize: yazi(11),
            fontWeight: 700,
            letterSpacing: '.2px',
            padding: '9px 14px',
            minHeight: 38,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            transition: 'background .18s, border-color .18s, transform .18s cubic-bezier(.2,.8,.3,1)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(194,92,208,.2)'
            e.currentTarget.style.borderColor = 'rgba(194,92,208,.62)'
            e.currentTarget.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = FEXT.accentSoftBg
            e.currentTarget.style.borderColor = FEXT.accentBorder
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          <SlidersHorizontal size={13} strokeWidth={2.2} />
          {(preferredGameLabels.length > 0 || followedTeamIds.length > 0)
            ? `Tercihlerin · ${followedTeamIds.length} takım`
            : 'Kişiselleştir'}
        </button>
      </div>

      <QuickAccessBar entries={quickAccess} loading={quickLoading} />

      {/* Turnuva seviye filtresi — eskiden başlık + açıklama + buton olan iki
          satırlık bir karttı. Artık tek satır segmented control; aktif seçimin
          altındaki mor kapsül kayarak geçiyor (transform → GPU, layout yok). */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        flexWrap: 'wrap', marginBottom: 18,
      }}>
        <span style={{
          fontSize: yazi(10), fontWeight: 800, color: 'var(--text-4)',
          letterSpacing: '.9px', textTransform: 'uppercase',
        }}>
          Turnuva seviyesi
        </span>

        <div style={{
          position: 'relative',
          display: 'inline-flex',
          padding: 3,
          borderRadius: 999,
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
              transform: showAllTournamentTiers ? 'translateX(100%)' : 'translateX(0)',
              transition: 'transform .28s cubic-bezier(.2,.8,.3,1)',
              pointerEvents: 'none',
            }}
          />
          {[
            { key: false, label: 'Sadece S/A' },
            { key: true,  label: 'Tümü' },
          ].map(opt => {
            const active = showAllTournamentTiers === opt.key
            return (
              <button
                key={String(opt.key)}
                onClick={() => setShowAllTournamentTiers(opt.key)}
                aria-pressed={active}
                style={{
                  position: 'relative',
                  minWidth: 92,
                  border: 'none',
                  background: 'transparent',
                  color: active ? 'var(--accent-fg)' : 'var(--text-4)',
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontSize: yazi(11),
                  fontWeight: 800,
                  letterSpacing: '.3px',
                  cursor: 'pointer',
                  transition: 'color .2s',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Takip Ettiklerim (takip edilen takım/oyuncu maçları) ── */}
      {takipVar && (
        <div id="takip" style={{ marginBottom: 24, scrollMarginTop: ustPay }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, ...baslikStil('takip') }}>
            <span style={{
              fontSize: yazi(11), fontWeight: 800, color: 'var(--altin-fg)',
              letterSpacing: '1.5px', textTransform: 'uppercase',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Star size={13} strokeWidth={2.2} fill="#f0c040" /> Takip Ettiklerim
            </span>
            <span style={{
              padding: '1px 8px', borderRadius: 8,
              background: 'rgba(240,192,64,.12)', color: 'var(--altin-fg)',
              fontSize: yazi(10), fontWeight: 700,
            }}>
              {myFeedMatches.length}
            </span>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(240,192,64,.3),transparent)' }} />
          </div>

          {liveFavCount > 0 && (
            <div style={{
              marginBottom: 12,
              padding: '10px 14px', borderRadius: 12,
              background: 'rgba(255,70,85,.08)',
              border: '1px solid rgba(255,70,85,.28)',
              boxShadow: 'none',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF4655', animation: 'livePulse 1.2s infinite' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--canli-fg)' }}>
                {liveFavCount} takip edilen maç şu anda canlı!
              </span>
            </div>
          )}

          {myFeedMatches.length === 0 ? (
            <div style={{
              padding: '14px 16px', borderRadius: 12,
              background: 'var(--surface)', border: '1px solid var(--line)',
              fontSize: yazi(11), color: 'var(--text-5)', textAlign: 'center',
            }}>
              Takip ettiğin takımlar/oyuncular için yakın tarihli maç yok.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {myFeedMatches.slice(0, 8).map(m => (
                <UpcomingRow key={m.id} match={m} teamForms={teamFormMap} showDate />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Weekly Dream Team Leaderboard ── */}
      {!MVP_HIDE_DREAM_TEAM && <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: yazi(11), fontWeight: 800, color: '#ff9aa9', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={13} /> Dream Team (Week)
          </span>
          <span style={{ fontSize: yazi(10), color: '#9e9e9e', padding: '2px 8px', borderRadius: 999, border: '1px solid #2c2c2c' }}>
            Son 7 Gun • {dreamGameLabel}
          </span>
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,154,169,.3),transparent)' }} />
        </div>

        <div style={{ border: '1px solid #2b3a58', borderRadius: 14, background: 'radial-gradient(circle at 8% 8%, rgba(200,16,46,.18), transparent 35%), var(--surface)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1.5fr 1fr .9fr .9fr .9fr', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--surface-2)', fontSize: yazi(10), color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '.6px' }}>
            <div>Sıra</div><div>Oyuncu</div><div>Takım</div><div>Maç</div><div>Ort. Etki</div><div>Form</div>
          </div>
          {dreamLoading && <div style={{ padding: 14, color: 'var(--text-5)', fontSize: 12 }}>Dream Team hesaplanıyor...</div>}
          {!dreamLoading && dreamTeam.length === 0 && <div style={{ padding: 14, color: 'var(--text-5)', fontSize: 12 }}>Haftalık oyuncu verisi bulunamadı.</div>}
          {!dreamLoading && dreamTeam.map((p, idx) => (
            <KartLink key={p.id} to={`/player/${p.id}`} style={{ display: 'grid', gridTemplateColumns: '60px 1.5fr 1fr .9fr .9fr .9fr', gap: 8, alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: idx === 0 ? 'linear-gradient(90deg, rgba(200,16,46,.22), transparent 62%)' : 'transparent' }}>
              <div style={{ fontWeight: 800, color: '#f4f4f4' }}>#{idx + 1}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <InitialsImage
                  src={p.image_url}
                  alt={p.nickname || ''}
                  name={p.nickname}
                  width={28}
                  height={28}
                  borderRadius='50%'
                  objectFit='cover'
                  style={{ border: '1px solid var(--track)' }}
                />
                <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nickname || '—'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <InitialsImage
                  src={p.team?.logo_url}
                  alt={p.team?.name || ''}
                  name={p.team?.name}
                  width={20}
                  height={20}
                  borderRadius={6}
                  objectFit='contain'
                />
                <span style={{ fontSize: yazi(11), color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team?.name || 'Free Agent'}</span>
              </div>
              <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.sampleMatches}</div>
              <div style={{ fontWeight: 800, color: '#ff9aa9', fontVariantNumeric: 'tabular-nums' }}>{ondalik(p.avgImpact, 2)}</div>
              <div style={{ fontWeight: 700, color: p.momentum >= 0 ? '#7ee787' : '#ff9aa9', fontVariantNumeric: 'tabular-nums' }}>
                {p.momentum >= 0 ? '+' : '−'}{yuzde(Math.abs(p.momentum), 1)}
              </div>
            </KartLink>
          ))}
        </div>
      </div>}

      {/* ── LIVE Section ─────────────────────────────────────────────────── */}
      {/* Canlı maç yokken BÖLÜMÜN TAMAMI gizlenir (Gemini #68, 2026-09-02).
          Önceden başlık + "Şu an canlı maç yok" kutusu duruyordu ve boş
          durumda ~145px ölü alan bırakıyordu. İki ayrı beta kullanıcısı ana
          sayfayı "aşırı boşluklu" / "çok aşağı kaydırıyorum" diye tarif etti.
          HLTV ve VLR.gg de canlı maç yokken bölümü hiç göstermiyor.
          Yükleme sırasında gösterilmeye devam eder → iskelet korunur, CLS olmaz. */}
      {canliBolumVar && (
      <div id="canli" style={{ marginBottom: 24, scrollMarginTop: ustPay }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, ...baslikStil('canli') }}>
          <span style={{ fontSize: yazi(11), fontWeight: 800, color: 'var(--canli-fg)', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Radio size={13} color="#FF4655" style={{ animation: 'livePulse 1.2s infinite' }} />
            Şu An Canlı
          </span>
          {!loading && liveMatches.length > 0 && (
            <span style={{ padding: '1px 7px', borderRadius: 8, background: 'rgba(255,70,85,.15)', color: 'var(--canli-fg)', fontSize: yazi(10), fontWeight: 700 }}>
              {liveMatches.length}
            </span>
          )}
          <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,70,85,.3),transparent)' }} />
          <Link
            to="/matches?tab=live"
            style={{ ...TUMU_LINK, transition: 'color .15s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-4)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-5)'}
          >Tümü →</Link>
        </div>

        {/* Önem sırasıyla en fazla CANLI_GOSTER maç. Masaüstünde kart (satırda en fazla 4),
            mobilde kompakt satır: eskiden her kart ~bir ekrandı, 7 canlı maç 4-5 ekran kaydırmaydı. */}
        {loading ? (
          isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[1,2,3].map(i => <Sk key={i} h="74px" r="12px" />)}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(max(230px,calc((100% - 36px) / 4)),1fr))', gap: 12 }}>
              {/* Skeleton yüksekliği gerçek LiveMatchCard ile aynı → CLS'i önler */}
              {[1,2,3,4].map(i => <Sk key={i} h="222px" r="16px" />)}
            </div>
          )
        ) : isMobile ? (
          <div className="content-in" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {liveGorunen.map(m => (
              <SkorSatiri key={m.id} match={m} favs={followedTeamIds} />
            ))}
          </div>
        ) : (
          <div className="content-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(max(230px,calc((100% - 36px) / 4)),1fr))', gap: 12 }}>
            {liveGorunen.map((m, i) => (
              <LiveMatchCard
                key={m.id}
                match={m}
                oncelikli={i < 2}
                favs={followedTeamIds}
                onToggleFav={handleToggleFav}
                teamForms={teamFormMap}
              />
            ))}
          </div>
        )}
        {!loading && liveSirali.length > CANLI_GOSTER && (
          <Link
            to="/matches?tab=live"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 8,
              padding: '9px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)',
              fontSize: yazi(11), fontWeight: 700, color: 'var(--text-3)', textDecoration: 'none', transition: 'border-color .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--line-2)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)' }}
          >
            Tüm canlı maçlar ({liveSirali.length}) <ChevronRight size={13} />
          </Link>
        )}
      </div>
      )}

      {/* ── Aktif Turnuvalar (süregelen üst-tier — canlı maçların altında) ─── */}
      {activeTournaments.length > 0 && (() => {
        const liveTournIds = new Set((liveMatches || []).map(m => m.tournament?.id ?? m.tournament_id).filter(Boolean))
        // Canlı maçı olan turnuvalar en solda (şeritte ilk görünen) — kullanıcı
        // kaydırmadan "şu an oynanan" turnuvayı görsün. Sıralama kararlı:
        // canlılar kendi aralarındaki mevcut sırayı korur.
        const orderedTournaments = [
          ...activeTournaments.filter(t => liveTournIds.has(t.id)),
          ...activeTournaments.filter(t => !liveTournIds.has(t.id)),
        ]
        return (
          <div id="turnuvalar" style={{ marginBottom: 24, scrollMarginTop: ustPay }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, ...baslikStil('turnuvalar') }}>
              <span style={{ fontSize: yazi(11), fontWeight: 800, color: 'var(--ai)', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Trophy size={13} /> Aktif Turnuvalar
              </span>
              <span style={{ padding: '1px 7px', borderRadius: 8, background: 'rgba(167,139,250,.14)', color: 'var(--ai)', fontSize: yazi(10), fontWeight: 700 }}>
                {activeTournaments.length}
              </span>
              <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(167,139,250,.3),transparent)' }} />
              <Link to="/tournaments" style={TUMU_LINK}>Tümü →</Link>
            </div>
            <DragScroll className="scroll-fade-x" style={{ gap: 10, paddingBottom: 4 }} ariaLabel="Aktif turnuvalar">
              {orderedTournaments.map((t, ti) => {
                const isLiveT = liveTournIds.has(t.id)
                const tierK = normalizeTierKey(t.tier)
                return (
                  <KartLink
                    key={t.id}
                    to={`/tournament/${t.id}`}
                    draggable={false}
                    style={{
                      flexShrink: 0, width: 210, cursor: 'pointer',
                      background: 'var(--surface)', border: `1px solid ${isLiveT ? 'rgba(255,70,85,.4)' : 'var(--line)'}`,
                      borderRadius: 14, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8,
                      transition: 'border-color .15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = isLiveT ? 'rgba(255,70,85,.6)' : 'var(--line-2)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = isLiveT ? 'rgba(255,70,85,.4)' : 'var(--line)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isLiveT && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: yazi(8), fontWeight: 800, color: 'var(--canli-fg)', letterSpacing: '.5px' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF4655', animation: 'livePulse 1.2s infinite' }} /> CANLI
                        </span>
                      )}
                      <span lang="en" style={{ fontSize: yazi(8), fontWeight: 700, color: 'var(--text-5)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{t.game?.name || ''}</span>
                      {(tierK === 'S' || tierK === 'A') && (
                        <span style={{ marginLeft: 'auto', fontSize: yazi(8), fontWeight: 900, color: 'var(--altin-fg)', border: '1px solid rgba(240,192,64,.4)', borderRadius: 5, padding: '1px 5px' }}>Tier {tierK}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', minHeight: 32 }}>
                      {tournamentDisplayName(t, { game: normalizeGameId(t.game?.slug ?? t.game?.name) })}
                    </div>
                    {t.teams.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', marginTop: 2 }}>
                        {t.teams.slice(0, 6).map((tm, i) => (
                          <InitialsImage
                            key={tm.id} src={tm.logo_url} name={tm.name} alt={tm.name}
                            priority={liveMatches.length === 0 && ti === 0}
                            width={20} height={20} borderRadius={5} objectFit='contain'
                            style={{ marginLeft: i === 0 ? 0 : -4, border: '1px solid var(--surface)', background: 'var(--surface-2)' }}
                          />
                        ))}
                        {t.teams.length > 6 && <span style={{ fontSize: yazi(9), color: 'var(--text-5)', marginLeft: 6 }}>+{t.teams.length - 6}</span>}
                      </div>
                    )}
                  </KartLink>
                )
              })}
            </DragScroll>
          </div>
        )
      })()}

      {/* ── Son Sonuçlar (biten maçlar, skorlu — ana sayfada kalıcı) ───────── */}
      {recentResults.length > 0 && (
        <div id="sonuclar" style={{ marginBottom: 24, scrollMarginTop: ustPay }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, ...baslikStil('sonuclar') }}>
            <span title="Takip ettiklerin, Türk takımları ve S/A turnuvalar" style={{ fontSize: yazi(11), fontWeight: 800, color: 'var(--altin-fg)', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Flag size={13} /> Son Sonuçlar
            </span>
            <span style={{ padding: '1px 7px', borderRadius: 8, background: 'rgba(240,192,64,.14)', color: 'var(--altin-fg)', fontSize: yazi(10), fontWeight: 700 }}>
              {recentResults.length}
            </span>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(240,192,64,.3),transparent)' }} />
            <Link
              to="/matches?tab=past"
              style={{ ...TUMU_LINK, transition: 'color .15s' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-4)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-5)'}
            >Tümü →</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(showAllResults ? recentResults : recentResults.slice(0, 6)).map(m => (
              isMobile
                ? <SkorSatiri key={m.id} match={m} favs={followedTeamIds} />
                : <ResultRow key={m.id} match={m} />
            ))}
            {recentResults.length > 6 && (
              <button
                onClick={() => setShowAllResults(v => !v)}
                style={{
                  background: 'none', border: '1px solid var(--line)', borderRadius: 8,
                  color: 'var(--text-5)', fontSize: yazi(10), fontWeight: 600, cursor: 'pointer',
                  padding: '7px 0', width: '100%', transition: 'all .15s', marginTop: 2,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--text-4)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--text-5)' }}
              >
                {showAllResults ? 'Daha az göster' : `+${recentResults.length - 6} sonuç daha göster`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Haber/canlı akış şeridi — eskiden sayfanın EN ÜSTÜNDEYDİ.
          Kurucu kararı (5 Eyl): üstte duracak kadar kritik değil, üstelik
          "ana sayfa aşırı boşluklu" geri bildirimini besliyordu. Artık
          "olan bitti" ile "gelecek maçlar" arasında ayraç görevi görüyor. */}
      <LiveTicker items={tickerItems} loading={tickerLoading} />

      {/* ── Maç Programı ─────────────────────────────────────────────────── */}
      {(() => {
        const now = new Date()
        const todayStr = now.toDateString()
        const tomorrowStr = new Date(now.getTime() + 86400000).toDateString()

        // Live maçlar zaten yukarıda gösteriliyor — burada yalnızca non-live
        // Ayrıca: scheduled_at geçmiş ama hâlâ not_started olanlar stale veri (sync gecikmesi)
        const staleThreshold = now.getTime() - SAATI_GECTI_ESIGI_MS   // başlamış ama güncellenmemiş
        const scheduled = upcomingMatches.filter(m =>
          m.status !== 'running' &&
          (!m.scheduled_at || new Date(m.scheduled_at).getTime() >= staleThreshold)
        )
        const stale = upcomingMatches.filter(m =>
          m.status !== 'running' &&
          m.scheduled_at && new Date(m.scheduled_at).getTime() < staleThreshold
        )

        // Tarihe göre grupla
        const groups = []
        const seen = new Map()
        for (const m of scheduled) {
          const d = m.scheduled_at ? new Date(m.scheduled_at) : null
          const key = d ? d.toDateString() : '__unknown'
          if (!seen.has(key)) {
            seen.set(key, groups.length)
            let label
            if      (key === todayStr)    label = 'Bugün'
            else if (key === tomorrowStr) label = 'Yarın'
            else if (d) label = d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' })
            else         label = '—'
            groups.push({ key, label, matches: [] })
          }
          groups[seen.get(key)].matches.push(m)
        }

        return (
          <div id="program" style={{ marginBottom: 24, scrollMarginTop: ustPay }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, ...baslikStil('program') }}>
              <span style={{ fontSize: yazi(11), fontWeight: 800, color: 'var(--yesil-fg)', letterSpacing: '1.5px', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CalendarDays size={13} /> Maç Programı
              </span>
              {!loading && scheduled.length > 0 && (
                <span style={{ padding: '1px 7px', borderRadius: 8, background: 'rgba(76,175,80,.15)', color: 'var(--yesil-fg)', fontSize: yazi(10), fontWeight: 700 }}>
                  {scheduled.length}
                </span>
              )}
              <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(76,175,80,.3),transparent)' }} />
              <Link
                to="/matches"
                style={{ ...TUMU_LINK, transition: 'color .15s' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-4)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-5)'}
              >Tümü →</Link>
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Skeleton yüksekliği gerçek program satırı ile aynı (54px) → CLS'i önler */}
                {[1,2,3,4,5].map(i => <Sk key={i} h="54px" r="12px" />)}
              </div>
            ) : groups.length === 0 ? (
              <div style={{ padding: '16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', textAlign: 'center', fontSize: yazi(11), color: 'var(--text-4)' }}>
                Yaklaşan maç bulunamadı
              </div>
            ) : (
              <div className="content-in" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {groups.map((g, gi) => (
                  <div key={g.key}>
                    {/* Gün ayırıcı */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginTop: gi > 0 ? 14 : 0, marginBottom: 6,
                    }}>
                      <span style={{
                        fontSize: yazi(9), fontWeight: 900, letterSpacing: '.8px',
                        textTransform: 'uppercase', color: g.key === todayStr ? 'var(--yesil-fg)' : 'var(--text-4)',
                        background: g.key === todayStr ? 'rgba(76,175,80,.1)' : 'transparent',
                        border: g.key === todayStr ? '1px solid rgba(76,175,80,.25)' : '1px solid transparent',
                        padding: '2px 8px', borderRadius: 6, flexShrink: 0,
                      }}>
                        {g.label}
                      </span>
                      <div style={{ flex: 1, height: 1, background: g.key === todayStr ? 'rgba(76,175,80,.15)' : 'var(--line)' }} />
                      <span style={{ fontSize: yazi(9), color: 'var(--text-5)', flexShrink: 0 }}>{g.matches.length} maç</span>
                    </div>

                    {(() => {
                      const isExpanded = expandedScheduleGroups.has(g.key)
                      const defaultLimit = gi === 0 ? 8 : 4
                      const visible = isExpanded ? g.matches : g.matches.slice(0, defaultLimit)
                      const hidden  = g.matches.length - defaultLimit
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {visible.map(m => (
                            <UpcomingRow key={m.id} match={m} teamForms={teamFormMap} />
                          ))}
                          {!isExpanded && hidden > 0 && (
                            <button
                              onClick={() => setExpandedScheduleGroups(prev => new Set([...prev, g.key]))}
                              style={{
                                background: 'none', border: '1px solid var(--line)', borderRadius: 8,
                                color: 'var(--text-5)', fontSize: yazi(10), fontWeight: 600, cursor: 'pointer',
                                padding: '7px 0', width: '100%', transition: 'all .15s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--text-4)' }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--text-5)' }}
                            >
                              +{hidden} maç daha göster
                            </button>
                          )}
                          {isExpanded && g.matches.length > defaultLimit && (
                            <button
                              onClick={() => setExpandedScheduleGroups(prev => { const s = new Set(prev); s.delete(g.key); return s })}
                              style={{
                                background: 'none', border: '1px solid var(--line)', borderRadius: 8,
                                color: 'var(--text-5)', fontSize: yazi(10), fontWeight: 600, cursor: 'pointer',
                                padding: '7px 0', width: '100%', transition: 'all .15s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--text-4)' }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--text-5)' }}
                            >
                              Daralt ↑
                            </button>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                ))}

                {scheduled.length > 0 && (
                  <Link
                    to="/matches"
                    style={{
                      display: 'block', textAlign: 'center', padding: '9px',
                      borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--line)',
                      fontSize: yazi(10), color: 'var(--text-5)', textDecoration: 'none',
                      transition: 'all .15s', marginTop: 10,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--text-4)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--text-5)' }}
                  >
                    Tüm program →
                  </Link>
                )}

                {/* Stale maçlar — başlamış olabilir ama DB henüz güncellenemedi */}
                {stale.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontSize: yazi(9), fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase',
                        color: 'var(--text-4)', padding: '2px 8px', borderRadius: 6,
                        border: '1px solid var(--line-2)',
                      }}>
                        ⟳ Sonuç Bekleniyor
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                      <span style={{ fontSize: yazi(9), color: 'var(--text-4)' }}>veri gecikmesi</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {stale.map(m => (
                        <UpcomingRow key={m.id} match={m} teamForms={teamFormMap} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── AI Güven Paneli — birleşik (net isabet + son-30 trend), tek satır ── */}
      <div style={{
        marginBottom: 24, padding: '12px 16px', borderRadius: 14,
        border: '1px solid rgba(148,163,184,.1)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <PredictionAccuracyBadge variant="inline" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 220, justifyContent: 'flex-end' }}>
          {/* Ana sayfa akışındaki son 30 biten maç (seçili oyun, tüm seviyeler); 50/50 tahminler sayılmaz */}
          <span style={{ fontSize: yazi(11), color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            {accuracySummary.evaluatedCount
              ? `Son ${accuracySummary.evaluatedCount} tahminde ${accuracySummary.correctCount} doğru`
              : 'Son tahminler'}
          </span>
          <div style={{ flex: 1, maxWidth: 160, height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--track)' }}>
            <div style={{ height: '100%', width: `${accuracySummary.accuracyRate ?? 0}%`, background: confidenceTone.accent, transition: 'width .35s ease' }} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>
            {accuracySummary.accuracyRate == null ? '--' : `%${accuracySummary.accuracyRate}`}
          </span>
        </div>
      </div>

      {/* ── Marka + Özet İstatistikler (Bento) — canlı içerik yukarıda, bu blok alta alındı ── */}
      <div style={{
        display: 'grid',
        // Telefonda hero tam satır, 4 istatistik kartı alt alta değil 2×2 (rapor 5 Kas, Adım 3)
        gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : '2fr 1fr 1fr',
        gridTemplateRows: isMobile ? 'auto' : '1fr 1fr',
        gap: 10,
        marginBottom: 24,
        minHeight: isMobile ? 'auto' : 160,
      }}>

        {/* ── Hero tile — 2 satır boyunca sol ── */}
        <div style={{
          gridColumn: isMobile ? '1 / -1' : '1 / 2',
          gridRow: isMobile ? 'auto' : '1 / 3',
          padding: isMobile ? '20px 16px' : '28px 24px',
          borderRadius: 20,
          background: 'linear-gradient(135deg,var(--surface-2),var(--surface))',
          border: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <h1 style={{
            margin: '2px 0 8px', fontSize: 34, fontWeight: 800, letterSpacing: '-.02em',
            fontFamily: "'Baloo 2','Fredoka',system-ui,sans-serif",
          }}>
            <span style={{ color: 'var(--text)' }}>fe</span>
            <span style={{ background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              <span style={{ fontSize: '1.22em' }}>X</span>t
            </span>
          </h1>
          <p style={{ margin: '0 0 16px', fontSize: yazi(11), color: 'var(--text-5)', lineHeight: 1.6 }}>
            Canlı sonuçlar · PandaScore verileri
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { to: '/matches',  Icon: CalendarDays, label: 'Takvim',      color: '#FF4655' },
              { to: '/tournaments', Icon: Trophy, label: 'Turnuvalar', color: '#FFB800' },
            ].map(b => (
              <Link key={b.to} to={b.to} style={{ textDecoration: 'none' }}>
                <div style={{
                  padding: '6px 13px', borderRadius: 10, fontSize: yazi(11), fontWeight: 700, cursor: 'pointer',
                  background: `${b.color}18`, border: `1px solid ${b.color}44`, color: b.color,
                  transition: 'all .15s', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${b.color}28`; e.currentTarget.style.borderColor = `${b.color}88` }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${b.color}18`; e.currentTarget.style.borderColor = `${b.color}44` }}
                ><b.Icon size={13} strokeWidth={2.2} />{b.label}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── 4 Stat tile — sağdaki 2 sütuna 2×2 grid ── */}
        {statTiles.map((s, i) => (
          <div key={s.label} style={{
            gridColumn: isMobile ? 'auto' : ((i % 2 === 0) ? '2 / 3' : '3 / 4'),
            gridRow:    isMobile ? 'auto' : ((i < 2) ? '1 / 2' : '2 / 3'),
            padding: '14px 12px',
            borderRadius: 16,
            textAlign: 'center',
            background: 'linear-gradient(135deg,var(--surface-2),var(--surface))',
            border: `1px solid ${s.color}1a`,
            display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
            transition: 'border-color .2s',
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = `${s.color}44`}
            onMouseLeave={e => e.currentTarget.style.borderColor = `${s.color}1a`}
          >
            <s.Icon size={18} strokeWidth={2} color={s.color} style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 22, fontWeight: 900, color: s.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {loading ? '…' : <><CountUp value={s.value} />{s.arti ? '+' : ''}</>}
            </div>
            <div style={{ fontSize: yazi(9), color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.6px', marginTop: 4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Hızlı Linkler — 6 Bento tile (telefonda 2×3, dar masaüstünde 3×2, genişte tek satır) ── */}
      <div className="fx-hizli-linkler" style={{ display: 'grid', gap: 10 }}>
        {[
          { to: '/matches',  Icon: CalendarDays, label: 'Maç Takvimi', sub: 'Yaklaşan & Biten',  color: '#FF4655' },
          { to: '/tournaments', Icon: Trophy, label: 'Turnuvalar', sub: 'Aktif ve Geçmiş',  color: '#FFB800' },
          { to: '/turk-takimlari', Icon: Flag, label: 'Türk Takımları', sub: 'Maçlar ve kadrolar', color: '#E30A17' },
          { to: '/stats',    Icon: FextopusIcon, label: 'Fextopus', sub: 'Tahmin isabet sicili', color: '#8B5CF6' },
          { to: '/scout',    Icon: FlaskConical, label: 'Scout', sub: 'Oyuncu karşılaştırma', color: '#C25CD0' },
          { to: '/news',     Icon: Newspaper, label: 'Haberler',    sub: 'Son gelişmeler',     color: '#4CAF50' },
        ].map(l => (
          <Link key={l.to} to={l.to} style={{ textDecoration: 'none' }}>
            <div style={{
              padding: '16px 14px', borderRadius: 16,
              background: 'linear-gradient(135deg,var(--surface-2),var(--surface))',
              border: `1px solid ${l.color}18`,
              transition: 'all .18s', cursor: 'pointer',
            }}
              onMouseEnter={e => {
                e.currentTarget.style.background    = `${l.color}0c`
                e.currentTarget.style.borderColor   = `${l.color}44`
                e.currentTarget.style.transform     = 'translateY(-3px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background    = 'linear-gradient(135deg,var(--surface-2),var(--surface))'
                e.currentTarget.style.borderColor   = `${l.color}18`
                e.currentTarget.style.transform     = 'translateY(0)'
              }}
            >
              <l.Icon size={20} strokeWidth={2} color={l.color} style={{ marginBottom: 7 }} />
              {/* Başlık nötr: marka renkleri (sarı, yeşil, bayrak kırmızısı) iki temada da metin kontrastını tutmuyor; renk ikonda */}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 3 }}>{l.label}</div>
              <div style={{ fontSize: yazi(10), color: 'var(--text-4)' }}>{l.sub}</div>
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        @keyframes shimmer   { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes liveNeonBlink {
          0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(255,70,85,.55); }
          50% { opacity: .5; box-shadow: 0 0 1px rgba(255,70,85,.4); }
        }
        /* Canlı kart üst vurgusu — kırmızı yavaş & soft sağa-sola süzülür */
        @keyframes liveAccentDrift {
          0%   { background-position: 0% 0;   opacity: .8; }
          50%  { opacity: 1; }
          100% { background-position: 100% 0; opacity: .8; }
        }
        @keyframes tickerScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes dashRipple {
          0% { opacity: .8; transform: translate(-50%, -50%) scale(0.2); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(9); }
        }
        /* Hızlı Erişim kartları sırayla süzülerek girer */
        @keyframes quickCardIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        /* Tercih paneli — sert "pat" yerine yumuşak açılış */
        @keyframes prefModalIn {
          from { opacity: 0; transform: translateY(12px) scale(.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        /* Hızlı Linkler: 6 kart 5+1 ya da 4+2 kırılmasın diye yalnız 2, 3 ya da 6 sütun */
        .fx-hizli-linkler { grid-template-columns: repeat(3,minmax(0,1fr)); }
        @media (max-width: 920px) { .fx-hizli-linkler { grid-template-columns: repeat(2,minmax(0,1fr)); } }
        @media (min-width: 1240px) { .fx-hizli-linkler { grid-template-columns: repeat(6,minmax(0,1fr)); } }
        /* FavoritesBar scroll — webkit için de gizle */
        .fav-scroll::-webkit-scrollbar { display: none }
      `}</style>

      <PreferencePickerModal
        open={showPreferenceWizard}
        onClose={handlePreferenceWizardClose}
        onSave={handlePreferenceWizardSave}
        gameIds={followedGames}
        teamIds={followedTeamIds}
        popularTeams={popularTeams}
        loading={popularTeamsLoading}
      />
    </div>
    </div>
    </div>
    </div>
  )
}

