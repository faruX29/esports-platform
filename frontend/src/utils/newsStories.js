const GAME_META = {
  valorant: { id: 'valorant', label: 'VALORANT', shortLabel: 'VAL', color: '#FF4655', icon: '⚡' },
  cs2: { id: 'cs2', label: 'Counter-Strike 2', shortLabel: 'CS2', color: '#F0A500', icon: '🎯' },
  lol: { id: 'lol', label: 'League of Legends', shortLabel: 'LoL', color: '#C89B3C', icon: '🏆' },
}

export const NEWS_LIMIT = 20
export const HERO_TIERS = new Set(['S', 'A'])

export function normalizeGameId(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return null
  if (value === 'valorant') return 'valorant'
  if (value === 'cs2' || value === 'csgo' || value.includes('counter') || value.includes('cs-go')) return 'cs2'
  if (value === 'lol' || value.includes('league')) return 'lol'
  return null
}

export function normalizeTier(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/\s+/g, '')
  return ['S', 'A', 'B', 'C'].includes(value) ? value : 'C'
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
  if (variant === 'upcoming') return 'Haftanin Maci'
  if (variant === 'upset') return 'Surpriz Sonuc'
  if (variant === 'stomp') return 'Skor Haberi'
  if (variant === 'close') return 'Seri Ozeti'
  return 'Gundem'
}

