// giris — kullanıcı adı ya da e-posta + şifre ile giriş (email_for_login'in yerine).
// E-posta tarayıcıya hiç dönmez; yalnız oturum anahtarları döner.
//
// Neden captcha burada doğrulanıyor: Auth'a secret key ile gidiyoruz (Sb-Forwarded-For
// yalnız secret key'le geçer) ve Auth admin kimlikli istekte captcha'yı atlar
// (supabase/auth middleware.go verifyCaptcha). Token tek kullanımlık, yalnız burada harcanır.
//
// IP: cf-connecting-ip (Cloudflare koyar, istemcinin gönderdiği istek 1000 ile reddedilir);
// yoksa ağ geçidinin koyduğu sb-forwarded-for. 20 Kasım 2026 testi: ikisi de sahtelenemedi.
// Auth'ın IP sınırı bu IP'yle işler: proje ayarı security_sb_forwarded_for_enabled açık olmalı.
//
// Sınırlar: Auth'ın IP sınırı + kimlik (kullanıcı adı/e-posta) başına 15 dk'da 5 hatalı,
// IP başına 15 dk'da 20 hatalı (login_rpc_attempts). Hesap bilgisi sızdırmasın diye kullanıcı
// adı yok / şifre yanlış / şifresiz (Google) hesap / kimlik sınırı → hep {hata:'gecersiz'},
// en az EN_AZ_SURE_MS sürede.
//
// Secret'lar: TURNSTILE_SECRET_KEY (Auth captcha ayarındakiyle aynı), secret key
// (otomatik SUPABASE_SECRET_KEYS, yoksa SB_SECRET_KEY).
// verify_jwt kapalı (config.toml): giriş öncesi oturum yok.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { corsBasliklari, json } from '../_shared/cors.ts'

const EN_AZ_SURE_MS = 1000
const PENCERE_DK = 15
const KIMLIK_SINIRI = 5
const IP_SINIRI = 20
// Kullanıcı adı bulunamazsa da Auth çağrılır (süre aynı kalsın); bu adres hiç var olamaz.
const YOK_EPOSTA = 'yok@fextesports.invalid'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

function secretKey(): string {
  const tekil = Deno.env.get('SB_SECRET_KEY')
  if (tekil) return tekil
  try {
    const hepsi = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    return hepsi.default ?? Object.values(hepsi)[0] ?? ''
  } catch {
    return ''
  }
}

function istemciIp(req: Request): string {
  const cf = (req.headers.get('cf-connecting-ip') ?? '').trim()
  if (cf) return cf
  return (req.headers.get('sb-forwarded-for') ?? '').split(',')[0].trim()
}

async function captchaGecerli(token: string, ip: string): Promise<boolean> {
  const gizli = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!gizli || !token) return false
  const form = new FormData()
  form.append('secret', gizli)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    const d = await r.json()
    if (!d.success) console.warn('giris captcha:', JSON.stringify(d['error-codes'] ?? []))
    return d.success === true
  } catch (e) {
    console.error('giris captcha isteği:', (e as Error).message)
    return false
  }
}

