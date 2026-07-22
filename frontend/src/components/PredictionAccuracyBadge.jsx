import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import FextopusIcon from './FextopusIcon'

/**
 * AI tahmin doğruluğu "trust signal" rozeti.
 *
 * get_prediction_accuracy RPC'sini çağırır (50/50'ler hariç, dürüst metrik).
 * Öne çıkan rakam: GÜVENLİ tahminlerde doğruluk (fav olasılığı ≥%65 → ~%72).
 * Veri yoksa / RPC eksikse hiçbir şey render etmez (graceful).
 *
 * variant: 'card' (varsayılan, dashboard) | 'inline' (maç detayında AI bar yanı)
 */

// Modül-seviyesi cache: sayfalar arası tek fetch (accuracy günde bir değişir)
let _cache = null
let _inflight = null

async function fetchAccuracy() {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = (async () => {
    const { data, error } = await supabase.rpc('get_prediction_accuracy', { days_back: 0 })
    if (error) throw error
    _cache = data
    return data
  })()
  try {
    return await _inflight
  } finally {
    _inflight = null
  }
}

export default function PredictionAccuracyBadge({ variant = 'card' }) {
  const [stats, setStats] = useState(_cache)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    if (_cache) { setStats(_cache); return }
    fetchAccuracy()
      .then(data => { if (alive) setStats(data) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  // Güvenli-tahmin örneklemi anlamlı değilse gösterme
  if (failed || !stats || !stats.confident_total || stats.confident_pct == null) return null

  const confPct = Math.round(stats.confident_pct)
  const overall = Math.round(stats.accuracy_pct ?? 0)
  const sample = (stats.confident_total || 0).toLocaleString('tr-TR')

  if (variant === 'inline') {
    return (
      <div
        title={`Genel isabet %${overall} · ${(stats.total || 0).toLocaleString('tr-TR')} maçta ölçüldü`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontWeight: 700, color: 'var(--ai)',
          padding: '4px 9px', borderRadius: 999,
          background: 'rgba(194,92,208,.12)', border: '1px solid rgba(194,92,208,.28)',
        }}
      >
        <FextopusIcon size={15} />
        Fextopus'un en güvendiği maçlarda %{confPct} net isabet
      </div>
    )
  }

  return (
    <div style={{
      border: '1px solid rgba(194,92,208,.22)',
      background: 'linear-gradient(130deg, rgba(194,92,208,.12), rgba(16,16,16,.92))',
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <FextopusIcon size={44} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 32, fontWeight: 900, color: '#ddfffb', lineHeight: 1 }}>%{confPct}</span>
        <span style={{ fontSize: 10, color: 'var(--ai)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.8px', marginTop: 4 }}>
          Net isabet
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13, color: '#ddfffb', fontWeight: 800, marginBottom: 4 }}>
          Fextopus'un En Güvendiği Maçlarda %{confPct} Net İsabet
        </div>
        <div style={{ fontSize: 12, color: '#c6c6c6', lineHeight: 1.5 }}>
          Elo tabanlı Fextopus, yüksek güvenli tahminlerinde ({sample} maçta ölçüldü) bu isabeti tutturuyor.
          Genel isabet %{overall}. <span style={{ color: '#8f8f8f' }}>Her maçı değil — en emin olduklarını.</span>
        </div>
      </div>
    </div>
  )
}
