/**
 * matchResult.js — maç sonucu yardımcıları.
 *
 * deriveWinnerTeamId: Bir maçın kazanan takım id'sini belirler.
 *  - SKOR ÖNCELİKLİ: seri sonucu = daha çok harita kazanan (en güvenilir ground truth).
 *    DB'de ~379 maçta (%1.2) winner_id skorla ÇELİŞİYOR (backfill sync hatası:
 *    0:2 skorlu maçta winner_id 0 skorlu takıma set edilmiş) → skora güveniyoruz.
 *  - Skorlar eşit/yoksa winner_id'ye düş (forfeit/walkover vb.).
 *  - Hiçbiri yoksa null (gerçek Bo2 beraberliği 1:1 / veri-yok 0:0).
 *
 * NOT: W/L kaynağı DAİMA matches tablosu olmalı — match_stats.stats JSONB'de
 * kazanan çoğu maçta yok (bu yüzden eskiden oyuncu profillerinde "0 galibiyet" çıkıyordu).
 */
export function deriveWinnerTeamId(match) {
  const a = Number(match?.team_a_score)
  const b = Number(match?.team_b_score)
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
    return a > b ? Number(match.team_a_id) : Number(match.team_b_id)
  }
  if (match?.winner_id != null) return Number(match.winner_id)
  return null
}

/** Maç sonucu bir takım açısından: 'W' | 'L' | 'D'. */
export function matchOutcome(match, teamId) {
  const w = deriveWinnerTeamId(match)
  if (w == null) return 'D'
  return w === Number(teamId) ? 'W' : 'L'
}
