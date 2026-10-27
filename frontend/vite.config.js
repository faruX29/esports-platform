import { execSync } from 'node:child_process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Hata kaydındaki sürüm (utils/hataBildir.js): Vercel build'inde commit'in kısa hash'i.
// loadEnv config dosyasından sonra koştuğu için process.env'deki VITE_ değişkeni istemciye geçer.
process.env.VITE_SURUM ||= (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)

// https://vite.dev/config/
// Kütüphaneler ayrı parçada: her deploy'da yalnız uygulama kodunun hash'i değişir,
// geri dönen ziyaretçi ~430 KB'lık vendor'ı tarayıcı önbelleğinden alır. Üç dosya
// HTML'de modulepreload ile paralel iner (tek 540 KB'lık dosya yerine).
const VENDOR_PARCALARI = [
  ['react', /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/],
  ['supabase', /[\\/]node_modules[\\/](@supabase|iceberg-js)[\\/]/],
]

// Capacitor uygulaması (`npm run build:app` → mode=app). Bu değişkenler eksikse uygulama
// açılır ama giriş/takip sessizce bozulur (auth captcha sunucuda zorunlu) → build durur.
const UYGULAMA_ZORUNLU_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_TURNSTILE_SITE_KEY']

// Uygulamada index.html'den web'e özel iki parça çıkar; web'in index.html'i (ve vercel.json
// CSP hash'leri) değişmez:
//  - viewport-fit=cover: Android'de web görünümü kenardan kenara açılır, sitede safe-area
//    boşluğu olmadığından içerik durum çubuğunun altına girer. Çıkınca Capacitor görünümü
//    sistem çubuklarının arasına yerleştirir (capacitor.config.json SystemBars: native).
//  - service worker kaydı: dosyalar zaten cihazda; SW eski sürümü önbellekte tutabilir.
function uygulamaHtml() {
  return {
    name: 'fext-uygulama-html',
    transformIndexHtml(html) {
      const yeni = html
        .replace(', viewport-fit=cover', '')
        .replace(/<!-- Service Worker kaydı[\s\S]*?<\/script>/, '')
      if (yeni.includes('viewport-fit') || yeni.includes('serviceWorker')) {
        throw new Error('fext-uygulama-html: index.html değişmiş, viewport/SW ayıklaması eşleşmedi')
      }
      return yeni
    },
  }
}

export default defineConfig(({ mode }) => {
  const uygulama = mode === 'app'
  if (uygulama) {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const eksik = UYGULAMA_ZORUNLU_ENV.filter((ad) => !env[ad])
    if (eksik.length) throw new Error(`Uygulama build'i için eksik ortam değişkeni: ${eksik.join(', ')} (.env / .env.app)`)
    if (!process.env.VITE_SURUM) {
      try { process.env.VITE_SURUM = execSync('git rev-parse --short=7 HEAD').toString().trim() } catch { /* 'yerel' kalır */ }
    }
  }

  return {
    plugins: [react(), tailwindcss(), uygulama && uygulamaHtml()].filter(Boolean),
    server: { port: 5173, strictPort: true },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            for (const [ad, re] of VENDOR_PARCALARI) if (re.test(id)) return ad
          },
        },
      },
    },
  }
})
