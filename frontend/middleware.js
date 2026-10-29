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
 * `/api/(.*)` → `X-Robots-Tag: noindex` (28 Eki): Google `/api/og?...` paylaşım
 * görsellerini sayfa gibi tarayıp "dizine eklenmedi" listesini dolduruyordu.
 * robots.txt Disallow DEĞİL: sosyal tarayıcılar OG görselini okuyabilmeli.
 *
 * ⚠️ vercel.json KATI ŞEMA doğrular: şemada olmayan üst düzey anahtar
 * (ör. açıklama için eklenen `_comment_*`) dağıtımı komple başarısız yapar.
 * 2026-09-08'de bu yüzden bir dağıtım sessizce düştü. Açıklamalar buraya.
 */
import { next } from '@vercel/edge'
import { ogImzala } from './lib/ogImza.js'

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
    '/turk-takimlari',
    '/gizlilik',
    '/kullanim-kosullari',
    '/kvkk',
    '/news',
    '/news/:path*',
    '/match/:path*',
    '/team/:path*',
    '/player/:path*',
    '/tournament/:path*',
    '/lig/:path*',
  ],
}

// Geniş kapsam: isimli crawler'lar + jenerik önizleme/araç token'ları. Gerçek
// tarayıcı UA'ları (Mozilla/Chrome/Safari/Edg) bu token'ları içermez → etkilenmez.
const BOT_RE = /(bot|crawler|spider|slurp|preview|unfurl|embed|opengraph|open graph|metadata|validator|facebookexternalhit|whatsapp|telegram|slack|discord|twitter|reddit|linkedin|pinterest|applebot|skype|vkshare|iframely|curl|wget|python-requests|axios|go-http|okhttp|headless)/i

// Bize ZİYARETÇİ GETİRMEYEN botlar: SEO araçları + yapay zekâ EĞİTİM tarayıcıları.
// Bunlara bot HTML'i ÜRETİLMEZ, SPA kabuğu gider (statik, 0 CPU).
// Neden (22 Eyl): middleware ÖNBELLEKTEN ÖNCE, HER istekte çalışır — yanıttaki
// s-maxage onu atlatmaz. Vercel Fluid Active CPU kotasının %45'i middleware'den,
// tüketimin %82'si ABD bölgelerinden (botlar). Googlebot/Bingbot, sosyal önizleme
// botları ve arama odaklı AI botları (OAI-SearchBot, PerplexityBot) KAPSAM DIŞI:
// onlar ziyaretçi getirir.
// Aynı liste public/robots.txt'te Disallow: (5 Eki) — SPA kabuğu da CDN Requests
// kotasından (ayda 1M) yer; kurala uyan bot hiç istek atmasın. İkisini eş tut.
const DEGERSIZ_BOT_RE = /(ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|dataforseobot|blexbot|serpstatbot|barkrowler|seekportbot|gptbot|ccbot|claudebot|anthropic-ai|amazonbot|meta-externalagent|imagesiftbot|omgili|diffbot|timpibot)/i

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
  const hf = s.match(/haftalik_([0-9a-fA-F-]{36})/)
  if (hf) return { type: 'haftalik', id: hf[1] }
  const tour = s.match(/tournament_(\d+)/) // maç sayısal fallback'ten ÖNCE
  if (tour) return { type: 'tournament', id: tour[1] }
  const m = s.match(/(\d{3,})(?!.*\d)/) // slug sonundaki sayı = match_id
  if (m) return { type: 'match', id: m[1] }
  return null
}

// Haber URL'i — src/utils/newsSlug.js buildNewsSlug ve api/sitemap.js newsSlug ile AYNI.
// 24 Eki'ye kadar bot HTML'indeki haber linkleri `/news/<haber uuid>` idi: SPA bunu
// maç numarası sanıp yanlış/boş sayfa açıyordu (Google'ın izlediği linkler kırıktı).
const SLUG_TR = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u' }
function slugify(t) {
  return String(t || '')
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, c => SLUG_TR[c] ?? SLUG_TR[c.toLowerCase()] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
}
const NEWS_LINK_SEL = 'id,match_id,tournament_id,title,content_type'
function newsPath(row) {
  const s = slugify(row.title)
  let id
  if (row.content_type === 'transfer') id = `transfer_${row.id}`
  else if (row.content_type === 'haftalik') id = `haftalik_${row.id}`
  else if (row.content_type === 'tournament') id = `tournament_${row.tournament_id}`
  else id = String(row.match_id || '')
  if (!id) return null
  return `/news/${s ? `${s}-${id}` : id}`
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

// Sayfanın ANA varlığı için (maç/takım/oyuncu/turnuva/haber satırı). sbFetch hatayı
// boş sonuçla karıştırır; burada hata fırlatılır → middleware SPA'ya düşer (200),
// null ise varlık gerçekten yok → 404. Geçici Supabase arızası Google'a 404 göstermesin.
async function sbBul(path) {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) throw new Error('supabase env yok')
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`supabase ${res.status}`)
  const rows = await res.json()
  return (Array.isArray(rows) ? rows[0] : rows) || null
}

// Soft 404 kapatma (Denetim Faz 5): olmayan maç/takım/oyuncu/turnuva/haber eskiden
// bota 200 + SPA kabuğu dönüyordu → Google boş kabuğu "soft 404" ya da kopya sayar.
// Artık gerçek 404 + noindex; gezinme linkleri kalır (tarama çıkmaz sokakta bitmesin).
const YOK = Symbol('yok')
const SAYI_RE = /^\d+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bulunamadiHtml(origin) {
  return `<!DOCTYPE html><html lang="tr"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sayfa bulunamadı — feXt</title>
<meta name="robots" content="noindex, follow"/>
</head><body><h1>Sayfa bulunamadı</h1><p>Aradığınız sayfa yok ya da kaldırıldı.</p>${siteNavHtml(origin)}</body></html>`
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

// URL imzalı (lib/ogImza.js): api/og imzasız isteği statik karta yollar.
// OG_SECRET yoksa imzalı URL üretilemez → doğrudan statik kart.
async function ogImageUrl(origin, p) {
  const secret = process.env.OG_SECRET
  if (!secret) return `${origin}${STATIC_OG}`
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== '') qs.set(k, String(v))
  }
  qs.set('sig', await ogImzala(qs, secret))
  return `${origin}/api/og?${qs.toString()}`
}

