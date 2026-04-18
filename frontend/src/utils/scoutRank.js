const SCOUT_RANKS = [
  {
    key: 'master_scout',
    minScore: 45,
    label: 'Master Scout',
    badge: 'Master Scout',
    icon: 'MASTER',
    accent: '#65d4ff',
    border: 'rgba(101,212,255,.55)',
    glow: 'rgba(101,212,255,.22)',
    background: 'linear-gradient(145deg, rgba(33,123,163,.24), rgba(14,20,26,.95))',
  },
  {
    key: 'analyst',
    minScore: 12,
    label: 'Analyst',
    badge: 'Analyst',
    icon: 'ANALYST',
    accent: '#93f5c4',
    border: 'rgba(147,245,196,.5)',
    glow: 'rgba(147,245,196,.2)',
    background: 'linear-gradient(145deg, rgba(34,113,85,.24), rgba(14,24,20,.95))',
  },
  {
    key: 'rookie',
    minScore: -99999,
    label: 'Rookie',
    badge: 'Rookie',
    icon: 'ROOKIE',
    accent: '#c2c7d6',
    border: 'rgba(194,199,214,.35)',
    glow: 'rgba(194,199,214,.14)',
    background: 'linear-gradient(145deg, rgba(80,85,101,.2), rgba(14,14,16,.95))',
  },
]

export function normalizeScoutScore(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.trunc(numeric)
}

export function getScoutRank(score) {
  const safeScore = normalizeScoutScore(score)
  const found = SCOUT_RANKS.find(rank => safeScore >= rank.minScore) || SCOUT_RANKS[SCOUT_RANKS.length - 1]
  return {
    ...found,
    score: safeScore,
  }
}

export function getScoutVoteDelta(previousVote, nextVote) {
  const prev = Number(previousVote || 0)
  const next = Number(nextVote || 0)
  return next - prev
}

export function getScoutEmblem(icon) {
  if (icon === 'MASTER') return '◆'
  if (icon === 'ANALYST') return '◉'
  return '△'
}
