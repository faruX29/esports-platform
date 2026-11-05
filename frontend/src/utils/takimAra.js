import { supabase } from '../supabaseClient'

// Takım araması ve popüler takımlar: takim_ara / populer_takimlar RPC'leri
// (backend/sql/takim_arama.sql). Sıra sunucuda: tam ad/kısaltma > ön ek > kelime başı
// > içinde geçer → "ex-" adlılar sona → Türk takımı → önem puanı (son 120 gün,
// seviyeye göre ağırlıklı maç sayısı). Türkçe harf düzleşir: "besiktas" → Beşiktaş.
// Çıktı satırı: { id, name, acronym, logo_url, game_id, location, country_code, game: {id,name,slug} }

let rpcYokBilindi = false  // bir kez PGRST202 aldıysak oturum boyunca doğrudan eski yol

function rpcYok(error) {
  // PGRST202: fonksiyon şemada yok (SQL henüz uygulanmamış)
  return error?.code === 'PGRST202' || /takim_ara|populer_takimlar/.test(String(error?.message || ''))
}

// RPC yoksa eski davranış: sırasız ilike. PostgREST .or() içinde virgül/parantez
// ayıraçtır, temizlenmezse "Team (EU)" sorguyu bozar.
async function eskiArama(q, adet) {
  const k = q.replace(/[,()]/g, ' ').trim()
  const { data, error } = await supabase
    .from('teams')
    .select('id,name,acronym,logo_url,game_id,location,country_code,game:games(id,name,slug)')
    .or(`name.ilike.%${k}%,acronym.ilike.%${k}%`)
    .limit(adet)
  if (error) throw error
  return data || []
}

export async function takimAra(sorgu, adet = 8) {
  const q = String(sorgu ?? '').trim()
  if (q.length < 2) return []
  if (!rpcYokBilindi) {
    const { data, error } = await supabase.rpc('takim_ara', { q, adet })
    if (!error) return data || []
    if (!rpcYok(error)) throw error
    rpcYokBilindi = true
    console.warn('takim_ara RPC yok, eski aramaya düşüldü:', error.message)
  }
  return eskiArama(q, adet)
}

// Kişiselleştir "Popüler Takımlar": aktif Türk takımları (en fazla 8) + elle seçilmiş
// dünya takımları. RPC yoksa boş döner; modal "yukarıdan ara" der.
export async function populerTakimlar() {
  const { data, error } = await supabase.rpc('populer_takimlar')
  if (error) {
    if (rpcYok(error)) { console.warn('populer_takimlar RPC yok:', error.message); return [] }
    throw error
  }
  return data || []
}
