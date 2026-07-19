import { createContext, useContext, useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from './AuthContext'
import BRANDING from '../branding.config'
import { normalizeGameId } from '../utils/gameUtils'

const STORAGE_KEY = BRANDING.followStateStorageKey

const UserContext = createContext(null)

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

function readStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { teamIds: [], playerIds: [], gameIds: [], teamGameMap: {} }
    const parsed = JSON.parse(raw)
    return {
      teamIds: Array.isArray(parsed.teamIds) ? parsed.teamIds : [],
      playerIds: Array.isArray(parsed.playerIds) ? parsed.playerIds : [],
      gameIds: Array.isArray(parsed.gameIds) ? parsed.gameIds : [],
      teamGameMap: sanitizeTeamGameMap(parsed.teamGameMap),
    }
  } catch {
    return { teamIds: [], playerIds: [], gameIds: [], teamGameMap: {} }
  }
}

export function UserProvider({ children }) {
  const storedState = readStoredState()
  const { user, profile, updateProfile, loading: authLoading } = useAuth()
  const [teamIds, setTeamIds] = useState(() => parseTeamIds(storedState.teamIds))
  const [playerIds, setPlayerIds] = useState(() => Array.isArray(storedState.playerIds) ? storedState.playerIds : [])
  const [gameIds, setGameIds] = useState(() => uniqueCanonicalGames(storedState.gameIds))
  const [teamGameMap, setTeamGameMap] = useState(() => sanitizeTeamGameMap(storedState.teamGameMap))
  const [hydratedFromDb, setHydratedFromDb] = useState(false)
  // Anonim takip yok — giriş yapmadan takip denemesi kayıt modalını açar.
  const [authPromptOpen, setAuthPromptOpen] = useState(false)
  // Yazma islemlerini seri hale getiren kilit — art arda follow'larda yaris kosulu /
  // veri kaybi olmaz. profileRef, persist icinde guncel profili stale kapamadan okur.
  const writeLockRef = useRef(Promise.resolve())
  const profileRef = useRef(profile)
  useEffect(() => { profileRef.current = profile }, [profile])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ teamIds, playerIds, gameIds, teamGameMap }))
  }, [teamIds, playerIds, gameIds, teamGameMap])

  // Girisli kullanicida follow datayi veritabanindan hydrate et.
  useEffect(() => {
    let cancelled = false

    async function loadFromDb() {
      // Auth henüz çözülmedi — logged-in kullanicinin follow'larini yanlislikla
      // silmemek icin bekle (bu asamada user gecici olarak null olabilir).
      if (authLoading) return

      if (!user?.id) {
        // Anonim / cikis yapilmis: yerel takip verisini temizle. Anonim takip yok;
        // takip icin kayit gerekir. Ortak bilgisayarda onceki kullanicinin
        // takipleri de bir sonrakine sizmaz.
        setTeamIds([])
        setPlayerIds([])
        setGameIds([])
        setTeamGameMap({})
        try { localStorage.removeItem(STORAGE_KEY) } catch { /* yok say */ }
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

      let mappedTeamGames = {}
      if (teamFromDb.length) {
        const { data: teamRows, error: teamRowsError } = await supabase
          .from('teams')
          .select('id,game_id,game:games(id,name,slug)')
          .in('id', teamFromDb)

        if (!teamRowsError) {
          mappedTeamGames = sanitizeTeamGameMap(Object.fromEntries((teamRows || []).map(row => {
            const gameId = normalizeGameId(row?.game?.slug ?? row?.game?.name ?? row?.game?.id ?? row?.game_id)
            return [String(row.id), gameId]
          })))
        }
      }

      const mergedGames = [...new Set([
        ...uniqueCanonicalGames(gameFromDb),
        ...collectMappedGames(teamFromDb, mappedTeamGames),
      ])]

      // Loginli kullanicida DB state source-of-truth olsun; eski local veriyi ez.
      setTeamIds(teamFromDb)
      setPlayerIds(playerFromDb)
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

  // Giris yoksa takip mutasyonunu engelle + kayit modalini ac. true => devam.
  function requireAuth() {
    if (user?.id) return true
    setAuthPromptOpen(true)
    return false
  }

  function followTeam(teamId) {
    if (!teamId || !requireAuth()) return
    setTeamIds(prev => (prev.includes(teamId) ? prev : [...prev, teamId]))
  }

  function unfollowTeam(teamId) {
    if (!teamId) return
    setTeamIds(prev => prev.filter(id => id !== teamId))
  }

  function toggleTeamFollow(teamId) {
    if (!teamId) return
    if (!teamIds.includes(teamId) && !requireAuth()) return
    setTeamIds(prev => (prev.includes(teamId)
      ? prev.filter(id => id !== teamId)
      : [...prev, teamId]))
  }

  function isTeamFollowed(teamId) {
    return teamIds.includes(teamId)
  }

  function followPlayer(playerId) {
    if (!playerId || !requireAuth()) return
    setPlayerIds(prev => (prev.includes(playerId) ? prev : [...prev, playerId]))
  }

  function unfollowPlayer(playerId) {
    if (!playerId) return
    setPlayerIds(prev => prev.filter(id => id !== playerId))
  }

  function togglePlayerFollow(playerId) {
    if (!playerId) return
    if (!playerIds.includes(playerId) && !requireAuth()) return
    setPlayerIds(prev => (prev.includes(playerId)
      ? prev.filter(id => id !== playerId)
      : [...prev, playerId]))
  }

  function isPlayerFollowed(playerId) {
    return playerIds.includes(playerId)
  }

  function followGame(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized || !requireAuth()) return
    setGameIds(prev => (prev.includes(normalized) ? prev : [...prev, normalized]))
  }

  function unfollowGame(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return
    setGameIds(prev => prev.filter(id => id !== normalized))
  }

  function toggleGameFollow(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return
    if (!gameIds.includes(normalized) && !requireAuth()) return
    setGameIds(prev => (prev.includes(normalized)
      ? prev.filter(id => id !== normalized)
      : [...prev, normalized]))
  }

  function isGameFollowed(gameId) {
    const normalized = normalizeGameId(gameId)
    if (!normalized) return false
    return gameIds.includes(normalized)
  }

  function setFollowedTeams(nextTeamIds = [], options = {}) {
    if (!requireAuth()) return
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
    if (!requireAuth()) return
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
    authPromptOpen,
    closeAuthPrompt: () => setAuthPromptOpen(false),
  }), [teamIds, playerIds, gameIds, authPromptOpen])

  return (
    <UserContext.Provider value={value}>
      {children}
      {authPromptOpen && <FollowAuthPrompt onClose={() => setAuthPromptOpen(false)} />}
    </UserContext.Provider>
  )
}

// Anonim kullanici takip etmeye calisinca cikan kayit-yonlendirme modali.
// Amac: anonim takip yerine kullaniciyi hesap acmaya yonlendirmek.
function FollowAuthPrompt({ onClose }) {
  const navigate = useNavigate()
  function go(path) { onClose(); navigate(path) }
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
