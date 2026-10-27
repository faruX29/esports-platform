// send-push — bildirim kuyruğunu FCM HTTP v1 ile gönderir.
// Çağıran: pg_cron `bildirim-gonder` (backend/sql/push_altyapisi.sql), dakikada
// bir ve yalnız bekleyen satır varsa. Kimlik: x-cron-secret başlığı.
//
// Secret'lar (supabase secrets set):
//   PUSH_CRON_SECRET     Vault'taki push_cron_secret ile aynı
//   FCM_SERVICE_ACCOUNT  Firebase → Proje ayarları → Hizmet hesapları → JSON
//
// FCM yapılandırılmamışsa kuyruğa DOKUNMAZ (503) → satırlar 30 dk içinde
// gönderilmezse bayatlar; sağlık raporu bunu "bekleyen" diye gösterir.
//
// Gövde {"dry_run": true} → FCM validate_only: bildirim cihaza gitmez, token ve
// mesaj biçimi doğrulanır (test için).
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'

type Token = { token: string; platform: string }
type Satir = { id: number; baslik: string; govde: string; veri: Record<string, unknown>; tokenlar: Token[] }
type HizmetHesabi = { client_email: string; private_key: string; project_id: string }

const ESZAMANLI = 10

function esit(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let fark = 0
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return fark === 0
}

function b64url(veri: ArrayBuffer | Uint8Array | string): string {
  const baytlar = typeof veri === 'string' ? new TextEncoder().encode(veri) : new Uint8Array(veri)
  let s = ''
  for (const b of baytlar) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── Google OAuth erişim token'ı (hizmet hesabı JWT'si, RS256) ────────────
let onbellek: { token: string; bitis: number } | null = null

async function erisimTokeni(h: HizmetHesabi): Promise<string> {
  const simdi = Math.floor(Date.now() / 1000)
  if (onbellek && onbellek.bitis - 60 > simdi) return onbellek.token

  const pem = h.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const anahtar = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const baslik = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const iddia = b64url(JSON.stringify({
    iss: h.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: simdi,
    exp: simdi + 3600,
  }))
  const imza = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', anahtar, new TextEncoder().encode(`${baslik}.${iddia}`))
  const jwt = `${baslik}.${iddia}.${b64url(imza)}`

  const yanit = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!yanit.ok) throw new Error(`oauth ${yanit.status}: ${(await yanit.text()).slice(0, 200)}`)
  const j = await yanit.json()
  onbellek = { token: j.access_token, bitis: simdi + Number(j.expires_in || 3600) }
  return onbellek.token
}

// ── Tek token'a gönderim ─────────────────────────────────────────────────
type Sonuc = 'ok' | 'gecersiz' | 'tekrar'

