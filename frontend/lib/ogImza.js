/**
 * /api/og URL imzası (HMAC-SHA256). URL'yi middleware üretir ve imzalar,
 * api/og.js doğrular; imzasız ya da yanlış imzalı istek statik karta düşer →
 * dışarıdan "a=Sahte&s=13-0" gibi sahte kart çizdirilemez.
 *
 * Anahtar Vercel env `OG_SECRET` (iki tarafta aynı). Edge runtime → crypto.subtle.
 * İmza parametrelerin anahtara göre sıralı hâlinden alınır; sıra ya da
 * kodlama farkı (boşluk '+' / '%20') imzayı bozmasın.
 */
const enc = new TextEncoder()
const IMZA_HEX = 32   // 128 bit; URL kısa kalsın

let anahtarOnbellek = null   // { secret, key }

async function anahtar(secret) {
  if (anahtarOnbellek?.secret !== secret) {
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    )
    anahtarOnbellek = { secret, key }
  }
  return anahtarOnbellek.key
}

function kanonik(params) {
  const girdiler = [...params.entries()]
    .filter(([k]) => k !== 'sig')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return new URLSearchParams(girdiler).toString()
}

export async function ogImzala(params, secret) {
  const mac = await crypto.subtle.sign('HMAC', await anahtar(secret), enc.encode(kanonik(params)))
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, IMZA_HEX)
}

export async function ogImzaGecerli(params, secret) {
  const sig = params.get('sig') || ''
  if (!secret || sig.length !== IMZA_HEX) return false
  const beklenen = await ogImzala(params, secret)
  // Sabit süreli karşılaştırma: ilk farklı karakterde dönmez.
  let fark = 0
  for (let i = 0; i < IMZA_HEX; i++) fark |= beklenen.charCodeAt(i) ^ sig.charCodeAt(i)
  return fark === 0
}
