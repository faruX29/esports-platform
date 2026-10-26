import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { bootstrapGlobalImageGuard } from './utils/imageGuard'
import { hataDinleyicileriniKur } from './utils/hataBildir'

hataDinleyicileriniKur()
bootstrapGlobalImageGuard()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
