/**
 * feXt renk sistemi — TEK kaynak. Sayfalardaki dağınık kırmızı/sarı aksanlar
 * yerine buradaki sabit token'lar kullanılır.
 *
 *  • accent (mor/magenta) → marka aksanı: buton, link, aktif sekme, focus, vurgu
 *  • status → maç durumu rozetleri (canlı/yaklaşan/bitti) — sabit anlam, sabit renk
 *  • game  → oyun kimlik renkleri (rafine/soft tonlar; espor standardı)
 *  • surface/line/text → lacivert yüzey paleti
 */

export const FEXT = {
  // Yüzeyler
  base:     '#0b0f19',
  surface:  '#131b2b',
  surface2: '#172032',
  line:     '#26324a',
  line2:    '#172032',

  // Metin
  text:     '#f8fafc',
  textDim:  '#94a3b8',
  textMute: '#64748b',
  textFaint:'#475569',

  // Marka aksanı (mor/magenta) — "feXt morluğu"
  accent:       '#C25CD0',   // solid: buton bg, aktif durum
  accentText:   '#D08BE0',   // link/metin (lacivert üstünde okunaklı)
  accentGrad:   'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)',
  accentSoftBg: 'rgba(194,92,208,.12)',
  accentBorder: 'rgba(194,92,208,.40)',
  accentGlow:   'rgba(194,92,208,.15)',

  // Maç durumu rozetleri
  status: {
    live:     { color: '#FF4655', bg: 'rgba(255,70,85,.16)' },   // canlı = kırmızı (evrensel)
    upcoming: { color: '#94A3B8', bg: 'rgba(148,163,184,.12)' }, // yaklaşan = nötr slate
    finished: { color: '#46B658', bg: 'rgba(70,182,88,.12)' },   // bitti = ölçülü yeşil
  },

  // Olumlu/uyarı (gerekince)
  good:    '#46B658',
  warn:    '#E0A24D',
  danger:  '#FF4655',
}

/** Oyun kimlik renkleri (rafine/soft) — GameContext ve rozetler bunu kullanır. */
export const GAME_COLORS = {
  all:      '#94A3B8',
  valorant: '#E8586A',
  cs2:      '#E0A24D',
  lol:      '#C6A24A',
  dota2:    '#B24A55',
}

/** Maç durumu → rozet stili (text + renk + arka plan). */
export function statusStyle(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'running' || s === 'live')  return { text: 'LIVE',     ...FEXT.status.live }
  if (s === 'finished')                 return { text: 'Bitti',    ...FEXT.status.finished }
  return { text: 'Upcoming', ...FEXT.status.upcoming } // not_started / upcoming / diğer
}
