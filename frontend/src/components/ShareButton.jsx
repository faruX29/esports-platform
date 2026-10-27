import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { UYGULAMA, disariKok } from '../utils/platform'

/**
 * Paylaşım butonu — X (Twitter) + kopyala-link.
 * B2C viral büyüme için haber kart/detay sayfalarında kullanılır.
 *
 * Props:
 *   path     — paylaşılacak göreli yol (örn. "/news/match_123")
 *   title    — paylaşım metni (X intent + native share)
 *   compact  — küçük varyant (kartlar için)
 */
export default function ShareButton({ path, title = '', compact = false }) {
  const [copied, setCopied] = useState(false)

  // Uygulamada window.location.origin dışarıda olmayan app.fextesports.com'dur (utils/platform.js).
  const buildUrl = () => `${disariKok()}${path || ''}`

  const stop = e => { e.preventDefault(); e.stopPropagation() }

  async function copyLink(e) {
    stop(e)
    // Uygulamada sistemin paylaşım sayfası (kopyala da orada); Android web görünümünde navigator.share yok.
    if (UYGULAMA) {
      try {
        const { Share } = await import('@capacitor/share')
        await Share.share({ title, url: buildUrl() })
      } catch { /* iptal */ }
      return
    }
    try {
      await navigator.clipboard.writeText(buildUrl())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Pano erişimi yoksa native paylaşıma düş
      if (navigator.share) {
        try { await navigator.share({ title, url: buildUrl() }) } catch { /* iptal */ }
      }
    }
  }

  function shareX(e) {
    stop(e)
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(buildUrl())}`
    window.open(intent, '_blank', 'noopener,noreferrer')
  }

  const pad = compact ? '5px 8px' : '9px 12px'
  const fs = compact ? 11 : 12
  const minH = compact ? undefined : 38

  return (
    <div style={{ display: 'inline-flex', gap: 8 }}>
      <button
        type="button"
        onClick={shareX}
        title="X'te paylaş"
        style={{
          border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)',
          borderRadius: 8, padding: pad, minHeight: minH, fontSize: fs, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}
      >
        𝕏 Paylaş
      </button>
      <button
        type="button"
        onClick={copyLink}
        title="Bağlantıyı kopyala"
        style={{
          border: `1px solid ${copied ? 'var(--success-fg)' : 'var(--line)'}`,
          background: copied ? 'rgba(74,222,128,.12)' : 'var(--surface)',
          color: copied ? 'var(--success-fg)' : 'var(--text-2)',
          borderRadius: 8, padding: pad, minHeight: minH, fontSize: fs, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}
      >
        {copied ? <><Check size={13} /> Kopyalandı</> : <><Link2 size={13} /> Link</>}
      </button>
    </div>
  )
}
