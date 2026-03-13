import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext(null)

function buildUsername(user) {
	const meta = user?.user_metadata || {}
	if (meta.username) return String(meta.username)
	if (meta.full_name) return String(meta.full_name)
	const email = user?.email || ''
	if (email.includes('@')) return email.split('@')[0]
	return `user_${String(user?.id || '').slice(0, 8)}`
}

export function AuthProvider({ children }) {
	const [session, setSession] = useState(null)
	const [user, setUser] = useState(null)
	const [profile, setProfile] = useState(null)
	const [loading, setLoading] = useState(true)
	const [profileLoading, setProfileLoading] = useState(false)

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
			.select('id, username, avatar_url, favorite_team_id')
			.eq('id', targetUser.id)
			.maybeSingle()

		if (error) {
			console.warn('AuthContext profile fetch:', error.message)
			const fallback = {
				id: targetUser.id,
				username: defaultUsername,
				avatar_url: defaultAvatar,
				favorite_team_id: null,
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
				avatar_url: defaultAvatar,
				favorite_team_id: null,
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
			avatar_url: data.avatar_url || defaultAvatar,
			favorite_team_id: data.favorite_team_id ?? null,
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

			const nextUserId = nextSession?.user?.id ?? null
			const prevUserId = lastAuthUserIdRef.current
			lastAuthUserIdRef.current = nextUserId

			setSession(nextSession)
			setUser(nextSession?.user ?? null)
			setLoading(false)

			if (!nextSession?.user) {
				setProfileLoading(false)
				inFlightProfileUserIdRef.current = null
				setProfile(null)
				return
			}

			if (prevUserId !== nextUserId || !profileRef.current?.id) {
				refreshProfile(nextSession.user, { force: true })
			} else if (!profileRef.current?.username) {
				refreshProfile(nextSession.user)
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

	async function signUp({ email, password, username }) {
		const cleanUsername = String(username || '').trim()
		const finalUsername = cleanUsername || email?.split('@')?.[0] || 'esports_fan'
		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				data: {
					username: finalUsername,
				},
			},
		})
		if (error) throw error

		if (data.user?.id) {
			await supabase.from('profiles').upsert({
				id: data.user.id,
				username: finalUsername,
				avatar_url: data.user.user_metadata?.avatar_url || null,
				favorite_team_id: null,
			}, { onConflict: 'id' })
			await refreshProfile(data.user)
		}

		return data
	}

	async function signIn({ email, password }) {
		const { data, error } = await supabase.auth.signInWithPassword({ email, password })
		if (error) throw error
		if (data.user) refreshProfile(data.user, { force: true })
		return data
	}

	async function signOut() {
		const { error } = await supabase.auth.signOut()
		if (error) throw error
		setProfileLoading(false)
		inFlightProfileUserIdRef.current = null
		setProfile(null)
	}

	async function updateProfile(partial) {
		if (!user?.id) throw new Error('Giris yapmadan profil guncellenemez.')
		const payload = {
			id: user.id,
			...(partial?.username !== undefined ? { username: partial.username || buildUsername(user) } : {}),
			...(partial?.avatar_url !== undefined ? { avatar_url: partial.avatar_url || null } : {}),
			...(partial?.favorite_team_id !== undefined ? { favorite_team_id: partial.favorite_team_id } : {}),
		}
		const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' })
		if (error) throw error
		const merged = {
			id: user.id,
			username: payload.username ?? profile?.username ?? buildUsername(user),
			avatar_url: payload.avatar_url ?? profile?.avatar_url ?? null,
			favorite_team_id: payload.favorite_team_id ?? profile?.favorite_team_id ?? null,
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
		isAuthenticated: !!user,
	}), [session, user, profile, loading, profileLoading, refreshProfile])

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
	const ctx = useContext(AuthContext)
	if (!ctx) throw new Error('useAuth must be used within AuthProvider')
	return ctx
}
