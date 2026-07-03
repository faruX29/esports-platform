/**
 * Espor isim formatı — KULLANICILAR için (Gemini kararı [[auth-onboarding]]).
 *
 *   Ad "Gamertag" Soyad   →   Ömer Faruk "faruks" Selçuk
 *
 * Liquipedia/turnuva-reji altın standardı (Lee "Faker" Sang-hyeok). Forum
 * yorumları, profil sayfaları ve B2B Scout raporlarında imza kimliğimiz.
 *
 * gamertag = profiles.username. first_name/last_name yoksa sade gamertag'e düşer.
 */
export function getEsportsName(profile) {
  if (!profile) return 'Anonim'
  const first = String(profile.first_name || '').trim()
  const last = String(profile.last_name || '').trim()
  const tag = String(profile.gamertag || profile.username || '').trim()

  if (tag && (first || last)) {
    return `${first} "${tag}" ${last}`.replace(/\s+/g, ' ').trim()
  }
  if (tag) return tag
  const full = `${first} ${last}`.trim()
  return full || 'Anonim'
}

/** Kısa gamertag (rozet/kompakt yerler için) */
export function getGamertag(profile) {
  return String(profile?.gamertag || profile?.username || '').trim() || 'Anonim'
}
