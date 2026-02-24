/**
 * Önemli Türk espor takımları
 * Maç kartlarında "🇹🇷 Turkish Pride" badge'i ile vurgulanır.
 */
export const TURKISH_TEAMS = [
  'Eternal Fire',
  'BBL Esports',
  'BBL',
  'FUT Esports',
  'FUT',
  'Sangal',
  'Galatasaray Esports',
  'Galatasaray',
  'Fire Flux',
  'Papara SuperMassive',
  'SuperMassive',
  'NASR eSports',          // TR/MENA karma roster
  'Bahcesehir Koleji',
  'Istanbul Wildcats',
  'Dark Passage',
  'Besiktas Esports',
]

/**
 * Bir takım adının Türk takımı olup olmadığını kontrol eder.
 * Büyük/küçük harf duyarsızdır; kısmi eşleşme yapar.
 */
export function isTurkishTeam(teamName) {
  if (!teamName) return false
  const lower = teamName.toLowerCase()
  return TURKISH_TEAMS.some(t => lower.includes(t.toLowerCase()))
}
