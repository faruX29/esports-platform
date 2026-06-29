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
export default function SeoHead({
  title,
  description = '',
  image = '',
  url = '',
  type = 'article',
  siteName = 'EsportsHub Pro',
}) {
  const fullTitle = title ? `${title} | ${siteName}` : siteName
  const canonical = url || (typeof window !== 'undefined' ? window.location.href : '')

  return (
    <>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      {canonical && <link rel="canonical" href={canonical} />}

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
