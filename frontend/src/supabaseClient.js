import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 350
const REALTIME_EVENTS_PER_SECOND = 5
const BROWSER_NOTIFICATION_DEDUPE_MS = 12_000
const browserNotificationDedupe = new Map()

function toInt(value, fallback = 0) {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeStatus(value) {
	return String(value || '').trim().toLowerCase()
}

function isTransientNetworkError(error) {
	const msg = String(error?.message || error || '').toLowerCase()
	return (
		msg.includes('failed to fetch') ||
		msg.includes('networkerror') ||
		msg.includes('network request failed') ||
		msg.includes('getaddrinfo') ||
		msg.includes('dns') ||
		msg.includes('econnreset') ||
		msg.includes('connection aborted')
	)
}

function isRetryableStatus(status) {
	return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

function wait(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

function canUseBrowserNotifications() {
	return typeof window !== 'undefined' && typeof Notification !== 'undefined'
}

export async function requestBrowserNotificationPermission({ allowPrompt = true } = {}) {
	if (!canUseBrowserNotifications()) return 'unsupported'
	if (Notification.permission === 'granted') return 'granted'
	if (!allowPrompt) return Notification.permission

	try {
		return await Notification.requestPermission()
	} catch {
		return 'denied'
	}
}

export function triggerBrowserMatchNotification(notification) {
	if (!notification?.browserEligible) return false
	if (!canUseBrowserNotifications()) return false
	if (Notification.permission !== 'granted') return false

	const dedupeKey = `${notification.dedupeKey}_browser`
	const now = Date.now()
	const previous = browserNotificationDedupe.get(dedupeKey) || 0
	if ((now - previous) < BROWSER_NOTIFICATION_DEDUPE_MS) return false

	browserNotificationDedupe.set(dedupeKey, now)
	if (browserNotificationDedupe.size > 120) {
		const expiry = now - (2 * 60 * 1000)
		for (const [key, ts] of browserNotificationDedupe.entries()) {
			if (ts < expiry) browserNotificationDedupe.delete(key)
		}
	}

	try {
		const notif = new Notification(notification.title, {
			body: notification.message,
			tag: `match_${notification.matchId}_${notification.variant}`,
			renotify: false,
			silent: false,
		})

		notif.onclick = () => {
			if (typeof window !== 'undefined' && notification.matchId) {
				window.focus?.()
				window.location.assign(`/match/${notification.matchId}`)
			}
		}
		return true
	} catch {
		return false
	}
}

async function resilientFetch(input, init) {
	let attempt = 0
	let lastError = null

	while (attempt <= RETRY_ATTEMPTS) {
		try {
			const response = await fetch(input, init)
			if (attempt < RETRY_ATTEMPTS && isRetryableStatus(response.status)) {
				const backoff = RETRY_BASE_DELAY_MS * (2 ** attempt)
				await wait(backoff)
				attempt += 1
				continue
			}
			return response
		} catch (err) {
			lastError = err
			if (attempt >= RETRY_ATTEMPTS || !isTransientNetworkError(err)) break
			const backoff = RETRY_BASE_DELAY_MS * (2 ** attempt)
			await wait(backoff)
			attempt += 1
		}
	}

	throw lastError || new Error('Supabase request failed')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	global: {
		fetch: resilientFetch,
	},
	realtime: {
		params: {
			eventsPerSecond: REALTIME_EVENTS_PER_SECOND,
		},
	},
})

export function subscribeToMatchesUpdates(onUpdate) {
	if (typeof onUpdate !== 'function') return () => {}

	const channel = supabase
		.channel(`matches_live_${Math.random().toString(36).slice(2, 9)}`)
		.on(
			'postgres_changes',
			{ event: 'UPDATE', schema: 'public', table: 'matches' },
			payload => {
				onUpdate(payload)
			}
		)
		.subscribe()

	return () => {
		supabase.removeChannel(channel)
	}
}

export function buildManualTestNotification(kind = 'start') {
	const normalized = String(kind || 'start').toLowerCase()
	if (normalized === 'finish' || normalized === 'finished') {
		return buildMatchRealtimeNotification({
			old: { id: 'manual-test', status: 'running', team_a_score: 11, team_b_score: 9 },
			new: { id: 'manual-test', status: 'finished', team_a_score: 13, team_b_score: 11 },
		})
	}

	return buildMatchRealtimeNotification({
		old: { id: 'manual-test', status: 'not_started', team_a_score: 0, team_b_score: 0 },
		new: { id: 'manual-test', status: 'running', team_a_score: 0, team_b_score: 0 },
	})
}

export function buildMatchRealtimeNotification(payload) {
	const nextRow = payload?.new ?? {}
	const prevRow = payload?.old ?? {}
	if (!nextRow?.id) return null

	const nextStatus = normalizeStatus(nextRow?.status)
	const prevStatus = normalizeStatus(prevRow?.status)
	const teamAScore = toInt(nextRow?.team_a_score, 0)
	const teamBScore = toInt(nextRow?.team_b_score, 0)
	const scoreChanged =
		prevRow?.team_a_score !== nextRow?.team_a_score ||
		prevRow?.team_b_score !== nextRow?.team_b_score
	const statusChanged = prevStatus !== nextStatus

	let title = ''
	let variant = 'info'
	let browserEligible = false

	if (statusChanged && nextStatus === 'finished') {
		title = 'MAC BITTI!'
		variant = 'success'
		browserEligible = true
	} else if (statusChanged && nextStatus === 'running') {
		title = 'MAC BASLADI!'
		variant = 'info'
		browserEligible = true
	} else if (scoreChanged && nextStatus === 'running') {
		title = 'GOL! SKOR GUNCELLENDI'
		variant = 'live'
	} else if (scoreChanged && nextStatus === 'finished') {
		title = 'SKOR KESINLESTI'
		variant = 'success'
	} else {
		return null
	}

	const dedupeKey = `${nextRow.id}_${nextStatus}_${teamAScore}_${teamBScore}_${title}`

	return {
		title,
		message: `Mac #${nextRow.id} · ${teamAScore}:${teamBScore}`,
		matchId: nextRow.id,
		variant,
		dedupeKey,
		browserEligible,
	}
}