// PandaScore turnuva adları PARÇALI gelir: lig ("VCT") + etkinlik
// ("Champions 2026") + turnuva ("Playoffs"). Biz yalnızca sonuncusunu
// kullanıyorduk ve ÖLÇÜLDÜ (12 Eylül 2026): 3.212 turnuvanın 1.016'sının adı
// "Playoffs", 410'u "Group A", 406'sı "Group B". Sitemap kapsamındaki 131
// turnuva sayfası birbirinin aynı başlığı taşıyordu ve her maç sayfası
// "· Playoffs" diyordu — "· VCT Champions 2026" demesi gerekirken.
//
// display_name kolonu var ama 3.212 kaydın hepsinde NULL; doldurulduğunda
// otomatik olarak tercih edilir.
function turnuvaAdi(t, sahneDahil = true) {
  if (!t) return ''
  if (t.display_name) return t.display_name
  const lig = String(t.league_name || '').trim()
  const etkinlik = String(t.event_name || '').trim()
  const sahne = String(t.name || '').trim()

  // "VCT" + "Champions 2026" -> "VCT Champions 2026". Etkinlik zaten lig adıyla
  // başlıyorsa tekrar etme ("China Evolution Series" + "China Evolution ...").
  let tam = etkinlik
  if (lig && etkinlik && !etkinlik.toLowerCase().startsWith(lig.toLowerCase())) {
    tam = `${lig} ${etkinlik}`
  } else if (lig && !etkinlik) {
    tam = lig
  }
  if (!tam) return sahne
  if (!sahneDahil || !sahne) return tam
  // Sahne adı zaten tam adın içindeyse tekrar etme.
  if (tam.toLowerCase().includes(sahne.toLowerCase())) return tam
  return `${tam} · ${sahne}`
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
  return `Fextopus: %${Math.round(favProb * 100)} ${fav}`
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

function htmlDoc({ title, desc, url, img, type = 'article', jsonLd = null, body = '', robots = '' }) {
  const t = esc(title), d = esc(desc), u = esc(url), i = esc(img)
  // Dizine açık sayfada büyük görsel izni: Google Discover'ın şartı (görsel ≥1200px,
  // og 1200x630). Yoksa Google küçük önizleme gösterir ve Discover'a pek girmez.
  const robotsTag = `<meta name="robots" content="${esc(robots || 'max-image-preview:large')}"/>\n`
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
${robotsTag}<link rel="canonical" href="${u}"/>
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

// Hangi maç sayfaları Google dizinine GİRMESİN (19 Eyl, GSC kopya uyarıları).
// Aynı iki takım art arda iki küçük elemede oynayınca (Sinners–Nuclear TigeRES,
// 10 ve 11 Eyl) sayfalar neredeyse aynı çıkıyor; Google birini "kopya" sayıyordu.
// Kural site haritasıyla tutarlı (orada zaten yalnız S/A var):
//   iptal edilen maç → noindex
//   C/D/bilinmeyen seviye → noindex, AMA Türk takımı oynuyorsa dizinde kalır
//   (kurucu kararı: Türkçe sitenin ayrıştığı yer Türk takımlarının küçük maçları)
// Sayfalar silinmez, kullanıcıya açık kalır; `follow` ile linkler takip edilir.
function macDizinDisi(row) {
  if (row.status === 'canceled') return true
  const tier = String(row.tournament?.tier || '').trim().toUpperCase().charAt(0)
  if (['S', 'A', 'B'].includes(tier)) return false
  const turk = row.team_a?.country_code === 'TR' || row.team_b?.country_code === 'TR'
  return !turk
}

async function buildForMatch(id, origin, url) {
  const sel =
    'team_a_score,team_b_score,scheduled_at,status,prediction_team_a,prediction_team_b,' +
    'team_a_id,team_b_id,tournament_id,' +
    'team_a:teams!matches_team_a_id_fkey(name,logo_url,country_code),' +
    'team_b:teams!matches_team_b_id_fkey(name,logo_url,country_code),' +
    'tournament:tournaments(name,tier,league_name,event_name,display_name),game:games(slug,name)'
  const row = await sbBul(`matches?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(sel)}&limit=1`)
  if (!row) return YOK
  const a = row.team_a?.name || 'Takım A'
  const b = row.team_b?.name || 'Takım B'
  const gm = gameMeta(row.game?.slug)
  const score = (row.team_a_score != null && row.team_b_score != null) ? `${row.team_a_score} - ${row.team_b_score}` : ''
  const p = predHook(row.prediction_team_a, row.prediction_team_b, a, b)
  const img = isShareableMatch(row.scheduled_at)
    ? await ogImageUrl(origin, {
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
  // Başlıkta sahne adı ("Playoffs") YOK, etkinlik adı var: insanlar
  // "champions 2026" diye arar, "playoffs" diye değil. Sahne künye satırında.
  const turAd = turnuvaAdi(row.tournament, false)
  const turSahne = turnuvaAdi(row.tournament, true)
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
      `${oyunAd} maç sonucu, Fextopus tahmini ve istatistikler — feXt.`
  } else {
    desc = `${a} – ${b} maçı${tarih ? `, ${tarih}` : ''}.` +
      `${p ? ` Fextopus tahmini: ${p.replace('Fextopus: ', '')}.` : ''} ` +
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
    `news_articles?match_id=eq.${ENC(id)}&select=${NEWS_LINK_SEL}&order=created_at.desc&limit=1`,
  )
  const haberYol = haber ? newsPath(haber) : null
  if (haberYol) satirlar.push(`<li><a href="${origin}${haberYol}">${esc(haber.title || 'Maç haberi')}</a></li>`)

  const tahminP = p ? `<p>Fextopus tahmin motoru bu maçta ${esc(p.replace('Fextopus: ', ''))} veriyordu.</p>` : ''
  const kunye = `<p>${esc(oyunAd)}${turSahne ? ` · ${esc(turSahne)}` : ''}${row.tournament?.tier ? ` · ${esc(String(row.tournament.tier).toUpperCase())}-Tier` : ''}${tarih ? ` · ${esc(tarih)}` : ''}</p>`
  const body = `<h1>${esc(title)}</h1><p>${esc(desc)}</p>${kunye}${tahminP}` +
    (satirlar.length ? `<h2>İlgili Sayfalar</h2><ul>${satirlar.join('')}</ul>` : '') +
    siteNavHtml(origin)

  return htmlDoc({ title, desc, url, img, jsonLd, body, robots: macDizinDisi(row) ? 'noindex, follow' : '' })
}

// Haberde Türk takımı var mı: maçta takım ID'leri, transferde ekler'deki ID'ler,
// haftalıkta varyant. ID'siz eski transferlerde link çıkmaz.
async function turkHaberiMi(ref, row) {
  if (ref.type === 'haftalik') return row.variant === 'turk_haftasi'
  let ids = []
  if (ref.type === 'match') {
    const m = await sbFetch(`matches?id=eq.${ENC(ref.id)}&select=team_a_id,team_b_id&limit=1`)
    ids = [m?.team_a_id, m?.team_b_id]
  } else if (ref.type === 'transfer') {
    ids = [row.ekler?.eski_takim_id, row.ekler?.yeni_takim_id]
  } else {
    return false
  }
  ids = ids.map(Number).filter(Number.isFinite)
  if (ids.length) {
    const tr = await sbFetchAll(`turk_takimlar?team_id=in.(${ids.join(',')})&select=team_id`)
    return tr.length > 0
  }
  return false
}

async function buildForNews(ref, origin, url) {
  const sel = 'title,summary,hero_score,game_slug,tier,tournament_name,team_a_name,team_b_name,team_a_logo,team_b_logo,created_at,ekler,variant'
  let query
  if (ref.type === 'transfer' || ref.type === 'haftalik') {
    query = `news_articles?id=eq.${encodeURIComponent(ref.id)}&select=${encodeURIComponent(sel)}&limit=1`
  } else if (ref.type === 'tournament') {
    query = `news_articles?content_type=eq.tournament&tournament_id=eq.${encodeURIComponent(ref.id)}&select=${encodeURIComponent(sel)}&order=created_at.desc&limit=1`
  } else {
    query = `news_articles?match_id=eq.${encodeURIComponent(ref.id)}&variant=neq.preview&select=${encodeURIComponent(sel)}&order=created_at.desc&limit=1`
  }
  let row = await sbBul(query)
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
    row = await sbBul(
      `news_articles?match_id=eq.${ENC(ref.id)}&select=${ENC(sel)}&order=created_at.desc&limit=1`,
    )
  }
  if (!row) {
    // Haberi olmayan maçta SPA maç verisinden sayfa kuruyor (NewsDetailPage) →
    // maç varsa kabuğa düş (eski davranış), maç da yoksa gerçekten 404.
    if (ref.type !== 'match') return YOK
    const mac = await sbBul(`matches?id=eq.${ENC(ref.id)}&select=id&limit=1`)
    return mac ? null : YOK
  }
  const gm = gameMeta(row.game_slug)
  // Maçlardaki OG_FRESH_DAYS kuralı haberlere de (22 Eyl). Haberde tarih sınırı
  // YOKTU: 1.300+ haberin her biri bot geldiğinde ~1,7 sn CPU'luk kart üretiyordu
  // ve Vercel Fluid Active CPU ücretsiz kotası (4 sa/ay) 22 Eylül'de %75'e dayandı.
  // Eski haber paylaşılmıyor → statik marka kartı, CDN'den, 0 CPU.
  // Haftalık özette takım yok → takım kartı boş çıkardı; statik marka kartı.
  const img = ref.type !== 'haftalik' && isShareableMatch(row.created_at)
    ? await ogImageUrl(origin, {
        a: row.team_a_name, b: row.team_b_name, la: row.team_a_logo, lb: row.team_b_logo,
        s: scoreFromHero(row.hero_score), g: gm.label, t: row.tier, tn: row.tournament_name, c: gm.accent,
      })
    : `${origin}${STATIC_OG}`
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
  } else if (ref.type === 'transfer') {
    const e = row.ekler || {}
    if (e.eski_takim_id) linkItems.push(`<a href="${origin}/team/${ENC(e.eski_takim_id)}">${esc(row.team_a_name || 'Eski takım')}</a>`)
    if (e.yeni_takim_id) linkItems.push(`<a href="${origin}/team/${ENC(e.yeni_takim_id)}">${esc(row.team_b_name || 'Yeni takım')}</a>`)
    if (e.oyuncu_id) linkItems.push(`<a href="${origin}/player/${ENC(e.oyuncu_id)}">${esc(row.hero_score || 'Oyuncu')} profili</a>`)
  } else if (ref.type === 'haftalik') {
    // Haftanın maçları: Googlebot her maç sayfasına buradan da ulaşır
    const ids = [...(row.ekler?.maclar || []), ...(row.ekler?.gelecek || [])].map(Number).filter(Number.isFinite)
    if (ids.length) {
      const maclar = await sbFetchAll(`matches?id=in.(${ids.join(',')})&select=${ENC(MATCH_SEL)}`)
      const sira = new Map(maclar.map(m => [m.id, m]))
      for (const mid of ids) {
        const m = sira.get(mid)
        if (!m) continue
        const skor = m.team_a_score != null && m.team_b_score != null ? ` ${m.team_a_score}-${m.team_b_score}` : ''
        linkItems.push(`<a href="${origin}/match/${m.id}">${esc(m.team_a?.name || 'Takım A')}${skor} ${esc(m.team_b?.name || 'Takım B')}</a>`)
      }
    }
  }
  // Türk takımı haberi → /turk-takimlari (merkez sayfa her haberden link alarak büyür)
  if (await turkHaberiMi(ref, row)) {
    linkItems.push(`<a href="${origin}/turk-takimlari">Türk takımları: maçlar, sonuçlar ve haberler</a>`)
  }
  const body = `<h1>${esc(row.title || 'feXt')}</h1><p>${esc(row.summary || '')}</p>` +
    (linkItems.length ? `<h2>İlgili Sayfalar</h2><ul>${linkItems.map(l => `<li>${l}</li>`).join('')}</ul>` : '')
  return htmlDoc({ title: row.title || 'feXt', desc: row.summary || '', url, img, jsonLd, body })
}

const ENC = encodeURIComponent
const MATCH_SEL = 'id,team_a_score,team_b_score,scheduled_at,team_a:teams!matches_team_a_id_fkey(name),team_b:teams!matches_team_b_id_fkey(name)'

async function buildForTeam(id, origin, url) {
  const team = await sbBul(`teams?id=eq.${ENC(id)}&select=${ENC('name,logo_url,game:games(name,slug)')}&limit=1`)
  if (!team) return YOK
  const name = team.name || 'Takım'
  const gm = gameMeta(team.game?.slug)
  const matches = await sbFetchAll(`matches?or=(team_a_id.eq.${ENC(id)},team_b_id.eq.${ENC(id)})&status=eq.finished&select=${ENC(MATCH_SEL)}&order=scheduled_at.desc&limit=10`)
  // Başlık "Kadro, Maçlar ve İstatistikler" vaat ediyordu ama gövdede ne kadro
  // ne istatistik vardı: 77 kelime ve 10 linkin hepsi maça gidiyordu, oyuncu
  // sayfalarına TEK link yoktu (ölçüldü 12 Eylül 2026). Hem vaat tutmuyordu
  // hem de oyuncu sayfaları iç linkten tamamen yoksundu.
  // NOT: players↔teams arasında FK yok; players.team_pandascore_id === teams.id.
  const kadro = await sbFetchAll(
    `players?team_pandascore_id=eq.${ENC(id)}&select=${ENC('id,nickname,role')}&limit=12`,
  )
  // Galibiyet dökümü zaten çekilmiş maçlardan hesaplanır; ekstra sorgu yok.
  let galip = 0, maglup = 0
  for (const m of matches) {
    if (m.team_a_score == null || m.team_b_score == null) continue
    const bizA = String(m.team_a?.name || '') === String(name)
    const bizim = bizA ? m.team_a_score : m.team_b_score
    const rakip = bizA ? m.team_b_score : m.team_a_score
    if (bizim > rakip) galip++
    else if (bizim < rakip) maglup++
  }
  const dokum = (galip + maglup) > 0
    ? `Son ${galip + maglup} maçta ${galip} galibiyet, ${maglup} yenilgi.` : ''

  const title = `${name} — Kadro, Maçlar ve İstatistikler`
  const desc = `${name} espor takımı (${gm.label}): ` +
    `${dokum ? dokum + ' ' : ''}Kadro, son maç sonuçları ve oyuncu istatistikleri — feXt.`
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'SportsTeam', name, sport: 'Esports',
    logo: team.logo_url || undefined, url,
    athlete: kadro.length
      ? kadro.map(o => ({ '@type': 'Person', name: o.nickname || 'Oyuncu' }))
      : undefined,
  }
  const kadroHtml = kadro.length
    ? `<h2>Kadro</h2><ul>${kadro.map(o =>
        `<li><a href="${origin}/player/${o.id}">${esc(o.nickname || 'Oyuncu')}</a>` +
        `${o.role ? ` — ${esc(o.role)}` : ''}</li>`).join('')}</ul>`
    : ''
  const body = `<h1>${esc(name)}</h1><p>${esc(desc)}</p>` +
    `${kadroHtml}${matchListHtml(origin, matches, 'Son Maçlar')}`
  return htmlDoc({ title, desc, url, img: '', type: 'profile', jsonLd, body })
}

