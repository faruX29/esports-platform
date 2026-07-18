// Özellik bayrakları (feature flags).
//
// DISCORD_ENABLED: Discord OAuth butonlarını göster/gizle. Kod hazır; buton
// yalnızca Supabase'de Discord provider açıldıktan SONRA true yapılmalı — aksi
// halde tıklanınca "provider not enabled" hatası verir. [[auth-onboarding]] B adımı.
export const DISCORD_ENABLED = false

// GOOGLE_ENABLED: Google ile giriş/kayıt butonlarını göster/gizle. Kod hazır; buton
// yalnızca Supabase → Auth → Providers → Google AÇILIP Google Cloud OAuth client'ı
// kurulduktan SONRA true yapılmalı — aksi halde tıklanınca "provider is not enabled"
// hatası verir. Kurulum: Google Cloud Console → OAuth client (Web) → Authorized redirect
// URI = https://<PROJ>.supabase.co/auth/v1/callback → Client ID+Secret'ı Supabase'e gir.
export const GOOGLE_ENABLED = false

// TURNSTILE — Cloudflare bot koruması (SMTP kotasını bot kayıt/reset saldırısından korur).
// Site key PUBLIC'tir, Vercel env `VITE_TURNSTILE_SITE_KEY`'den okunur. Secret key
// Supabase paneline girilir (Auth → Attack Protection → CAPTCHA).
//
// Davranış:
//   • Key YOKSA → widget hiç render olmaz, formlar bugünkü gibi çalışır (dev/geçiş güvenli).
//   • Key VARSA → widget render olur + captchaToken signUp/signIn/reset'e eklenir.
//
// ⚠️ ROLLOUT SIRASI: Supabase'de CAPTCHA'yı SADECE bu key canlı env'e girilip DEPLOY
// edildikten SONRA aç. Aksi halde token göndermeyen istekler (eski cache'li sayfalar)
// reddedilir. Supabase CAPTCHA toggle'ı GLOBAL'dir → signup + login + reset üçünü de
// zorlar; bu yüzden Turnstile üç formda da var. [[auth-onboarding]]
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
export const TURNSTILE_ENABLED = !!TURNSTILE_SITE_KEY
