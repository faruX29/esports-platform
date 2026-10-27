/**
 * gorunmezCaptcha.js — form olmadan Turnstile token'ı almak için.
 *
 * Auth captcha'sı sunucuda zorunlu: anonim oturum (signInAnonymously) da token
 * ister. Kullanıcı bir formda değil, "Takip et"e basmış durumda; bu yüzden
 * widget 'interaction-only' görünümde, sayfanın altında geçici bir kutuda
 * çizilir. Cloudflare etkileşim istemezse kutu hiç görünmez; isterse kısa bir
 * açıklamayla belirir. Token gelince ya da süre dolunca kutu kaldırılır.
 */
import { TURNSTILE_SITE_KEY } from '../features'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise = null

export function turnstileYukle() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => { scriptPromise = null; reject(new Error('Turnstile yüklenemedi')) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

// Etkileşimsiz çözüm birkaç saniye sürer; etkileşim gerekirse kullanıcıya süre tanı.
const SESSIZ_SURE_MS = 20000
const ETKILESIM_SURE_MS = 120000

export async function gorunmezCaptchaTokeni({ etiket = 'Devam etmek için doğrula' } = {}) {
  if (!TURNSTILE_SITE_KEY) return null
  await turnstileYukle()
  if (!window.turnstile) throw new Error('Turnstile yüklenemedi')

  return new Promise((resolve, reject) => {
    const kutu = document.createElement('div')
    Object.assign(kutu.style, {
      position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)', zIndex: '1100',
      display: 'none', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '14px',
      padding: '12px 14px', boxShadow: '0 16px 40px rgba(0,0,0,.45)', maxWidth: 'calc(100vw - 32px)',
    })
    const yazi = document.createElement('div')
    yazi.textContent = etiket
    Object.assign(yazi.style, { fontSize: '12.5px', fontWeight: '700', color: 'var(--text-2)', marginBottom: '8px' })
    const yer = document.createElement('div')
    kutu.append(yazi, yer)
    document.body.appendChild(kutu)

    let bitti = false
    let widgetId = null
    let sayac = setTimeout(() => son(new Error('captcha_zaman_asimi')), SESSIZ_SURE_MS)

    function son(hata, token) {
      if (bitti) return
      bitti = true
      clearTimeout(sayac)
      if (widgetId !== null) { try { window.turnstile.remove(widgetId) } catch { /* yoksay */ } }
      kutu.remove()
      if (hata) reject(hata)
      else resolve(token)
    }

    try {
      widgetId = window.turnstile.render(yer, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: 'interaction-only',
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        retry: 'never',
        callback: token => son(null, token),
        'error-callback': () => son(new Error('captcha_hata')),
        'expired-callback': () => son(new Error('captcha_sure')),
        'unsupported-callback': () => son(new Error('captcha_desteklenmiyor')),
        'before-interactive-callback': () => {
          kutu.style.display = 'block'
          clearTimeout(sayac)
          sayac = setTimeout(() => son(new Error('captcha_zaman_asimi')), ETKILESIM_SURE_MS)
        },
      })
    } catch (err) {
      son(err)
    }
  })
}