async function buildForPlayer(id, origin, url) {
  // NOT: players↔teams FK yok; players.team_pandascore_id === teams.id (ayrı sorgu).
  const p = await sbBul(`players?id=eq.${ENC(id)}&select=${ENC('nickname,role,nationality,image_url,team_pandascore_id')}&limit=1`)
  if (!p) return YOK
  const nick = p.nickname || 'Oyuncu'
  let team = null
  if (p.team_pandascore_id != null) {
    team = await sbFetch(`teams?id=eq.${ENC(p.team_pandascore_id)}&select=id,name&limit=1`)
  }
  const teamName = team?.name
  // ---- Gerçek maç istatistikleri --------------------------------------
  // ÖLÇÜLDÜ (12 Eylül 2026): oyuncu sayfaları bot'a 27 KELİME ve 1 link
  // dönüyördu — salt kalıp cümle, tek bir sayı yok. Oyuncu sayfaları
  // 25 Ağustos'ta tam bu yüzden sitemap'ten çıkarılmıştı ("ince içerik").
  // Artık player_match_stats dolu (6.330 satır / 340 oyuncu) → sayfa gerçek
  // sayı taşıyabilir. Toplama PostgREST'te değil JS'te yapılıyor: RPC eklemek
  // şema değişikliği gerektirirdi, bot yanıtları zaten 24 saat önbellekli.
  const satir = await sbFetchAll(
    `player_match_stats?player_id=eq.${ENC(id)}` +
    `&select=${ENC('match_id,kills,deaths,assists,is_win,hs_percentage,played_at')}` +
    `&order=played_at.desc&limit=1000`,
  )
  let ist = null
  if (satir.length) {
    const maclar = new Set()
    let k = 0, d = 0, a = 0, hsTop = 0, hsAdet = 0
    const macKazanc = new Map()
    for (const r of satir) {
      if (r.match_id != null) maclar.add(r.match_id)
      k += Number(r.kills) || 0
      d += Number(r.deaths) || 0
      a += Number(r.assists) || 0
      if (r.hs_percentage != null) { hsTop += Number(r.hs_percentage); hsAdet++ }
      if (r.match_id != null && r.is_win != null && !macKazanc.has(r.match_id)) {
        macKazanc.set(r.match_id, r.is_win)
      }
    }
    const galip = [...macKazanc.values()].filter(Boolean).length
    // NOT: player_match_stats maç başına TEK satır tutar (6.330 satırın
    // tümü oyuncu+maç başına 1). Yani "harita" diye ayrı bir sayı YOK;
    // öyle yazmak sayfada olmayan bir kırılımı vaat etmek olurdu.
    ist = {
      mac: maclar.size,
      k, d, a,
      kd: d > 0 ? (k / d).toFixed(2) : String(k),
      kazanmaOrani: macKazanc.size ? Math.round((100 * galip) / macKazanc.size) : null,
      hs: hsAdet ? Math.round(hsTop / hsAdet) : null,
      sonMaclar: [...maclar].slice(0, 5),
    }
  }

  const title = ist
    ? `${nick} — ${ist.mac} Maç İstatistiği, KDA ve Kazanma Oranı`
    : `${nick} — Espor Oyuncu Profili`
  const desc = ist
    ? `${nick}${teamName ? ` (${teamName})` : ''}: ${ist.mac} maçta ` +
      `${ist.k} kill / ${ist.d} ölüm / ${ist.a} asist, K/D ${ist.kd}` +
      `${ist.kazanmaOrani != null ? `, kazanma oranı %${ist.kazanmaOrani}` : ''}` +
      `${ist.hs != null ? `, kafa vuruşu %${ist.hs}` : ''}. Maç bazında istatistikler — feXt.`
    : `${nick}${teamName ? ` (${teamName})` : ''} espor oyuncu profili: rol, KDA, kazanma oranı, kariyer ve istatistikler — feXt.`
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Person', name: nick, jobTitle: 'Espor Oyuncusu',
    nationality: p.nationality || undefined, image: p.image_url || undefined,
    memberOf: teamName ? { '@type': 'SportsTeam', name: teamName } : undefined, url,
  }
  const teamLink = team?.id ? `<p>Takım: <a href="${origin}/team/${team.id}">${esc(teamName)}</a></p>` : ''

  let istBlok = ''
  if (ist) {
    const sat = [
      ['Oynanan maç', ist.mac],
      ['Kill / Ölüm / Asist', `${ist.k} / ${ist.d} / ${ist.a}`],
      ['K/D oranı', ist.kd],
    ]
    if (ist.kazanmaOrani != null) sat.push(['Kazanma oranı', `%${ist.kazanmaOrani}`])
    if (ist.hs != null) sat.push(['Kafa vuruşu oranı', `%${ist.hs}`])
    istBlok = `<h2>Maç İstatistikleri</h2><ul>${
      sat.map(([kk, vv]) => `<li>${esc(kk)}: ${esc(String(vv))}</li>`).join('')
    }</ul>`
    // Bağlantı metinleri BENZERSİZ olmalı: beş linkin de üzerinde "Maç detayı"
    // yazması hem okuyucuya hiçbir şey söylemiyor hem de arama motoruna hepsi
    // aynı sayfaymış sinyali veriyor. Takım adlarını çekip yazıyoruz.
    if (ist.sonMaclar.length) {
      const macSat = await sbFetchAll(
        `matches?id=in.(${ist.sonMaclar.join(',')})` +
        `&select=${ENC('id,team_a_score,team_b_score,scheduled_at,' +
          'team_a:teams!matches_team_a_id_fkey(name),team_b:teams!matches_team_b_id_fkey(name)')}`,
      )
      const macAdi = new Map(macSat.map(m => {
        const an = m.team_a?.name || '?', bn = m.team_b?.name || '?'
        const sk = (m.team_a_score != null && m.team_b_score != null)
          ? `${m.team_a_score}-${m.team_b_score}` : 'vs'
        const tr = trTarih(m.scheduled_at)
        return [String(m.id), `${an} ${sk} ${bn}${tr ? ` · ${tr}` : ''}`]
      }))
      const ogeler = ist.sonMaclar
        .map(mid => {
          const ad = macAdi.get(String(mid))
          return ad ? `<li><a href="${origin}/match/${mid}">${esc(ad)}</a></li>` : ''
        })
        .filter(Boolean)
      if (ogeler.length) istBlok += `<h2>Son Maçlar</h2><ul>${ogeler.join('')}</ul>`
    }
  }

  const body = `<h1>${esc(nick)}</h1><p>${esc(desc)}</p>` +
    `${p.role ? `<p>Rol: ${esc(p.role)}</p>` : ''}${teamLink}${istBlok}` +
    siteNavHtml(origin)
  return htmlDoc({ title, desc, url, img: '', type: 'profile', jsonLd, body })
}

