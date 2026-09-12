/**
 * Vercel Edge Middleware — sosyal crawler'lar için OG meta enjeksiyonu.
 *
 * Sorun: SPA meta etiketlerini JS ile set eder; crawler'lar (X, Discord, Reddit,
 * WhatsApp...) JS çalıştırmaz → paylaşımda kart çıkmaz.
 *
 * Çözüm: bot user-agent'ları algıla → /news/* ve /match/* için Supabase'den veri
 * çek → OG meta + og:image=/api/og?... içeren minimal HTML döndür. Gerçek
 * kullanıcı → next() (normal SPA). Her hata → next() (asla sayfayı bozma).
 *
 * ─── Kardeş kural: vercel.json → headers ────────────────────────────────────
 * `*.vercel.app` host'larına `X-Robots-Tag: noindex, nofollow` basılıyor.
 * Sebep: 2026-09-08'e kadar esports-platform-brown.vercel.app HTTP 200
 * dönüyordu ve kendi robots.txt'i "Allow: /" diyordu — sitenin TAMAMI ikinci
 * bir alan adında taranabilir haldeydi. GSC bunu "Kopya, Google kullanıcıdan
 * farklı bir standart sayfa seçti" olarak raporluyordu.
 *
 * robots.txt `Disallow` YERİNE `noindex` seçildi: Disallow yalnızca taramayı
 * engeller, ZATEN dizinde olan sayfaları çıkarmaz — Google noindex'i
 * görebilmek için sayfayı tarayabilmek zorunda.
 *
 * Alan adını Vercel'den silmek çözüm DEĞİL: her dağıtımın kendi
 * <proje>-<hash>.vercel.app adresi var, sabit takma adı silmek onları
 * kapsamaz. Joker host kuralı hepsini birden kapsıyor.
 *
 * ⚠️ vercel.json KATI ŞEMA doğrular: şemada olmayan üst düzey anahtar
 * (ör. açıklama için eklenen `_comment_*`) dağıtımı komple başarısız yapar.
 * 2026-09-08'de bu yüzden bir dağıtım sessizce düştü. Açıklamalar buraya.
 */
import { next } from '@vercel/edge'

export const config = {
  // Detay rotaları + liste rotaları. Liste rotaları 2026-09-08'de eklendi:
  // öncesinde botlara canonical'sız, birbirinin AYNISI olan index.html kabuğu
  // gidiyordu (bkz. buildForStatic). Matcher bilerek dar tutuluyor — her
  // istekte middleware çalıştırmak Vercel çağrı bütçesini yer.
  matcher: [
    '/',
    '/matches',
    '/rankings',
    '/tournaments',
    '/stats',
    '/players',
    '/scout',
    '/gizlilik',
    '/kullanim-kosullari',
    '/kvkk',
    '/news',
    '/news/:path*',
    '/match/:path*',
    '/team/:path*',
    '/player/:path*',
    '/tournament/:path*',
  ],
}

// Geniş kapsam: isimli crawler'lar + jenerik önizleme/araç token'ları. Gerçek
// tarayıcı UA'ları (Mozilla/Chrome/Safari/Edg) bu token'ları içermez → etkilenmez.
const BOT_RE = /(bot|crawler|spider|slurp|preview|unfurl|embed|opengraph|open graph|metadata|validator|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|reddit|linkedin|pinterest|applebot|skype|vkshare|iframely|curl|wget|python-requests|axios|go-http|okhttp|headless)/i

// Canonical = DAİMA üretim domaini + temiz path (query yok). www/vercel.app/utm
// varyantları tek canonical'da toplanır → "duplicate without user-selected canonical" biter.
const SITE_ORIGIN = (process.env.SITE_URL || 'https://fextesports.com').replace(/\/+$/, '')

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

