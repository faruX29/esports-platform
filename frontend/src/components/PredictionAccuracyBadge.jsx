import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import FextopusIcon from './FextopusIcon'
import { yazi } from '../theme'

/**
 * AI tahmin doğruluğu "trust signal" rozeti.
 *
 * get_prediction_accuracy RPC'sini çağırır (50/50'ler hariç, dürüst metrik).
 * Öne çıkan rakam: "en güvendiği maçlar" = favori olasılığı ≥%70; /stats'taki
 * "Çok emin" katmanıyla aynı tanım (RPC ile görünüm aynı filtreyi kullanır).
 * Veri yoksa / RPC eksikse hiçbir şey render etmez (graceful).
 *
 * variant: 'card' (varsayılan, dashboard) | 'inline' (maç detayında AI bar yanı)
 */

// Modül-seviyesi cache: sayfalar arası tek fetch (accuracy günde bir değişir).
// RPC tüm biten maçları tarar (~40 bin satır); tekrar gelen ziyaretçi için 6 saat
// tarayıcıda da saklanır, ana sayfa açılışında veritabanına gitmez.
// v2: eşik %65 → %70 (4 Kasım); eski kayıt eski tanımı taşır.
const SAKLAMA_ANAHTARI = 'fext_isabet_v2'
const SAKLAMA_OMRU_MS = 6 * 60 * 60 * 1000

function saklananiOku() {
  try {
    const kayit = JSON.parse(localStorage.getItem(SAKLAMA_ANAHTARI) || 'null')
    return kayit && Date.now() - kayit.zaman < SAKLAMA_OMRU_MS ? kayit.veri : null
  } catch {
    return null
  }
}

let _cache = saklananiOku()
let _inflight = null

async function fetchAccuracy() {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = (async () => {
    const { data, error } = await supabase.rpc('get_prediction_accuracy', { days_back: 0 })
    if (error) throw error
    _cache = data
    try { localStorage.setItem(SAKLAMA_ANAHTARI, JSON.stringify({ zaman: Date.now(), veri: data })) } catch { /* gizli sekme */ }
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
      <Link
        to="/stats"
        title={`%70 ve üzeri şans verdiği ${sample} maçta ölçüldü · Genel isabet %${overall}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: yazi(11), fontWeight: 700, color: 'var(--ai)', textDecoration: 'none',
          padding: '4px 9px', borderRadius: 999,
          background: 'rgba(194,92,208,.12)', border: '1px solid rgba(194,92,208,.28)',
        }}
      >
        <FextopusIcon size={15} />
        Fextopus'un en güvendiği maçlarda %{confPct} net isabet
      </Link>
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
        <span style={{ fontSize: yazi(10), color: 'var(--ai)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.8px', marginTop: 4 }}>
          Net isabet
        </span>
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13, color: '#ddfffb', fontWeight: 800, marginBottom: 4 }}>
          Fextopus'un En Güvendiği Maçlarda %{confPct} Net İsabet
        </div>
        <div style={{ fontSize: 12, color: '#c6c6c6', lineHeight: 1.5 }}>
          Elo tabanlı Fextopus, bir takıma %70 ve üzeri şans verdiği {sample} maçta bu isabeti tutturdu.
          Genel isabet %{overall}. <span style={{ color: '#8f8f8f' }}>Her maçı değil — en emin olduklarını.</span>
        </div>
        {/* Rakamin arkasindaki tam dagilim: iddiayi dogrulanabilir kilar */}
        <Link to="/stats" style={{ display: 'inline-block', marginTop: 8, fontSize: yazi(11.5),
          fontWeight: 700, color: 'var(--accent-fg)', textDecoration: 'none' }}>
          Tüm güven katmanlarını gör →
        </Link>
      </div>
    </div>
  )
}
