import GameLogo from './GameLogo'
import { GAMES } from '../context/GameContext'
import { normalizeGameId } from '../utils/gameUtils'
import { yazi, oyunFg } from '../theme'

/**
 * Küçük oyun rozeti: logo + kısa ad ("CS2", "VAL", "LoL"). Aynı adlı takımları
 * (Eternal Fire CS2 / VALORANT) ayırt etmek için arama, takım şeridi ve takım başlığında.
 * `oyun`: games satırı ({ slug, name }) ya da düz ad/slug. Tanınmazsa hiçbir şey çizmez.
 */
export default function OyunRozeti({ oyun, buyuk = false, style }) {
  const id = normalizeGameId(typeof oyun === 'string' ? oyun : (oyun?.slug ?? oyun?.name))
  const meta = GAMES.find(g => g.id === id)
  if (!meta || id === 'all') return null
  return (
    <span
      lang="en"
      title={meta.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: buyuk ? 5 : 4,
        padding: buyuk ? '3px 9px' : '2px 6px', borderRadius: 999,
        border: `1px solid ${meta.color}55`, background: `${meta.color}14`, color: oyunFg(id),
        fontSize: buyuk ? yazi(11) : yazi(9), fontWeight: 800, letterSpacing: '.3px', lineHeight: 1,
        whiteSpace: 'nowrap', flexShrink: 0,
        ...style,
      }}
    >
      <GameLogo game={id} size={buyuk ? 12 : 10} />
      {meta.shortLabel}
    </span>
  )
}
