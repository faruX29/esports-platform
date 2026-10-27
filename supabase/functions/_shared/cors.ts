// Tarayıcıdan çağrılan fonksiyonlar için CORS. Yalnız bilinen kökenler:
// site, yerel geliştirme ve Capacitor uygulaması (Android https://localhost,
// iOS capacitor://localhost).
const IZINLI = new Set([
  'https://fextesports.com',
  'https://www.fextesports.com',
  'http://localhost:5173',
  'http://localhost:4173',
  'https://localhost',
  'capacitor://localhost',
])

export function corsBasliklari(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': IZINLI.has(origin) ? origin : 'https://fextesports.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function json(req: Request, durum: number, govde: unknown): Response {
  return new Response(JSON.stringify(govde), {
    status: durum,
    headers: { ...corsBasliklari(req), 'Content-Type': 'application/json' },
  })
}
