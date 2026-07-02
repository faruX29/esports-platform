import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

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
        title={`Genel doğruluk %${overall} · ${(stats.total || 0).toLocaleString('tr-TR')} maçta test edildi`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontWeight: 700, color: '#93f5ea',
          padding: '4px 9px', borderRadius: 999,
          background: 'rgba(20,184,166,.12)', border: '1px solid rgba(94,234,212,.28)',
        }}
      >
        🎯 Güvenli tahminlerde %{confPct} isabet
      </div>
    )
  }

  return (
    <div style={{
      border: '1px solid rgba(94,234,212,.22)',
      background: 'linear-gradient(130deg, rgba(20,184,166,.12), rgba(16,16,16,.92))',
      borderRadius: 14,
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 32, fontWeight: 900, color: '#ddfffb', lineHeight: 1 }}>%{confPct}</span>
        <span style={{ fontSize: 10, color: '#93f5ea', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.8px', marginTop: 4 }}>
          Güvenli tahmin isabeti
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 12, color: '#9dd8d0', fontWeight: 700, marginBottom: 4 }}>
          🎯 AI Tahmin Motoru — Elo tabanlı
        </div>
        <div style={{ fontSize: 12, color: '#c6c6c6', lineHeight: 1.5 }}>
          Model favorisini güvenle seçtiğinde ({sample} maçta test edildi) <b style={{ color: '#ddfffb' }}>10 maçtan ~{Math.round(confPct / 10)}'ini</b> doğru biliyor.
          Genel isabet %{overall}.
        </div>
      </div>
    </div>
  )
}