// Dinamik OG kartı üretimi (@vercel/og) kart başına ~1.7sn SAF CPU harcıyor ve
// her maçın kendine ait bir kart URL'i var (~15.6k maç). Sosyal medyada gerçekte
// paylaşılan şeyler haberler ve yakın tarihli/yaklaşan maçlar; aylar önceki bir
// maçı kimse paylaşmıyor. Bu yüzden eski maçlarda statik marka kartına düşüyoruz
// → CDN'den servis, 0 CPU. (Vercel Fluid Active CPU bütçesi: ücretsiz 4sa/ay.)
const OG_FRESH_DAYS = 7
const STATIC_OG = '/og-default.jpg'

function isShareableMatch(scheduledAt) {
  if (!scheduledAt) return false           // tarihsiz maç → statik
  const t = Date.parse(scheduledAt)
  if (Number.isNaN(t)) return false
  return t >= Date.now() - OG_FRESH_DAYS * 86400000  // son 7 gün + tüm gelecek
}

function ogImageUrl(origin, p) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== '') qs.set(k, String(v))
  }
  return `${origin}/api/og?${qs.toString()}`
}

// Edge runtime'da Intl/ICU garantisi yok -> tarih elle bicimlenir.
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function trTarih(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return `${t.getUTCDate()} ${AYLAR[t.getUTCMonth()]} ${t.getUTCFullYear()}`
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

// Event yapısal verisi ortak alanları. location + startDate KRİTİK (Google zengin
// sonuç zorunluları); geri kalanı non-critical öneri. Espor maçı = online etkinlik.
function eventCommon(url, startDate, desc, img) {
  return {
    startDate: startDate || undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url },
    description: desc || undefined,
    image: img || undefined,
    organizer: { '@type': 'Organization', name: 'feXt', url: SITE_ORIGIN },
  }
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
    'team_a_score,team_b_score,scheduled_at,status,prediction_team_a,prediction_team_b,' +
    'team_a_id,team_b_id,tournament_id,' +
    'team_a:teams!matches_team_a_id_fkey(name,logo_url),' +
    'team_b:teams!matches_team_b_id_fkey(name,logo_url),' +
    'tournament:tournaments(name,tier),game:games(slug,name)'
  const row = await sbFetch(`matches?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(sel)}&limit=1`)
  if (!row) return null
  const a = row.team_a?.name || 'Takım A'
  const b = row.team_b?.name || 'Takım B'
  const gm = gameMeta(row.game?.slug)
  const score = (row.team_a_score != null && row.team_b_score != null) ? `${row.team_a_score} - ${row.team_b_score}` : ''
  const p = predHook(row.prediction_team_a, row.prediction_team_b, a, b)
  const img = isShareableMatch(row.scheduled_at)
    ? ogImageUrl(origin, {
        a, b, la: row.team_a?.logo_url, lb: row.team_b?.logo_url,
        s: score, g: gm.label, t: row.tournament?.tier, tn: row.tournament?.name, p, c: gm.accent,
      })
    : `${origin}${STATIC_OG}`
  // ---- Başlık / açıklama / gövde ----------------------------------------
  // ÖLÇÜLDÜ (12 Eylül 2026): maç sayfaları Googlebot'a 36-56 KELİME
  // dönüyördu (gövde = varsayılan `<h1>+<p>+<a>`), 12 örneğin 5'inde açıklama
  // birebir aynı kalıp cümleydi ve 36.796 biten maçın HİÇBİRİNDE skor
  // başlıkta yoktu. Oysa insanlar "takim1 takim2 sonuc/skor" diye arar:
  // başlıkta skor olmayan sayfa, tam da karşılaması gereken sorguyu kaçırır.
  const bitti = row.status === 'finished' && score
  const skorK = score.replace(/\s+/g, '')   // "2 - 1" -> "2-1" (başlıkta daha doğal, arama sorgusuna daha yakın)
  const tarih = trTarih(row.scheduled_at)
  const turAd = row.tournament?.name || ''
  const oyunAd = row.game?.name || gm.label

  const title = bitti
    ? `${a} ${skorK} ${b}${turAd ? ' · ' + turAd : ''}`
    : `${a} vs ${b}${turAd ? ' · ' + turAd : ''}`

  let desc
  if (bitti) {
    const ax = Number(row.team_a_score), bx = Number(row.team_b_score)
    const sonuc = ax === bx
      ? `${a} ile ${b} ${skorK} berabere kaldı.`
      : `${ax > bx ? a : b}, ${ax > bx ? b : a} karşısında ` +
        // skorK daima "A-B" sırasında. Kazananı cümlenin başına alırken skoru da
        // çevirmezsek "100 Thieves, NRG karşısında 0-2 kazandı" gibi yanlış çıkıyor.
        `${ax > bx ? ax : bx}-${ax > bx ? bx : ax} kazandı.`
    desc = `${sonuc}${turAd ? ` ${turAd},` : ''}${tarih ? ` ${tarih}.` : ''} ` +
      `${oyunAd} maç sonucu, harita skorları ve istatistikler — feXt.`
  } else {
    desc = `${a} – ${b} maçı${tarih ? `, ${tarih}` : ''}.` +
      `${p ? ` Fextopus tahmini: ${p.replace('AI: ', '')}.` : ''} ` +
      `${oyunAd} canlı skor, kadro ve maç analizi — feXt.`
  }
  const teams = [{ '@type': 'SportsTeam', name: a }, { '@type': 'SportsTeam', name: b }]
  // Event şeması YALNIZCA startDate varsa basılır (startDate = Google zorunlu alanı;
  // tarih yoksa geçersiz Event yerine hiç şema basmamak daha doğru).
  const jsonLd = row.scheduled_at ? {
    '@context': 'https://schema.org', '@type': 'SportsEvent', name: `${a} vs ${b}`, sport: 'Esports',
    ...eventCommon(url, row.scheduled_at, desc, img),
    competitor: teams, performer: teams,
    // superEvent KALDIRILDI: iç içe SportsEvent (turnuva) sadece name taşıyordu →
    // Google onu ayrı Event gibi doğrulayıp "location/startDate eksik" veriyordu
    // (GSC 10 öğe). Ana maç Event'i zaten tam; superEvent opsiyonel, kaldırınca temiz.
    url,
  } : null

  // Gövde: gerçek cümle + iç linkler. Eskiden htmlDoc'un varsayılan gövdesi
  // kullanılıyordu (`<h1>+<p>+kendine link`) — 40 kelime ve tek bir iç link
  // bile yok. Takım/turnuva sayfaları zaten gövde basıyordu; maç sayfaları
  // (sitemap'in en kalabalık bölümü, 2.477 URL) boşta kalmıştı.
  const satirlar = []
  if (row.team_a_id) satirlar.push(`<li><a href="${origin}/team/${row.team_a_id}">${esc(a)} kadro ve istatistikler</a></li>`)
  if (row.team_b_id) satirlar.push(`<li><a href="${origin}/team/${row.team_b_id}">${esc(b)} kadro ve istatistikler</a></li>`)
  if (row.tournament_id) satirlar.push(`<li><a href="${origin}/tournament/${row.tournament_id}">${esc(turAd || 'Turnuva')} fikstürü</a></li>`)
  const haber = await sbFetch(
    `news_articles?match_id=eq.${ENC(id)}&select=id,title&order=created_at.desc&limit=1`,
  )
  if (haber?.id) satirlar.push(`<li><a href="${origin}/news/${haber.id}">${esc(haber.title || 'Maç haberi')}</a></li>`)

  const tahminP = p ? `<p>Fextopus tahmin motoru bu maçta ${esc(p.replace('AI: ', ''))} veriyordu.</p>` : ''
  const kunye = `<p>${esc(oyunAd)}${turAd ? ` · ${esc(turAd)}` : ''}${row.tournament?.tier ? ` · ${esc(String(row.tournament.tier).toUpperCase())}-Tier` : ''}${tarih ? ` · ${esc(tarih)}` : ''}</p>`
  const body = `<h1>${esc(title)}</h1><p>${esc(desc)}</p>${kunye}${tahminP}` +
    (satirlar.length ? `<h2>İlgili Sayfalar</h2><ul>${satirlar.join('')}</ul>` : '') +
    siteNavHtml(origin)

  return htmlDoc({ title, desc, url, img, jsonLd, body })
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
  let row = await sbFetch(query)
  // Maç haberlerinde önce maç SONRASI yazı aranır (variant≠preview) — aynı maçın
  // hem önizlemesi hem özeti olabilir, doğru olan özettir. Ama maç henüz
  // oynanmadıysa elde YALNIZCA preview vardır; eskiden burada null dönülüp bot
  // SPA kabuğuna düşüyordu.
  //
  // ÖLÇÜLDÜ (12 Eylül 2026): match_id'li 685 haber URL'inin 110'u (%16)
  // Googlebot'a BAYT BAYT AYNI, canonical'sız, <p> içermeyen 7,5 KB'lık kabuk
  // dönüyordu — hepsinin <title>'ı "feXt — Espor Maçları, Skorlar ve Haberler".
  // Üstelik bunlar en TAZE sayfalar: preview = yaklaşan maç, yani Google'ın en
  // istekli taradığı içerik. Bu, GSC'deki "kopya, kullanıcı tarafından seçilmiş
  // canonical yok" uyarısının ayakta kalan son kaynağıydı.
  if (!row && ref.type === 'match') {
    row = await sbFetch(
      `news_articles?match_id=eq.${ENC(ref.id)}&select=${ENC(sel)}&order=created_at.desc&limit=1`,
    )
  }
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
  // İç linkler → Googlebot takımları/maçı/turnuvayı takip eder (tarama derinliği).
  const linkItems = []
  if (ref.type === 'match') {
    linkItems.push(`<a href="${origin}/match/${ENC(ref.id)}">Maç detayı ve canlı skor</a>`)
    const m = await sbFetch(`matches?id=eq.${ENC(ref.id)}&select=team_a_id,team_b_id,tournament_id&limit=1`)
    if (m) {
      if (m.team_a_id) linkItems.push(`<a href="${origin}/team/${m.team_a_id}">${esc(row.team_a_name || 'Takım A')}</a>`)
      if (m.team_b_id) linkItems.push(`<a href="${origin}/team/${m.team_b_id}">${esc(row.team_b_name || 'Takım B')}</a>`)
      if (m.tournament_id) linkItems.push(`<a href="${origin}/tournament/${m.tournament_id}">${esc(row.tournament_name || 'Turnuva')}</a>`)
    }
  } else if (ref.type === 'tournament') {
    linkItems.push(`<a href="${origin}/tournament/${ENC(ref.id)}">${esc(row.tournament_name || 'Turnuva')} turnuva sayfası</a>`)
  }
  const body = `<h1>${esc(row.title || 'feXt')}</h1><p>${esc(row.summary || '')}</p>` +
    (linkItems.length ? `<h2>İlgili Sayfalar</h2><ul>${linkItems.map(l => `<li>${l}</li>`).join('')}</ul>` : '')
  return htmlDoc({ title: row.title || 'feXt', desc: row.summary || '', url, img, jsonLd, body })
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
  // NOT: players↔teams FK yok; players.team_pandascore_id === teams.id (ayrı sorgu).
  const p = await sbFetch(`players?id=eq.${ENC(id)}&select=${ENC('nickname,role,nationality,image_url,team_pandascore_id')}&limit=1`)
  if (!p) return null
  const nick = p.nickname || 'Oyuncu'
  let team = null
  if (p.team_pandascore_id != null) {
    team = await sbFetch(`teams?id=eq.${ENC(p.team_pandascore_id)}&select=id,name&limit=1`)
  }
  const teamName = team?.name
  const title = `${nick} — Espor Oyuncu Profili`
  const desc = `${nick}${teamName ? ` (${teamName})` : ''} espor oyuncu profili: rol, KDA, kazanma oranı, kariyer ve istatistikler — feXt.`
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Person', name: nick, jobTitle: 'Espor Oyuncusu',
    nationality: p.nationality || undefined, image: p.image_url || undefined,
    memberOf: teamName ? { '@type': 'SportsTeam', name: teamName } : undefined, url,
  }
  const teamLink = team?.id ? `<p>Takım: <a href="${origin}/team/${team.id}">${esc(teamName)}</a></p>` : ''
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
  // Event şeması yalnızca begin_at (startDate) varsa (turnuvaların ~%18'i tarihsiz →
  // onlarda geçersiz Event basmaktansa hiç basma; sayfa yine çalışır).
  const jsonLd = t.begin_at ? {
    '@context': 'https://schema.org', '@type': 'SportsEvent', name, sport: 'Esports',
    ...eventCommon(url, t.begin_at, desc, ''),
    endDate: t.end_at || undefined, url,
  } : null
  const body = `<h1>${esc(name)}</h1><p>${esc(desc)}</p>${matchListHtml(origin, matches, 'Maçlar')}`
  return htmlDoc({ title, desc, url, img: '', type: 'article', jsonLd, body })
}

