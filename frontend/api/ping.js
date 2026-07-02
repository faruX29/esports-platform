// Teşhis endpoint'i: Vercel serverless fonksiyonları deploy oluyor mu?
export const config = { runtime: 'edge' }

export default function handler() {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    headers: { 'content-type': 'application/json' },
  })
}
