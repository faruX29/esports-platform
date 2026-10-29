// Turnuva/lig sayfası maç satırı hazırlığı (TournamentPage ve LigPage ortak).
import { cleanDisplayName } from './nameCleaner'

function temizAd(value, fallback = '') {
  const cleaned = cleanDisplayName(value)
  if (cleaned) return cleaned
  return String(fallback || value || '').trim()
}

// Lig sayfası için dar seçim: `*` ham PandaScore JSON'unu (raw_data, pandascore_data)
// da taşır; bir etkinlikte 150+ maç olabiliyor. Aşama görünümleri yalnız bunları okur.
export const TURNUVA_MAC_SECIMI = `
  id, tournament_id, game_id, team_a_id, team_b_id, status, scheduled_at, begin_at,
  team_a_score, team_b_score, winner_id, number_of_games, match_type, name,
  round_info, bracket_type, serie_id,
  prediction_team_a, prediction_team_b, prediction_confidence,
  round_ham:raw_data->>round_info,
  team_a:teams!matches_team_a_id_fkey(id, name, logo_url, acronym),
  team_b:teams!matches_team_b_id_fkey(id, name, logo_url, acronym),
  game:games(id, name)
`

export function normalizeTurnuvaMaci(row) {
  // Detect and fix score inversion: PandaScore results[] is not guaranteed
  // to be ordered the same as opponents[], so winner may show the lower score.
  // When winner's score < loser's score, swap to display correctly.
  let aScore = row?.team_a_score ?? null
  let bScore = row?.team_b_score ?? null
  const wId = row?.winner_id
  if (wId != null && aScore != null && bScore != null && aScore !== bScore) {
    const aWon = wId === row?.team_a_id
    const bWon = wId === row?.team_b_id
    if ((aWon && aScore < bScore) || (bWon && bScore < aScore)) {
      ;[aScore, bScore] = [bScore, aScore]
    }
  }

  return {
    ...row,
    team_a_score: aScore,
    team_b_score: bScore,
    // Fallback chain: DB column → raw_data.round_info → match name before ":"
    // PandaScore stores bracket stage in name: "Upper bracket final: PRV vs VIT"
    round_info: temizAd(
      row?.round_info
      || row?.raw_data?.round_info
      || row?.round_ham
      || (row?.name ? row.name.split(':')[0]?.trim() : null)
      || null,
      row?.round_info || '',
    ),
    tournament: row?.tournament
      ? {
          ...row.tournament,
          name: temizAd(row.tournament?.name, row.tournament?.name || ''),
        }
      : row?.tournament,
  }
}
