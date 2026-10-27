import { defineConfig } from 'vite'
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
})
