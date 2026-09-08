import { createContext, useContext, useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, requestBrowserNotificationPermission } from '../supabaseClient'
import { useAuth } from './AuthContext'
import BRANDING from '../branding.config'
import { normalizeGameId } from '../utils/gameUtils'

const STORAGE_KEY = BRANDING.followStateStorageKey
// Anonim oturum takipleri (Karar #70). sessionStorage BİLEREK seçildi:
// tarayıcı/sekme kapanınca silinir → ortak bilgisayarda önceki kişinin takip
// listesi bir sonrakine sızmaz. 15 Temmuz'da anonim takip tam da bu yüzden
// kaldırılmıştı (ba9ecd3); localStorage'a dönmek o hatayı geri getirir.
const SESSION_KEY = `${STORAGE_KEY}_session`
// "Kalıcı kaydet" teklifi bu oturumda gösterildi mi — reddedilince tekrarlamaz.
const OFFER_KEY = `${STORAGE_KEY}_offer_seen`
// Kayıt/giriş DEVİR kutusu. sessionStorage sekmeye özeldir: kullanıcı "Kalıcı
// kaydet"e basıp kaydolunca doğrulama maili çoğu zaman YENİ SEKMEDE açılır ve
// oturum takipleri oraya gelmez — yani tam da söz verdiğimiz şey kaybolur.
// Bu yüzden yalnızca kullanıcı hesap CTA'sına bastığında, kısa ömürlü bir
// devir kaydı localStorage'a yazılır. Kalıcı takip listesi DEĞİL: birleştirme
// biter bitmez veya süresi dolunca silinir.
const HANDOFF_KEY = `${STORAGE_KEY}_handoff`
const HANDOFF_TTL_MS = 30 * 60 * 1000

const UserContext = createContext(null)

// Depolama erişimi gizli sekmede / site verisi engelliyken throw edebilir.
function safeGet(store, key) {
  try { return store.getItem(key) } catch { return null }
}
function safeSet(store, key, value) {
  try { store.setItem(key, value) } catch { /* yok say */ }
}
function safeRemove(store, key) {
  try { store.removeItem(key) } catch { /* yok say */ }
}

function uniqueCanonicalGames(gameList = []) {
  return [...new Set((gameList || []).map(normalizeGameId).filter(Boolean))]
}

function sanitizeTeamGameMap(rawMap = {}) {
  if (!rawMap || typeof rawMap !== 'object') return {}
  const result = {}

  for (const [teamIdRaw, gameIdRaw] of Object.entries(rawMap)) {
    const teamId = String(teamIdRaw || '').trim()
    const gameId = normalizeGameId(gameIdRaw)
    if (!teamId || !gameId) continue
    result[teamId] = gameId
  }

  return result
}

function collectMappedGames(teamIdList = [], teamGameMap = {}) {
  return [...new Set((teamIdList || [])
    .map(teamId => teamGameMap[String(teamId)])
    .map(normalizeGameId)
    .filter(Boolean))]
}

function parseTeamIds(list = []) {
  return [...new Set((list || []).map(id => Number(id)).filter(Number.isFinite))]
}

const EMPTY_STATE = { teamIds: [], playerIds: [], gameIds: [], teamGameMap: {} }

function parseStoredState(raw) {
  if (!raw) return EMPTY_STATE
  try {
    const parsed = JSON.parse(raw)
    return {
      teamIds: Array.isArray(parsed.teamIds) ? parsed.teamIds : [],
      playerIds: Array.isArray(parsed.playerIds) ? parsed.playerIds : [],
      gameIds: Array.isArray(parsed.gameIds) ? parsed.gameIds : [],
      teamGameMap: sanitizeTeamGameMap(parsed.teamGameMap),
    }
  } catch {
    return EMPTY_STATE
  }
}

// Devir kutusunu oku; süresi dolmuşsa oku değil SİL. Böylece ortak
// bilgisayarda unutulmuş bir kayıt bir sonraki kişiye geçmez.
function readHandoff() {
  const raw = safeGet(localStorage, HANDOFF_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.ts || Date.now() - parsed.ts > HANDOFF_TTL_MS) {
      safeRemove(localStorage, HANDOFF_KEY)
      return null
    }
    return parseStoredState(JSON.stringify(parsed.state || {}))
  } catch {
    safeRemove(localStorage, HANDOFF_KEY)
    return null
  }
}

