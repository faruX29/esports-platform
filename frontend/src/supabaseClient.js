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

function requestUrl(input) {
	if (typeof input === 'string') return input
	return input?.url || ''
}

async function resilientFetch(input, init) {
	// Auth istekleri (signup/login/reset) tek-kullanımlık Turnstile captcha token'ı
	// taşır. Ağ blip'i ya da geçici 5xx'te retry AYNI token'ı tekrar oynatır →
	// Cloudflare "timeout-or-duplicate" döndürür ve kayıt/giriş kırılır. Ayrıca auth
	// POST'ları idempotent değil (çift kayıt riski). → auth'ta retry YOK.
	const isAuthRequest = requestUrl(input).includes('/auth/v1/')
	const maxAttempts = isAuthRequest ? 0 : RETRY_ATTEMPTS

	let attempt = 0
	let lastError = null

	while (attempt <= maxAttempts) {
		try {
			const response = await fetch(input, init)
			if (attempt < maxAttempts && isRetryableStatus(response.status)) {
				const backoff = RETRY_BASE_DELAY_MS * (2 ** attempt)
				await wait(backoff)
				attempt += 1
				continue
			}
			return response
		} catch (err) {
			lastError = err
			if (attempt >= maxAttempts || !isTransientNetworkError(err)) break
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

// ── Canlı maç yayını: uygulama başına TEK kanal ─────────────────────────────
// Veritabanı tetikleyicisi (backend/sql/canli_yayin.sql) durum/skor/kazanan/saat
// değişen maçları ifade başına tek Broadcast mesajında 'maclar' konusuna atar.
// Eskiden her abone (App + Dashboard + Matches) kendi postgres_changes kanalını
// açıyor, her satır yazımında tüm satırı (raw_data dahil) alıyordu.
// Olay biçimi eskisiyle aynı: { eventType: 'INSERT'|'UPDATE', new, old }.
// old artık gerçekten önceki durum/skor/kazananı taşır (RLS'li postgres_changes'te
// yalnız id geliyordu). Yeniden bağlanınca { eventType: 'RESYNC' } yayılır: kopukken
// kaçan değişimler için dinleyici listesini tazelemeli.
const MACLAR_KONUSU = 'maclar'
const KANAL_KAPATMA_GECIKMESI_MS = 5_000
const macDinleyicileri = new Set()
const baglantiDinleyicileri = new Set()
let macKanali = null
let kanalBagli = false
let kanalHicBaglandi = false
let kapatmaZamanlayicisi = null
let kapanisSozu = null  // removeChannel sürerken yeni kanal açılmaz (aşağıya bak)

function macDinleyicilerineYay(olay) {
	for (const dinleyici of macDinleyicileri) {
		try {
			dinleyici(olay)
		} catch (err) {
			console.error('Canlı maç dinleyicisi:', err?.message || err)
		}
	}
}

function kanalDurumunuAyarla(bagli) {
	if (kanalBagli === bagli) return
	kanalBagli = bagli
	for (const dinleyici of baglantiDinleyicileri) dinleyici(bagli)
}

function macKanaliniAc() {
	if (macKanali) return
	if (kapanisSozu) {
		// supabase.channel() aynı konudaki kanalı yeniden kullanır; kapanmakta olan
		// kanala abone olmak sessizce boşa düşer → kapanış bitince yeniden dene.
		kapanisSozu.then(() => { if (!macKanali && macDinleyicileri.size > 0) macKanaliniAc() })
		return
	}
	macKanali = supabase
		.channel(MACLAR_KONUSU)
		.on('broadcast', { event: 'degisim' }, ({ payload }) => {
			const eventType = payload?.tur === 'insert' ? 'INSERT' : 'UPDATE'
			for (const satir of payload?.maclar || []) {
				if (!satir?.id) continue
				const { eski, ...yeni } = satir
				macDinleyicilerineYay({ eventType, new: yeni, old: eski ? { id: yeni.id, ...eski } : {} })
			}
		})
		.subscribe(durum => {
			if (durum === 'SUBSCRIBED') {
				const yenidenBaglandi = kanalHicBaglandi
				kanalHicBaglandi = true
				kanalDurumunuAyarla(true)
				if (yenidenBaglandi) macDinleyicilerineYay({ eventType: 'RESYNC', new: {}, old: {} })
			} else {
				// CHANNEL_ERROR / TIMED_OUT / CLOSED: realtime-js kendisi yeniden dener.
				kanalDurumunuAyarla(false)
			}
		})
}

function macKanaliniKapatmayiPlanla() {
	clearTimeout(kapatmaZamanlayicisi)
	// Sayfa geçişinde (bir abone çıkıp diğeri girerken) kanalı kapatıp açmamak için gecikme.
	kapatmaZamanlayicisi = setTimeout(() => {
		if (macDinleyicileri.size > 0 || !macKanali) return
		const kanal = macKanali
		macKanali = null
		kanalHicBaglandi = false
		kanalDurumunuAyarla(false)
		kapanisSozu = supabase.removeChannel(kanal)
			.catch(() => {})
			.finally(() => {
				// Sunucu ayrılmayı onaylamadıysa (zaman aşımı) kanal listede kalır → zorla sök.
				if (supabase.getChannels().includes(kanal)) kanal.teardown()
				kapanisSozu = null
			})
	}, KANAL_KAPATMA_GECIKMESI_MS)
}

export function subscribeToMatchesUpdates(onUpdate) {
	if (typeof onUpdate !== 'function') return () => {}

	macDinleyicileri.add(onUpdate)
	clearTimeout(kapatmaZamanlayicisi)
	macKanaliniAc()

	return () => {
		macDinleyicileri.delete(onUpdate)
		if (macDinleyicileri.size === 0) macKanaliniKapatmayiPlanla()
	}
}

// Canlı kanal bağlı mı? Bağlıyken sayfalar yoklamayı seyrekleştirir.
export function isMatchesChannelConnected() {
	return kanalBagli
}

export function subscribeToMatchesChannelStatus(onChange) {
	if (typeof onChange !== 'function') return () => {}
	baglantiDinleyicileri.add(onChange)
	return () => baglantiDinleyicileri.delete(onChange)
}

export function subscribeToNewsComments(newsId, { onInsert, onDelete } = {}) {
	if (!newsId) return () => {}

	const channel = supabase
		.channel(`news_comments_${String(newsId).replace(/[^a-z0-9]/gi, '_')}_${Math.random().toString(36).slice(2, 9)}`)
		.on(
			'postgres_changes',
			{ event: 'INSERT', schema: 'public', table: 'news_comments', filter: `news_id=eq.${newsId}` },
			payload => { if (typeof onInsert === 'function') onInsert(payload.new) }
		)
		.on(
			'postgres_changes',
			{ event: 'DELETE', schema: 'public', table: 'news_comments', filter: `news_id=eq.${newsId}` },
			payload => { if (typeof onDelete === 'function') onDelete(payload.old) }
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

export function buildMatchRealtimeNotification(payload, opts = {}) {
	const nextRow = payload?.new ?? {}
	const prevRow = payload?.old ?? {}
	if (!nextRow?.id) return null

	// teamNames: id→isim haritası (realtime payload isim taşımaz → çağıran verir).
	const teamNames = opts.teamNames instanceof Map ? opts.teamNames : new Map()
	const nextStatus = normalizeStatus(nextRow?.status)
	const prevStatus = normalizeStatus(prevRow?.status)
	const teamAScore = toInt(nextRow?.team_a_score, 0)
	const teamBScore = toInt(nextRow?.team_b_score, 0)
	const scoreChanged =
		prevRow?.team_a_score !== nextRow?.team_a_score ||
		prevRow?.team_b_score !== nextRow?.team_b_score
	const statusChanged = prevStatus !== nextStatus

	const aName = teamNames.get(nextRow?.team_a_id) || 'Takım A'
	const bName = teamNames.get(nextRow?.team_b_id) || 'Takım B'
	const vsLine = `${aName} vs ${bName}`
	const scoreLine = `${aName} ${teamAScore}-${teamBScore} ${bName}`

	let title = ''
	let message = ''
	let variant = 'info'
	let browserEligible = false

	if (statusChanged && nextStatus === 'finished') {
		title = 'Maç bitti'
		message = scoreLine
		variant = 'success'
		browserEligible = true
	} else if (statusChanged && nextStatus === 'running') {
		title = 'Maç başladı'
		message = vsLine
		variant = 'info'
		browserEligible = true
	} else if (scoreChanged && nextStatus === 'running') {
		title = 'Skor güncellendi'
		message = scoreLine
		variant = 'live'
	} else if (scoreChanged && nextStatus === 'finished') {
		title = 'Skor kesinleşti'
		message = scoreLine
		variant = 'success'
	} else {
		return null
	}

	const dedupeKey = `${nextRow.id}_${nextStatus}_${teamAScore}_${teamBScore}_${title}`

	return { title, message, matchId: nextRow.id, variant, dedupeKey, browserEligible }
}