/**
 * Capacitor uygulamasına özel açılış işleri (main.jsx; web'de hiç yüklenmez,
 * eklentiler dinamik import ile ayrı parçada kalır).
 *  - Android geri tuşu: sayfa geçmişinde geri, geçmiş yoksa uygulamadan çık.
 *  - Splash: React ilk kareyi çizince kapanır (config'teki 3 sn yalnız üst sınır).
 */
export async function uygulamayiKur() {
  const [{ App }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/splash-screen'),
  ])

  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else App.exitApp()
  })

  requestAnimationFrame(() => {
    SplashScreen.hide().catch(() => { /* config süresi dolunca zaten kapanır */ })
  })
}
