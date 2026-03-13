function toNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function safePct(v) {
  if (!Number.isFinite(v)) return 0
  return clamp(v, 0, 100)
}

function normalizeWinFlag(raw) {
  if (raw === true || raw === 1 || raw === '1') return 1
  if (raw === false || raw === 0 || raw === '0') return 0
  if (typeof raw === 'string') {
    const val = raw.toLowerCase()
    if (val.includes('win') || val === 'w') return 1
    if (val.includes('loss') || val === 'l') return 0
  }
  return null
}

export function pickRowTimestamp(row) {
  return row?.played_at || row?.created_at || row?.updated_at || row?.date || null
}

export function parsePlayerMatchRow(row) {
  const stats = row?.stats || {}

  const kills = toNum(row?.kills ?? row?.total_kills ?? row?.k ?? stats?.kills ?? stats?.total_kills ?? stats?.kda?.kills) || 0
  const deaths = toNum(row?.deaths ?? row?.total_deaths ?? row?.d ?? stats?.deaths ?? stats?.total_deaths ?? stats?.kda?.deaths) || 0
  const assists = toNum(row?.assists ?? row?.a ?? stats?.assists ?? stats?.kda?.assists) || 0
  const headshots = toNum(
    row?.headshots ?? row?.headshot_kills ?? row?.hs_kills ??
    stats?.headshots ?? stats?.headshot_kills ?? stats?.hs_kills
  ) || 0

  const hsPctRaw = toNum(row?.hs_percentage ?? row?.headshot_percentage ?? stats?.hs_percentage ?? stats?.headshot_percentage)
  const hsPct = hsPctRaw != null ? safePct(hsPctRaw) : (kills > 0 ? safePct((headshots / kills) * 100) : 0)

  const winFlag = normalizeWinFlag(
    row?.is_win ?? row?.won ?? row?.win ?? row?.result ?? stats?.is_win ?? stats?.won ?? stats?.result
  )

  return {
    kills,
    deaths,
    assists,
    headshots,
    hsPct,
    winFlag,
  }
}

export function summarizePlayerMatchStats(rows) {
  const parsed = (rows || []).map(parsePlayerMatchRow)
  const sampleMatches = parsed.length

  let totalKills = 0
  let totalDeaths = 0
  let totalAssists = 0
  let totalHeadshots = 0
  let wins = 0
  let winsCountable = 0

  for (const p of parsed) {
    totalKills += p.kills
    totalDeaths += p.deaths
    totalAssists += p.assists
    totalHeadshots += p.headshots
    if (p.winFlag != null) {
      winsCountable += 1
      wins += p.winFlag
    }
  }

  const kd = totalDeaths > 0 ? totalKills / totalDeaths : (totalKills > 0 ? totalKills : 0)
  const hsPct = totalKills > 0 ? safePct((totalHeadshots / totalKills) * 100) : 0
  const winRate = winsCountable > 0 ? safePct((wins / winsCountable) * 100) : 0

  // Impact scoring is shared across PlayersPage, PlayerPage and Dashboard Dream Team.
  const kdSignal = clamp(kd * 34, 0, 100)
  const hsSignal = clamp(hsPct, 0, 100)
  const impact = safePct((kdSignal * 0.48) + (hsSignal * 0.32) + (winRate * 0.20))

  return {
    sampleMatches,
    totalKills,
    totalDeaths,
    totalAssists,
    totalHeadshots,
    kd,
    hsPct,
    winRate,
    impact,
  }
}

export function metricBars(summary) {
  return {
    kdBar: safePct(summary.kd * 33),
    hsBar: safePct(summary.hsPct),
    winBar: safePct(summary.winRate),
    impactBar: safePct(summary.impact),
  }
}
