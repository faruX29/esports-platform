import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 350
const REALTIME_EVENTS_PER_SECOND = 5

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

export function buildMatchRealtimeNotification(payload) {
	const nextRow = payload?.new
	const prevRow = payload?.old || {}
	if (!nextRow?.id) return null

	const nextStatus = normalizeStatus(nextRow.status)
	const prevStatus = normalizeStatus(prevRow.status)
	const teamAScore = toInt(nextRow.team_a_score, 0)
	const teamBScore = toInt(nextRow.team_b_score, 0)
	const scoreChanged =
		prevRow.team_a_score !== nextRow.team_a_score ||
		prevRow.team_b_score !== nextRow.team_b_score
	const statusChanged = prevStatus !== nextStatus

	let title = ''
	let variant = 'info'

	if (statusChanged && nextStatus === 'finished') {
		title = 'MAC BITTI!'
		variant = 'success'
	} else if (statusChanged && nextStatus === 'running') {
		title = 'MAC BASLADI!'
		variant = 'info'
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
	}
}