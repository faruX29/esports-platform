/**
 * Maç serisi formatını (Bo1/Bo3/Bo5) belirler.
 *
 * Öncelik PandaScore'un number_of_games alanıdır; bu alan boşsa
 * en yüksek harita skorundan format tahmin edilir (örn. skor 2 → Bo3).
 *
 * @param {number|string|null} aScore       - Takım A harita skoru
 * @param {number|string|null} bScore       - Takım B harita skoru
 * @param {number|string|null} numberOfGames - PandaScore number_of_games
 * @returns {('Bo1'|'Bo3'|'Bo5'|null)} Format etiketi veya belirlenemiyorsa null
 */
export function getBOFormat(aScore, bScore, numberOfGames) {
  const n = Number(numberOfGames)
  if (n >= 5) return 'Bo5'
  if (n >= 3) return 'Bo3'
  if (n === 1) return 'Bo1'
  const maxScore = Math.max(Number(aScore) || 0, Number(bScore) || 0)
  if (maxScore >= 3) return 'Bo5'
  if (maxScore >= 2) return 'Bo3'
  if (maxScore === 1) return 'Bo1'
  return null
}
