function toNum(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function parseJsonIfPossible(raw) {
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return raw
  try {
    return JSON.parse(trimmed)
  } catch {
    return raw
  }
}

function normalizeProbabilities(teamA, teamB) {
  const a = toNum(teamA)
  const b = toNum(teamB)
  if (a == null || b == null) return null
  const total = a + b
  if (!Number.isFinite(total) || total <= 0) return null
  return {
    teamA: clamp(a / total, 0, 1),
    teamB: clamp(b / total, 0, 1),
  }
}

function sideToWinnerId(side, matchRow) {
  if (!side || !matchRow) return null
  const value = String(side).toLowerCase()

  const isTeamA =
    value === 'a' || value === '1' ||
    value.includes('team_a') || value.includes('teama') ||
    value.includes('left') || value.includes('home')

  const isTeamB =
    value === 'b' || value === '2' ||
    value.includes('team_b') || value.includes('teamb') ||
    value.includes('right') || value.includes('away')

  if (isTeamA) return matchRow.team_a_id ?? null
  if (isTeamB) return matchRow.team_b_id ?? null
  return null
}

function winnerFromAiPrediction(aiPrediction, matchRow) {
  const parsed = parseJsonIfPossible(aiPrediction)

  if (parsed == null) return null

  if (typeof parsed === 'number') {
    return toNum(parsed)
  }

  if (typeof parsed === 'string') {
    const asNum = toNum(parsed)
    if (asNum != null) return asNum
    return sideToWinnerId(parsed, matchRow)
  }

  if (typeof parsed === 'object') {
    const winnerId = toNum(
      parsed.winner_id ??
      parsed.predicted_winner_id ??
      parsed.winnerTeamId ??
      parsed.predicted_team_id ??
      parsed.team_id
    )
    if (winnerId != null) return winnerId

    const sideWinner = sideToWinnerId(
      parsed.winner_side ?? parsed.predicted_side ?? parsed.side ?? parsed.pick ?? parsed.favorite,
      matchRow,
    )
    if (sideWinner != null) return sideWinner

    const probs = normalizeProbabilities(
      parsed.team_a ?? parsed.teamA ?? parsed.prob_a ?? parsed.probability_a,
      parsed.team_b ?? parsed.teamB ?? parsed.prob_b ?? parsed.probability_b,
    )
    if (probs) {
      if (probs.teamA > probs.teamB) return matchRow.team_a_id ?? null
      if (probs.teamB > probs.teamA) return matchRow.team_b_id ?? null
    }
  }

  return null
}

export function getPredictedWinnerId(matchRow = {}) {
  const fromAiPrediction = winnerFromAiPrediction(matchRow.ai_prediction, matchRow)
  if (fromAiPrediction != null) return fromAiPrediction

  const fromColumns = normalizeProbabilities(matchRow.prediction_team_a, matchRow.prediction_team_b)
  if (!fromColumns) return null

  if (fromColumns.teamA > fromColumns.teamB) return matchRow.team_a_id ?? null
  if (fromColumns.teamB > fromColumns.teamA) return matchRow.team_b_id ?? null
  return null
}

export function getPredictionConfidence(matchRow = {}) {
  const direct = toNum(matchRow.prediction_confidence)
  if (direct != null) {
    const normalized = direct > 1 ? direct / 100 : direct
    return clamp(normalized, 0, 1)
  }

  const parsedAi = parseJsonIfPossible(matchRow.ai_prediction)
  if (parsedAi && typeof parsedAi === 'object') {
    const aiConf = toNum(parsedAi.confidence ?? parsedAi.probability ?? parsedAi.win_confidence)
    if (aiConf != null) {
      const normalized = aiConf > 1 ? aiConf / 100 : aiConf
      return clamp(normalized, 0, 1)
    }
  }

  const probs = normalizeProbabilities(matchRow.prediction_team_a, matchRow.prediction_team_b)
  if (!probs) return null

  const edge = Math.abs(probs.teamA - probs.teamB)
  return clamp(0.5 + (edge * 0.5), 0.5, 0.98)
}

export function calculatePredictionAccuracy(finishedMatches = []) {
  let evaluatedCount = 0
  let correctCount = 0

  for (const row of (finishedMatches || [])) {
    if (!row || row.status !== 'finished') continue
    if (row.winner_id == null) continue

    const predictedWinnerId = getPredictedWinnerId(row)
    if (predictedWinnerId == null) continue

    evaluatedCount += 1
    if (Number(predictedWinnerId) === Number(row.winner_id)) {
      correctCount += 1
    }
  }

  const accuracyRate = evaluatedCount > 0
    ? Math.round((correctCount / evaluatedCount) * 100)
    : null

  return {
    accuracyRate,
    correctCount,
    evaluatedCount,
    totalFinished: (finishedMatches || []).filter(row => row?.status === 'finished').length,
  }
}

export function getMatchImpactLabel(matchRow = {}) {
  const confidence = getPredictionConfidence(matchRow)
  if (confidence == null) return null

  const confidencePct = Math.round(confidence * 100)

  if (confidence >= 0.72) {
    return {
      tone: 'high',
      text: 'Yuksek Guven',
      confidencePct,
      color: '#9ef4b5',
      border: 'rgba(76,175,80,.55)',
      bg: 'rgba(76,175,80,.16)',
    }
  }

  if (confidence <= 0.56) {
    return {
      tone: 'risk',
      text: 'Riskli Mac',
      confidencePct,
      color: '#ffc4cb',
      border: 'rgba(255,70,85,.5)',
      bg: 'rgba(255,70,85,.16)',
    }
  }

  return {
    tone: 'balanced',
    text: 'Dengeli',
    confidencePct,
    color: '#ffe3a8',
    border: 'rgba(255,184,0,.5)',
    bg: 'rgba(255,184,0,.16)',
  }
}
