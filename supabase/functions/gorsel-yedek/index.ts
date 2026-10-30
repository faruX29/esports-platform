// gorsel-yedek — PandaScore takım logolarının thumb_ sürümünü Storage'a kopyalar.
// Çağıran: pg_cron `gorsel-yedek` (backend/sql/gorsel_yedek.sql), 10 dk'da bir ve
// yalnız bekleyen kaynak varsa. Kimlik: x-cron-secret (PUSH_CRON_SECRET, send-push ile ortak).
//
// Neden: bazı Türkiye hatlarında "Güvenli İnternet" filtresi *.pandascore.co'yu
// kesiyor; site o hatlarda bu yedeğe düşer (frontend/src/utils/gorsel.js yedekGorsel).
// Yol kuralı iki tarafta aynı olmalı: `/images/` sonrası, dosya adı thumb_ ile.
//
// thumb_ yoksa (403/404) orijinal aynı yola kopyalanır: frontend yalnız thumb_ yolunu bilir.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'

const KOVA = 'gorsel-yedek'
const PARTI = 120
const ESZAMANLI = 6
const AZAMI_BAYT = 1024 * 1024
const KAYNAK_RE = /^https:\/\/cdn-api\.pandascore\.co\/images\/([^?#]+\/)(?:thumb_)?([^/?#]+)$/

function esit(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let fark = 0
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return fark === 0
}

function yollar(kaynak: string): { thumb: string; orijinal: string; hedef: string } | null {
  const m = kaynak.match(KAYNAK_RE)
  if (!m) return null
  const kok = `https://cdn-api.pandascore.co/images/${m[1]}`
  return { thumb: `${kok}thumb_${m[2]}`, orijinal: kaynak, hedef: `${m[1]}thumb_${m[2]}` }
}

async function indir(url: string): Promise<{ veri: Uint8Array; tur: string } | { durum: number }> {
  const yanit = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!yanit.ok) { await yanit.body?.cancel(); return { durum: yanit.status } }
  const tur = (yanit.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!tur.startsWith('image/')) { await yanit.body?.cancel(); return { durum: 415 } }
  const veri = new Uint8Array(await yanit.arrayBuffer())
  if (veri.byteLength > AZAMI_BAYT) return { durum: 413 }
  return { veri, tur }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('yontem', { status: 405 })

  const beklenen = Deno.env.get('PUSH_CRON_SECRET') ?? ''
  const gelen = req.headers.get('x-cron-secret') ?? ''
  if (!beklenen || !esit(gelen, beklenen)) return new Response('yetkisiz', { status: 401 })

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: bekleyen, error } = await db.rpc('gorsel_yedek_bekleyen', { p_limit: PARTI })
  if (error) {
    console.error('gorsel-yedek: bekleyenler alınamadı:', error.message)
    return Response.json({ hata: 'bekleyen' }, { status: 500 })
  }

  let tamam = 0
  let hatali = 0

  const isler = ((bekleyen ?? []) as { kaynak: string }[]).map(({ kaynak }) => async () => {
    let hata: string | null = null
    try {
      const y = yollar(kaynak)
      if (!y) throw new Error('desen')
      let sonuc = await indir(y.thumb)
      // PandaScore'un deposu olmayan dosyaya 404 değil 403 de dönebiliyor.
      if ('durum' in sonuc && (sonuc.durum === 403 || sonuc.durum === 404) && y.thumb !== y.orijinal) {
        sonuc = await indir(y.orijinal)
      }
      if ('durum' in sonuc) throw new Error(`indirme ${sonuc.durum}`)
      const { error: yukHata } = await db.storage.from(KOVA).upload(y.hedef, sonuc.veri, {
        contentType: sonuc.tur,
        cacheControl: '604800',
        upsert: true,
      })
      if (yukHata) throw new Error(`yukleme ${yukHata.message}`)
    } catch (e) {
      hata = String((e as Error)?.message ?? e).slice(0, 200)
    }
    if (hata) hatali++
    else tamam++
    const { error: kayitHata } = await db.rpc('gorsel_yedek_sonuc', { p_kaynak: kaynak, p_hata: hata })
    if (kayitHata) console.error('gorsel-yedek: sonuç yazılamadı:', kayitHata.message)
  })

  // Sınırlı eşzamanlılık
  let sira = 0
  await Promise.all(Array.from({ length: ESZAMANLI }, async () => {
    while (sira < isler.length) await isler[sira++]()
  }))

  if (hatali) console.warn(`gorsel-yedek: ${hatali} kaynak kopyalanamadı (gorsel_yedek.hata)`)
  return Response.json({ tamam, hatali })
})
