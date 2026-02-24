/**
 * Paylaşılan rol badge yardımcı fonksiyonu.
 * TeamPage.jsx ve PlayerSearch.jsx tarafından kullanılır.
 */
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
 * @param {string|null} role - PandaScore'dan gelen rol adı
 * @returns {{ bg, border, color, label }}
 */
export function getRoleBadge(role) {
  const key = role?.toLowerCase()
  return ROLE_STYLES[key] || {
    bg: 'rgba(255,70,85,0.15)',
    border: 'rgba(255,70,85,0.4)',
    color: '#FF4655',
    label: role || 'Unknown',
  }
}