/* ── Statik (liste) rotalar ────────────────────────────────────────────────
 * SORUN (2026-09-08, GSC "duplicate without user-selected canonical"):
 * middleware yalnızca detay rotalarını kapsıyordu. `/`, `/matches`,
 * `/rankings`, `/news`, `/tournaments`, `/stats`, `/players` botlara
 * index.html kabuğunu döndürüyordu — beşi de BAYT BAYT AYNI 7491 baytlık
 * belge, üstelik canonical etiketi olmadan (index.html'de hiç yok; React
 * onu ancak JS çalışınca ekliyor). Googlebot için bunlar tek bir dokümanın
 * kopyalarıydı ve hangisinin asıl olduğunu söyleyen bir işaret yoktu.
 *
 * Çözüm: her liste sayfasına kendi canonical'ı, kendi başlığı/açıklaması ve
 * gerçek iç linkleri olan hafif bir belge. Böylece belgeler artık birbirinin
 * kopyası değil ve her biri kendi canonical'ını beyan ediyor.
 */
const STATIC_ROUTES = {
  '/': {
    title: 'feXt — Espor Maçları, Skorlar ve Fextopus Tahminleri',
    desc: 'VALORANT, CS2 ve League of Legends maçları: canlı skorlar, maç programı, turnuvalar ve Fextopus tahmin oranları.',
    heading: 'Günün espor maçları',
    feed: 'matches',
  },
  '/matches': {
    title: 'Maç Programı — Canlı, Yaklaşan ve Geçmiş Espor Maçları',
    desc: 'VALORANT, CS2 ve LoL maç takvimi. Canlı skorlar, yaklaşan karşılaşmalar ve sonuçlanmış maçlar tek sayfada.',
    heading: 'Yaklaşan ve canlı maçlar',
    feed: 'matches',
  },
  '/rankings': {
    title: 'Takım Sıralaması — Espor Güç Sıralaması',
    desc: 'VALORANT, CS2 ve LoL takımlarının form ve galibiyet oranına göre sıralaması.',
    heading: 'Öne çıkan takımlar',
    feed: 'teams',
  },
  '/tournaments': {
    title: 'Turnuvalar — Aktif ve Yaklaşan Espor Turnuvaları',
    desc: 'S-Tier ve A-Tier espor turnuvaları; bracket, takvim ve puan durumu.',
    heading: 'Aktif turnuvalar',
    feed: 'tournaments',
  },
  '/news': {
    title: 'Haberler — Espor Transferleri ve Maç Analizleri',
    desc: 'Kadro değişiklikleri, transferler ve maç sonrası analizler. Veriler Liquipedia ve resmi kaynaklardan.',
    heading: 'Son haberler',
    feed: 'news',
  },
  '/stats': {
    title: 'Fextopus İsabet Oranları',
    desc: 'Fextopus tahmin motorunun güven katmanına göre isabet oranları — sonuçlanmış maçlar üzerinde canlı hesaplanır.',
    heading: 'Fextopus isabet matrisi',
    feed: null,
  },
  '/players': {
    title: 'Oyuncular — Espor Oyuncu Profilleri ve İstatistikleri',
    desc: 'VALORANT, CS2 ve LoL oyuncularının profilleri, takımları ve maç istatistikleri.',
    heading: 'Oyuncu profilleri',
    feed: null,
  },
  '/news/archive': {
    title: 'Haber Arşivi — Geçmiş Espor Haberleri',
    desc: 'feXt haber arşivi: geçmiş transferler, kadro değişiklikleri ve maç analizleri.',
    heading: 'Haber arşivi',
    feed: 'news',
  },
  '/scout': {
    title: 'Scout Engine — Kulüpler ve Ajanslar için Espor Veri Aracı',
    desc: 'Oyuncu ve takım performansını veriye dayalı karşılaştıran B2B scout aracı.',
    heading: 'Scout Engine',
    feed: null,
  },
  // Yasal sayfalar: içerikleri statik ve SPA içinde. Buraya konmalarının tek
  // sebebi canonical — sitemap'te oldukları için Google onları tarıyor ve
  // canonical'sız kabuk kopya sayılıyordu.
  '/gizlilik': {
    title: 'Gizlilik Politikası',
    desc: 'feXt gizlilik politikası: hangi verileri topluyoruz, nasıl kullanıyoruz ve haklarınız.',
    heading: 'Gizlilik Politikası',
    feed: null,
  },
  '/kullanim-kosullari': {
    title: 'Kullanım Koşulları',
    desc: 'feXt kullanım koşulları ve veri kaynakları (Liquipedia CC BY-SA 3.0) hakkında bilgi.',
    heading: 'Kullanım Koşulları',
    feed: null,
  },
  '/kvkk': {
    title: 'KVKK Aydınlatma Metni',
    desc: 'Kişisel verilerin korunması kapsamında feXt aydınlatma metni.',
    heading: 'KVKK Aydınlatma Metni',
    feed: null,
  },
}