// Mount anında auth henüz çözülmedi: girişli kullanıcının önbelleği
// localStorage'da, anonim oturumunki sessionStorage'da. Hangisi doluysa onu
// göster (yanıp sönmeyi önler); hydrate efekti hemen ardından doğrusunu yazar.
function readStoredState() {
  const local = parseStoredState(safeGet(localStorage, STORAGE_KEY))
  if (local.teamIds.length || local.playerIds.length || local.gameIds.length) return local
  return parseStoredState(safeGet(sessionStorage, SESSION_KEY))
}

export function UserProvider({ children }) {
  const storedState = readStoredState()
  const { user, profile, updateProfile, loading: authLoading } = useAuth()
  const [teamIds, setTeamIds] = useState(() => parseTeamIds(storedState.teamIds))
  const [playerIds, setPlayerIds] = useState(() => Array.isArray(storedState.playerIds) ? storedState.playerIds : [])
  const [gameIds, setGameIds] = useState(() => uniqueCanonicalGames(storedState.gameIds))
  const [teamGameMap, setTeamGameMap] = useState(() => sanitizeTeamGameMap(storedState.teamGameMap))
  const [hydratedFromDb, setHydratedFromDb] = useState(false)
  // Duvar: beğeni/yorum gibi gerçekten hesap gerektiren işlemlerde açılır.
  const [authPromptOpen, setAuthPromptOpen] = useState(false)
  // Teklif: anonim ilk takipte bir kez açılır, takibi ENGELLEMEZ (Karar #70).
  const [savePromptOpen, setSavePromptOpen] = useState(false)
  // Yazma islemlerini seri hale getiren kilit — art arda follow'larda yaris kosulu /
  // veri kaybi olmaz. profileRef, persist icinde guncel profili stale kapamadan okur.
  const writeLockRef = useRef(Promise.resolve())
  const profileRef = useRef(profile)
  useEffect(() => { profileRef.current = profile }, [profile])

  useEffect(() => {
    // authLoading sürerken user geçici olarak null olabilir — o anda yazmak
    // girişli kullanıcının önbelleğini anonim kutusuna taşırdı.
    if (authLoading) return
    const payload = JSON.stringify({ teamIds, playerIds, gameIds, teamGameMap })
    if (user?.id) {
      safeSet(localStorage, STORAGE_KEY, payload)
      safeRemove(sessionStorage, SESSION_KEY)
    } else {
      safeSet(sessionStorage, SESSION_KEY, payload)
      safeRemove(localStorage, STORAGE_KEY)
    }
  }, [teamIds, playerIds, gameIds, teamGameMap, user?.id, authLoading])

  // Girisli kullanicida follow datayi veritabanindan hydrate et.
  useEffect(() => {
    let cancelled = false

    async function loadFromDb() {
      // Auth henüz çözülmedi — logged-in kullanicinin follow'larini yanlislikla
      // silmemek icin bekle (bu asamada user gecici olarak null olabilir).
      if (authLoading) return

      if (!user?.id) {
        // Anonim / cikis yapilmis: OTURUM takibi serbest (Karar #70). Durum
        // sessionStorage'dan gelir; sekme kapaninca kendiliginden silinir.
        // localStorage MUTLAKA temizlenir — orada duran veri bir onceki GIRISLI
        // kullanicinin onbellegidir ve ortak bilgisayarda sizmamalidir.
        const anon = parseStoredState(safeGet(sessionStorage, SESSION_KEY))
        readHandoff()   // suresi dolmus devir kaydi varsa burada silinir
        setTeamIds(parseTeamIds(anon.teamIds))
        setPlayerIds(Array.isArray(anon.playerIds) ? anon.playerIds : [])
        setGameIds(uniqueCanonicalGames(anon.gameIds))
        setTeamGameMap(sanitizeTeamGameMap(anon.teamGameMap))
        safeRemove(localStorage, STORAGE_KEY)
        setHydratedFromDb(true)
        return
      }

      const { data, error } = await supabase
        .from('follows')
        .select('target_type,target_id')
        .eq('user_id', user.id)

      if (cancelled) return

      if (error) {
        console.warn('UserContext follows load:', error.message)
        setHydratedFromDb(true)
        return
      }

      const teamFromDb = (data || [])
        .filter(x => x.target_type === 'team')
        .map(x => Number(x.target_id))
        .filter(Number.isFinite)

      const playerFromDb = (data || [])
        .filter(x => x.target_type === 'player')
        .map(x => x.target_id)
        .filter(Boolean)

      const gameFromDb = (data || [])
        .filter(x => x.target_type === 'game')
        .map(x => x.target_id)
        .filter(Boolean)

      // Anonim oturumda yapilan takipleri DEVRAL (Karar #70). Kullaniciya
      // "kalici kaydet" dedik; giris sonrasi takipleri kaybolursa soz yalan
      // olur. Birlesim alinir (silme yok), sonra oturum kutusu bosaltilir.
      const sessionPending = parseStoredState(safeGet(sessionStorage, SESSION_KEY))
      // Ayni sekmede giris yapildiysa sessionStorage yeter; kayit akisi yeni
      // sekmede bittiyse devir kutusu devreye girer.
      const handoff = readHandoff() || EMPTY_STATE
      safeRemove(sessionStorage, SESSION_KEY)
      safeRemove(localStorage, HANDOFF_KEY)

      const teamIdsMerged = [...new Set([
        ...teamFromDb,
        ...parseTeamIds(sessionPending.teamIds),
        ...parseTeamIds(handoff.teamIds),
      ])]
      const playerIdsMerged = [...new Set([
        ...playerFromDb,
        ...[...(sessionPending.playerIds || []), ...(handoff.playerIds || [])].filter(Boolean),
      ])]
      const gameIdsMerged = [...new Set([
        ...uniqueCanonicalGames(gameFromDb),
        ...uniqueCanonicalGames(sessionPending.gameIds),
        ...uniqueCanonicalGames(handoff.gameIds),
      ])]

      let mappedTeamGames = sanitizeTeamGameMap({
        ...sanitizeTeamGameMap(handoff.teamGameMap),
        ...sanitizeTeamGameMap(sessionPending.teamGameMap),
      })
      if (teamIdsMerged.length) {
        const { data: teamRows, error: teamRowsError } = await supabase
          .from('teams')
          .select('id,game_id,game:games(id,name,slug)')
          .in('id', teamIdsMerged)

        if (!teamRowsError) {
          // Tazeler once, anonim oturumdan gelen eslesme yalnizca bosluklari doldurur.
          mappedTeamGames = sanitizeTeamGameMap({
            ...mappedTeamGames,
            ...Object.fromEntries((teamRows || []).map(row => {
              const gameId = normalizeGameId(row?.game?.slug ?? row?.game?.name ?? row?.game?.id ?? row?.game_id)
              return [String(row.id), gameId]
            })),
          })
        }
      }

      const mergedGames = [...new Set([
        ...gameIdsMerged,
        ...collectMappedGames(teamIdsMerged, mappedTeamGames),
      ])]

      // DB + anonim oturum birlesimi. Persist efekti bunu hemen ardindan
      // veritabanina yazar (yalnizca FARKI ekler, silme yapmaz).
      setTeamIds(teamIdsMerged)
      setPlayerIds(playerIdsMerged)
      setGameIds(mergedGames)
      setTeamGameMap(mappedTeamGames)
      setHydratedFromDb(true)
    }

    loadFromDb()
    return () => { cancelled = true }
  }, [user?.id, authLoading])

  // Follow degisikliklerini veritabanina yaz — debounce + seri kilit.
  // Onceki surum: in-flight persist iptal olunca setSyncing(false) atlanip syncing
  // kalici true'ya takiliyor, sonraki takimlar hic yazilmiyordu (F5'te 2/3 bug'i).
  // Simdi: her degisiklik 300ms sonra SON durumu tek persist eder; yazmalar
  // writeLockRef zincirinde sirayla kosar (cakisma/duplicate yok).
  useEffect(() => {
    if (!user?.id || !hydratedFromDb) return

    const snapshot = {
      userId: user.id,
      teamIds: [...teamIds],
      playerIds: [...playerIds],
      persistedGameIds: [...new Set([
        ...uniqueCanonicalGames(gameIds),
        ...collectMappedGames(teamIds, teamGameMap),
      ])],
    }

    const handle = setTimeout(() => {
      writeLockRef.current = writeLockRef.current
        .then(() => persistSnapshot(snapshot))
        .catch(err => console.warn('UserContext persist chain:', err?.message))
    }, 300)

    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, hydratedFromDb, teamIds, playerIds, gameIds, teamGameMap])

  async function persistSnapshot({ userId, teamIds: tIds, playerIds: pIds, persistedGameIds }) {
    // Hedef durumu anahtar->satir haritasi olarak kur.
    const desired = new Map()
    for (const id of tIds) desired.set(`team:${String(id)}`, { user_id: userId, target_type: 'team', target_id: String(id) })
    for (const id of pIds) desired.set(`player:${String(id)}`, { user_id: userId, target_type: 'player', target_id: String(id) })
    for (const id of persistedGameIds) desired.set(`game:${String(id)}`, { user_id: userId, target_type: 'game', target_id: String(id) })

    // Mevcut satirlari oku, sadece FARKI uygula. Destructive "hepsini sil" yok —
    // kismi bir hata tum takipleri ucurmaz.
    const { data: existing, error: readError } = await supabase
      .from('follows')
      .select('id,target_type,target_id')
      .eq('user_id', userId)

    if (readError) { console.warn('UserContext follows read:', readError.message); return }

    const existingByKey = new Map()
    for (const row of existing || []) existingByKey.set(`${row.target_type}:${String(row.target_id)}`, row.id)

    const toInsert = [...desired].filter(([key]) => !existingByKey.has(key)).map(([, row]) => row)
    const toDeleteIds = [...existingByKey].filter(([key]) => !desired.has(key)).map(([, id]) => id)

    // Once ekle (veri kaybi riski yok), sonra fazlalari sil.
    if (toInsert.length) {
      const { error: insError } = await supabase.from('follows').insert(toInsert)
      if (insError) { console.warn('UserContext follows insert:', insError.message); return }
    }
    if (toDeleteIds.length) {
      const { error: delError } = await supabase.from('follows').delete().in('id', toDeleteIds)
      if (delError) console.warn('UserContext follows delete:', delError.message)
    }

    if (typeof updateProfile === 'function') {
      const preferredTeam = tIds[0] || null
      if ((profileRef.current?.favorite_team_id || null) !== preferredTeam) {
        try {
          await updateProfile({ favorite_team_id: preferredTeam })
        } catch (e) {
          console.warn('UserContext profile favorite sync:', e.message)
        }
      }
    }
  }

  // DUVAR — gercekten hesap gerektiren islemler icin (begeni, yorum: DB'ye
  // user_id yaziliyor). Takipler bunu ARTIK KULLANMAZ (Karar #70).
  function requireAuth() {
    if (user?.id) return true
    setAuthPromptOpen(true)
    return false
  }

  // TEKLIF — anonim takibi engellemez. Oturumda bir kez gosterilir; "simdi
  // degil" denirse bir daha cikmaz (her takipte modal = yeni bir duvar).
  function offerAccountSave() {
    if (user?.id || authLoading) return
    if (safeGet(sessionStorage, OFFER_KEY)) return
    safeSet(sessionStorage, OFFER_KEY, '1')
    setSavePromptOpen(true)
  }

  // Takip eklendikten SONRA calisir: girisliye bildirim izni, anonime teklif.
  function afterFollowAdded() {
    if (user?.id) {
      // Bildirim izni: sayfa yükünde DEĞİL, kullanıcı takım takip edince iste
      // (doğal opt-in anı; favori maça bildirim özelliği için).
      requestBrowserNotificationPermission({ allowPrompt: true })
      return
    }
    offerAccountSave()
  }

  function followTeam(teamId) {
    if (!teamId) return
    setTeamIds(prev => (prev.includes(teamId) ? prev : [...prev, teamId]))
    afterFollowAdded()
  }

  function unfollowTeam(teamId) {
    if (!teamId) return
    setTeamIds(prev => prev.filter(id => id !== teamId))
  }

  function toggleTeamFollow(teamId) {
    if (!teamId) return
    const isAdding = !teamIds.includes(teamId)
    setTeamIds(prev => (prev.includes(teamId)
      ? prev.filter(id => id !== teamId)
      : [...prev, teamId]))
    if (isAdding) afterFollowAdded()
  }

  function isTeamFollowed(teamId) {
    return teamIds.includes(teamId)
  }

  function followPlayer(playerId) {
    if (!playerId) return
    setPlayerIds(prev => (prev.includes(playerId) ? prev : [...prev, playerId]))
    afterFollowAdded()
  }

  function unfollowPlayer(playerId) {
    if (!playerId) return
    setPlayerIds(prev => prev.filter(id => id !== playerId))
  }

  function togglePlayerFollow(playerId) {
    if (!playerId) return
    const isAdding = !playerIds.includes(playerId)
    setPlayerIds(prev => (prev.includes(playerId)
      ? prev.filter(id => id !== playerId)
      : [...prev, playerId]))
    if (isAdding) afterFollowAdded()
  }

  function isPlayerFollowed(playerId) {
    return playerIds.includes(playerId)
  }

  function followGame(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return
    setGameIds(prev => (prev.includes(normalized) ? prev : [...prev, normalized]))
    afterFollowAdded()
  }

  function unfollowGame(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return
    setGameIds(prev => prev.filter(id => id !== normalized))
  }

  function toggleGameFollow(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return
    const isAdding = !gameIds.includes(normalized)
    setGameIds(prev => (prev.includes(normalized)
      ? prev.filter(id => id !== normalized)
      : [...prev, normalized]))
    if (isAdding) afterFollowAdded()
  }

  function isGameFollowed(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return false
    return gameIds.includes(normalized)
  }

  function setFollowedTeams(nextTeamIds = [], options = {}) {
    const normalizedTeamIds = parseTeamIds(nextTeamIds)
    const providedMap = sanitizeTeamGameMap(options?.teamGameMap)
    const mergedMap = { ...teamGameMap, ...providedMap }
    const inferredGames = collectMappedGames(normalizedTeamIds, mergedMap)

    setTeamIds(normalizedTeamIds)
    if (Object.keys(providedMap).length > 0) {
      setTeamGameMap(mergedMap)
    }

    if (inferredGames.length > 0) {
      setGameIds(prev => [...new Set([
        ...uniqueCanonicalGames(prev),
        ...inferredGames,
      ])])
    }
  }

  function setFollowedGames(nextGameIds = [], options = {}) {
    const normalizedTeamIds = parseTeamIds(options?.teamIds || teamIds)
    const providedMap = sanitizeTeamGameMap(options?.teamGameMap)
    const mergedMap = { ...teamGameMap, ...providedMap }
    const inferredGames = collectMappedGames(normalizedTeamIds, mergedMap)
    const normalizedGames = [...new Set([
      ...uniqueCanonicalGames(nextGameIds),
      ...inferredGames,
    ])]

    if (Object.keys(providedMap).length > 0) {
      setTeamGameMap(mergedMap)
    }
    setGameIds(normalizedGames)
  }

  const value = useMemo(() => ({
    followedTeamIds: teamIds,
    followedPlayerIds: playerIds,
    followedGames: gameIds,
    followTeam,
    unfollowTeam,
    toggleTeamFollow,
    isTeamFollowed,
    followPlayer,
    unfollowPlayer,
    togglePlayerFollow,
    isPlayerFollowed,
    followGame,
    unfollowGame,
    toggleGameFollow,
    isGameFollowed,
    setFollowedTeams,
    setFollowedGames,
    requireAuth,
    authPromptOpen,
    closeAuthPrompt: () => setAuthPromptOpen(false),
    // Anonim kullanicinin takipleri bu oturumla sinirli mi — arayuz bunu
    // kullaniciya soyleyebilsin diye disari veriliyor.
    followsAreSessionOnly: !authLoading && !user?.id,
    openAccountSavePrompt: () => setSavePromptOpen(true),
  }), [teamIds, playerIds, gameIds, authPromptOpen, user?.id, authLoading])

  return (
    <UserContext.Provider value={value}>
      {children}
      {authPromptOpen && <FollowAuthPrompt onClose={() => setAuthPromptOpen(false)} />}
      {savePromptOpen && (
        <SaveFollowsPrompt
          onClose={() => setSavePromptOpen(false)}
          onBeforeLeave={() => {
            // Kullanici hesap akisina giriyor: takipleri kisa omurlu devir
            // kutusuna yaz ki dogrulama maili yeni sekmede acilsa da kaybolmasin.
            safeSet(localStorage, HANDOFF_KEY, JSON.stringify({
              ts: Date.now(),
              state: { teamIds, playerIds, gameIds, teamGameMap },
            }))
          }}
        />
      )}
    </UserContext.Provider>
  )
}

