// localStorage'da favorileri yönetmek için helper fonksiyonlar

const FAVORITES_KEY        = 'esports_favorite_teams'
const FOLLOWED_PLAYERS_KEY = 'esports_followed_players'

export function getFavorites() {
  try {
    const favorites = localStorage.getItem(FAVORITES_KEY)
    return favorites ? JSON.parse(favorites) : []
  } catch (error) {
    console.error('Error reading favorites:', error)
    return []
  }
}

export function addFavorite(teamId) {
  try {
    const favorites = getFavorites()
    if (!favorites.includes(teamId)) {
      favorites.push(teamId)
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
    }
    return favorites
  } catch (error) {
    console.error('Error adding favorite:', error)
    return getFavorites()
  }
}

export function removeFavorite(teamId) {
  try {
    const favorites = getFavorites()
    const updated = favorites.filter(id => id !== teamId)
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated))
    return updated
  } catch (error) {
    console.error('Error removing favorite:', error)
    return getFavorites()
  }
}

export function isFavorite(teamId) {
  return getFavorites().includes(teamId)
}

/**
 * Toggle: favorideyse çıkar, değilse ekle.
 * Her iki durumda da güncel diziyi döner.
 */
export function toggleFavorite(teamId) {
  return isFavorite(teamId) ? removeFavorite(teamId) : addFavorite(teamId)
}

export function clearFavorites() {
  try {
    localStorage.removeItem(FAVORITES_KEY)
    return []
  } catch (error) {
    console.error('Error clearing favorites:', error)
    return []
  }
}

// ── Oyuncu Takip Sistemi ────────────────────────────────────────────────────

export function getFollowedPlayers() {
  try {
    const raw = localStorage.getItem(FOLLOWED_PLAYERS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function followPlayer(player) {
  try {
    const list = getFollowedPlayers()
    if (!list.find(p => p.id === player.id)) {
      list.push({
        id:        player.id,
        nickname:  player.nickname,
        role:      player.role,
        image_url: player.image_url,
      })
      localStorage.setItem(FOLLOWED_PLAYERS_KEY, JSON.stringify(list))
    }
    return list
  } catch {
    return getFollowedPlayers()
  }
}

export function unfollowPlayer(playerId) {
  try {
    const updated = getFollowedPlayers().filter(p => p.id !== playerId)
    localStorage.setItem(FOLLOWED_PLAYERS_KEY, JSON.stringify(updated))
    return updated
  } catch {
    return getFollowedPlayers()
  }
}

export function isFollowedPlayer(playerId) {
  return getFollowedPlayers().some(p => p.id === playerId)
}

export function clearFollowedPlayers() {
  try {
    localStorage.removeItem(FOLLOWED_PLAYERS_KEY)
    return []
  } catch {
    return []
  }
}