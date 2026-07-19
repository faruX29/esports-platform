import { createContext, useContext, useState } from 'react';
import { GAME_COLORS } from '../theme';

export const GAMES = [
  {
    id:         'all',
    label:      'All Games',
    shortLabel: 'All',
    icon:       '🎮',
    color:      GAME_COLORS.all,
    soon:       false,
    patterns:   [],
  },
  {
    id:         'valorant',
    label:      'VALORANT',
    shortLabel: 'VAL',
    icon:       '⚡',
    color:      GAME_COLORS.valorant,
    soon:       false,
    patterns:   ['valorant'],
  },
  {
    id:         'cs2',
    label:      'Counter-Strike 2',
    shortLabel: 'CS2',
    icon:       '🎯',
    color:      GAME_COLORS.cs2,
    soon:       false,
    patterns:   ['counter-strike', 'counter strike', 'counter-strike global offensive', 'cs-go', 'csgo', 'cs2'],
  },
  {
    id:         'lol',
    label:      'League of Legends',
    shortLabel: 'LoL',
    icon:       '🏆',
    color:      GAME_COLORS.lol,
    soon:       false,
    patterns:   ['league of legends', 'league-of-legends'],
  },
  {
    id:         'dota2',
    label:      'Dota 2',
    shortLabel: 'Dota2',
    icon:       '🔮',
    color:      GAME_COLORS.dota2,
    soon:       true,
    patterns:   ['dota'],
  },
]

/* ── Yardımcı: verilen oyun adı aktif filtreye uyuyor mu? ── */
export function gameMatchesFilter(gameName = '', activeGameId) {
  if (!activeGameId || activeGameId === 'all') return true
  const game = GAMES.find(g => g.id === activeGameId)
  if (!game || game.patterns.length === 0) return true
  const lower = gameName.toLowerCase()
  return game.patterns.some(p => lower.includes(p))
}

/* ── Context ── */
const GameContext = createContext(null)

export function GameProvider({ children }) {
  const [activeGame, setActiveGame] = useState('all')

  return (
    <GameContext.Provider value={{ activeGame, setActiveGame, games: GAMES }}>
      {children}
    </GameContext.Provider>
  )
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>')
  return ctx
}
