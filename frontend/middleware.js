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
  matcher: ['/news/:path*', '/match/:path*', '/team/:path*', '/player/:path*', '/tournament/:path*'],
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
  const tour = s.match(/tournament_(\d+)/) // maç sayısal fallback'ten ÖNCE
  if (tour) return { type: 'tournament', id: tour[1] }
  const m = s.match(/(\d{3,})(?!.*\d)/) // slug sonundaki sayı = match_id
  if (m) return { type: 'match', id: m[1] }
  return null
}

async function sbFetchAll(path) {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) return []
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) return []
  const rows = await res.json()
  return Array.isArray(rows) ? rows : (rows ? [rows] : [])
}

async function sbFetch(path) {
  const rows = await sbFetchAll(path)
  return rows[0] || null
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

function htmlDoc({ title, desc, url, img, type = 'article', jsonLd = null, body = '' }) {
  const t = esc(title), d = esc(desc), u = esc(url), i = esc(img)
  const imgTags = i ? `<meta property="og:image" content="${i}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:image" content="${i}"/>` : ''
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''
  const bodyHtml = body || `<h1>${t}</h1><p>${d}</p><a href="${u}">${t}</a>`
  return `<!DOCTYPE html><html lang="tr"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${t}</title>
<meta name="description" content="${d}"/>
<link rel="canonical" href="${u}"/>
<meta property="og:type" content="${type}"/>
<meta property="og:site_name" content="feXt"/>
<meta property="og:title" content="${t}"/>
<meta property="og:description" content="${d}"/>
<meta property="og:url" content="${u}"/>
${imgTags}
<meta name="twitter:card" content="${i ? 'summary_large_image' : 'summary'}"/>
<meta name="twitter:title" content="${t}"/>
<meta name="twitter:description" content="${d}"/>
${ld}
</head><body>${bodyHtml}</body></html>`
}

// Maç listesi → SEO gövde linkleri (Googlebot iç linkleri takip eder → tarama derinliği)
function matchListHtml(origin, rows, heading) {
  if (!rows.length) return ''
  const items = rows.map(m => {
    const an = m.team_a?.name || '?', bn = m.team_b?.name || '?'
    const sc = (m.team_a_score != null && m.team_b_score != null) ? ` ${m.team_a_score}-${m.team_b_score} ` : ' vs '
    return `<li><a href="${origin}/match/${m.id}">${esc(an)}${sc}${esc(bn)}</a></li>`
  }).join('')
  return `<h2>${esc(heading)}</h2><ul>${items}</ul>`
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
  const desc = p ? `${p} · feXt AI analizi ve canlı skor.` : 'feXt — AI analizi, canlı skor ve istatistikler.'
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'SportsEvent', name: `${a} vs ${b}`, sport: 'Esports',
    competitor: [{ '@type': 'SportsTeam', name: a }, { '@type': 'SportsTeam', name: b }],
    superEvent: row.tournament?.name ? { '@type': 'SportsEvent', name: row.tournament.name } : undefined,
    url,
  }
  return htmlDoc({ title, desc, url, img, jsonLd })
}

async function buildForNews(ref, origin, url) {
  const sel = 'title,summary,hero_score,game_slug,tier,tournament_name,team_a_name,team_b_name,team_a_logo,team_b_logo'
  let query
  if (ref.type === 'transfer') {
    query = `news_articles?id=eq.${encodeURIComponent(ref.id)}&select=${encodeURIComponent(sel)}&limit=1`
  } else if (ref.type === 'tournament') {
    query = `news_articles?content_type=eq.tournament&tournament_id=eq.${encodeURIComponent(ref.id)}&select=${encodeURIComponent(sel)}&order=created_at.desc&limit=1`
  } else {
    query = `news_articles?match_id=eq.${encodeURIComponent(ref.id)}&variant=neq.preview&select=${encodeURIComponent(sel)}&order=created_at.desc&limit=1`
  }
  const row = await sbFetch(query)
  if (!row) return null
  const gm = gameMeta(row.game_slug)
  const img = ogImageUrl(origin, {
    a: row.team_a_name, b: row.team_b_name, la: row.team_a_logo, lb: row.team_b_logo,
    s: scoreFromHero(row.hero_score), g: gm.label, t: row.tier, tn: row.tournament_name, c: gm.accent,
  })
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'NewsArticle',
    headline: row.title || '', description: row.summary || '', inLanguage: 'tr-TR',
    author: { '@type': 'Organization', name: 'feXt' },
    publisher: { '@type': 'Organization', name: 'feXt', logo: { '@type': 'ImageObject', url: `${origin}/icons/icon-512.png` } },
    mainEntityOfPage: url,
  }
  return htmlDoc({ title: row.title || 'feXt', desc: row.summary || '', url, img, jsonLd })
}