async function buildForTournament(id, origin, url) {
  const t = await sbBul(
    `tournaments?id=eq.${ENC(id)}` +
    `&select=${ENC('name,tier,begin_at,end_at,league_name,event_name,display_name')}&limit=1`,
  )
  if (!t) return YOK
  const name = turnuvaAdi(t, true) || t.name || 'Turnuva'
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
  // Kalıcı lig sayfasına bağlantı: eski etkinlikte "Güncel: …", güncelde "Tüm aşamalar: …"
  // → Google "worlds fikstür" gibi sorguda eski aşamadan yeni lig sayfasına geçer.
  // Yan veri: hata olursa bağlantısız döner (sbFetch).
  const lig = await sbFetch(`rpc/turnuva_ligi?p_tid=${ENC(id)}`).catch(() => null)
  const ligLink = lig?.slug
    ? `<p><a href="${origin}/lig/${esc(lig.slug)}">${lig.guncel ? 'Tüm aşamalar' : 'Güncel'}: ` +
      `${esc([lig.ad, lig.yil].filter(Boolean).join(' '))} fikstür, puan durumu ve sonuçlar</a></p>`
    : ''
  const body = `<h1>${esc(name)}</h1>${ligLink}<p>${esc(desc)}</p>${matchListHtml(origin, matches, 'Maçlar')}`
  return htmlDoc({ title, desc, url, img: '', type: 'article', jsonLd, body })
}