// Anonim ilk takipten SONRA cikan teklif. Duvar DEGIL: takip zaten yapildi,
// burada yalnizca kalicilik satiliyor. "Simdi degil" oturum boyunca hatirlanir.
function SaveFollowsPrompt({ onClose, onBeforeLeave }) {
  const navigate = useNavigate()
  function go(path) { onBeforeLeave?.(); onClose(); navigate(path) }
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center',
        background: 'rgba(3,6,12,.72)', backdropFilter: 'blur(4px)', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Takiplerini kalıcı kaydet"
        style={{
          width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 16, padding: '26px 22px', textAlign: 'center',
          boxShadow: '0 24px 60px rgba(0,0,0,.55)',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', marginBottom: 8 }}>
          Takip edildi ✓
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.65, marginBottom: 20 }}>
          Ana sayfan artık bu takibe göre şekillenecek. Ama takiplerin şu an
          <b style={{ color: 'var(--text-2)' }}> yalnızca bu tarayıcı oturumunda</b> tutuluyor —
          sekmeyi kapatınca silinir. Ücretsiz hesapla
          <b style={{ color: 'var(--text)' }}> kalıcı kaydet</b>, maç hatırlatmalarını ve
          transfer haberlerini kaçırma.
        </div>
        <div style={{ display: 'grid', gap: 9 }}>
          <button
            type="button"
            onClick={() => go('/register')}
            style={{
              background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)', color: '#fff', border: 'none',
              borderRadius: 11, padding: '11px 14px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer',
            }}
          >
            Kalıcı kaydet (ücretsiz)
          </button>
          <button
            type="button"
            onClick={() => go('/login')}
            style={{
              background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--line)',
              borderRadius: 11, padding: '10px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >
            Zaten hesabım var
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', color: 'var(--text-4)', border: 'none',
              padding: '4px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Şimdi değil, gezinmeye devam et
          </button>
        </div>
      </div>
    </div>
  )
}

