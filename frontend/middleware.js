/**
 * Vercel Edge Middleware — sosyal crawler'lar için OG meta enjeksiyonu.
 *
 * Sorun: SPA meta etiketlerini JS ile set eder; crawler'lar (X, Discord, Reddit,
 * WhatsApp...) JS çalıştırmaz → paylaşımda kart çıkmaz.
 *
 * Çözüm: bot user-agent'ları algıla → /news/* ve /match/* için Supabase'den veri
 * çek → OG meta + og:image=/api/og?... içeren minimal HTML döndür. Gerçek
 * kullanıcı → next() (normal SPA). Her hata → next() (asla sayfayı bozma).
 */
import { next } from '@vercel/edge'

export const config = {
  matcher: ['/news/:path*', '/match/:path*'],
}

// Geniş kapsam: isimli crawler'lar + jenerik önizleme/araç token'ları. Gerçek
// tarayıcı UA'ları (Mozilla/Chrome/Safari/Edg) bu token'ları içermez → etkilenmez.
const BOT_RE = /(bot|crawler|spider|slurp|preview|unfurl|embed|opengraph|open graph|metadata|validator|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|reddit|linkedin|pinterest|applebot|skype|vkshare|iframely|curl|wget|python-requests|axios|go-http|okhttp|headless)/i

const GAME_META = {
  valorant: { label: 'VALORANT', accent: 'FF4655' },
  csgo: { label: 'CS2', accent: 'F5A623' },
  'cs-go': { label: 'CS2', accent: 'F5A623' },
  cs2: { label: 'CS2', accent: 'F5A623' },
  lol: { label: 'LoL', accent: '1E90FF' },
  'league-of-legends': { label: 'LoL', accent: '1E90FF' },
}

function gameMeta(slug) {
  return GAME_META[String(slug || '').toLowerCase()] || { label: 'ESPORTS', accent: 'C8102E' }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function scoreFromHero(hero) {
  const m = String(hero || '').match(/(\d+)\s*[-:]\s*(\d+)/)
  return m ? `${m[1]} - ${m[2]}` : ''
}

function parseNewsRef(slug) {
  const s = String(slug || '')
  const tr = s.match(/transfer_([0-9a-fA-F-]{36})/)
  if (tr) return { type: 'transfer', id: tr[1] }
  const m = s.match(/(\d{3,})(?!.*\d)/) // slug sonundaki sayı = match_id
  if (m) return { type: 'match', id: m[1] }
  return null
}

async function sbFetch(path) {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) return null
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) return null
  const rows = await res.json()
  return Array.isArray(rows) ? rows[0] || null : rows
}

function ogImageUrl(origin, p) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== '') qs.set(k, String(v))
  }
  return `${origin}/api/og?${qs.toString()}`
}

function predHook(pa, pb, aName, bName) {
  if (pa == null || pb == null) return ''
  const fa = Number(pa), fb = Number(pb)
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa === fb) return ''
  const favProb = Math.max(fa, fb)
  if (favProb < 0.6) return ''
  const fav = fa >= fb ? aName : bName
  return `AI: %${Math.round(favProb * 100)} ${fav}`
}

function htmlDoc({ title, desc, url, img, type = 'article' }) {
  const t = esc(title), d = esc(desc), u = esc(url), i = esc(img)
  return `<!DOCTYPE html><html lang="tr"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${t}</title>
<meta name="description" content="${d}"/>
<meta property="og:type" content="${type}"/>
<meta property="og:site_name" content="EsportsHub Pro"/>
<meta property="og:title" content="${t}"/>
<meta property="og:description" content="${d}"/>
<meta property="og:url" content="${u}"/>
<meta property="og:image" content="${i}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${t}"/>
<meta name="twitter:description" content="${d}"/>
<meta name="twitter:image" content="${i}"/>
</head><body><a href="${u}">${t}</a></body></html>`
}

async function buildForMatch(id, origin, url) {
  const sel =
    'team_a_score,team_b_score,prediction_team_a,prediction_team_b,' +
    'team_a:teams!matches_team_a_id_fkey(name,logo_url),' +
    'team_b:teams!matches_team_b_id_fkey(name,logo_url),' +
    'tournament:tournaments(name,tier),game:games(slug)'
  const row = await sbFetch(`matches?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(sel)}&limit=1`)
  if (!row) return null
  const a = row.team_a?.name || 'Takım A'
  const b = row.team_b?.name || 'Takım B'
  const gm = gameMeta(row.game?.slug)
  const score = (row.team_a_score != null && row.team_b_score != null) ? `${row.team_a_score} - ${row.team_b_score}` : ''
  const p = predHook(row.prediction_team_a, row.prediction_team_b, a, b)
  const img = ogImageUrl(origin, {
    a, b, la: row.team_a?.logo_url, lb: row.team_b?.logo_url,
    s: score, g: gm.label, t: row.tournament?.tier, tn: row.tournament?.name, p, c: gm.accent,
  })
  const title = `${a} vs ${b}${row.tournament?.name ? ' · ' + row.tournament.name : ''}`
  const desc = p ? `${p} · EsportsHub Pro AI analizi ve canlı skor.` : 'EsportsHub Pro — AI analizi, canlı skor ve istatistikler.'
  return htmlDoc({ title, desc, url, img })
}

async function buildForNews(ref, origin, url) {
  const sel = 'title,summary,hero_score,game_slug,tier,tournament_name,team_a_name,team_b_name,team_a_logo,team_b_logo'
  const query = ref.type === 'transfer'
    ? `news_articles?id=eq.${encodeURIComponent(ref.id)}&select=${encodeURIComponent(sel)}&limit=1`
    : `news_articles?match_id=eq.${encodeURIComponent(ref.id)}&variant=neq.preview&select=${encodeURIComponent(sel)}&order=created_at.desc&limit=1`
  const row = await sbFetch(query)
  if (!row) return null
  const gm = gameMeta(row.game_slug)
  const img = ogImageUrl(origin, {
    a: row.team_a_name, b: row.team_b_name, la: row.team_a_logo, lb: row.team_b_logo,
    s: scoreFromHero(row.hero_score), g: gm.label, t: row.tier, tn: row.tournament_name, c: gm.accent,
  })
  return htmlDoc({ title: row.title || 'EsportsHub Pro', desc: row.summary || '', url, img })
}

export default async function middleware(req) {
  const ua = req.headers.get('user-agent') || ''
  const url = new URL(req.url)
  // ?__og=1 → tarayıcıda elle doğrulama için OG HTML'i zorla (bot olmasan da)
  const force = url.searchParams.get('__og') === '1'
  if (!force && !BOT_RE.test(ua)) return next() // gerçek kullanıcı → SPA

  try {
    const origin = url.origin
    const path = url.pathname

    let html = null
    if (path.startsWith('/match/')) {
      const id = path.split('/')[2]
      if (id) html = await buildForMatch(id, origin, req.url)
    } else if (path.startsWith('/news/') && path !== '/news/archive') {
      const ref = parseNewsRef(path.split('/')[2])
      if (ref) html = await buildForNews(ref, origin, req.url)
    }

    if (html) {
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' },
      })
    }
  } catch {
    // yut → SPA fallback
  }
  return next()
}
