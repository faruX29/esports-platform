/**
 * Uygulamada push bildirimi (Capacitor + FCM). Web'de hiç yüklenmez:
 * UygulamaKopru ve AuthContext.signOut dinamik import eder.
 *
 * Push yalnız kayıtlı hesaba (backend/sql/push_altyapisi.sql, `push_token_kaydet`
 * anonim oturumu 42501 ile reddeder). Çıkışta cihazın token'ı silinir; yoksa
 * çıkış yapılan telefon eski hesabın bildirimlerini almaya devam eder.
 */
import { registerPlugin } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from '../supabaseClient'

// android/.../BildirimAyarlariPlugin.java: sistemin bu uygulamaya ait bildirim ayarı.
const BildirimAyarlari = registerPlugin('BildirimAyarlari')

const TOKEN_ANAHTARI = 'fext_push_token'
// Sistem izni kendiliğinden bir kez sorulur; reddedilirse tekrar sormak
// Ayarlar'daki bildirim bölümünün işi (izinIste; Android iki retten sonra
// pencereyi hiç göstermez, o zaman sistem ayarı açılır).
const IZIN_SORULDU_ANAHTARI = 'fext_push_izin_soruldu'

let dinleyiciler = null

function depoOku(anahtar) {
  try { return localStorage.getItem(anahtar) } catch { return null }
}
function depoYaz(anahtar, deger) {
  try {
    if (deger == null) localStorage.removeItem(anahtar)
    else localStorage.setItem(anahtar, deger)
  } catch { /* depo kapalı: bir sonraki açılışta yeniden kaydolur */ }
}

/** Bildirimdeki adres yalnız site içi yol olabilir ("/match/123"); gerisi yok sayılır. */
export function guvenliYol(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null
}

/**
 * Uygulama açılışında bir kez (oturumdan bağımsız): bildirime basılarak soğuk
 * açılan uygulamada olay, dinleyici eklenene kadar eklentide bekler.
 * @param {{ git: (yol: string) => void, ekrandayken: (bildirim: object) => void }} p
 */
export function dinleyicileriKur({ git, ekrandayken }) {
  if (dinleyiciler) return dinleyiciler
  dinleyiciler = (async () => {
    // send-push android.notification.channel_id = 'maclar'; kanal yoksa Android
    // bildirimi "Diğer" kanalına düşürür.
    await PushNotifications.createChannel({
      id: 'maclar',
      name: 'Maç bildirimleri',
      description: 'Takip ettiğin takımların maçı başlarken ve bitince',
      importance: 4,
      visibility: 1,
    }).catch((err) => console.error('Bildirim kanalı açılamadı:', err))

    await PushNotifications.addListener('registration', async ({ value }) => {
      const { error } = await supabase.rpc('push_token_kaydet', { p_token: value, p_platform: 'android' })
      if (error) {
        console.error('Push token kaydedilemedi:', error.message)
        return
      }
      depoYaz(TOKEN_ANAHTARI, value)
    })
    await PushNotifications.addListener('registrationError', (err) => {
      console.error('Push kaydı başarısız:', err?.error || err)
    })
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const yol = guvenliYol(notification?.data?.url)
      if (yol) git(yol)
    })
    // Uygulama öndeyken Android bildirimi tepsiye koymaz; ekranda gösterilir.
    await PushNotifications.addListener('pushNotificationReceived', (bildirim) => ekrandayken(bildirim))
  })()
  return dinleyiciler
}

/** Kayıtlı hesap oturumu açıkken: izin varsa (yoksa bir kez sorup) FCM'e kaydol. */
export async function kaydol() {
  await dinleyiciler
  let izin = await PushNotifications.checkPermissions()
  if (izin.receive === 'prompt' || izin.receive === 'prompt-with-rationale') {
    if (depoOku(IZIN_SORULDU_ANAHTARI)) return
    depoYaz(IZIN_SORULDU_ANAHTARI, '1')
    izin = await PushNotifications.requestPermissions()
  }
  if (izin.receive !== 'granted') return
  await PushNotifications.register()
}

/** Ayarlar ekranı için: 'acik' | 'kapali' (sistem penceresi artık çıkmaz) | 'sorulabilir'. */
export async function izinDurumu() {
  const { receive } = await PushNotifications.checkPermissions()
  if (receive === 'granted') return 'acik'
  return receive === 'denied' ? 'kapali' : 'sorulabilir'
}

/**
 * Ayarlar'daki "Bildirimleri aç": kendiliğinden sorma hakkı kullanılmış olsa da
 * izni yeniden ister; Android pencereyi artık göstermiyorsa sistem ayarını açar
 * (dönüşte ekran izni yeniden okur ve kaydol'u çağırır).
 */
export async function izinIste() {
  const durum = await izinDurumu()
  if (durum === 'kapali') {
    await BildirimAyarlari.ac()
    return durum
  }
  depoYaz(IZIN_SORULDU_ANAHTARI, '1')
  if (durum === 'sorulabilir') await PushNotifications.requestPermissions()
  await kaydol()
  return izinDurumu()
}

/** Çıkıştan ÖNCE (oturum hâlâ açıkken): token satırını sil, FCM kaydını da düşür. */
export async function birak() {
  const token = depoOku(TOKEN_ANAHTARI)
  if (token) {
    const { error } = await supabase.from('push_tokens').delete().eq('token', token)
    if (error) console.error('Push token silinemedi:', error.message)
    depoYaz(TOKEN_ANAHTARI, null)
  }
  // Satır silinemese bile FCM token'ı geçersizleşir; send-push geçersiz token'ı siler.
  try { await PushNotifications.unregister() } catch (err) { console.error('Push kaydı düşürülemedi:', err) }
}
