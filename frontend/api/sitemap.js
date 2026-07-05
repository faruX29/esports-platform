/**
 * Dinamik SEO sitemap (Vercel Edge) — Gemini #15.
 *
 * Statik dosya üretip commit'lemek + .gitignore ile boğuşmak yerine: istek anında
 * Supabase'den güncel slug'ları çekip doğru domainle XML basar. Agresif edge cache
 * (s-maxage=1 gün) → ağır üretim günde ~1 kez çalışır.
 *
 * Route eşlemesi (vercel.json rewrites):
 *   /sitemap.xml           → index (alt-sitemap'leri listeler)
 *   /sitemap-static.xml    → ?type=static
 *   /sitemap-news.xml      → ?type=news
 *   /sitemap-matches.xml   → ?type=matches   (sadece finished)
 *   /sitemap-tournaments.xml, /sitemap-teams.xml, /sitemap-players.xml
 *
 * Domain: SITE_URL env (kanonik) → yoksa request origin (vercel.app'te test için).
 */
export const config = { runtime: 'edge' }

const SB = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_ANON_KEY

const CHILDREN = ['static', 'news', 'matches', 'tournaments', 'teams', 'players']

const TR = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u' }
function slugify(t) {
  return String(t || '')
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, c => TR[c] ?? TR[c.toLowerCase()] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
}
function newsSlug(row) {
  if (row.content_type === 'transfer') {
    const id = `transfer_${row.id}`
    const s = slugify(row.title)
    return s ? `${s}-${id}` : id
  }
  if (row.content_type === 'tournament') {
    const id = `tournament_${row.tournament_id}`
    const s = slugify(row.title)
    return s ? `${s}-${id}` : id
  }
  const mid = row.match_id
  if (!mid) return `match_${row.id}`
  const s = slugify(row.title)
  return s ? `${s}-${mid}` : String(mid)
}

function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function baseUrl(req) {
  const site = process.env.SITE_URL
  return (site || new URL(req.url).origin).replace(/\/+$/, '')
}

async function fetchAll(table, select, filter) {
  if (!SB || !KEY) return []
  const rows = []
  const size = 1000
  for (let i = 0; i < 40; i++) {
    const url = `${SB}/rest/v1/${table}?select=${encodeURIComponent(select)}` +
      (filter ? `&${filter}` : '') +
      `&order=id.asc&limit=${size}&offset=${i * size}`
    const res = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
    if (!res.ok) break
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    rows.push(...batch)
    if (batch.length < size) break
  }
  return rows
}

function urlset(urls) {
  const body = urls
    .map(u => {
      const parts = [`<loc>${xmlEsc(u.loc)}</loc>`]
      if (u.lastmod) parts.push(`<lastmod>${u.lastmod}</lastmod>`)
      if (u.changefreq) parts.push(`<changefreq>${u.changefreq}</changefreq>`)
      if (u.priority) parts.push(`<priority>${u.priority}</priority>`)
      return `  <url>${parts.join('')}</url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

function lastmod(row) {
  const d = row.updated_at || row.created_at
  if (!d) return null
  try { return new Date(d).toISOString().slice(0, 10) } catch { return null }
}

async function buildChild(type, base) {
  if (type === 'static') {
    const today = new Date().toISOString().slice(0, 10)
    const pages = [
      ['/', 'daily', '1.0'], ['/matches', 'daily', '0.9'], ['/news', 'daily', '0.9'],
      ['/news/archive', 'daily', '0.8'], ['/tournaments', 'daily', '0.8'],
      ['/rankings', 'weekly', '0.8'], ['/players', 'weekly', '0.7'], ['/scout', 'monthly', '0.6'],
    ]
    return urlset(pages.map(([p, cf, pr]) => ({ loc: base + p, lastmod: today, changefreq: cf, priority: pr })))
  }
  if (type === 'news') {
    const rows = await fetchAll('news_articles', 'id,match_id,tournament_id,title,content_type,created_at')
    return urlset(rows.map(r => ({ loc: `${base}/news/${newsSlug(r)}`, lastmod: lastmod(r), changefreq: 'weekly', priority: '0.8' })))
  }
  if (type === 'matches') {
    const rows = await fetchAll('matches', 'id,updated_at', 'status=eq.finished')
    return urlset(rows.map(r => ({ loc: `${base}/match/${r.id}`, lastmod: lastmod(r), changefreq: 'monthly', priority: '0.6' })))
  }
  if (type === 'tournaments') {
    const rows = await fetchAll('tournaments', 'id,updated_at')
    return urlset(rows.map(r => ({ loc: `${base}/tournament/${r.id}`, lastmod: lastmod(r), changefreq: 'weekly', priority: '0.6' })))
  }
  if (type === 'teams') {
    const rows = await fetchAll('teams', 'id,updated_at')
    return urlset(rows.map(r => ({ loc: `${base}/team/${r.id}`, lastmod: lastmod(r), changefreq: 'weekly', priority: '0.6' })))
  }
  if (type === 'players') {
    const rows = await fetchAll('players', 'id,created_at')
    return urlset(rows.map(r => ({ loc: `${base}/player/${r.id}`, lastmod: lastmod(r), changefreq: 'weekly', priority: '0.5' })))
  }
  return null
}

function buildIndex(base) {
  const now = new Date().toISOString().slice(0, 10)
  const entries = CHILDREN
    .map(t => `  <sitemap><loc>${xmlEsc(`${base}/sitemap-${t}.xml`)}</loc><lastmod>${now}</lastmod></sitemap>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`
}

export default async function handler(req) {
  const base = baseUrl(req)
  const type = new URL(req.url).searchParams.get('type')

  let xml
  if (!type) {
    xml = buildIndex(base)
  } else if (CHILDREN.includes(type)) {
    xml = await buildChild(type, base)
  }

  if (!xml) return new Response('Not found', { status: 404 })

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}
