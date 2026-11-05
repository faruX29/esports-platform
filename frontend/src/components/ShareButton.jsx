import { useState } from 'react'
import { Check, Link2, MessageCircle, Share2 } from 'lucide-react'
import { UYGULAMA, disariKok } from '../utils/platform'
import { yazi } from '../theme'

/**
 * Paylaşım butonu — WhatsApp + linki kopyala; telefonda tek "Paylaş" (sistem paylaşım
 * sayfası: WhatsApp, Instagram, kopyala hepsi orada). X kaldırıldı (Faz 5'te sosyal
 * hesaptan da çıktı); Türk kitlesi link paylaşımını çoğunlukla WhatsApp'tan yapıyor.
 *
 * Props:
 *   path     — paylaşılacak göreli yol (örn. "/news/match_123")
 *   title    — paylaşım metni
 *   compact  — küçük varyant (kartlar için)
 */

// Masaüstü Chrome/Edge'de de navigator.share var (Windows paylaşım penceresi) ama orada
// WhatsApp + kopyala daha tanıdık → sistem sayfası yalnız dokunmatik cihazda.
function dokunmatikPaylasim() {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
}

export default function ShareButton({ path, title = '', compact = false }) {
  const [copied, setCopied] = useState(false)

  // Uygulamada window.location.origin dışarıda olmayan app.fextesports.com'dur (utils/platform.js).
  const buildUrl = () => `${disariKok()}${path || ''}`

  const stop = e => { e.preventDefault(); e.stopPropagation() }

  async function sistemPaylas(e) {
    stop(e)
    // Uygulamada Capacitor paylaşım sayfası; Android web görünümünde navigator.share yok.
    if (UYGULAMA) {
      try {
        const { Share } = await import('@capacitor/share')
        await Share.share({ title, url: buildUrl() })
      } catch { /* iptal */ }
      return
    }
    try { await navigator.share({ title, url: buildUrl() }) } catch { /* iptal */ }
  }

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

  function whatsapp(e) {
    stop(e)
    const metin = title ? `${title} ${buildUrl()}` : buildUrl()
    window.open(`https://wa.me/?text=${encodeURIComponent(metin)}`, '_blank', 'noopener,noreferrer')
  }

  const pad = compact ? '5px 8px' : '9px 12px'
  const fs = compact ? 11 : 12
  const minH = compact ? undefined : 38
  const stil = {
    border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)',
    borderRadius: 8, padding: pad, minHeight: minH, fontSize: yazi(fs), fontWeight: 700, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 5,
  }

  if (UYGULAMA || dokunmatikPaylasim()) {
    return (
      <button type="button" onClick={sistemPaylas} title="Paylaş" style={stil}>
        <Share2 size={13} /> Paylaş
      </button>
    )
  }

  return (
    <div style={{ display: 'inline-flex', gap: 8 }}>
      <button type="button" onClick={whatsapp} title="WhatsApp'ta paylaş" style={stil}>
        <MessageCircle size={13} /> WhatsApp
      </button>
      <button
        type="button"
        onClick={copyLink}
        title="Linki kopyala"
        style={{
          ...stil,
          border: `1px solid ${copied ? 'var(--success-fg)' : 'var(--line)'}`,
          background: copied ? 'rgba(74,222,128,.12)' : 'var(--surface)',
          color: copied ? 'var(--success-fg)' : 'var(--text-2)',
        }}
      >
        {copied ? <><Check size={13} /> Kopyalandı</> : <><Link2 size={13} /> Linki kopyala</>}
      </button>
    </div>
  )
}