const ENC = encodeURIComponent
const MATCH_SEL = 'id,team_a_score,team_b_score,scheduled_at,team_a:teams!matches_team_a_id_fkey(name),team_b:teams!matches_team_b_id_fkey(name)'

async function buildForTeam(id, origin, url) {
  const team = await sbFetch(`teams?id=eq.${ENC(id)}&select=${ENC('name,logo_url,game:games(name,slug)')}&limit=1`)
  if (!team) return null
  const name = team.name || 'Takım'
  const gm = gameMeta(team.game?.slug)
  const matches = await sbFetchAll(`matches?or=(team_a_id.eq.${ENC(id)},team_b_id.eq.${ENC(id)})&status=eq.finished&select=${ENC(MATCH_SEL)}&order=scheduled_at.desc&limit=10`)
  const title = `${name} — Kadro, Maçlar ve İstatistikler`
  const desc = `${name} espor takımı (${gm.label}): son maç sonuçları, kazanma oranı, transferler ve istatistikler — feXt.`
  const jsonLd = { '@context': 'https://schema.org', '@type': 'SportsTeam', name, sport: 'Esports', logo: team.logo_url || undefined, url }
  const body = `<h1>${esc(name)}</h1><p>${esc(desc)}</p>${matchListHtml(origin, matches, 'Son Maçlar')}`
  return htmlDoc({ title, desc, url, img: '', type: 'profile', jsonLd, body })
}

async function buildForPlayer(id, origin, url) {
  const p = await sbFetch(`players?id=eq.${ENC(id)}&select=${ENC('nickname,role,nationality,image_url,team:teams(id,name)')}&limit=1`)
  if (!p) return null
  const nick = p.nickname || 'Oyuncu'
  const teamName = p.team?.name
  const title = `${nick} — Espor Oyuncu Profili`
  const desc = `${nick}${teamName ? ` (${teamName})` : ''} espor oyuncu profili: rol, KDA, kazanma oranı, kariyer ve istatistikler — feXt.`
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Person', name: nick, jobTitle: 'Espor Oyuncusu',
    nationality: p.nationality || undefined, image: p.image_url || undefined,
    memberOf: teamName ? { '@type': 'SportsTeam', name: teamName } : undefined, url,
  }
  const teamLink = p.team?.id ? `<p>Takım: <a href="${origin}/team/${p.team.id}">${esc(teamName)}</a></p>` : ''
  const body = `<h1>${esc(nick)}</h1><p>${esc(desc)}</p>${p.role ? `<p>Rol: ${esc(p.role)}</p>` : ''}${teamLink}`
  return htmlDoc({ title, desc, url, img: '', type: 'profile', jsonLd, body })
}

async function buildForTournament(id, origin, url) {
  const t = await sbFetch(`tournaments?id=eq.${ENC(id)}&select=${ENC('name,tier,begin_at,end_at')}&limit=1`)
  if (!t) return null
  const name = t.name || 'Turnuva'
  const matches = await sbFetchAll(`matches?tournament_id=eq.${ENC(id)}&select=${ENC(MATCH_SEL)}&order=scheduled_at.desc&limit=15`)
  const title = `${name} — Fikstür, Puan Durumu ve Sonuçlar`
  const desc = `${name} espor turnuvası: maç programı, sonuçlar ve puan durumu — feXt.`
  const jsonLd = { '@context': 'https://schema.org', '@type': 'SportsEvent', name, sport: 'Esports', startDate: t.begin_at || undefined, endDate: t.end_at || undefined, url }
  const body = `<h1>${esc(name)}</h1><p>${esc(desc)}</p>${matchListHtml(origin, matches, 'Maçlar')}`
  return htmlDoc({ title, desc, url, img: '', type: 'article', jsonLd, body })
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
    const seg = path.split('/')[2]
    if (path.startsWith('/match/')) {
      if (seg) html = await buildForMatch(seg, origin, req.url)
    } else if (path.startsWith('/news/') && path !== '/news/archive') {
      const ref = parseNewsRef(seg)
      if (ref) html = await buildForNews(ref, origin, req.url)
    } else if (path.startsWith('/team/')) {
      if (seg) html = await buildForTeam(seg, origin, req.url)
    } else if (path.startsWith('/player/')) {
      if (seg) html = await buildForPlayer(seg, origin, req.url)
    } else if (path.startsWith('/tournament/')) {
      if (seg) html = await buildForTournament(seg, origin, req.url)
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
