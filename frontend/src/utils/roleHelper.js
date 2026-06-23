const ROLE_STYLES = {
  igl:        { bg: 'rgba(139,92,246,0.2)',    border: 'rgba(139,92,246,0.55)',  color: '#a78bfa', label: 'IGL' },
  sniper:     { bg: 'rgba(56,189,248,0.15)',   border: 'rgba(56,189,248,0.5)',   color: '#38bdf8', label: 'Sniper' },
  awp:        { bg: 'rgba(56,189,248,0.15)',   border: 'rgba(56,189,248,0.5)',   color: '#38bdf8', label: 'AWP' },
  entry:      { bg: 'rgba(239,68,68,0.2)',     border: 'rgba(239,68,68,0.5)',    color: '#f87171', label: 'Entry' },
  support:    { bg: 'rgba(234,179,8,0.18)',    border: 'rgba(234,179,8,0.45)',   color: '#fbbf24', label: 'Support' },
  lurker:     { bg: 'rgba(156,163,175,0.15)',  border: 'rgba(156,163,175,0.35)', color: '#9ca3af', label: 'Lurker' },
  rifler:     { bg: 'rgba(34,197,94,0.15)',    border: 'rgba(34,197,94,0.4)',    color: '#4ade80', label: 'Rifler' },
  carry:      { bg: 'rgba(251,146,60,0.2)',    border: 'rgba(251,146,60,0.5)',   color: '#fb923c', label: 'Carry' },
  jungler:    { bg: 'rgba(52,211,153,0.18)',   border: 'rgba(52,211,153,0.45)',  color: '#34d399', label: 'Jungler' },
  mid:        { bg: 'rgba(167,139,250,0.2)',   border: 'rgba(167,139,250,0.5)',  color: '#c4b5fd', label: 'Mid' },
  top:        { bg: 'rgba(251,191,36,0.15)',   border: 'rgba(251,191,36,0.4)',   color: '#fcd34d', label: 'Top' },
  bot:        { bg: 'rgba(96,165,250,0.18)',   border: 'rgba(96,165,250,0.45)',  color: '#60a5fa', label: 'Bot' },
  adc:        { bg: 'rgba(96,165,250,0.18)',   border: 'rgba(96,165,250,0.45)',  color: '#60a5fa', label: 'ADC' },
  controller: { bg: 'rgba(20,184,166,0.18)',   border: 'rgba(20,184,166,0.45)', color: '#2dd4bf', label: 'Controller' },
  duelist:    { bg: 'rgba(239,68,68,0.2)',     border: 'rgba(239,68,68,0.5)',    color: '#f87171', label: 'Duelist' },
  initiator:  { bg: 'rgba(251,146,60,0.2)',    border: 'rgba(251,146,60,0.5)',   color: '#fb923c', label: 'Initiator' },
  sentinel:   { bg: 'rgba(139,92,246,0.2)',    border: 'rgba(139,92,246,0.55)', color: '#a78bfa', label: 'Sentinel' },
}

/**
 * Normalize a role string for a specific game. Returns null when the role
 * cannot be determined so callers can choose not to render a badge.
 */
export function normalizeRoleForGame(role, gameId) {
  const value = String(role || '').trim().toLowerCase()
  if (!value) return null

  if (gameId === 'lol') {
    if (value === 'adc') return 'adc'
    if (value === 'bot' || value === 'bottom') return 'bot'
    if (value.includes('top')) return 'top'
    if (value.includes('jung')) return 'jungler'
    if (value.includes('mid')) return 'mid'
    if (value.includes('support') || value === 'sup') return 'support'
    if (value.includes('carry')) return 'carry'
    return null
  }

  if (gameId === 'valorant') {
    if (value.includes('duelist')) return 'duelist'
    if (value.includes('controller')) return 'controller'
    if (value.includes('initiator')) return 'initiator'
    if (value.includes('sentinel')) return 'sentinel'
    if (value.includes('igl')) return 'igl'
    return null
  }

  if (gameId === 'cs2') {
    if (value === 'awp' || value.includes('awper') || value.includes('sniper')) return 'sniper'
    if (value.includes('igl')) return 'igl'
    if (value.includes('entry')) return 'entry'
    if (value.includes('support')) return 'support'
    if (value.includes('lurk')) return 'lurker'
    if (value.includes('rifl')) return 'rifler'
    return null
  }

  // Unknown game — try generic role detection
  if (value.includes('igl')) return 'igl'
  if (value.includes('awp') || value.includes('sniper')) return 'sniper'
  if (value.includes('support')) return 'support'
  return null
}

/**
 * Resolve a player's role, falling back to extra_metadata sources.
 * Use this in PlayerPage where extra_metadata is available.
 */
export function resolvePlayerRole(player, gameId) {
  const sources = [
    player?.role,
    player?.extra_metadata?.role,
    player?.extra_metadata?.liquipedia?.role,
    player?.extra_metadata?.liquipedia?.position,
  ]
  for (const raw of sources) {
    const normalized = normalizeRoleForGame(raw, gameId)
    if (normalized) return normalized
  }
  return null
}

/**
 * Returns badge style for a role key. Returns null when role is unknown
 * so callers can skip rendering entirely.
 */
export function getRoleBadge(role) {
  if (!role) return null
  const key = String(role).toLowerCase()
  return ROLE_STYLES[key] ?? null
}
