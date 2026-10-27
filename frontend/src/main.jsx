import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { bootstrapGlobalImageGuard } from './utils/imageGuard'
import { hataDinleyicileriniKur } from './utils/hataBildir'
import { anaSayfaAkisiniOnYukle } from './utils/anaSayfaAkisi'
import { bayatParcadaYenile } from './utils/bayatParca'
import { UYGULAMA } from './utils/platform'

hataDinleyicileriniKur()
bootstrapGlobalImageGuard()

// Yayından sonra açık kalan sekme silinmiş parçayı isterse bir kez yenile (utils/bayatParca.js).
window.addEventListener('vite:preloadError', (e) => {
  if (bayatParcadaYenile()) e.preventDefault()
})

// Ana sayfa verisi Dashboard parçası inerken istenir; Dashboard aynı sözü kullanır.
if (window.location.pathname === '/') anaSayfaAkisiniOnYukle()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (UYGULAMA) {
  import('./utils/uygulamaKurulum')
    .then((m) => m.uygulamayiKur())
    .catch((err) => console.error('Uygulama kurulumu başarısız:', err))
}