// Her liste sayfasının altına aynı gezinme bloğu → Googlebot site yapısını
// tek taramada çıkarır (iç link derinliği).
function siteNavHtml(origin) {
  const links = [
    ['/matches', 'Maç programı'],
    ['/tournaments', 'Turnuvalar'],
    ['/rankings', 'Takım sıralaması'],
    ['/news', 'Haberler'],
    ['/stats', 'Fextopus isabet oranları'],
  ]
  return `<nav><h2>feXt bölümleri</h2><ul>${
    links.map(([p, t]) => `<li><a href="${origin}${p}">${esc(t)}</a></li>`).join('')
  }</ul></nav>`
}

async function staticFeedHtml(feed, origin) {
  try {
    if (feed === 'matches') {
      const rows = await sbFetchAll(
        `matches?status=in.(running,not_started)&select=${ENC(MATCH_SEL)}&order=scheduled_at.asc&limit=25`,
      )
      return matchListHtml(origin, rows, 'Yaklaşan ve canlı maçlar')
    }
    if (feed === 'teams') {
      const rows = await sbFetchAll('teams?select=id,name&order=name.asc&limit=30')
      if (!rows.length) return ''
      return `<h2>Takımlar</h2><ul>${
        rows.map(t => `<li><a href="${origin}/team/${t.id}">${esc(t.name)}</a></li>`).join('')
      }</ul>`
    }
    if (feed === 'tournaments') {
      const rows = await sbFetchAll(
        `tournaments?tier=in.(S,s,A,a)&select=id,name,tier&order=begin_at.desc&limit=25`,
      )
      if (!rows.length) return ''
      return `<h2>Turnuvalar</h2><ul>${
        rows.map(t => `<li><a href="${origin}/tournament/${t.id}">${esc(t.name)}${t.tier ? ` (${esc(String(t.tier).toUpperCase())}-Tier)` : ''}</a></li>`).join('')
      }</ul>`
    }
    if (feed === 'news') {
      const rows = await sbFetchAll(
        'news_articles?select=id,title&order=created_at.desc&limit=25',
      )
      if (!rows.length) return ''
      return `<h2>Son haberler</h2><ul>${
        rows.map(n => `<li><a href="${origin}/news/${n.id}">${esc(n.title)}</a></li>`).join('')
      }</ul>`
    }
  } catch {
    // Veri gelmezse sayfa yine canonical + gezinme ile döner; boş kabuktan iyi.
  }
  return ''
}

