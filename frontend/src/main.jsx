import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { bootstrapGlobalImageGuard } from './utils/imageGuard'
import { hataDinleyicileriniKur } from './utils/hataBildir'
import { anaSayfaAkisiniOnYukle } from './utils/anaSayfaAkisi'

hataDinleyicileriniKur()
bootstrapGlobalImageGuard()

// Ana sayfa verisi Dashboard parçası inerken istenir; Dashboard aynı sözü kullanır.
if (window.location.pathname === '/') anaSayfaAkisiniOnYukle()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
