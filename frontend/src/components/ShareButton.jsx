import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'

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

  const buildUrl = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}${path || ''}`
  }

  const stop = e => { e.preventDefault(); e.stopPropagation() }

  async function copyLink(e) {
    stop(e)
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

  const pad = compact ? '5px 8px' : '6px 10px'
  const fs = compact ? 11 : 12

  return (
    <div style={{ display: 'inline-flex', gap: 6 }}>
      <button
        type="button"
        onClick={shareX}
        title="X'te paylaş"
        style={{
          border: '1px solid #26324a', background: '#131b2b', color: '#cbd5e1',
          borderRadius: 8, padding: pad, fontSize: fs, fontWeight: 700, cursor: 'pointer',
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
          border: `1px solid ${copied ? '#2f6846' : '#26324a'}`,
          background: copied ? '#10281a' : '#131b2b',
          color: copied ? '#8de3af' : '#cbd5e1',
          borderRadius: 8, padding: pad, fontSize: fs, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}
      >
        {copied ? <><Check size={13} /> Kopyalandı</> : <><Link2 size={13} /> Link</>}
      </button>
    </div>
  )
}