async function buildForStatic(path, origin, url) {
  const meta = STATIC_ROUTES[path]
  if (!meta) return null
  const feed = meta.feed ? await staticFeedHtml(meta.feed, origin) : ''
  const body = `<h1>${esc(meta.title)}</h1><p>${esc(meta.desc)}</p>${feed}${siteNavHtml(origin)}`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': path === '/' ? 'WebSite' : 'CollectionPage',
    name: meta.title,
    description: meta.desc,
    url,
    publisher: { '@type': 'Organization', name: 'feXt', url: origin },
  }
  return htmlDoc({ title: meta.title, desc: meta.desc, url, img: `${origin}${STATIC_OG}`, type: 'website', jsonLd, body })
}

export default async function middleware(req) {
  const ua = req.headers.get('user-agent') || ''
  const url = new URL(req.url)
  // ?__og=1 → tarayıcıda elle doğrulama için OG HTML'i zorla (bot olmasan da)
  const force = url.searchParams.get('__og') === '1'
  if (!force && !BOT_RE.test(ua)) return next() // gerçek kullanıcı → SPA

  try {
    const path = url.pathname

    // canonical + iç linkler + OG görsel = üretim domaini (req host'u DEĞİL) →
    // www/vercel.app/utm varyantları tek canonical'da toplanır.
    const canon = SITE_ORIGIN + path
    let html = null
    const seg = path.split('/')[2]
    // Liste rotaları önce denenir: '/news' (segment yok) buraya düşer,
    // '/news/<slug>' aşağıdaki detay dalına gider.
    if (STATIC_ROUTES[path]) {
      html = await buildForStatic(path, SITE_ORIGIN, canon)
    } else if (path.startsWith('/match/')) {
      if (seg) html = await buildForMatch(seg, SITE_ORIGIN, canon)
    } else if (path.startsWith('/news/') && path !== '/news/archive') {
      const ref = parseNewsRef(seg)
      if (ref) html = await buildForNews(ref, SITE_ORIGIN, canon)
    } else if (path.startsWith('/team/')) {
      if (seg) html = await buildForTeam(seg, SITE_ORIGIN, canon)
    } else if (path.startsWith('/player/')) {
      if (seg) html = await buildForPlayer(seg, SITE_ORIGIN, canon)
    } else if (path.startsWith('/tournament/')) {
      if (seg) html = await buildForTournament(seg, SITE_ORIGIN, canon)
    }

    if (html) {
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // Bot SEO snapshot'ı gerçek-zamanlı olmak zorunda değil → uzun paylaşımlı
          // cache: aynı URL tekrar taranınca fonksiyon yeniden çalışmaz (Vercel CPU/
          // Origin Transfer tasarrufu). Google zaten periyodik yeniden tarar.
          'cache-control': 'public, max-age=1800, s-maxage=86400, stale-while-revalidate=604800',
        },
      })
    }
  } catch {
    // yut → SPA fallback
  }
  return next()
}
