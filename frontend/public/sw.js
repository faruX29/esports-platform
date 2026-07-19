/* feXt Service Worker — minimal + güvenli (PWA kurulabilirliği + hızlı tekrar yükleme).
   ÖNEMLİ: Canlı skor/API ASLA cache'lenmez → bayat veri riski yok. Sadece Vite'ın
   içerik-hash'li statik varlıkları (yeni deploy = yeni dosya adı → bayatlamaz) cache-first. */
const CACHE = 'fext-static-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return  // Supabase vb. dış origin → dokunma

  const isHashedStatic = /\/assets\/|\/icons\/|\.(?:js|css|woff2?|png|svg|webp|jpg|jpeg|ico)$/.test(url.pathname)
  if (!isHashedStatic) return  // HTML / diğer → normal network (bayat içerik yok)

  event.respondWith((async () => {
    const cached = await caches.match(req)
    if (cached) return cached
    try {
      const res = await fetch(req)
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE)
        cache.put(req, res.clone())
      }
      return res
    } catch (err) {
      return cached || Response.error()
    }
  })())
})
