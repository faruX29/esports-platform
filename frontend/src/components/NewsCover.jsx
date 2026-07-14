import InitialsImage from './InitialsImage'
import { ArrowRight, Trophy } from 'lucide-react'

/** heroScore string'inden ("Team A 13 - 8 Team B") salt skoru ("13 - 8") çıkarır. */
export function scoreFromHero(heroScore) {
  const m = String(heroScore || '').match(/(\d+)\s*[-:]\s*(\d+)/)
  return m ? `${m[1]} - ${m[2]}` : ''
}

/**
 * NewsCover — haber kapak kompoziti (CSS/DOM, $0 maliyet, anlık).
 *
 * Gemini stratejik kararı: AI görsel üretimi yerine mühendislik akıllılığı.
 * Koyu/cyberpunk gradient şablon + iki takım logosu "VS" formatında +
 * skor/turnuva/oyun overlay. Hem in-app kart/hero görseli hem tutarlı,
 * kurumsal kapak sağlar.
 *
 * Props:
 *   visuals  — { gameColor, gameLabel, tournamentName, tier, turkish,
 *                teamA:{name,logo_url}, teamB:{name,logo_url} }
 *   score    — opsiyonel skor metni (örn. "13 - 8"); yoksa "VS"
 *   height   — kapak yüksekliği (px); compact kartlarda küçük
 *   compact  — küçük varyant
 */
export default function NewsCover({ visuals, score = '', height = 180, compact = false }) {
  const v = visuals || {}
  const accent = v.gameColor || '#C8102E'
  const logoSize = compact ? 52 : 76
  const teamA = v.teamA || {}
  const teamB = v.teamB || {}

  return (
    <div
      style={{
        position: 'relative',
        height,
        borderRadius: compact ? 12 : 14,
        overflow: 'hidden',
        background: `
          radial-gradient(circle at 18% 20%, ${accent}33, transparent 42%),
          radial-gradient(circle at 82% 78%, ${accent}22, transparent 46%),
          linear-gradient(135deg, #14141a 0%, #0b0b0d 55%, #050507 100%)
        `,
        border: `1px solid ${v.turkish ? 'rgba(200,16,46,.42)' : '#1f1f24'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Diagonal cyberpunk şerit */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `repeating-linear-gradient(115deg, transparent, transparent 22px, ${accent}0a 22px, ${accent}0a 24px)`,
      }} />
      {/* Orta ayraç parıltısı */}
      <div style={{
        position: 'absolute', top: '12%', bottom: '12%', left: '50%', width: 1.5,
        transform: 'translateX(-50%) skewX(-12deg)',
        background: `linear-gradient(180deg, transparent, ${accent}cc, transparent)`,
        boxShadow: `0 0 14px ${accent}aa`,
      }} />

      {/* Üst şerit: oyun + tier */}
      <div style={{
        position: 'absolute', top: 10, left: 12, right: 12, zIndex: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <span style={{
          fontSize: compact ? 9 : 10, fontWeight: 800, letterSpacing: '.6px',
          textTransform: 'uppercase', color: '#fff',
          padding: '3px 8px', borderRadius: 999,
          background: `${accent}33`, border: `1px solid ${accent}66`,
        }}>
          {v.gameLabel || 'ESPORTS'}
        </span>
        {v.tier && (
          <span style={{
            fontSize: compact ? 9 : 10, fontWeight: 700, color: '#e2e8f0',
            padding: '3px 8px', borderRadius: 999,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)',
          }}>
            Tier {v.tier}
          </span>
        )}
      </div>

      {/* Takımlar + skor/VS */}
      <div style={{
        position: 'relative', zIndex: 2,
        display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
        gap: compact ? 12 : 22, width: '100%', padding: '0 16px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <InitialsImage
            src={teamA.logo_url} alt={teamA.name || ''} name={teamA.name}
            width={logoSize} height={logoSize} borderRadius={14} objectFit="contain"
            style={{ background: 'rgba(255,255,255,.04)', padding: 6, border: '1px solid rgba(255,255,255,.1)' }}
          />
          {!compact && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', maxWidth: 120, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {teamA.name}
            </span>
          )}
        </div>

        <div style={{
          fontSize: compact ? 16 : 22, fontWeight: 900, color: '#fff',
          letterSpacing: score ? '1px' : '2px',
          textShadow: `0 0 18px ${accent}aa`, fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {score === '➜' ? <ArrowRight size={compact ? 22 : 30} /> : score === '🏆' ? <Trophy size={compact ? 20 : 28} /> : (score || 'VS')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <InitialsImage
            src={teamB.logo_url} alt={teamB.name || ''} name={teamB.name}
            width={logoSize} height={logoSize} borderRadius={14} objectFit="contain"
            style={{ background: 'rgba(255,255,255,.04)', padding: 6, border: '1px solid rgba(255,255,255,.1)' }}
          />
          {!compact && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', maxWidth: 120, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {teamB.name}
            </span>
          )}
        </div>
      </div>

      {/* Alt şerit: turnuva adı */}
      {v.tournamentName && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2,
          padding: compact ? '5px 12px' : '7px 14px',
          background: 'linear-gradient(0deg, rgba(0,0,0,.7), transparent)',
          fontSize: compact ? 9 : 10, color: '#cbd5e1', fontWeight: 600,
          textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {v.tournamentName}
        </div>
      )}

      {/* Turkish Pride köşe rozeti */}
      {v.turkish && (
        <div style={{
          position: 'absolute', top: compact ? 36 : 40, right: 0, zIndex: 2,
          background: 'linear-gradient(90deg,#C8102E,#a00d25)',
          color: '#fff', fontSize: 8, fontWeight: 800, letterSpacing: '.8px',
          padding: '3px 8px', borderRadius: '6px 0 0 6px', textTransform: 'uppercase',
        }}>
          🇹🇷 TR
        </div>
      )}
    </div>
  )
}
