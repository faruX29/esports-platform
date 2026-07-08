# SMTP (Resend) + Turnstile (Cloudflare) — Kurulum Kılavuzu

Kod tarafı hazır. Aşağıdaki adımlar **panel ayarları** — anahtarlar elde olunca sırayla yapılır.

---

## 1) Production SMTP — Resend → Supabase

### 1.1 Resend'den SMTP bilgileri
- Host: `smtp.resend.com`
- Port: `465`  (SSL)
- User: `resend`
- Pass: Resend API key (`re_...`)
- Gönderici: `onboarding@resend.dev` (domain yokken) → domain alınınca `noreply@senindomain.com`

### 1.2 Supabase → Custom SMTP
Supabase Dashboard → **Project Settings → Authentication → SMTP Settings** (veya Authentication → Emails → SMTP):
1. **Enable Custom SMTP** aç.
2. Alanları doldur:
   - Sender email: `onboarding@resend.dev`
   - Sender name: `EsportsHub Pro`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: `re_...` (Resend API key)
3. **Save**.
4. **Rate limits** (Authentication → Rate Limits): "Emails per hour" değerini yükselt (built-in limit ~3-4/saat idi; Resend free 100/gün, 3000/ay). Lansman için ~50-100/saat yeterli.

### 1.3 Mail şablonları (cyberpunk)
Supabase Dashboard → **Authentication → Email Templates**:
- **Confirm signup** → `confirm_signup.html` içeriğinin tamamını yapıştır.
- **Reset Password** → `reset_password.html` içeriğinin tamamını yapıştır.
- (İstege bağlı: Magic Link / Change Email şablonlarını da aynı stille sonra ekleyebiliriz.)

### 1.4 Redirect URL (şifre sıfırlama için ŞART)
Supabase → **Authentication → URL Configuration → Redirect URLs**:
- Ekle: `https://esports-platform-brown.vercel.app/**`
- (Domain alınınca gerçek domaini de ekle.)

### 1.5 Test
- Kayıt ol → doğrulama maili gelmeli (cyberpunk şablon).
- Şifremi unuttum → reset maili gelmeli → link `/reset-password`e götürmeli.
- Resend Dashboard → **Logs**'ta gönderimleri gör.

---

## 2) Cloudflare Turnstile — bot koruması

> ⚠️ **SIRA ÖNEMLİ.** Supabase CAPTCHA toggle'ı GLOBAL'dir: açılınca **signup + login + reset** üçünü de zorlar. Önce Site Key'i Vercel'e koyup DEPLOY et, SONRA Supabase'de aç. Aksi halde token göndermeyen istekler reddedilir.

### 2.1 Site Key → Vercel env (frontend)
Vercel → Project → **Settings → Environment Variables**:
- Name: `VITE_TURNSTILE_SITE_KEY`
- Value: Cloudflare **Site Key** (`0x...`, public)
- Environment: Production (+ Preview istenirse)
- **Save** → **Redeploy** (env build-time'da gömülür, yeniden deploy şart).

Deploy sonrası: Kayıt/Giriş/Şifremi-unuttum formlarında Turnstile widget'ı görünmeli. (Key yoksa widget hiç çıkmaz — kod öyle tasarlandı.)

### 2.2 Secret Key → Supabase CAPTCHA
Supabase Dashboard → **Authentication → Attack Protection** (bazı sürümlerde Settings → Auth → "Enable CAPTCHA protection"):
1. **Enable CAPTCHA protection** aç.
2. Provider: **Turnstile** seç.
3. **Secret Key** yapıştır (Cloudflare'in verdiği gizli key `0x...`).
4. **Save**.

### 2.3 Test
- Signup/Login/Forgot formlarında widget'ı çöz → işlem geçmeli.
- Widget'ı çözmeden submit → "Lütfen doğrulamayı tamamla" uyarısı (frontend gate).
- Token'sız doğrudan API çağrısı → Supabase reddeder (server-side, bypass edilemez).

### 2.4 Geri alma (acil)
Sorun çıkarsa: Supabase'de CAPTCHA protection'ı kapat → formlar token göndermeye devam eder ama Supabase yok sayar, kimse kilitlenmez.

---

## Kod tarafında ne değişti (referans)
- `frontend/src/features.js` — `TURNSTILE_SITE_KEY` / `TURNSTILE_ENABLED` (env okur).
- `frontend/src/components/Turnstile.jsx` — widget (explicit render, reset handle, key yoksa null).
- `frontend/src/context/AuthContext.jsx` — `signUp` / `signIn` / `requestPasswordReset` artık `captchaToken` geçiriyor.
- `frontend/src/pages/{Register,Login,ForgotPassword}Page.jsx` — widget + token gate + hata sonrası reset.
- `backend/email_templates/*.html` — Supabase mail şablonları.
