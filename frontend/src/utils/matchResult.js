/**
 * matchResult.js — maç sonucu yardımcıları.
 *
 * ⚠️ VERİ GERÇEĞİ (raw PandaScore ile doğrulandı): winner_id GÜVENİLİR alan.
 * ~379 maçta (%1.2) team_a_score/team_b_score, team_a_id/team_b_id'ye göre TERS
 * atanmış (PandaScore results[] vs opponents[] sıralama quirk'i). Yani çelişkide
 * SKOR bozuk, winner_id doğru. Bu yüzden:
 *   - deriveWinnerTeamId → winner_id ÖNCELİKLİ (winner_id yoksa skordan türet).
 *   - correctedScores    → skorları winner_id ile tutarlı hale getirir (display için).
 *
 * NOT: W/L kaynağı DAİMA matches tablosu olmalı — match_stats.stats JSONB'de kazanan
 * çoğu maçta yok (bu yüzden eskiden oyuncu profillerinde "0 galibiyet" çıkıyordu).
 */

/** Kazanan takım id (Number) veya null (gerçek Bo2 1:1 / veri-yok 0:0). */
export function deriveWinnerTeamId(match) {
  if (match?.winner_id != null) return Number(match.winner_id)
  const a = Number(match?.team_a_score)
  const b = Number(match?.team_b_score)
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
    return a > b ? Number(match.team_a_id) : Number(match.team_b_id)
  }
  return null
}

/** Maç sonucu bir takım açısından: 'W' | 'L' | 'D'. */
export function matchOutcome(match, teamId) {
  const w = deriveWinnerTeamId(match)
  if (w == null) return 'D'
  return w === Number(teamId) ? 'W' : 'L'
}

/**
 * Skorları winner_id ile tutarlı döndür (ters-atanmış skor quirk'ini düzeltir).
 * Kazananın skoru düşük görünüyorsa team_a_score/team_b_score yer değiştirir.
 * @returns {{team_a_score:number|null, team_b_score:number|null}}
 */
export function correctedScores(match) {
  const a = match?.team_a_score
  const b = match?.team_b_score
  const w = match?.winner_id
  if (w != null && a != null && b != null && Number(a) !== Number(b)) {
    const aWon = Number(w) === Number(match.team_a_id)
    const bWon = Number(w) === Number(match.team_b_id)
    if ((aWon && Number(a) < Number(b)) || (bWon && Number(b) < Number(a))) {
      return { team_a_score: b, team_b_score: a }
    }
  }
  return { team_a_score: a, team_b_score: b }
}
