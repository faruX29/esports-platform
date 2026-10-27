/**
 * Uygulamada Google girişi (web'de yüklenmez; AuthContext ve UygulamaKopru dinamik import eder).
 *
 * Google, giriş sayfasının web görünümünde açılmasını reddeder → sistem tarayıcısı
 * (Custom Tab) açılır, Supabase dönüşte `com.fextesports.app://giris?code=...`
 * linkine yönlendirir (AndroidManifest intent-filter; Supabase → Auth → Redirect URLs'te
 * izinli olmalı, yoksa Supabase siteye döner ve uygulamada oturum açılmaz).
 *
 * Neden ayrı PKCE istemcisi: özel şemayı başka bir uygulama da kaydedebilir. Düz
 * (implicit) akışta dönüş linki oturum anahtarlarını taşır; PKCE'de yalnız kod taşır
 * ve kod, cihazdaki doğrulayıcı olmadan işe yaramaz. Ana istemci implicit kalır
 * (PKCE'ye geçse uygulamadan istenen şifre sıfırlama linki tarayıcıda açılamazdı);
 * kod burada takas edilir, oturum ana istemciye verilir.
 */
import { createClient } from '@supabase/supabase-js'
import { Browser } from '@capacitor/browser'
import { supabase } from '../supabaseClient'

export const GIRIS_DONUS = 'com.fextesports.app://giris'
const DEPO_ANAHTARI = 'fext-uygulama-giris'

let istemci = null
function girisIstemcisi() {
  istemci ||= createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      storageKey: DEPO_ANAHTARI,
      // Doğrulayıcı localStorage'da kalır: tarayıcıdayken uygulama süreci
      // kapanırsa da dönüşte takas edilebilir.
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return istemci
}

function depoyuTemizle() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(DEPO_ANAHTARI))
      .forEach((k) => localStorage.removeItem(k))
  } catch { /* depo kapalı */ }
}

export async function googleIleGir() {
  const { data, error } = await girisIstemcisi().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: GIRIS_DONUS, skipBrowserRedirect: true },
  })
  if (error) throw error
  await Browser.open({ url: data.url })
}

/** Dönüş linki mi? */
export function girisDonusuMu(url) {
  return typeof url === 'string' && url.startsWith(GIRIS_DONUS)
}

/**
 * Dönüş linkindeki kodu oturuma çevirir. Başarılıysa true.
 * Hata (kullanıcı vazgeçti, kod süresi doldu) Error olarak fırlar.
 */
export async function girisDonusunuIsle(url) {
  Browser.close().catch(() => { /* Android'de singleTask zaten kapatır */ })
  const u = new URL(url)
  const hata = u.searchParams.get('error_description') || u.searchParams.get('error')
  if (hata) throw new Error(hata)
  const kod = u.searchParams.get('code')
  if (!kod) throw new Error('Giriş dönüşünde kod yok')

  const { data, error } = await girisIstemcisi().auth.exchangeCodeForSession(kod)
  if (error) throw error
  const { access_token, refresh_token } = data.session
  // Geçici istemcinin kopyası silinir; signOut ÇAĞRILMAZ (sunucuda bu oturumu,
  // yani ana istemciye verdiğimiz yenileme anahtarını da iptal ederdi).
  depoyuTemizle()
  const { error: oturumHatasi } = await supabase.auth.setSession({ access_token, refresh_token })
  if (oturumHatasi) throw oturumHatasi
  return true
}
