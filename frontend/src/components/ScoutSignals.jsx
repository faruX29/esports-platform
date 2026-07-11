/**
 * ScoutSignals — "Deep Scout" premium sinyalleri (Gemini onaylı €0 strateji).
 *
 * Amaç: veri kısıtını KUSUR gibi değil, KASITLI premium konumlandırma gibi göster.
 *  - DeepScoutBadge: gerçek hibrit veri (Liquipedia v3 KDA/ACS/harita) VARSA parlat.
 *  - StatsCoverageNotice: veri YOKSA "bozuk" değil → "yalnızca Tier S/A kapsamı" +
 *    kurumsal waitlist'e (/scout) yönlendiren şık cyberpunk empty-state (upsell kaldıracı).
 */
import { Link } from 'react-router-dom'

const TEAL = '#5eead4'

/* Gerçek deep-scout verisi olan panellerin üstüne konan premium rozet. */
export function DeepScoutBadge({ label = 'Deep Scout Analitiği Aktif', source = 'Liquipedia', style }) {
  return (
    <span
      title={source ? `Gerçek maç verisi · ${source}` : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 10, fontWeight: 800, letterSpacing: '.3px',
        color: '#04201b', background: TEAL,
        borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap',
        boxShadow: `0 0 14px ${TEAL}44`,
        ...style,
      }}
    >
      <span style={{ fontSize: 11 }}>🛰️</span> {label}
    </span>
  )
}

/* Veri olmayan (lower-tier) yerlerde: kasıtlı kapsam + kurumsal upsell. */
export function StatsCoverageNotice({
  title = 'Deep Scout Analitiği',
  message = 'Gelişmiş performans istatistikleri (harita bazlı KDA, ACS, Impact) şu an yalnızca Tier S/A kapsama alanındaki maçlar için mevcut.',
  cta = 'Kurumsal kapsama & derin scout raporları',
  compact = false,
  style,
}) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${TEAL}2e`,
        background: `linear-gradient(150deg, rgba(20,184,166,.08), rgba(13,13,15,.92))`,
        padding: compact ? '12px 14px' : '16px 18px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
        <span style={{ fontSize: 17 }}>🛰️</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#d7fbf4', letterSpacing: '.3px' }}>{title}</span>
        <span style={{
          marginLeft: 'auto', fontSize: 9, fontWeight: 800, letterSpacing: '.5px',
          color: '#8bd9cd', border: `1px solid ${TEAL}44`, borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase',
        }}>
          Tier S/A
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: '#a9bdb9' }}>{message}</p>
      <Link
        to="/scout"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
          fontSize: 12, fontWeight: 700, color: TEAL, textDecoration: 'none',
        }}
      >
        {cta} <span aria-hidden>→</span>
      </Link>
    </div>
  )
}
