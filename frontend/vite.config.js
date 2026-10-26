import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Hata kaydındaki sürüm (utils/hataBildir.js): Vercel build'inde commit'in kısa hash'i.
// loadEnv config dosyasından sonra koştuğu için process.env'deki VITE_ değişkeni istemciye geçer.
process.env.VITE_SURUM ||= (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
})
