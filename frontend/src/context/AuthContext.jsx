import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { gorunmezCaptchaTokeni } from '../utils/gorunmezCaptcha'
import { UYGULAMA, disariKok } from '../utils/platform'

const AuthContext = createContext(null)

// Anonim oturum (yalnız takip için, Faz 6) bu bağlamın DIŞINA `user` olarak
// verilmez: yorum, beğeni, navbar, ProtectedRoute vb. `user`'ı "kayıtlı hesap"
// sayıyor. Anonim kimlik yalnız `anonUserId` ile UserContext'e gider.
function isAnonymousUser(u) {
	return !!u?.is_anonymous
}

// Kullanıcı adı herkese açık: Google'dan gelen tam ad ya da e-postanın bir parçası
// varsayılan yapılmaz. Kullanıcı ayarlardan değiştirebilir.
function buildUsername(user) {
	const meta = user?.user_metadata || {}
	if (meta.username) return String(meta.username)
	return `oyuncu_${String(user?.id || '').replace(/-/g, '').slice(0, 8)}`
}

export function AuthProvider({ children }) {
	const [session, setSession] = useState(null)
	const [user, setUser] = useState(null)
	const [anonUserId, setAnonUserId] = useState(null)
	const anonPromiseRef = useRef(null)
	const [profile, setProfile] = useState(null)
	const [loading, setLoading] = useState(true)
	const [profileLoading, setProfileLoading] = useState(false)
	// Şifre-kurtarma modu: e-postadaki linkten gelince (PASSWORD_RECOVERY) true olur.
	// Bu modda kullanıcı YENİ ŞİFRE belirlemeden siteyi gezemez (RecoveryGate zorlar) —
	// aksi halde link'le girip şifre koymadan çıkınca eski (bilinmeyen) şifreye takılıyordu.
	const [recoveryMode, setRecoveryMode] = useState(() => {
		try { return sessionStorage.getItem('fext_recovery') === '1' } catch { return false }
	})

	const clearRecoveryMode = useCallback(() => {
		setRecoveryMode(false)
		try { sessionStorage.removeItem('fext_recovery') } catch { /* yoksay */ }
	}, [])

	const userRef = useRef(null)
	const profileRef = useRef(null)
	const lastAuthUserIdRef = useRef(undefined)
	const inFlightProfileUserIdRef = useRef(null)

	useEffect(() => {
		userRef.current = user
	}, [user])

	useEffect(() => {
		profileRef.current = profile
	}, [profile])

	const refreshProfile = useCallback(async (explicitUser = null, options = {}) => {
		const targetUser = explicitUser || userRef.current
		const force = !!options.force
		if (!targetUser?.id) {
			setProfile(null)
			setProfileLoading(false)
			inFlightProfileUserIdRef.current = null
			return null
		}

		if (!force && inFlightProfileUserIdRef.current === targetUser.id) {
			return profileRef.current
		}

		setProfileLoading(true)
		inFlightProfileUserIdRef.current = targetUser.id

		const defaultUsername = buildUsername(targetUser)
		const defaultAvatar = targetUser.user_metadata?.avatar_url || null

		const { data, error } = await supabase
			.from('profiles')
			.select('id, username, first_name, last_name, avatar_url, favorite_team_id, scout_score, show_team_badge')
			.eq('id', targetUser.id)
			.maybeSingle()

		const meta = targetUser.user_metadata || {}

		if (error) {
			console.warn('AuthContext profile fetch:', error.message)
			const fallback = {
				id: targetUser.id,
				username: defaultUsername,
				first_name: meta.first_name || null,
				last_name: meta.last_name || null,
				avatar_url: defaultAvatar,
				favorite_team_id: null,
				scout_score: 0,
				show_team_badge: true,
			}
			setProfile(fallback)
			setProfileLoading(false)
			inFlightProfileUserIdRef.current = null
			return null
		}

		if (!data) {
			const payload = {
				id: targetUser.id,
				username: defaultUsername,
				first_name: meta.first_name || null,
				last_name: meta.last_name || null,
				avatar_url: defaultAvatar,
				favorite_team_id: meta.favorite_team_id ?? null,
				scout_score: 0,
				show_team_badge: true,
			}
			const { error: upsertError } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
			if (upsertError) {
				console.warn('AuthContext profile upsert:', upsertError.message)
			}
			setProfile(payload)
			setProfileLoading(false)
			inFlightProfileUserIdRef.current = null
			return payload
		}

		const normalized = {
			id: data.id,
			username: data.username || defaultUsername,
			first_name: data.first_name || null,
			last_name: data.last_name || null,
			avatar_url: data.avatar_url || defaultAvatar,
			favorite_team_id: data.favorite_team_id ?? null,
			scout_score: Number(data.scout_score || 0),
			show_team_badge: data.show_team_badge !== false,
		}
		setProfile(normalized)
		setProfileLoading(false)
		inFlightProfileUserIdRef.current = null
		return normalized
	}, [])

	useEffect(() => {
		let mounted = true

		function applySession(nextSession) {
			if (!mounted) return

			const anonymous = isAnonymousUser(nextSession?.user)
			const realUser = anonymous ? null : (nextSession?.user ?? null)
			const nextUserId = realUser?.id ?? null
			const prevUserId = lastAuthUserIdRef.current
			lastAuthUserIdRef.current = nextUserId

			setSession(nextSession)
			setUser(realUser)
			setAnonUserId(anonymous ? nextSession.user.id : null)
			setLoading(false)

			if (!realUser) {
				setProfileLoading(false)
				inFlightProfileUserIdRef.current = null
				setProfile(null)
				return
			}

			if (prevUserId !== nextUserId || !profileRef.current?.id) {
				refreshProfile(realUser, { force: true })
			} else if (!profileRef.current?.username) {
				refreshProfile(realUser)
			}
		}

		async function init() {
			const { data } = await supabase.auth.getSession()
			const nextSession = data.session
			if (!mounted) return
			applySession(nextSession)
		}

		init()

		const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
			if (!mounted) return
			// Şifre kurtarma linkinden gelindi → yeni şifre belirlenene kadar kapıyı kilitle.
			if (event === 'PASSWORD_RECOVERY') {
				setRecoveryMode(true)
				try { sessionStorage.setItem('fext_recovery', '1') } catch { /* yoksay */ }
			}
			// Token refresh eventlerinde profile sorgusunu tekrar tekrar tetikleme.
			if (event === 'TOKEN_REFRESHED') {
				setSession(nextSession)
				setLoading(false)
			} else {
				applySession(nextSession)
			}
		})

		return () => {
			mounted = false
			listener.subscription.unsubscribe()
		}
	}, [refreshProfile])

	async function signUp({ email, password, username, first_name, last_name, favorite_team_id, captchaToken }) {
		const cleanUsername = String(username || '').trim()
		const finalUsername = cleanUsername || email?.split('@')?.[0] || 'esports_fan'
		const firstName = String(first_name || '').trim() || null
		const lastName = String(last_name || '').trim() || null
		const favTeam = favorite_team_id ?? null

		// Kullanıcı adı benzersizliği (büyük/küçük harf duyarsız). DB'de de unique index
		// var (nihai garanti); bu ön-kontrol kullanıcıya net hata verir. profiles anon'a
		// kapalı, müsaitlik yalnız boolean dönen RPC'den. [[auth-onboarding]]
		if (cleanUsername) {
			const { data: available, error: availError } = await supabase.rpc('username_available', { name: cleanUsername })
			if (availError) console.warn('username_available:', availError.message)
			else if (available === false) {
				throw new Error('Bu kullanıcı adı zaten alınmış. Başka bir tane dene.')
			}
		}

		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: {
					username: finalUsername,
					first_name: firstName,
					last_name: lastName,
					favorite_team_id: favTeam,
				},
				...(captchaToken ? { captchaToken } : {}),
			},
		})
		if (error) throw error

		if (data.user?.id) {
			await supabase.from('profiles').upsert({
				id: data.user.id,
				username: finalUsername,
				first_name: firstName,
				last_name: lastName,
				avatar_url: data.user.user_metadata?.avatar_url || null,
				favorite_team_id: favTeam,
				scout_score: 0,
			}, { onConflict: 'id' })
			await refreshProfile(data.user)
		}

		return data
	}

	// ── Şifre sıfırlama (Gemini launch-blocker) ────────────────────────────────
	async function requestPasswordReset(email, captchaToken) {
		// Uygulamada da e-postadaki link siteye gider (app.fextesports.com dışarıda yok).
		const redirectTo = `${disariKok()}/reset-password`
		const { error } = await supabase.auth.resetPasswordForEmail(String(email || '').trim(), {
			redirectTo,
			...(captchaToken ? { captchaToken } : {}),
		})
		if (error) throw error
	}

	async function updatePassword(newPassword) {
		const { error } = await supabase.auth.updateUser({ password: newPassword })
		if (error) throw error
	}

	// ── Discord OAuth (espor kitlesi için tek-tık giriş) ───────────────────────
	async function signInWithDiscord() {
		const { error } = await supabase.auth.signInWithOAuth({
			provider: 'discord',
			options: { redirectTo: `${window.location.origin}/` },
		})
		if (error) throw error
	}

	// ── Google OAuth (e-posta yazmadan tek-tık giriş) ──────────────────────────
	// ⚠️ Supabase → Auth → Providers → Google AÇIK olmalı + Google Cloud OAuth
	// client kurulmalı, yoksa "provider not enabled" döner. [[auth-onboarding]]
	async function signInWithGoogle() {
		// Uygulamada sistem tarayıcısı + PKCE; dönüşü UygulamaKopru işler (utils/uygulamaGiris.js).
		if (UYGULAMA) return (await import('../utils/uygulamaGiris')).googleIleGir()
		const { error } = await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: { redirectTo: `${window.location.origin}/` },
		})
		if (error) throw error
	}

	async function signIn({ identifier, email, password, captchaToken }) {
		// identifier: e-posta VEYA kullanıcı adı olabilir. E-posta değilse (@ yoksa)
		// email_for_login RPC'si şifreyi doğrular ve yalnız doğruysa e-postayı döner;
		// asıl giriş yine signInWithPassword (Turnstile + Supabase sınırı). [[auth-onboarding]]
		let loginEmail = String(identifier ?? email ?? '').trim()
		if (loginEmail && !loginEmail.includes('@') && password) {
			const { data: resolved, error: rpcError } = await supabase.rpc('email_for_login', { identifier: loginEmail, password })
			if (rpcError) console.warn('email_for_login:', rpcError.message)
			// Kullanıcı adı yok, şifre yanlış ya da deneme sınırı: hepsi aynı genel hata.
			if (!resolved) throw new Error('Invalid login credentials')
			loginEmail = resolved
		}
		const { data, error } = await supabase.auth.signInWithPassword({
			email: loginEmail,
			password,
			...(captchaToken ? { options: { captchaToken } } : {}),
		})
		if (error) throw error
		if (data.user) refreshProfile(data.user, { force: true })
		return data
	}

	async function signOut() {
		// Uygulamada cihazın push token'ı oturum kapanmadan silinir (RLS sahibine izin verir).
		if (UYGULAMA) {
			try { await (await import('../utils/push')).birak() } catch (err) { console.error('Push bırakılamadı:', err) }
		}
		const { error } = await supabase.auth.signOut()
		if (error) throw error
		setProfileLoading(false)
		inFlightProfileUserIdRef.current = null
		setProfile(null)
		clearRecoveryMode()
	}

	// ── Anonim oturum (takip için) ─────────────────────────────────────────────
	// Kayıtsız ziyaretçi ilk takipte çağrılır; sayfa yükünde DEĞİL (botlar ve
	// yalnız gezen ziyaretçi kullanıcı üretmesin). Auth captcha'sı sunucuda
	// zorunlu → görünmez Turnstile token'ı alınır. Eşzamanlı çağrılar tek isteğe
	// bağlanır. Oturum zaten varsa (kayıtlı ya da anonim) hiçbir şey yapmaz.
	async function startAnonymousSession() {
		if (anonPromiseRef.current) return anonPromiseRef.current
		const p = (async () => {
			const { data: current } = await supabase.auth.getSession()
			if (current.session?.user) return current.session.user.id
			const captchaToken = await gorunmezCaptchaTokeni({ etiket: 'Takiplerini kaydetmek için doğrula' })
			const { data, error } = await supabase.auth.signInAnonymously(
				captchaToken ? { options: { captchaToken } } : undefined,
			)
			if (error) throw error
			return data.user?.id ?? null
		})()
		anonPromiseRef.current = p
		try {
			return await p
		} finally {
			anonPromiseRef.current = null
		}
	}

	// ── Hesap silme (Apple 5.1.1(v), Play, KVKK) ──────────────────────────────
	// Edge Function `delete-account` sunucuda siler; burada yalnız yerel oturum
	// kapatılır (sunucudaki oturum hesapla birlikte gitti, global signOut 403 verir).
	async function deleteAccount() {
		if (!user?.id) throw new Error('Giriş yapmadan hesap silinemez.')
		const { data, error } = await supabase.functions.invoke('delete-account', {
			body: { onay: 'HESABIMI SIL' },
		})
		if (error || !data?.ok) {
			let kod = ''
			try { kod = (await error?.context?.json?.())?.hata || '' } catch { /* gövde yok */ }
			throw new Error(kod ? `Hesap silinemedi (${kod}).` : 'Hesap silinemedi. Lütfen tekrar dene.')
		}
		await supabase.auth.signOut({ scope: 'local' }).catch(() => { /* oturum zaten geçersiz */ })
		setProfileLoading(false)
		inFlightProfileUserIdRef.current = null
		setProfile(null)
		clearRecoveryMode()
	}

	async function updateProfile(partial) {
		if (!user?.id) throw new Error('Giriş yapmadan profil güncellenemez.')
		const payload = {
			id: user.id,
			...(partial?.username !== undefined ? { username: partial.username || buildUsername(user) } : {}),
			...(partial?.first_name !== undefined ? { first_name: partial.first_name || null } : {}),
			...(partial?.last_name !== undefined ? { last_name: partial.last_name || null } : {}),
			...(partial?.avatar_url !== undefined ? { avatar_url: partial.avatar_url || null } : {}),
			...(partial?.favorite_team_id !== undefined ? { favorite_team_id: partial.favorite_team_id } : {}),
			...(partial?.show_team_badge !== undefined ? { show_team_badge: !!partial.show_team_badge } : {}),
			...(partial?.scout_score !== undefined ? { scout_score: Number(partial.scout_score || 0) } : {}),
		}
		const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
		if (error) throw error
		// payload yalnızca DEĞİŞEN alanları içerir (koşullu spread). Mevcut profilin
		// üzerine bindir → temizlenen alanlar (null) doğru yansır; `??` fallback'i
		// null'ı eski değere geri döndürüp "favori takım kaldırılamıyor" bug'ı yapıyordu.
		const merged = {
			username: buildUsername(user),
			first_name: null,
			last_name: null,
			avatar_url: null,
			favorite_team_id: null,
			scout_score: 0,
			show_team_badge: true,
			...(profile || {}),
			...payload,
			id: user.id,
		}
		setProfile(merged)
		return merged
	}

	const value = useMemo(() => ({
		session,
		user,
		profile,
		loading,
		profileLoading,
		signUp,
		signIn,
		signOut,
		updateProfile,
		refreshProfile,
		requestPasswordReset,
		updatePassword,
		signInWithDiscord,
		signInWithGoogle,
		recoveryMode,
		clearRecoveryMode,
		isAuthenticated: !!user,
		anonUserId,
		startAnonymousSession,
		deleteAccount,
	}), [session, user, anonUserId, profile, loading, profileLoading, refreshProfile, recoveryMode, clearRecoveryMode])

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
	const ctx = useContext(AuthContext)
	if (!ctx) throw new Error('useAuth must be used within AuthProvider')
	return ctx
}
