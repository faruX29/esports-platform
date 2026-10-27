import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { App } from '@capacitor/app'
import { dinleyicileriKur, kaydol } from '../utils/push'
import { girisDonusuMu, girisDonusunuIsle } from '../utils/uygulamaGiris'

/**
 * Yalnız Capacitor uygulamasında (App.jsx lazy yükler): push dinleyicileri,
 * kayıtlı hesapla FCM kaydı ve Google girişi dönüş linki. Görünür bir şey çizmez.
 */
export default function UygulamaKopru() {
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    dinleyicileriKur({
      git: (yol) => navigate(yol),
      ekrandayken: (bildirim) => {
        const metin = [bildirim?.title, bildirim?.body].filter(Boolean).join(' · ')
        if (metin) toast(metin, { duration: 5000, id: bildirim?.id })
      },
    }).catch((err) => console.error('Push dinleyicileri kurulamadı:', err))
  }, [navigate])

  // Google girişi dönüşü: uygulama açıkken appUrlOpen; tarayıcıdayken süreç
  // kapandıysa soğuk açılışta getLaunchUrl. Aynı link iki kez işlenmez.
  useEffect(() => {
    const islenen = new Set()
    async function linkGeldi(url) {
      if (!girisDonusuMu(url) || islenen.has(url)) return
      islenen.add(url)
      try {
        await girisDonusunuIsle(url)
        if (/^\/(login|register)(\/|$)/.test(window.location.pathname)) navigate('/', { replace: true })
      } catch (err) {
        console.error('Google girişi tamamlanamadı:', err)
        toast.error('Google girişi tamamlanamadı. Tekrar dene.')
      }
    }
    const dinleyici = App.addListener('appUrlOpen', ({ url }) => linkGeldi(url))
    App.getLaunchUrl().then((r) => r?.url && linkGeldi(r.url)).catch(() => {})
    return () => { dinleyici.then((d) => d.remove()) }
  }, [navigate])

  // useAuth().user anonimi içermez: push yalnız kayıtlı hesaba.
  const kullaniciId = user?.id
  useEffect(() => {
    if (!kullaniciId) return
    kaydol().catch((err) => console.error('Push kaydı başarısız:', err))
  }, [kullaniciId])

  return null
}
