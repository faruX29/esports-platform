function normalizeGameKey(value) {
  return String(value || '').trim().toLowerCase()
}

function isStoryGamePreferred(story, followedGameIds = []) {
  if (!Array.isArray(followedGameIds) || followedGameIds.length === 0) return false

  const preferredGames = new Set(followedGameIds.map(normalizeGameKey).filter(Boolean))
  if (!preferredGames.size) return false

  const candidates = [
    story?.visuals?.gameId,
    story?.visuals?.game,
    story?.category,
  ]

  return candidates
    .map(normalizeGameKey)
    .filter(Boolean)
    .some(game => preferredGames.has(game))
}

export function isStoryForYou(story, followedTeamIds = [], followedGameIds = []) {
  if (!story) return false

  const followed = new Set(followedTeamIds.map(id => String(id)))
  const teamAId = story?.visuals?.teamA?.id != null ? String(story.visuals.teamA.id) : null
  const teamBId = story?.visuals?.teamB?.id != null ? String(story.visuals.teamB.id) : null
  const teamMatch = Boolean((teamAId && followed.has(teamAId)) || (teamBId && followed.has(teamBId)))
  if (teamMatch) return true

  return isStoryGamePreferred(story, followedGameIds)
}

export function prioritizeStoriesForYou(stories = [], followedTeamIds = [], followedGameIds = []) {
  if (!Array.isArray(stories) || stories.length === 0) return []

  return [...stories].sort((left, right) => {
    const leftForYou = isStoryForYou(left, followedTeamIds, followedGameIds) ? 1 : 0
    const rightForYou = isStoryForYou(right, followedTeamIds, followedGameIds) ? 1 : 0

    if (rightForYou !== leftForYou) return rightForYou - leftForYou
    if ((right?.priority || 0) !== (left?.priority || 0)) return (right?.priority || 0) - (left?.priority || 0)

    const leftTs = new Date(left?.publishedAt || 0).getTime()
    const rightTs = new Date(right?.publishedAt || 0).getTime()
    return rightTs - leftTs
  })
}
