import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GAMES, useGame } from '../context/GameContext'

/**
 * Tek oyun isteyen sayfaların (Sıralama, Oyuncular) kendi oyun seçimi.
 *
 * Ortak `activeGame`'i DEĞİŞTİRMEZ: eskiden bu sayfalar "Tümü"yü kendi
 * varsayılanına (VAL) çeviriyordu, ana sayfaya dönünce filtre VAL kalıyordu.
 * Seçim URL'de (`?oyun=cs2`) durur → geri tuşu ve paylaşılan link aynı oyunu
 * açar. URL'de yoksa ortak seçim (tek oyunsa), o da yoksa ilk oyun.
 */
const SECILEBILIR = GAMES.filter(g => !g.soon && g.id !== 'all')
const gecerli = id => SECILEBILIR.some(g => g.id === id)

export default function useSayfaOyunu() {
  const { activeGame } = useGame()
  const [params, setParams] = useSearchParams()
  const urlOyun = params.get('oyun')
  const oyun = gecerli(urlOyun) ? urlOyun
    : gecerli(activeGame) ? activeGame
    : SECILEBILIR[0]?.id || 'valorant'

  const setOyun = useCallback(id => {
    setParams(onceki => {
      const yeni = new URLSearchParams(onceki)
      yeni.set('oyun', id)
      return yeni
    }, { replace: true })
  }, [setParams])

  return [oyun, setOyun]
}