/* ── Kalıcı lig sayfası (/lig/<slug>) ──────────────────────────────────────
 * Ligin EN GÜNCEL etkinliğinin tüm aşamaları tek sayfada (backend/sql/ligler.sql
 * `lig_sayfasi`). Başlık "<Lig> <yıl> Fikstür, Puan Durumu ve Sonuçlar": aranan kalıp.
 * Aşama başına puan durumu (grup/lig aşamalarında), fikstür (tarihli) ve sonuçlar.
 */
const LIG_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const LIG_MAC_SEL = 'id,tournament_id,status,scheduled_at,team_a_score,team_b_score,winner_id,' +
  'team_a:teams!matches_team_a_id_fkey(id,name),team_b:teams!matches_team_b_id_fkey(id,name)'
// Eleme aşamasında G-M tablosu anlamsız (herkes 1-2 maç oynar)
const ELEME_ASAMA_RE = /play-?offs?|knockout|bracket|final|elimination/i

// PandaScore results[] sırası opponents[] ile aynı değil: kazananın skoru küçükse çevir
function macSkoru(m) {
  let a = m.team_a_score, b = m.team_b_score
  if (a == null || b == null) return null
  const w = m.winner_id
  if (w != null && a !== b && ((w === m.team_a?.id && a < b) || (w === m.team_b?.id && b < a))) [a, b] = [b, a]
  return [a, b]
}

function ligMacLi(origin, m, skorlu) {
  const an = esc(m.team_a?.name || '?'), bn = esc(m.team_b?.name || '?')
  const sk = skorlu ? macSkoru(m) : null
  const orta = sk ? ` ${sk[0]}-${sk[1]} ` : ' vs '
  const tarih = trTarih(m.scheduled_at)
  return `<li><a href="${origin}/match/${m.id}">${an}${orta}${bn}</a>${tarih ? ` — ${tarih}` : ''}</li>`
}

