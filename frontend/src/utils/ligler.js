/**
 * Kalıcı lig sayfaları (/lig/<slug>). Tanımlar ve "güncel etkinlik" seçimi DB'de
 * (backend/sql/ligler.sql: `ligler` tablosu, `lig_sayfasi` / `turnuva_ligi` /
 * `lig_listesi` RPC'leri); bot HTML (middleware) ve sitemap de aynılarını okur.
 */
import { supabase } from '../supabaseClient'

export const ligPath = slug => `/lig/${slug}`

/** "<Lig> <yıl>" — sayfa başlığı ve "Güncel: …" bağlantısı aynı adı kullanır. */
export function ligBaslik(lig) {
  if (!lig) return ''
  return [lig.ad, lig.yil].filter(Boolean).join(' ')
}

/** Lig + güncel etkinliğin aşamaları + önceki etkinlikler; lig yoksa null. Hata fırlatır. */
export async function ligSayfasiGetir(slug) {
  const { data, error } = await supabase.rpc('lig_sayfasi', { p_slug: slug })
  if (error) throw error
  return data || null
}

/** Turnuvanın ait olduğu lig ({ slug, ad, yil, guncel }); yoksa ya da hata olursa null. */
export async function turnuvaLigiGetir(turnuvaId) {
  const { data, error } = await supabase.rpc('turnuva_ligi', { p_tid: Number(turnuvaId) })
  if (error) {
    console.warn('turnuva_ligi okunamadı:', error.message)
    return null
  }
  return data || null
}

/** Tüm aktif ligler (güncel etkinlik özetiyle); hata olursa boş liste. */
export async function ligListesiGetir() {
  const { data, error } = await supabase.rpc('lig_listesi')
  if (error) {
    console.warn('lig_listesi okunamadı:', error.message)
    return []
  }
  return Array.isArray(data) ? data : []
}
