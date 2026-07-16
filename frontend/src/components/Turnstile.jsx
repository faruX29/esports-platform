/**
 * Turnstile.jsx — Cloudflare Turnstile widget (bot koruması).
 *
 * - Script'i tarayıcıda bir kez yükler (explicit render modu).
 * - onVerify(token): kullanıcı doğrulamayı geçince token verir.
 * - onExpire(): token süresi dolunca / hata olunca (parent token'ı temizlemeli).
 * - ref.reset(): tek-kullanımlık token tüketildikten (submit hatası) sonra yeni challenge.
 *
 * Site key yoksa (VITE_TURNSTILE_SITE_KEY tanımsız) HİÇBİR ŞEY render etmez →
 * formlar eskisi gibi çalışır. [[features]] TURNSTILE_ENABLED.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { TURNSTILE_SITE_KEY } from '../features'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise = null

function loadScript() {
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

const Turnstile = forwardRef(function Turnstile({ onVerify, onExpire, theme = 'dark' }, ref) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const onVerifyRef = useRef(onVerify)
  const onExpireRef = useRef(onExpire)

  useEffect(() => { onVerifyRef.current = onVerify }, [onVerify])
  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current !== null && window.turnstile) {
        try { window.turnstile.reset(widgetIdRef.current) } catch { /* yoksay */ }
      }
    },
  }), [])

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false

    loadScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      if (widgetIdRef.current !== null) return // çift-render koruması (StrictMode)
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme,
        // Uzun kayıt formunda token (300s TTL) bayatlar → süre dolunca otomatik
        // yeni challenge çöz + yeni token üret; hata olunca da otomatik yeniden dene.
        // Böylece submit anında elde her zaman TAZE token olur ("timeout" hatası önlenir).
        'refresh-expired': 'auto',
        retry: 'auto',
        callback: (token) => onVerifyRef.current?.(token),
        'expired-callback': () => onExpireRef.current?.(),
        'error-callback': () => onExpireRef.current?.(),
      })
    }).catch(() => { /* script yüklenmezse formu bloklama */ })

    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* yoksay */ }
        widgetIdRef.current = null
      }
    }
  }, [theme])

  if (!TURNSTILE_SITE_KEY) return null
  return <div ref={containerRef} style={{ minHeight: 65, marginTop: 4 }} />
})

export default Turnstile