// ilike'ta `_` ve `%` jokerdir; kullanıcı adında `_` olabilir → kaçır, sonra kesin karşılaştır.
function ilikeKacir(s: string): string {
  return s.replace(/[\\%_]/g, (k) => `\\${k}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsBasliklari(req) })
  if (req.method !== 'POST') return json(req, 405, { hata: 'yontem' })

  const baslangic = Date.now()
  const bekleVeDon = async (durum: number, govde: unknown) => {
    const kalan = EN_AZ_SURE_MS - (Date.now() - baslangic)
    if (kalan > 0) await new Promise((r) => setTimeout(r, kalan))
    return json(req, durum, govde)
  }

  let govde: { kimlik?: string; sifre?: string; captcha?: string } = {}
  try { govde = await req.json() } catch { /* boş gövde */ }
  const kimlik = String(govde.kimlik ?? '').trim().toLowerCase()
  const sifre = String(govde.sifre ?? '')
  if (!kimlik || !sifre || kimlik.length > 320 || sifre.length > 200) return json(req, 400, { hata: 'eksik' })

  const anahtar = secretKey()
  if (!anahtar || !Deno.env.get('TURNSTILE_SECRET_KEY')) {
    console.error('giris: secret key ya da TURNSTILE_SECRET_KEY eksik')
    return json(req, 500, { hata: 'yapilandirma' })
  }

  const ip = istemciIp(req)
  // Captcha hesap bilgisi taşımaz: ayrı cevap güvenli, süre beklemeye gerek yok.
  if (!(await captchaGecerli(String(govde.captcha ?? ''), ip))) return json(req, 400, { hata: 'captcha' })

  const admin = createClient(SUPABASE_URL, anahtar, { auth: { persistSession: false, autoRefreshToken: false } })

  // Sınırlar (yalnız hatalı denemeler sayılır)
  const esik = new Date(Date.now() - PENCERE_DK * 60_000).toISOString()
  const [kSay, iSay] = await Promise.all([
    admin.from('login_rpc_attempts').select('id', { count: 'exact', head: true })
      .eq('username_lower', kimlik).eq('success', false).gt('created_at', esik),
    ip
      ? admin.from('login_rpc_attempts').select('id', { count: 'exact', head: true })
        .eq('ip', ip).eq('success', false).gt('created_at', esik)
      : Promise.resolve({ count: 0, error: null }),
  ])
  if (kSay.error || iSay.error) {
    console.error('giris sınır sorgusu:', kSay.error?.message ?? iSay.error?.message)
    return bekleVeDon(500, { hata: 'sunucu' })
  }
  if ((kSay.count ?? 0) >= KIMLIK_SINIRI || (iSay.count ?? 0) >= IP_SINIRI) {
    return bekleVeDon(401, { hata: 'gecersiz' })
  }

  // Kimlik → e-posta (e-posta tarayıcıya dönmez)
  let eposta = YOK_EPOSTA
  if (kimlik.includes('@')) {
    eposta = kimlik
  } else {
    const { data: profiller, error } = await admin.from('profiles').select('id, username')
      .ilike('username', ilikeKacir(kimlik)).limit(5)
    if (error) {
      console.error('giris profil sorgusu:', error.message)
      return bekleVeDon(500, { hata: 'sunucu' })
    }
    const p = (profiller ?? []).find((x) => String(x.username ?? '').toLowerCase() === kimlik)
    if (p) {
      const { data: k, error: kHata } = await admin.auth.admin.getUserById(p.id)
      if (kHata) {
        console.error('giris kullanıcı sorgusu:', kHata.message)
        return bekleVeDon(500, { hata: 'sunucu' })
      }
      if (k?.user?.email) eposta = k.user.email.toLowerCase()
    }
  }

  // Asıl giriş: Auth'ın kendi şifre kontrolü + IP sınırı (gerçek IP ile)
  let r: Response
  try {
    r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anahtar,
        'Content-Type': 'application/json',
        ...(ip ? { 'Sb-Forwarded-For': ip } : {}),
      },
      body: JSON.stringify({ email: eposta, password: sifre }),
    })
  } catch (e) {
    console.error('giris auth isteği:', (e as Error).message)
    return bekleVeDon(502, { hata: 'sunucu' })
  }
  const d = await r.json().catch(() => ({}))
  const basarili = r.ok && !!d.access_token && !!d.refresh_token

  const { error: kayitHata } = await admin.from('login_rpc_attempts')
    .insert({ username_lower: kimlik, ip: ip || null, success: basarili })
  if (kayitHata) console.error('giris deneme kaydı:', kayitHata.message)

  if (basarili) {
    return bekleVeDon(200, { access_token: d.access_token, refresh_token: d.refresh_token })
  }
  const kod = String(d.error_code ?? d.code ?? '')
  if (r.status === 429 || kod === 'over_request_rate_limit') return bekleVeDon(429, { hata: 'cok_deneme' })
  // Supabase'in doğrudan girişte de verdiği ayrım: şifre doğru, e-posta onaysız.
  if (kod === 'email_not_confirmed') return bekleVeDon(400, { hata: 'eposta_onaysiz' })
  if (kod && kod !== 'invalid_credentials') console.warn('giris auth:', r.status, kod)
  return bekleVeDon(401, { hata: 'gecersiz' })
})
