import { cleanDisplayName } from './nameCleaner'
import { normalizeGameId } from './gameUtils'
import { tournamentDisplayName } from './tournamentDisplay'
import { isUncertainPrediction } from './prediction'

export { normalizeGameId }

const GAME_META = {
  valorant: { id: 'valorant', label: 'VALORANT', shortLabel: 'VAL', color: '#FF4655', icon: '⚡' },
  cs2: { id: 'cs2', label: 'Counter-Strike 2', shortLabel: 'CS2', color: '#F0A500', icon: '🎯' },
  lol: { id: 'lol', label: 'League of Legends', shortLabel: 'LoL', color: '#C89B3C', icon: '🏆' },
}

export const NEWS_LIMIT = 60
export const HERO_TIERS = new Set(['S', 'A'])

export function normalizeTier(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return 'C'

  const compact = value
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')

  const stripped = compact.replace(/tier/g, '').replace(/[^a-z]/g, '')
  const first = stripped.charAt(0).toUpperCase()
  if (['S', 'A', 'B', 'C'].includes(first)) return first

  return 'C'
}

export function tierWeight(tier) {
  const key = normalizeTier(tier)
  if (key === 'S') return 4
  if (key === 'A') return 3
  if (key === 'B') return 2
  return 1
}

export function getGameMeta(gameId) {
  return GAME_META[gameId] || GAME_META.valorant
}

function storyTag(variant) {
  if (variant === 'upcoming') return 'Haftanın Maçı'
  if (variant === 'upset') return 'Sürpriz Sonuç'
  if (variant === 'stomp') return 'Skor Haberi'
  if (variant === 'close') return 'Seri Özeti'
  return 'Gündem'
}

export function buildStoryVisuals(match, isTurkishTeam) {
  const teamA = match.team_a || {}
  const teamB = match.team_b || {}
  const gameId = normalizeGameId(match?.game?.slug ?? match?.game?.name ?? match?.game?.id)
  const game = getGameMeta(gameId)
  // tournaments.name çoğunlukla yalnız aşama ("Group Stage"); lig + etkinlik varsa tam ad
  const tournamentName = cleanDisplayName(match.tournament ? tournamentDisplayName(match.tournament, { game: gameId }) : 'Ana Sahne') || 'Ana Sahne'
  const tier = normalizeTier(match?.tournament?.tier ?? match?.tier)
  const turkish = Boolean(isTurkishTeam?.(teamA) || isTurkishTeam?.(teamB))

  return {
    gameId,
    gameLabel: game?.shortLabel || game?.label || 'ESPORTS',
    gameColor: game?.color || '#C8102E',
    gameIcon: game?.icon || '🎮',
    tournamentName,
    tier,
    turkish,
    teamA,
    teamB,
  }
}

export function buildUpcomingStory(match, isTurkishTeam) {
  const aName = match.team_a?.name || 'Team A'
  const bName = match.team_b?.name || 'Team B'
  const tournamentName = match.tournament
    ? tournamentDisplayName(match.tournament, { game: normalizeGameId(match?.game?.slug ?? match?.game?.name) })
    : 'Ana Sahne'
  const startsAt = match.scheduled_at ? new Date(match.scheduled_at).getTime() : Date.now()
  const hoursAway = Math.max(1, Math.round((startsAt - Date.now()) / (60 * 60 * 1000)))
  const tier = normalizeTier(match.tournament?.tier)
  const isHeroTier = HERO_TIERS.has(tier)
  const predA = typeof match.prediction_team_a === 'number' ? match.prediction_team_a : null
  const predB = typeof match.prediction_team_b === 'number' ? match.prediction_team_b : null
  const predictionEdge = predA != null && predB != null ? Math.abs(predA - predB) : null
  const favorite = predA != null && predB != null ? (predA >= predB ? aName : bName) : null

  // Yalnız doğrulanabilir bilgi: turnuva, başlama zamanı, Fextopus olasılığı. Eskiden
  // "veto düzeni", "MVP yarışı", "playoff bileti" gibi veriye dayanmayan cümleler vardı.
  const favP = predA != null && predB != null ? Math.round(Math.max(predA, predB) * 100) : null
  let summary = `${aName} ile ${bName}, ${tournamentName} sahnesinde ${hoursAway} saat sonra karşılaşıyor.`
  if (favorite && favP != null) {
    summary += isUncertainPrediction(predA, predB)
      ? ' Fextopus iki takımı başa baş görüyor.'
      : ` Fextopus ${favorite} tarafına %${favP} kazanma olasılığı veriyor.`
  }

  return {
    id: `match_${match.id}`,
    matchId: match.id,
    tournamentId: match?.tournament?.id ?? match?.tournament_id ?? null,
    status: 'upcoming',
    variant: 'upcoming',
    publishedAt: match.scheduled_at || new Date().toISOString(),
    priority: (tierWeight(match.tournament?.tier) * 100) + (isHeroTier ? 46 : 18),
    title: `${aName} – ${bName}: ${tournamentName}`,
    summary,
    tag: storyTag('upcoming'),
    heroScore: `${aName} vs ${bName}`,
    visuals: buildStoryVisuals(match, isTurkishTeam),
    source: {
      predictionA: predA,
      predictionB: predB,
      predictionEdge,
      favorite,
      startInHours: hoursAway,
    },
  }
}

export function storyExplainability(story) {
  const explanations = []
  const tier = story?.visuals?.tier
  if (HERO_TIERS.has(tier)) {
    explanations.push('Turnuva tier puanı yüksek olduğu için manşet önceliği verildi (Tier S/A).')
  }
  if (story?.variant === 'upset' || story?.source?.upset) {
    explanations.push('Fextopus favoriye en az %65 kazanma olasılığı verdiği hâlde favori kaybettiği için haber Sürpriz olarak etiketlendi.')
  }
  if (story?.variant === 'stomp') {
    explanations.push('Skor marjı yüksek olduğu için skor odaklı hikaye öne çıktı.')
  }
  if (story?.status === 'upcoming') {
    explanations.push('Maç başlangıcına kalan süre ve turnuva tier değeri Haftanın Maçı seçimini tetikledi.')
  }
  if (explanations.length === 0) {
    explanations.push('Maç önemi, skor yoğunluğu ve turnuva bağlamı puanlanarak Gündem akışına yerleştirildi.')
  }

  const classification = story?.source?.upset ? 'Sürpriz' : (HERO_TIERS.has(tier) ? 'Manşet' : 'Gündem')
  return { classification, explanations }
}

/** Haftalık özetin kapak metni (NewsCover visuals.weekly). Detay sayfası da kullanır. */
export function weeklyCover(row) {
  const baslik = row.variant === 'surprizler' ? "Fextopus'u yanıltanlar" : 'Türk takımları'
  return { baslik, alt: row.ekler?.etiket || '' }
}
