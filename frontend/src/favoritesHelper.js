// localStorage'da favorileri yönetmek için helper fonksiyonlar

const FAVORITES_KEY = 'esports_favorite_teams'

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
    return favorites
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
    return favorites
  }
}

export function isFavorite(teamId) {
  const favorites = getFavorites()
  return favorites.includes(teamId)
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