async function gonder(h: HizmetHesabi, erisim: string, satir: Satir, t: Token, deneme: boolean): Promise<{ sonuc: Sonuc; hata?: string }> {
  // FCM data alanı yalnız string kabul eder.
  const veri = Object.fromEntries(Object.entries(satir.veri ?? {}).map(([k, v]) => [k, String(v)]))
  const mesaj = {
    validate_only: deneme,
    message: {
      token: t.token,
      notification: { title: satir.baslik, body: satir.govde },
      data: veri,
      android: { priority: 'high', notification: { channel_id: 'maclar', tag: `${veri.match_id}-${veri.tur}` } },
      apns: { payload: { aps: { sound: 'default', 'thread-id': String(veri.match_id ?? '') } } },
      webpush: { fcm_options: { link: `https://fextesports.com${veri.url ?? '/'}` } },
    },
  }
  const yanit = await fetch(`https://fcm.googleapis.com/v1/projects/${h.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${erisim}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mesaj),
  })
  if (yanit.ok) return { sonuc: 'ok' }

  const metin = await yanit.text()
  // Token artık geçerli değil: uygulama silindi ya da token yenilendi.
  if (yanit.status === 404 || /UNREGISTERED/.test(metin) ||
      (yanit.status === 400 && /registration token is not a valid|INVALID_ARGUMENT.*token/is.test(metin))) {
    return { sonuc: 'gecersiz', hata: `${yanit.status}` }
  }
  return { sonuc: 'tekrar', hata: `${yanit.status}: ${metin.slice(0, 200)}` }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('yontem', { status: 405 })

  const beklenen = Deno.env.get('PUSH_CRON_SECRET') ?? ''
  const gelen = req.headers.get('x-cron-secret') ?? ''
  if (!beklenen || !esit(gelen, beklenen)) return new Response('yetkisiz', { status: 401 })

  const hamHesap = Deno.env.get('FCM_SERVICE_ACCOUNT')
  if (!hamHesap) return Response.json({ hata: 'fcm_yapilandirilmadi' }, { status: 503 })
  let hesap: HizmetHesabi
  try {
    hesap = JSON.parse(hamHesap)
    if (!hesap.client_email || !hesap.private_key || !hesap.project_id) throw new Error('eksik alan')
  } catch (e) {
    console.error('send-push: FCM_SERVICE_ACCOUNT okunamadı:', (e as Error).message)
    return Response.json({ hata: 'fcm_hesap_bozuk' }, { status: 503 })
  }

  let deneme = false
  try { deneme = (await req.json())?.dry_run === true } catch { /* gövde boş */ }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  // OAuth token'ı kuyruğu almadan ÖNCE al: başarısızsa satırlar kilitlenmez.
  let erisim: string
  try {
    erisim = await erisimTokeni(hesap)
  } catch (e) {
    console.error('send-push: erişim tokenı:', (e as Error).message)
    return Response.json({ hata: 'oauth' }, { status: 502 })
  }

  const { data: satirlar, error } = await db.rpc('push_kuyrugu_al', { p_limit: 200 })
  if (error) {
    console.error('send-push: kuyruk alınamadı:', error.message)
    return Response.json({ hata: 'kuyruk' }, { status: 500 })
  }

  const gonderilen: number[] = []
  const hatali: { id: number; hata: string }[] = []
  const gecersiz = new Set<string>()

  const isler = (satirlar as Satir[] ?? []).map((satir) => async () => {
    const tokenlar = satir.tokenlar ?? []
    if (!tokenlar.length) { gonderilen.push(satir.id); return }   // cihaz kalmamış
    const sonuclar = await Promise.all(tokenlar.map((t) =>
      gonder(hesap, erisim, satir, t, deneme).catch((e) => ({ sonuc: 'tekrar' as Sonuc, hata: String(e?.message ?? e) }))))
    sonuclar.forEach((s, i) => { if (s.sonuc === 'gecersiz') gecersiz.add(tokenlar[i].token) })
    // En az bir cihaza gittiyse ya da tekrar denenecek cihaz kalmadıysa kapanır.
    if (sonuclar.some((s) => s.sonuc === 'ok') || sonuclar.every((s) => s.sonuc === 'gecersiz')) {
      gonderilen.push(satir.id)
    } else {
      hatali.push({ id: satir.id, hata: sonuclar.find((s) => s.sonuc === 'tekrar')?.hata ?? 'bilinmiyor' })
    }
  })

  // Sınırlı eşzamanlılık
  let sira = 0
  await Promise.all(Array.from({ length: ESZAMANLI }, async () => {
    while (sira < isler.length) await isler[sira++]()
  }))

  // Deneme modunda token silinmez, satırlar kapatılmaz: kilit açılır, rapor döner.
  const { error: isleHata } = await db.rpc('push_kuyrugu_isle', deneme
    ? { p_gonderilen: [], p_hatali: (satirlar as Satir[] ?? []).map((s) => ({ id: s.id, hata: 'dry_run' })), p_gecersiz_tokenlar: [] }
    : { p_gonderilen: gonderilen, p_hatali: hatali, p_gecersiz_tokenlar: [...gecersiz] })
  if (isleHata) {
    console.error('send-push: sonuç yazılamadı:', isleHata.message)
    return Response.json({ hata: 'isle' }, { status: 500 })
  }

  return Response.json({ alinan: satirlar?.length ?? 0, gonderilen: gonderilen.length, hatali: hatali.length, gecersiz_token: gecersiz.size, deneme })
})
