/**
 * Dinamik Open Graph görsel endpoint'i (Vercel Edge + @vercel/og / satori).
 *
 * Sosyal paylaşımlarda (X, Discord, Reddit) linkin altında görünen 1200x630
 * cyberpunk kompozit kart: iki takım (logo + isim) VS/skor + AI tahmin vurgusu
 * + turnuva + marka. NewsCover'ın (in-app kompozit) sosyal-medya karşılığı.
 *
 * Kullanım (og:image):
 *   /api/og?a=Karmine%20Corp&b=Team%20Liquid&la=<logoUrl>&lb=<logoUrl>
 *           &s=2%20-%201&g=VALORANT&t=S&tn=VCT%20Masters&p=AI:%20%2572%20Karmine&c=C8102E
 *
 * Param: a,b (takım) · la,lb (logo url) · s (skor, yoksa VS) · g (oyun) · t (tier)
 *        · tn (turnuva) · p (tahmin vurgusu) · c (accent hex, #'siz) · tr (1=TR)
 *
 * NOT: yalnızca Vercel Edge runtime'ında çalışır; lokalde `vercel dev` gerekir.
 */
import { ImageResponse } from '@vercel/og'

export const config = { runtime: 'edge' }

const W = 1200
const H = 630

function q(params, key, fallback = '') {
  const v = params.get(key)
  return v == null || v === '' ? fallback : v
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function TeamBlock({ name, logo, accent }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 380 }}>
      {logo ? (
        <img
          src={logo}
          width={150}
          height={150}
          style={{ objectFit: 'contain', borderRadius: 24, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}
        />
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 150, height: 150, borderRadius: 24,
          background: `${accent}22`, border: `2px solid ${accent}88`,
          fontSize: 56, fontWeight: 900, color: '#ffffff',
        }}>
          {initials(name)}
        </div>
      )}
      <div style={{
        marginTop: 22, fontSize: 34, fontWeight: 800, color: '#f2f2f2',
        textAlign: 'center', maxWidth: 360, overflow: 'hidden',
      }}>
        {name}
      </div>
    </div>
  )
}

export default function handler(req) {
  const params = new URL(req.url).searchParams
  const a = q(params, 'a', 'Takım A')
  const b = q(params, 'b', 'Takım B')
  const la = q(params, 'la')
  const lb = q(params, 'lb')
  const score = q(params, 's')
  const game = q(params, 'g', 'ESPORTS')
  const tier = q(params, 't')
  const tournament = q(params, 'tn')
  const pred = q(params, 'p')
  const accent = `#${q(params, 'c', 'C8102E').replace(/[^0-9a-fA-F]/g, '') || 'C8102E'}`
  const turkish = q(params, 'tr') === '1'

  return new ImageResponse(
    (
      <div style={{
        display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
        backgroundColor: '#0b0b0d',
        backgroundImage: `radial-gradient(circle at 18% 20%, ${accent}33, transparent 42%), radial-gradient(circle at 82% 82%, ${accent}22, transparent 46%), linear-gradient(135deg, #14141a 0%, #0b0b0d 60%, #050507 100%)`,
        padding: 48,
        position: 'relative',
      }}>
        {/* Üst şerit: oyun + tier */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{
            display: 'flex', fontSize: 24, fontWeight: 800, color: '#ffffff',
            padding: '8px 18px', borderRadius: 999,
            background: `${accent}33`, border: `1px solid ${accent}88`, letterSpacing: 1,
          }}>
            {game}
          </div>
          {tier ? (
            <div style={{
              display: 'flex', fontSize: 22, fontWeight: 700, color: '#e8e8e8',
              padding: '8px 18px', borderRadius: 999,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)',
            }}>
              Tier {tier}
            </div>
          ) : <div style={{ display: 'flex' }} />}
        </div>

        {/* Orta: Takım A — VS/skor — Takım B */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flex: 1, width: '100%',
        }}>
          <TeamBlock name={a} logo={la} accent={accent} />
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', width: 200,
          }}>
            <div style={{
              display: 'flex', fontSize: score ? 76 : 60, fontWeight: 900, color: '#ffffff',
            }}>
              {score || 'VS'}
            </div>
          </div>
          <TeamBlock name={b} logo={lb} accent={accent} />
        </div>

        {/* AI tahmin vurgusu (varsa) */}
        {pred ? (
          <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginBottom: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', fontSize: 26, fontWeight: 800,
              color: '#ddfffb', padding: '10px 22px', borderRadius: 999,
              background: 'rgba(20,184,166,0.16)', border: '1px solid rgba(94,234,212,0.4)',
            }}>
              🎯 {pred}
            </div>
          </div>
        ) : null}

        {/* Alt şerit: turnuva + marka */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', fontSize: 22, color: '#b8b8b8', fontWeight: 600, maxWidth: 780, overflow: 'hidden' }}>
            {turkish ? '🇹🇷 ' : ''}{tournament || ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, fontWeight: 900, color: accent }}>
            ⚡ EsportsHub Pro
          </div>
        </div>
      </div>
    ),
    { width: W, height: H },
  )
}
