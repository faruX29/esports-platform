/**
 * Görünen kullanıcı adı — düz nickname (kullanıcı adı).
 *
 * NOT: Eski `Ad "Gamertag" Soyad` formatı (Lee "Faker" Sang-hyeok stili) kaldırıldı;
 * artık her yerde sade kullanıcı adı gösterilir. Ad/Soyad yalnızca profilde saklanır,
 * herkese açık gösterimde kullanılmaz.
 *
 * nickname = profiles.username. Yoksa (eski kayıtlar) ad-soyada, o da yoksa Anonim.
 */
export function getEsportsName(profile) {
  if (!profile) return 'Anonim'
  const tag = String(profile.gamertag || profile.username || '').trim()
  if (tag) return tag
  const full = `${String(profile.first_name || '').trim()} ${String(profile.last_name || '').trim()}`.replace(/\s+/g, ' ').trim()
  return full || 'Anonim'
}

/** Kısa nickname (rozet/kompakt yerler için) — getEsportsName ile aynı, geriye dönük uyum. */
export function getGamertag(profile) {
  return String(profile?.gamertag || profile?.username || '').trim() || 'Anonim'
}
