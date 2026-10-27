// delete-account — kullanıcının kendi hesabını kalıcı olarak siler.
// Apple 5.1.1(v) ve Play hesap silme şartı; KVKK silme hakkı.
//
// Sıra (her adım hata verirse durur, hesap silinmeden kalır → tekrar denenebilir):
//   1) Avatar dosyaları (Storage SQL'le silinemez, API gerekir)
//   2) Hesaba bağlı olmayan ama kişiye ait satırlar: scout_waitlist (e-posta),
//      user_favorites (eski tablo, text user_id)
//   3) auth.admin.deleteUser → profiles, follows, news_likes, oylar, push
//      token'ları CASCADE ile gider; yorumların yazar bağı NULL olur
//      (backend/sql/hesap_silme.sql).
//   4) Doğrulama: kullanıcı gerçekten yok mu.
//
// verify_jwt kapalı (config.toml): JWT burada auth.getUser ile doğrulanır.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { corsBasliklari, json } from '../_shared/cors.ts'

const ONAY = 'HESABIMI SIL'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsBasliklari(req) })
  if (req.method !== 'POST') return json(req, 405, { hata: 'yontem' })

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json(req, 401, { hata: 'oturum_yok' })

  let govde: { onay?: string } = {}
  try { govde = await req.json() } catch { /* boş gövde → onay yok */ }
  if (govde.onay !== ONAY) return json(req, 400, { hata: 'onay_eksik' })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: kim, error: kimHata } = await admin.auth.getUser(jwt)
  if (kimHata || !kim?.user?.id) return json(req, 401, { hata: 'oturum_gecersiz' })
  const uid = kim.user.id
  const eposta = (kim.user.email ?? '').trim().toLowerCase()

  // 1) Avatarlar: avatars/<uid>/<dosya>
  const kova = admin.storage.from('avatars')
  for (let tur = 0; tur < 20; tur++) {
    const { data: dosyalar, error } = await kova.list(uid, { limit: 1000 })
    if (error) {
      console.error('delete-account avatar listesi:', error.message)
      return json(req, 500, { hata: 'avatar_listesi' })
    }
    if (!dosyalar?.length) break
    const { error: silHata } = await kova.remove(dosyalar.map((d) => `${uid}/${d.name}`))
    if (silHata) {
      console.error('delete-account avatar silme:', silHata.message)
      return json(req, 500, { hata: 'avatar_silme' })
    }
  }

  // 2) Hesaba FK ile bağlı olmayan kişisel satırlar
  // E-posta büyük/küçük harfe duyarsız tekil. ilike'ta `_` ve `%` (PostgREST'te
  // `*` de) jokerdir → yalnız aday bulmak için kullanılır, silme KESİN eşleşmeyle.
  if (eposta) {
    const desen = eposta.replace(/[\\%_]/g, (k) => `\\${k}`)
    const { data: adaylar, error } = await admin.from('scout_waitlist').select('id,email').ilike('email', desen)
    if (error) {
      console.error('delete-account scout_waitlist:', error.message)
      return json(req, 500, { hata: 'bekleme_listesi' })
    }
    const idler = (adaylar ?? []).filter((r) => String(r.email).trim().toLowerCase() === eposta).map((r) => r.id)
    if (idler.length) {
      const { error: silHata } = await admin.from('scout_waitlist').delete().in('id', idler)
      if (silHata) {
        console.error('delete-account scout_waitlist silme:', silHata.message)
        return json(req, 500, { hata: 'bekleme_listesi' })
      }
    }
  }
  {
    const { error } = await admin.from('user_favorites').delete().eq('user_id', uid)
    if (error) {
      console.error('delete-account user_favorites:', error.message)
      return json(req, 500, { hata: 'favoriler' })
    }
  }

  // 3) Hesap (kalıcı; soft delete değil)
  const { error: silmeHata } = await admin.auth.admin.deleteUser(uid, false)
  if (silmeHata) {
    console.error('delete-account deleteUser:', silmeHata.message)
    return json(req, 500, { hata: 'hesap_silme' })
  }

  // 4) Doğrulama
  const { data: kalan } = await admin.auth.admin.getUserById(uid)
  if (kalan?.user) {
    console.error('delete-account: silme sonrası kullanıcı hâlâ var')
    return json(req, 500, { hata: 'dogrulama' })
  }

  return json(req, 200, { ok: true })
})
