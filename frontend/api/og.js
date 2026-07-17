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
 * NOT: JSX yerine React.createElement — Vercel'in Vite (non-Next) zero-config
 * fonksiyon algılaması .jsx transpilasyonuna güvenmesin diye.
 */
import { ImageResponse } from '@vercel/og'
import { createElement as h } from 'react'

export const config = { runtime: 'edge' }

const W = 1200
const H = 630

function q(params, key, fallback = '') {
  const v = params.get(key)
  return v == null || v === '' ? fallback : v
}

// SSRF koruması: la/lb logo URL'leri server-side (satori) fetch edilir. Yalnızca
// bilinen CDN host'larına + https'e izin ver; iç IP / metadata servisi / http engelli.
const ALLOWED_LOGO_HOSTS = /(^|\.)(pandascore\.co|liquipedia\.net|supabase\.co)$/i
function safeLogo(u) {
  if (!u) return ''
  try {
    const x = new URL(u)
    return x.protocol === 'https:' && ALLOWED_LOGO_HOSTS.test(x.hostname) ? u : ''
  } catch {
    return ''
  }
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

function teamBlock(name, logo, accent) {
  const logoEl = logo
    ? h('img', {
        src: logo,
        width: 150,
        height: 150,
        style: {
          objectFit: 'contain',
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(255,255,255,0.04)',
        },
      })
    : h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 150,
            height: 150,
            borderRadius: 24,
            background: `${accent}22`,
            border: `2px solid ${accent}88`,
            fontSize: 56,
            fontWeight: 900,
            color: '#ffffff',
          },
        },
        initials(name),
      )
  const nameEl = h(
    'div',
    { style: { marginTop: 22, fontSize: 34, fontWeight: 800, color: '#f2f2f2', textAlign: 'center', maxWidth: 360 } },
    name,
  )
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 380 } },
    logoEl,
    nameEl,
  )
}

export default function handler(req) {
  const params = new URL(req.url).searchParams
  const a = q(params, 'a', 'Takım A')
  const b = q(params, 'b', 'Takım B')
  const la = safeLogo(q(params, 'la'))
  const lb = safeLogo(q(params, 'lb'))
  const score = q(params, 's')
  const game = q(params, 'g', 'ESPORTS')
  const tier = q(params, 't')
  const tournament = q(params, 'tn')
  const pred = q(params, 'p')
  const accent = `#${(q(params, 'c', 'C8102E').replace(/[^0-9a-fA-F]/g, '') || 'C8102E')}`
  const turkish = q(params, 'tr') === '1'

  const topBar = h(
    'div',
    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } },
    h(
      'div',
      {
        style: {
          display: 'flex', fontSize: 24, fontWeight: 800, color: '#ffffff',
          padding: '8px 18px', borderRadius: 999,
          background: `${accent}33`, border: `1px solid ${accent}88`, letterSpacing: 1,
        },
      },
      game,
    ),
    tier
      ? h(
          'div',
          {
            style: {
              display: 'flex', fontSize: 22, fontWeight: 700, color: '#e8e8e8',
              padding: '8px 18px', borderRadius: 999,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)',
            },
          },
          `Tier ${tier}`,
        )
      : h('div', { style: { display: 'flex' } }),
  )

  const center = h(
    'div',
    { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, width: '100%' } },
    teamBlock(a, la, accent),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 200 } },
      h('div', { style: { display: 'flex', fontSize: score ? 76 : 60, fontWeight: 900, color: '#ffffff' } }, score || 'VS'),
    ),
    teamBlock(b, lb, accent),
  )

  const predEl = pred
    ? h(
        'div',
        { style: { display: 'flex', justifyContent: 'center', width: '100%', marginBottom: 8 } },
        h(
          'div',
          {
            style: {
              display: 'flex', alignItems: 'center', fontSize: 26, fontWeight: 800,
              color: '#ddfffb', padding: '10px 22px', borderRadius: 999,
              background: 'rgba(20,184,166,0.16)', border: '1px solid rgba(94,234,212,0.4)',
            },
          },
          `🎯 ${pred}`,
        ),
      )
    : null

  const bottom = h(
    'div',
    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' } },
    h('div', { style: { display: 'flex', fontSize: 22, color: '#b8b8b8', fontWeight: 600, maxWidth: 780 } }, `${turkish ? '🇹🇷 ' : ''}${tournament || ''}`),
    h('div', { style: { display: 'flex', alignItems: 'center', fontSize: 26, fontWeight: 900, color: accent } }, 'feXt'),
  )

  const root = h(
    'div',
    {
      style: {
        display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
        backgroundColor: '#0b0b0d',
        backgroundImage: `radial-gradient(circle at 18% 20%, ${accent}33, transparent 42%), radial-gradient(circle at 82% 82%, ${accent}22, transparent 46%), linear-gradient(135deg, #14141a 0%, #0b0b0d 60%, #050507 100%)`,
        padding: 48,
      },
    },
    topBar,
    center,
    predEl,
    bottom,
  )

  return new ImageResponse(root, { width: W, height: H })
}
