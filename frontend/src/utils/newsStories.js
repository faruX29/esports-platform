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

function extractMapSignals(statsRows, aScore, bScore) {
  const mapLengths = []
  let mapCount = Math.max(Number(aScore || 0), Number(bScore || 0), 0)

  for (const row of (statsRows || [])) {
    const details = Array.isArray(row?.stats?.games_detail)
      ? row.stats.games_detail
      : Array.isArray(row?.stats?.maps)
        ? row.stats.maps
        : []

    if (details.length > mapCount) mapCount = details.length

    for (const detail of details) {
      const seconds = Number(
        detail?.duration_seconds
        ?? detail?.duration
        ?? detail?.round_time
        ?? 0,
      )
      if (Number.isFinite(seconds) && seconds > 0) mapLengths.push(seconds)
    }
  }

  const longestMapSeconds = mapLengths.length ? Math.max(...mapLengths) : null
  const averageMapSeconds = mapLengths.length
    ? Math.round(mapLengths.reduce((sum, current) => sum + current, 0) / mapLengths.length)
    : null

  let tempoLabel = 'dengeli tempo'
  if (averageMapSeconds != null && averageMapSeconds <= 1500) tempoLabel = 'hizli tempo'
  if (averageMapSeconds != null && averageMapSeconds >= 2200) tempoLabel = 'uzun round temposu'

  return {
    mapCount,
    longestMapSeconds,
    averageMapSeconds,
    tempoLabel,
  }
}

function formatMinutes(seconds) {
  if (!seconds) return null
  return `${Math.round(seconds / 60)} dk`
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
  const favoredName = predictedWinner === aId ? aName : predictedWinner === bId ? bName : null
  const predictionEdge = predA != null && predB != null ? Math.abs(predA - predB) : null
  const isUpset = predictedWinner != null && winner && predictedWinner !== winner

  const statsRows = statsByMatch.get(match.id) || []
  const mapSignals = extractMapSignals(statsRows, aScore, bScore)
  const topRow = [...statsRows]
    .map(row => ({
      teamId: Number(row.team_id),
      score: Number(row?.stats?.score ?? 0),
    }))
    .sort((left, right) => right.score - left.score)[0]

  const impactTeam = topRow?.teamId === aId ? aName : topRow?.teamId === bId ? bName : null
  const impactScore = topRow?.score ?? null
  const mapMinutes = formatMinutes(mapSignals.averageMapSeconds)
  const longestMap = formatMinutes(mapSignals.longestMapSeconds)
  const scoreline = `${aScore}:${bScore}`

  const mvpLine = impactTeam
    ? `${impactTeam}${impactScore != null ? ` tarafinda ${impactScore} impact puaniyla MVP seviyesi performans verdi` : ' tarafinda MVP etkisi yaratti'}.`
    : 'Macin belirleyici bolumlerinde bireysel performans farki sonucu dogrudan etkiledi.'

  let variant = 'close'
  let title = `Mac Raporu: ${winnerName}, ${scoreline} ile seriyi tamamladi`
  let summary = `${match.tournament?.name || 'Turnuva'} sahnesinde final skor ${scoreline}. Seri ${mapSignals.mapCount || 1} haritaya yayildi, tempo ${mapSignals.tempoLabel} olarak olculdu${mapMinutes ? ` ve ortalama harita suresi ${mapMinutes}` : ''}. ${mvpLine}`

  if (isUpset) {
    variant = 'upset'
    title = `Surpriz Skor: ${winnerName}, ${match.tournament?.name || 'ana sahne'} dengesini degistirdi`
    summary = `${match.tournament?.name || 'Turnuva'} arenasinda ${winnerName}, ${loserName} onunde ${scoreline} ile kazanarak model projeksiyonunu tersine cevirdi.${favoredName ? ` Tahminlerde onde yazilan taraf ${favoredName}` : ''}${predictionEdge != null ? ` ve tahmin farki ${predictionEdge} puandi` : ''}. ${mvpLine} Sonuc, playoff tablosunda yeni bir senaryo acti.`
  } else if (margin >= 2) {
    variant = 'stomp'
    title = `Skor Haberi: ${winnerName}, ${scoreline} ile net ustunluk kurdu`
    summary = `${winnerName}, ${loserName} karsisinda seriyi ${scoreline} bitirdi. ${mapSignals.mapCount || 1} haritalik sette tempo ${mapSignals.tempoLabel} seviyesinde ilerledi${longestMap ? `, en uzun harita ${longestMap}` : ''}. ${mvpLine} Bu tablo gunun en yuksek kontrol yuzdelerinden birini urettirdi.`
  } else if (impactTeam) {
    title = `Analiz: ${winnerName} dar seride MVP etkisiyle ayakta kaldi`
    summary = `${aName} ile ${bName} arasindaki yakin seride kazanan ${winnerName} oldu ve skor ${scoreline} kapandi. ${impactTeam}${impactScore != null ? ` ${impactScore} impact puaniyla` : ''} kritik roundlarda oyunu cevirdi${mapMinutes ? `; ortalama harita suresi ${mapMinutes}` : ''}. Teknik denge son bolumde mikro kararlarla kirildi.`
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
      impactTeam,
      impactScore,
      mapCount: mapSignals.mapCount,
      mapTempo: mapSignals.tempoLabel,
      averageMapSeconds: mapSignals.averageMapSeconds,
      longestMapSeconds: mapSignals.longestMapSeconds,
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
  const predA = typeof match.prediction_team_a === 'number' ? match.prediction_team_a : null
  const predB = typeof match.prediction_team_b === 'number' ? match.prediction_team_b : null
  const predictionEdge = predA != null && predB != null ? Math.abs(predA - predB) : null
  const favorite = predA != null && predB != null ? (predA >= predB ? aName : bName) : null
  const favoriteModelScore = predA != null && predB != null
    ? (predA >= predB ? predA : predB)
    : null

  let summary = `${aName} ile ${bName} ${hoursAway} saat sonra sunucuya cikiyor. Karsilasma oncesi ana hikaye skor tablosundaki pozisyon savasi ve veto duzeninin ilk haritaya etkisi. Analitik model, serinin kirilim noktasinin acilis haritasi olabilecegini isaret ediyor.`
  if (isHeroTier) {
    summary = `${aName} ile ${bName}, ${tournamentName} sahnesinde haftanin manset serisine cikiyor. Gozler form trendi, veto dengesi ve playoff bileti ihtimalleri uzerinde; bu seri turnuva ivmesini dogrudan etkileyebilir.`
  }
  if (favorite && predictionEdge != null) {
    summary += ` Model, ${favorite} tarafini ${predictionEdge} puanlik farkla onde goruyor${favoriteModelScore != null ? ` (model skoru ${favoriteModelScore})` : ''}; MVP yarisi acisindan one cikan ekip ilk iki haritada psikolojik ustunlugu alabilir.`
  }

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
