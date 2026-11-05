/**
 * SeoHead — React 19 native metadata hoisting ile <head> SEO/OG etiketleri.
 *
 * React 19, bileşen ağacının herhangi bir yerinde render edilen <title>, <meta>
 * ve <link> etiketlerini otomatik olarak <head>'e taşır. Bu yüzden react-helmet
 * gibi ek bağımlılığa gerek yoktur.
 *
 * Not: SPA (SSR yok) olduğu için bu etiketler client-render sonrası eklenir;
 * JS çalıştıran crawler'lar (Googlebot) ve link-unfurl yapan bazı botlar için
 * çalışır. Tam SSR/prerender ileride sitemap + statik render ile güçlendirilebilir.
 */
import { useLayoutEffect } from 'react'

/* ── index.html varsayılanları ──────────────────────────────────────────────
 * React 19 hoisting mevcut etiketin ÜZERİNE YAZMAZ, yanına ekler: DOM'da iki
 * description, iki og:title... (Google'ın JS'li çiziminde ikisi de görünür).
 * index.html'deki varsayılanlar `data-varsayilan="<anahtar>"` ile işaretli;
 * SeoHead aynı anahtarı çizdiği sürece varsayılanı DOM'dan ayırır, son SeoHead
 * gidince geri takar (SeoHead'siz sayfalar — ana sayfa, giriş — varsayılanla
 * kalır). Dosyadan SİLİNMEZ: middleware'in değersiz bot/YOK kabuğu index.html'i
 * olduğu gibi sunar. Sayaç: aynı anda iki SeoHead ve StrictMode çift çağrısı. */
const sayac = new Map()
const ayrilan = new Map()

function varsayilaniAyir(anahtar) {
  const n = (sayac.get(anahtar) || 0) + 1
  sayac.set(anahtar, n)
  if (n !== 1) return
  const els = [...document.head.querySelectorAll(`[data-varsayilan="${anahtar}"]`)]
  els.forEach(el => el.remove())
  ayrilan.set(anahtar, els)
}

function varsayilaniGeriTak(anahtar) {
  const n = (sayac.get(anahtar) || 0) - 1
  sayac.set(anahtar, Math.max(n, 0))
  if (n > 0) return
  ;(ayrilan.get(anahtar) || []).forEach(el => document.head.appendChild(el))
  ayrilan.delete(anahtar)
}

export default function SeoHead({
  title,
  description = '',
  image = '',
  url = '',
  type = 'article',
  siteName = 'feXt',
  schema = null,   // Schema.org JSON-LD (obje veya dizi) → Google zengin sonuç
}) {
  const fullTitle = title ? `${title} | ${siteName}` : siteName
  // Canonical = üretim domaini + temiz path (query/hash yok). www, vercel.app ve
  // ?utm= varyantlarının hepsi tek canonical'da toplanır → "duplicate without
  // user-selected canonical" (Search Console) çözülür.
  const SITE_ORIGIN = 'https://fextesports.com'
  const canonical = url || (typeof window !== 'undefined' ? SITE_ORIGIN + window.location.pathname : '')

  // Bu SeoHead'in çizdiği anahtarlar; yalnız bunların varsayılanı ayrılır
  // (görseli olmayan sayfada varsayılan og:image kalır).
  const anahtarlar = [
    'title', 'og:site_name', 'og:type', 'og:title', 'twitter:card',
    ...(description ? ['description', 'og:description'] : []),
    ...(canonical ? ['og:url'] : []),
    ...(image ? ['og:image', 'twitter:image'] : []),
  ].join(' ')

  useLayoutEffect(() => {
    const liste = anahtarlar.split(' ')
    liste.forEach(varsayilaniAyir)
    return () => liste.forEach(varsayilaniGeriTak)
  }, [anahtarlar])

  return (
    <>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      {canonical && <link rel="canonical" href={canonical} />}

      {/* Yapısal veri (Schema.org) — Google JSON-LD'yi head/body'de okur */}
      {schema && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      )}

      {/* Open Graph (Facebook, WhatsApp, Discord, LinkedIn) */}
      <meta property="og:site_name" content={siteName} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      {description && <meta property="og:description" content={description} />}
      {canonical && <meta property="og:url" content={canonical} />}
      {image && <meta property="og:image" content={image} />}

      {/* Twitter / X Card */}
      <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={fullTitle} />
      {description && <meta name="twitter:description" content={description} />}
      {image && <meta name="twitter:image" content={image} />}
    </>
  )
}