// DUVAR modali — begeni/yorum gibi hesap ZORUNLU islemlerde cikar.
// Takipte artik kullanilmaz (Karar #70): orada SaveFollowsPrompt var.
function FollowAuthPrompt({ onClose }) {
  const navigate = useNavigate()
  function go(path) { onClose(); navigate(path) }
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center',
        background: 'rgba(3,6,12,.72)', backdropFilter: 'blur(4px)', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Hesap oluştur"
        style={{
          width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 16, padding: '26px 22px', textAlign: 'center',
          boxShadow: '0 24px 60px rgba(0,0,0,.55)',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', marginBottom: 8 }}>
          Hiçbir gelişmeyi kaçırma
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.65, marginBottom: 20 }}>
          Takip ettiğin takımların <b style={{ color: 'var(--text-2)' }}>canlı maç tahminlerini</b>,
          anlık <b style={{ color: 'var(--text-2)' }}>transfer haberlerini</b> ve maç
          hatırlatmalarını kaçırma. <b style={{ color: 'var(--text)' }}>5 saniyede</b> ücretsiz
          hesabını oluştur.
        </div>
        <div style={{ display: 'grid', gap: 9 }}>
          <button
            type="button"
            onClick={() => go('/register')}
            style={{
              background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)', color: '#fff', border: 'none',
              borderRadius: 11, padding: '11px 14px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer',
            }}
          >
            Ücretsiz hesap oluştur
          </button>
          <button
            type="button"
            onClick={() => go('/login')}
            style={{
              background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--line)',
              borderRadius: 11, padding: '10px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
          >
            Zaten hesabım var
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', color: 'var(--text-4)', border: 'none',
              padding: '4px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Şimdi değil
          </button>
        </div>
      </div>
    </div>
  )
}

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) {
    throw new Error('useUser must be used within UserProvider')
  }
  return ctx
}