export function buildStoryVisuals(match, isTurkishTeam) {
  const teamA = match.team_a || {}
  const teamB = match.team_b || {}
  const gameId = normalizeGameId(match?.game?.slug ?? match?.game?.name ?? match?.game?.id)
  const game = getGameMeta(gameId)
  const tournamentName = match.tournament?.name || 'Ana Sahne'
  const tier = normalizeTier(match.tournament?.tier)
  const turkish = Boolean(isTurkishTeam?.(teamA.name) || isTurkishTeam?.(teamB.name))

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

export function buildFinishedStory(match, statsByMatch, isTurkishTeam) {
  const aName = match.team_a?.name || 'Team A'
  const bName = match.team_b?.name || 'Team B'
  const aScore = Number(match.team_a_score ?? 0)
  const bScore = Number(match.team_b_score ?? 0)
  const winner = Number(match.winner_id)
  const aId = Number(match.team_a_id || match.team_a?.id)
  const bId = Number(match.team_b_id || match.team_b?.id)
  const winnerName = winner === aId ? aName : winner === bId ? bName : aName
  const loserName = winner === aId ? bName : aName
  const margin = Math.abs(aScore - bScore)

  const predA = typeof match.prediction_team_a === 'number' ? match.prediction_team_a : null
  const predB = typeof match.prediction_team_b === 'number' ? match.prediction_team_b : null
  const predictedWinner = predA != null && predB != null ? (predA >= predB ? aId : bId) : null
  const isUpset = predictedWinner != null && winner && predictedWinner !== winner

  const statsRows = statsByMatch.get(match.id) || []
  const topRow = [...statsRows]
    .map(row => ({
      teamId: Number(row.team_id),
      score: Number(row?.stats?.score ?? 0),
    }))
    .sort((left, right) => right.score - left.score)[0]

  const impactTeam = topRow?.teamId === aId ? aName : topRow?.teamId === bId ? bName : null

  let variant = 'close'
  let title = `${winnerName}, ${loserName} karsisinda seriyi kapatti`
  let summary = `${winnerName}, ${loserName} onunde ${aScore}:${bScore} ile kazandi ve serinin momentumunu son bolumde kendi lehine cevirdi.`

  if (isUpset) {
    variant = 'upset'
    title = `${winnerName}, ${match.tournament?.name || 'ana sahne'} macinda dengeleri bozdu`
    summary = `${match.tournament?.name || 'Turnuva'} arenasinda ${winnerName}, beklenen tabloyu tersine cevirip ${loserName} onunde ${aScore}:${bScore} kazandi. Sonuc, ust bracket ve playoff hesaplarini dogrudan etkiliyor.`
  } else if (margin >= 2) {
    variant = 'stomp'
    title = `${winnerName}, ${loserName} onunde net skorla one cikti`
    summary = `${winnerName}, ${loserName} karsisinda seriyi ${aScore}:${bScore} ile bitirdi. Mac boyu oyunun temposunu ve objective kontrolunu elinde tutan taraf, gunun en temiz galibiyetlerinden birini yazdi.`
  } else if (impactTeam) {
    title = `${winnerName} dar seride ${impactTeam} etkisiyle ayakta kaldi`
    summary = `${aName} ile ${bName} arasindaki yakin seride kazanan ${winnerName} oldu. Skor tabelasi ${aScore}:${bScore} biterken istatistiklerde one cikan ${impactTeam}, macin kirilma anlarina damga vurdu.`
  }

  return {
    id: `match_${match.id}`,
    matchId: match.id,
    status: 'finished',
    variant,
    publishedAt: match.scheduled_at || new Date().toISOString(),
    priority: (tierWeight(match.tournament?.tier) * 100) + (variant === 'upset' ? 35 : variant === 'stomp' ? 24 : 12),
    title,
    summary,
    tag: storyTag(variant),
    heroScore: `${aName} ${aScore} - ${bScore} ${bName}`,
    visuals: buildStoryVisuals(match, isTurkishTeam),
    source: {
      predictionA: predA,
      predictionB: predB,
      winnerId: winner,
      predictedWinnerId: predictedWinner,
      upset: isUpset,
      margin,
      statRows: statsRows,
    },
  }
}

export function buildUpcomingStory(match, isTurkishTeam) {
  const aName = match.team_a?.name || 'Team A'
  const bName = match.team_b?.name || 'Team B'
  const tournamentName = match.tournament?.name || 'Ana Sahne'
  const startsAt = match.scheduled_at ? new Date(match.scheduled_at).getTime() : Date.now()
  const hoursAway = Math.max(1, Math.round((startsAt - Date.now()) / (60 * 60 * 1000)))
  const tier = normalizeTier(match.tournament?.tier)
  const isHeroTier = HERO_TIERS.has(tier)

  return {
    id: `match_${match.id}`,
    matchId: match.id,
    status: 'upcoming',
    variant: 'upcoming',
    publishedAt: match.scheduled_at || new Date().toISOString(),
    priority: (tierWeight(match.tournament?.tier) * 100) + (isHeroTier ? 46 : 18),
    title: isHeroTier
      ? `${tournamentName} vitrini: ${aName} vs ${bName}`
      : `${aName} ile ${bName} haftanin radarinda`,
    summary: isHeroTier
      ? `${aName} ile ${bName}, ${tournamentName} sahnesinde haftanin en kritik eslesmelerinden birine cikiyor. Seri yaklasirken gozler form durumu, veto dengesi ve playoff yarisi uzerinde olacak.`
      : `${aName} ile ${bName} ${hoursAway} saat sonra sunucuya cikiyor. Eslesme, turnuva tablosunda sira savasi ve alt sira baskisi acisindan gunun belirleyici karsilasmalarindan biri olmaya aday.`,
    tag: storyTag('upcoming'),
    heroScore: `${aName} vs ${bName}`,
    visuals: buildStoryVisuals(match, isTurkishTeam),
    source: {
      predictionA: typeof match.prediction_team_a === 'number' ? match.prediction_team_a : null,
      predictionB: typeof match.prediction_team_b === 'number' ? match.prediction_team_b : null,
      startInHours: hoursAway,
    },
  }
}

export function storyExplainability(story) {
  const explanations = []
  const tier = story?.visuals?.tier
  if (HERO_TIERS.has(tier)) {
    explanations.push('Turnuva tier puani yuksek oldugu icin manset onceligi verildi (Tier S/A).')
  }
  if (story?.variant === 'upset' || story?.source?.upset) {
    explanations.push('Model tahmini ile mac sonucu farkli oldugu icin haber Surpriz olarak etiketlendi.')
  }
  if (story?.variant === 'stomp') {
    explanations.push('Skor marji yuksek oldugu icin skor odakli hikaye one cikti.')
  }
  if (story?.status === 'upcoming') {
    explanations.push('Mac baslangicina kalan sure ve turnuva tier degeri Haftanin Maci secimini tetikledi.')
  }
  if (explanations.length === 0) {
    explanations.push('Mac onemi, skor yogunlugu ve turnuva baglami puanlanarak Gundem akisina yerlestirildi.')
  }

  const classification = story?.source?.upset ? 'Surpriz' : (HERO_TIERS.has(tier) ? 'Manset' : 'Gundem')
  return { classification, explanations }
}
