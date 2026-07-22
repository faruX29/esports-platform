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

// "For You" ROZETİ için: yalnızca takip edilen bir TAKIM geçtiğinde true.
// (Takip edilen oyun eşleşmesi rozet basmaz — yoksa o oyundaki her haberde çıkar
// ve rozet anlamını yitirir. Oyun tercihi yalnızca sıralamayı etkiler.)
export function isStoryFollowedTeam(story, followedTeamIds = []) {
  if (!story || !Array.isArray(followedTeamIds) || followedTeamIds.length === 0) return false
  const followed = new Set(followedTeamIds.map(id => String(id)))
  const teamAId = story?.visuals?.teamA?.id != null ? String(story.visuals.teamA.id) : null
  const teamBId = story?.visuals?.teamB?.id != null ? String(story.visuals.teamB.id) : null
  return Boolean((teamAId && followed.has(teamAId)) || (teamBId && followed.has(teamBId)))
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

// Tazelik kovası — "Günün Bülteni" için recency önce gelsin (yoksa eski yüksek-tier
// haber günlerce manşette kalıyordu). Gün içinde tier/priority belirleyici.
// Yaklaşan maçlar (gelecek tarih) en taze kovaya düşer → prominent kalır.
export function freshnessBucket(publishedAt) {
  const h = (Date.now() - new Date(publishedAt || 0).getTime()) / 3600000
  if (h < 24) return 3   // bugün (ve yaklaşan)
  if (h < 48) return 2   // dün
  if (h < 96) return 1   // 2-3 gün
  return 0               // daha eski
}

export function prioritizeStoriesForYou(stories = [], followedTeamIds = [], followedGameIds = []) {
  if (!Array.isArray(stories) || stories.length === 0) return []

  return [...stories].sort((left, right) => {
    const leftForYou = isStoryForYou(left, followedTeamIds, followedGameIds) ? 1 : 0
    const rightForYou = isStoryForYou(right, followedTeamIds, followedGameIds) ? 1 : 0
    if (rightForYou !== leftForYou) return rightForYou - leftForYou

    // Önce tazelik kovası (bugün > dün > 2-3 gün > eski)
    const leftBucket = freshnessBucket(left?.publishedAt)
    const rightBucket = freshnessBucket(right?.publishedAt)
    if (rightBucket !== leftBucket) return rightBucket - leftBucket

    // Aynı kova içinde tier/priority
    if ((right?.priority || 0) !== (left?.priority || 0)) return (right?.priority || 0) - (left?.priority || 0)

    // Son olarak tam zaman
    const leftTs = new Date(left?.publishedAt || 0).getTime()
    const rightTs = new Date(right?.publishedAt || 0).getTime()
    return rightTs - leftTs
  })
}