function puanDurumuHtml(maclar) {
  const tablo = new Map()
  const satir = t => {
    if (!tablo.has(t.id)) tablo.set(t.id, { ad: t.name, g: 0, m: 0 })
    return tablo.get(t.id)
  }
  for (const m of maclar) {
    if (m.status !== 'finished' || !m.team_a?.id || !m.team_b?.id) continue
    const sk = macSkoru(m)
    let kazanan = m.winner_id
    if (kazanan == null && sk && sk[0] !== sk[1]) kazanan = sk[0] > sk[1] ? m.team_a.id : m.team_b.id
    if (kazanan == null) continue
    const [k, y] = kazanan === m.team_a.id ? [m.team_a, m.team_b] : [m.team_b, m.team_a]
    satir(k).g++
    satir(y).m++
  }
  if (!tablo.size) return ''
  const sirali = [...tablo.values()].sort((x, y) => y.g - x.g || x.m - y.m || String(x.ad).localeCompare(String(y.ad)))
  return `<h3>Puan durumu</h3><table><thead><tr><th>Sıra</th><th>Takım</th><th>G</th><th>M</th></tr></thead><tbody>${
    sirali.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.ad)}</td><td>${r.g}</td><td>${r.m}</td></tr>`).join('')
  }</tbody></table>`
}

async function buildForLig(slug, origin, url) {
  const lig = await sbBul(`rpc/lig_sayfasi?p_slug=${ENC(slug)}`)
  if (!lig) return YOK
  const turnuvalar = Array.isArray(lig.turnuvalar) ? lig.turnuvalar : []
  const idler = turnuvalar.map(t => t.id).filter(Number.isFinite)
  const [maclar, turkler] = idler.length
    ? await Promise.all([
        sbFetchAll(`matches?tournament_id=in.(${idler.join(',')})&select=${ENC(LIG_MAC_SEL)}&order=scheduled_at.asc&limit=600`),
        sbFetchAll('turk_takimlar?select=team_id'),
      ])
    : [[], []]

  const baslik = [lig.ad, lig.yil].filter(Boolean).join(' ')
  const etkinlik = turnuvaAdi({ league_name: lig.league_name, event_name: lig.etkinlik }, false) || baslik
  const title = `${baslik} Fikstür, Puan Durumu ve Sonuçlar`
  const asamaAdlari = turnuvalar.map(t => t.name).filter(Boolean).join(', ')
  const desc = `${etkinlik} fikstürü, puan durumu ve maç sonuçları` +
    `${asamaAdlari ? `: ${asamaAdlari}` : ''}. Tüm aşamalar tek sayfada — feXt.`

  // Türk takımları (turk_takimlar, TEK KAYNAK) — Türkçe sitenin ayrıştığı yer
  const turkId = new Set(turkler.map(r => r.team_id))
  const turkTakim = new Map()
  for (const m of maclar) {
    for (const t of [m.team_a, m.team_b]) if (t?.id && turkId.has(t.id)) turkTakim.set(t.id, t.name)
  }
  const turkHtml = turkTakim.size
    ? `<h2>Bu etkinlikteki Türk takımları</h2><ul>${
      [...turkTakim.entries()].map(([id, ad]) => `<li><a href="${origin}/team/${id}">${esc(ad)}</a></li>`).join('')
    }</ul>`
    : ''

  const asamaHtml = turnuvalar.map(t => {
    const am = maclar.filter(m => m.tournament_id === t.id)
    const fikstur = am.filter(m => m.status === 'not_started' || m.status === 'running')
    const sonuc = am.filter(m => m.status === 'finished').reverse()
    const tarih = [trTarih(t.begin_at), trTarih(t.end_at)].filter(Boolean).join(' – ')
    return `<section><h2><a href="${origin}/tournament/${t.id}">${esc(t.name || 'Aşama')}</a></h2>` +
      (tarih ? `<p>${esc(tarih)}</p>` : '') +
      (ELEME_ASAMA_RE.test(t.name || '') ? '' : puanDurumuHtml(am)) +
      (fikstur.length ? `<h3>Fikstür</h3><ul>${fikstur.map(m => ligMacLi(origin, m, m.status === 'running')).join('')}</ul>` : '') +
      (sonuc.length ? `<h3>Sonuçlar</h3><ul>${sonuc.map(m => ligMacLi(origin, m, true)).join('')}</ul>` : '') +
      (!am.length ? '<p>Bu aşamanın maçları henüz açıklanmadı.</p>' : '') +
      `</section>`
  }).join('')

  const gecmis = Array.isArray(lig.gecmis) ? lig.gecmis : []
  const gecmisHtml = gecmis.length
    ? `<h2>Önceki etkinlikler</h2><ul>${gecmis.map(g =>
      `<li><a href="${origin}/tournament/${ENC(g.turnuva_id)}">${esc(turnuvaAdi({ league_name: lig.league_name, event_name: g.etkinlik }, false))}</a></li>`,
    ).join('')}</ul>`
    : ''

  const jsonLd = lig.baslangic ? {
    '@context': 'https://schema.org', '@type': 'SportsEvent', name: etkinlik, sport: 'Esports',
    ...eventCommon(url, lig.baslangic, desc, ''),
    endDate: lig.bitis || undefined, url,
  } : null
  const body = `<h1>${esc(title)}</h1><p>${esc(desc)}</p>${turkHtml}${asamaHtml}${gecmisHtml}${siteNavHtml(origin)}`
  // Tanımlı ama etkinliği olmayan lig: sayfa açık kalır, dizine girmez
  return htmlDoc({ title, desc, url, img: `${origin}${STATIC_OG}`, type: 'website', jsonLd, body,
    robots: turnuvalar.length ? '' : 'noindex, follow' })
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
    feed: 'stats',
  },
  '/players': {
    title: 'Oyuncular — Espor Oyuncu Profilleri ve İstatistikleri',
    desc: 'VALORANT, CS2 ve LoL oyuncularının profilleri, takımları ve maç istatistikleri.',
    heading: 'Oyuncu profilleri',
    feed: 'players',
  },
  '/news/archive': {
    title: 'Haber Arşivi — Geçmiş Espor Haberleri',
    desc: 'feXt haber arşivi: geçmiş transferler, kadro değişiklikleri ve maç analizleri.',
    heading: 'Haber arşivi',
    feed: 'news',
  },
  // Başlıkta takım adları: okur Türk takımını adıyla arar. Yalnız metin: Türk takımı
  // TESPİTİ yine turk_takimlar'dan. TurkTakimlariPage.jsx SeoHead'iyle aynı tutulur.
  '/turk-takimlari': {
    title: 'Türk Espor Takımları: BBL, Eternal Fire, FUT, Galatasaray Maçları',
    desc: 'BBL Esports, Eternal Fire, FUT Esports, Galatasaray Esports ve diğer Türk takımlarının VALORANT, CS2 ve LoL maç programı, sonuçları, kadro ve transfer haberleri tek sayfada.',
    heading: 'Türk takımları',
    feed: 'turk',
  },
  '/scout': {
    title: 'Scout — VALORANT Oyuncu Karşılaştırma',
    desc: 'Profesyonel VALORANT oyuncularını yan yana karşılaştır: K/D, harita başına kill, galibiyet oranı, son 5 maç formu, ajan ve harita havuzu.',
    heading: 'VALORANT oyuncu karşılaştırma',
    feed: 'scout',
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
    ['/turk-takimlari', 'Türk takımları'],
    ['/stats', 'Fextopus isabet oranları'],
  ]
  return `<nav><h2>feXt bölümleri</h2><ul>${
    links.map(([p, t]) => `<li><a href="${origin}${p}">${esc(t)}</a></li>`).join('')
  }</ul></nav>`
}

async function staticFeedHtml(feed, origin) {
  try {
    // /stats — EN AYIRT EDİCİ İÇERİĞİMİZ. ÖLÇÜLDÜ (12 Eylül 2026): bot'a
    // 47 kelime gidiyordu, tek bir sayı yok. Oysa tahmin sicilini bu şeffaflıkla
    // yayınlayan neredeyse kimse yok; sayfanın değeri tam olarak o sayılar.
    // get_prediction_accuracy STABLE olduğu için PostgREST GET ile çağrılabiliyor.
    if (feed === 'stats') {
      const base = process.env.VITE_SUPABASE_URL
      const key = process.env.VITE_SUPABASE_ANON_KEY
      if (!base || !key) return ''
      const res = await fetch(`${base}/rest/v1/rpc/get_prediction_accuracy?days_back=0`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      })
      if (!res.ok) return ''
      const a = await res.json()
      if (!a || a.total == null) return ''
      const tr = n => Number(n).toLocaleString('tr-TR')
      return `<h2>Fextopus isabet oranları</h2><ul>` +
        `<li>Değerlendirilen maç: ${tr(a.total)}</li>` +
        `<li>Doğru tahmin: ${tr(a.correct)}</li>` +
        `<li>Genel isabet oranı: %${String(a.accuracy_pct).replace('.', ',')}</li>` +
        `<li>Emin katman (favori olasılığı %65 ve üzeri): ${tr(a.confident_total)} maçta ` +
        `%${String(a.confident_pct).replace('.', ',')} isabet</li>` +
        `</ul><p>Oranlar sonuçlanmış maçlar üzerinde canlı hesaplanır; 50/50 biten ` +
        `tahminler hariç tutulur.</p>`
    }

    // /players — istatistiği olan oyunculara iç link. Oyuncu sayfaları 12 Eylül'de
    // sitemap'e geri alındı; liste sayfasından da linklenmezlerse yalnız sitemap'e
    // kalmış olurlardı ve iç link derinliği sıfır olurdu.
    if (feed === 'players') {
      const sat = await sbFetchAll(
        `player_match_stats?select=${ENC('player_id,played_at')}&order=played_at.desc&limit=1000`,
      )
      const sayac = new Map()
      for (const r of sat) {
        if (r.player_id) sayac.set(r.player_id, (sayac.get(r.player_id) || 0) + 1)
      }
      const idler = [...sayac.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40).map(([id]) => id)
      if (!idler.length) return ''
      const oyuncular = await sbFetchAll(
        `players?id=in.(${idler.join(',')})&select=${ENC('id,nickname')}`,
      )
      if (!oyuncular.length) return ''
      return `<h2>İstatistikli oyuncu profilleri</h2><ul>${
        oyuncular.map(o => `<li><a href="${origin}/player/${o.id}">${esc(o.nickname || 'Oyuncu')} ` +
          `maç istatistikleri</a></li>`).join('')
      }</ul>`
    }

    // /scout — VALORANT karşılaştırma aracı (13 Eyl). Arayüzle aynı RPC; STABLE
    // olduğu için GET ile çağrılabiliyor. Bot, K/D sıralamasını ve oyuncu linklerini görür.
    if (feed === 'scout') {
      const rows = await sbFetchAll('rpc/get_scout_players?p_min_matches=10')
      const liste = rows
        .filter(p => p.deaths > 0 && p.maps_played > 0)
        .map(p => ({ ...p, kd: p.kills / p.deaths, kpm: p.kills / p.maps_played }))
        .sort((a, b) => b.kd - a.kd)
        .slice(0, 20)
      if (!liste.length) return ''
      const ondalik = (n, h) => n.toFixed(h).replace('.', ',')
      return `<h2>K/D sıralaması (en az 10 maç)</h2><ol>${
        liste.map(p => `<li><a href="${origin}/player/${p.id}">${esc(p.nickname)}</a>` +
          `${p.team_name ? ` (${esc(p.team_name)})` : ''}: K/D ${ondalik(p.kd, 2)}, ` +
          `harita başına ${ondalik(p.kpm, 1)} kill, ${p.matches} maç</li>`).join('')
      }</ol>` +
        `<p>${rows.length} oyuncu en az 10 maç verisine sahip. Kill, ölüm, asist ve galibiyet ` +
        `maç toplamlarından hesaplanır; rol, ajan ve harita havuzu harita bazındadır. ` +
        `<a href="${origin}/players">Tüm oyuncu profilleri</a>.</p>`
    }

    // /turk-takimlari — takım listesi turk_takimlar görünümünden (TEK KAYNAK, SPA ile aynı)
    if (feed === 'turk') {
      const ids = (await sbFetchAll('turk_takimlar?select=team_id')).map(r => r.team_id).filter(Number.isFinite)
      if (!ids.length) return ''
      const liste = ids.join(',')
      const TURK_MAC_SEL = MATCH_SEL + ',team_a_id,team_b_id,status'
      const takimFiltresi = ENC(`(team_a_id.in.(${liste}),team_b_id.in.(${liste}))`)
      const simdi = Date.now()
      const son60 = `matches?or=${takimFiltresi}&status=eq.finished` +
        `&scheduled_at=gte.${ENC(new Date(simdi - 60 * 86400000).toISOString())}&order=scheduled_at.desc`
      const [takimlar, yaklasan, son, oynayanlar, haftalik] = await Promise.all([
        sbFetchAll(`teams?id=in.(${liste})&select=${ENC('id,name,game:games(slug)')}`),
        sbFetchAll(`matches?or=${takimFiltresi}&status=in.(not_started,running)` +
          `&scheduled_at=gte.${ENC(new Date(simdi - 6 * 3600000).toISOString())}` +
          `&select=${ENC(TURK_MAC_SEL)}&order=scheduled_at.asc&limit=15`),
        sbFetchAll(`${son60}&select=${ENC(TURK_MAC_SEL)}&limit=20`),
        // Aktif takım kümesi için 60 günün TAMAMI (yalnız kimlik): son 80 maç ancak ~2 haftaya
        // yetiyordu, Galatasaray gibi iki haftadır oynamayan takım listeden düşüyordu.
        sbFetchAll(`${son60}&select=team_a_id,team_b_id&limit=1000`),
        sbFetchAll(`news_articles?content_type=eq.haftalik&variant=eq.turk_haftasi&select=${NEWS_LINK_SEL}&order=created_at.desc&limit=10`),
      ])
      // Haberde takım ID'si yok, ad var (haber üretimi adı teams.name'den aynen yazar)
      const adlar = [...new Set(takimlar.map(t => t.name).filter(Boolean))]
        .map(a => `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')
      const haberler = adlar
        ? await sbFetchAll(`news_articles?or=${ENC(`(team_a_name.in.(${adlar}),team_b_name.in.(${adlar}))`)}` +
            `&content_type=neq.haftalik&select=${NEWS_LINK_SEL}&order=created_at.desc&limit=15`)
        : []
      // Izgara SPA'daki gibi: yalnız son 60 günde oynamış ya da maçı olan takımlar
      const aktif = new Set([...yaklasan, ...oynayanlar].flatMap(m => [m.team_a_id, m.team_b_id]))
      const aktifTakimlar = takimlar.filter(t => aktif.has(t.id))
      const haberHtml = (rows, baslik) => {
        const li = rows.map(n => ({ n, yol: newsPath(n) })).filter(x => x.yol)
          .map(({ n, yol }) => `<li><a href="${origin}${yol}">${esc(n.title)}</a></li>`).join('')
        return li ? `<h2>${esc(baslik)}</h2><ul>${li}</ul>` : ''
      }
      // Oyuna göre gruplu: "Türk VALORANT takımları" gibi başlıklar aramadaki kalıbın kendisi
      const OYUN_BASLIK = [['valorant', 'Türk VALORANT takımları'], ['csgo', 'Türk CS2 takımları'],
        ['lol', 'Türk League of Legends takımları'], [null, 'Diğer Türk takımları']]
      const oyunu = t => (['valorant', 'csgo', 'lol'].includes(t.game?.slug) ? t.game.slug : null)
      const takimHtml = OYUN_BASLIK.map(([slug, baslik]) => {
        const grup = aktifTakimlar.filter(t => oyunu(t) === slug)
        return grup.length ? `<h2>${esc(baslik)}</h2><ul>${
          grup.map(t => `<li><a href="${origin}/team/${t.id}">${esc(String(t.name).trim())}</a></li>`).join('')
        }</ul>` : ''
      }).join('')
      return takimHtml +
        // Başlamamış maçta skor 0-0 gelir; "vs" yazılsın
        matchListHtml(origin, yaklasan.map(m => (m.status === 'not_started' ? { ...m, team_a_score: null, team_b_score: null } : m)), 'Yaklaşan Türk maçları') +
        matchListHtml(origin, son.slice(0, 20), 'Son sonuçlar') +
        haberHtml(haberler, 'Türk takımı haberleri') +
        haberHtml(haftalik, 'Türk Espor Haftası arşivi')
    }

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
      const [rows, ligler] = await Promise.all([
        sbFetchAll(`tournaments?tier=in.(S,s,A,a)&select=${ENC('id,name,tier,league_name,event_name,display_name')}&order=begin_at.desc&limit=25`),
        sbFetchAll('rpc/lig_listesi'),
      ])
      const ligHtml = ligler.length
        ? `<h2>Ligler — güncel fikstür ve puan durumu</h2><ul>${ligler.map(l =>
          `<li><a href="${origin}/lig/${esc(l.slug)}">${esc([l.ad, l.yil].filter(Boolean).join(' '))} fikstür ve puan durumu</a></li>`,
        ).join('')}</ul>`
        : ''
      if (!rows.length) return ligHtml
      return ligHtml + `<h2>Turnuvalar</h2><ul>${
        rows.map(t => `<li><a href="${origin}/tournament/${t.id}">${esc(turnuvaAdi(t, true) || t.name)}${t.tier ? ` (${esc(String(t.tier).toUpperCase())}-Tier)` : ''}</a></li>`).join('')
      }</ul>`
    }
    if (feed === 'news') {
      const rows = await sbFetchAll(
        `news_articles?select=${NEWS_LINK_SEL}&order=created_at.desc&limit=25`,
      )
      if (!rows.length) return ''
      return `<h2>Son haberler</h2><ul>${
        rows.map(n => ({ n, yol: newsPath(n) })).filter(x => x.yol)
          .map(({ n, yol }) => `<li><a href="${origin}${yol}">${esc(n.title)}</a></li>`).join('')
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

  // Eski haber linki `/news/<haber uuid>` (24 Eki öncesi bot HTML'i) → slug'lı adrese 301.
  // Bot ve insan için: SPA uuid'i çözemiyor. Haber yoksa bota 404 (aşağıda), insana SPA.
  const eskiHaber = url.pathname.match(/^\/news\/([^/]+)\/?$/)
  if (eskiHaber && UUID_RE.test(eskiHaber[1])) {
    try {
      const row = await sbBul(`news_articles?id=eq.${ENC(eskiHaber[1])}&select=${ENC(NEWS_LINK_SEL)}&limit=1`)
      const yol = row && newsPath(row)
      if (yol) {
        return new Response(null, {
          status: 301,
          headers: { location: SITE_ORIGIN + yol, 'cache-control': 'public, max-age=86400' },
        })
      }
      if (!row && (force || BOT_RE.test(ua))) {
        return new Response(bulunamadiHtml(SITE_ORIGIN), {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=3600' },
        })
      }
    } catch {
      // geçici arıza → 404 değil, SPA
    }
    return next()
  }

  if (!force && !BOT_RE.test(ua)) return next() // gerçek kullanıcı → SPA
  if (!force && DEGERSIZ_BOT_RE.test(ua)) return next() // ziyaretçi getirmeyen bot → statik kabuk

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
      // Biçimi tutmayan kimlik (ör. /match/abc) PostgREST'te 400 → sbBul fırlatır →
      // 200 kabuk olurdu; sorgusuz 404.
      if (seg) html = SAYI_RE.test(seg) ? await buildForMatch(seg, SITE_ORIGIN, canon) : YOK
    } else if (path.startsWith('/news/') && path !== '/news/archive') {
      if (seg) {
        const ref = parseNewsRef(seg)
        html = ref ? await buildForNews(ref, SITE_ORIGIN, canon) : YOK
      }
    } else if (path.startsWith('/team/')) {
      if (seg) html = SAYI_RE.test(seg) ? await buildForTeam(seg, SITE_ORIGIN, canon) : YOK
    } else if (path.startsWith('/player/')) {
      if (seg) html = UUID_RE.test(seg) ? await buildForPlayer(seg, SITE_ORIGIN, canon) : YOK
    } else if (path.startsWith('/tournament/')) {
      if (seg) html = SAYI_RE.test(seg) ? await buildForTournament(seg, SITE_ORIGIN, canon) : YOK
    } else if (path.startsWith('/lig/')) {
      if (seg) html = LIG_SLUG_RE.test(seg) ? await buildForLig(seg, SITE_ORIGIN, canon) : YOK
    }

    if (html === YOK) {
      return new Response(bulunamadiHtml(SITE_ORIGIN), {
        status: 404,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          // Kısa önbellek: yeni eklenen varlık (ör. sonradan senkronlanan maç) uzun süre 404 kalmasın.
          'cache-control': 'public, max-age=300, s-maxage=3600',
        },
      })
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
