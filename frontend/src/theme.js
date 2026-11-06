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
  accent:       '#C25CD0',   // solid: buton bg, aktif durum (alpha-suffix ile de kullanılır → sabit hex)
  accentText:   'var(--accent-fg)', // link/metin → tema-farkında (koyu: açık mor / aydınlık: derin magenta)
  accentGrad:   'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)',
  accentSoftBg: 'rgba(194,92,208,.12)',
  accentBorder: 'rgba(194,92,208,.40)',
  accentGlow:   'rgba(194,92,208,.15)',

  // Maç durumu rozetleri. `color` sabit hex (kenarlık/zemin için alfa eklenir); rozet YAZISI
  // `fg` ile (tema-farkında: aydınlıkta koyulaşır, index.css --canli-fg/--yesil-fg).
  status: {
    live:     { color: '#FF4655', fg: 'var(--canli-fg)', bg: 'rgba(255,70,85,.16)' },   // canlı = kırmızı (evrensel)
    upcoming: { color: '#94A3B8', fg: 'var(--text-3)',   bg: 'rgba(148,163,184,.12)' }, // yaklaşan = nötr slate
    finished: { color: '#46B658', fg: 'var(--yesil-fg)', bg: 'rgba(70,182,88,.12)' },   // bitti = ölçülü yeşil
  },

  // Olumlu/uyarı (gerekince)
  good:    '#46B658',
  warn:    '#E0A24D',
  danger:  '#FF4655',
}

/** 12 px'ten küçük yazı boyutu: masaüstünde verilen değer, telefonda (≤768 px) en az 12 px.
 *  Taban `index.css` `--yazi-taban`'da. 12 ve üstü için düz sayı yaz. */
export const yazi = px => `max(var(--yazi-taban), ${px}px)`

/** Oyun kimlik renkleri (rafine/soft) — GameContext ve rozetler bunu kullanır. */
export const GAME_COLORS = {
  all:      '#94A3B8',
  valorant: '#E8586A',
  cs2:      '#E0A24D',
  lol:      '#C6A24A',
  dota2:    '#B24A55',
}

// Oyun rengi METİN olarak (tema-farkında, ≥4,5:1). GAME_COLORS zemin/kenarlık/ikon içindir;
// alfa eki (`${renk}22`) var() ile çalışmaz, o yüzden ikisi ayrı.
export const GAME_FG = {
  all:      'var(--text-3)',
  valorant: 'var(--oyun-val-fg)',
  cs2:      'var(--oyun-cs2-fg)',
  lol:      'var(--oyun-lol-fg)',
  dota2:    'var(--oyun-dota-fg)',
}
/** Oyun kimliğinden metin rengi; tanınmazsa ikincil metin. */
export const oyunFg = id => GAME_FG[id] || 'var(--text-3)'
// Sayfaların oyun rengini hex olarak taşıdığı yerler için (`gc`; eski sayfa içi gameColor
// paletleri dahil): hex → metin token'ı. Tanınmayan renk aynen döner.
const OYUN_HEX_FG = {
  '#E8586A': GAME_FG.valorant, '#FF4655': GAME_FG.valorant,
  '#E0A24D': GAME_FG.cs2,      '#F0A500': GAME_FG.cs2,
  '#C6A24A': GAME_FG.lol,      '#C89B3C': GAME_FG.lol,
  '#B24A55': GAME_FG.dota2,    '#9D2226': GAME_FG.dota2,
  '#818CF8': 'var(--indigo-fg)', '#6366F1': 'var(--indigo-fg)',
  '#94A3B8': GAME_FG.all,
}
/** Token'ı olmayan renk METİN olarak (rol rozeti gibi çok renkli süsler): temaya göre açar/koyulaştırır
 *  (index.css --ton-oran/--ton-hedef). Zemin/kenarlıkta hex'i kullanmaya devam et. */
export const metinTonu = renk => `color-mix(in srgb, ${renk} var(--ton-oran), var(--ton-hedef))`

/** Oyun rengi (hex) METİN olarak: `color: oyunMetni(gc)`. Zemin/kenarlıkta hex'i kullanmaya devam et. */
export const oyunMetni = hex => OYUN_HEX_FG[String(hex || '').toUpperCase()] || hex

// Başlama saatinden bu kadar sonra hâlâ "başlamadı" görünen maç: veri gecikmesi (maç
// senkronu saatlerce geç koşabiliyor). Maç büyük olasılıkla oynandı ya da oynanıyor.
export const SAATI_GECTI_ESIGI_MS = 20 * 60 * 1000

/** Başlamamış görünen maçın saati eşikten fazla geçti mi? */
export function saatiGecti(scheduledAt, simdi = Date.now()) {
  const t = scheduledAt ? new Date(scheduledAt).getTime() : NaN
  return Number.isFinite(t) && t < simdi - SAATI_GECTI_ESIGI_MS
}

/** Maç durumu → rozet stili (text + renk + arka plan). scheduledAt verilirse saati
 *  geçmiş "başlamadı" maçı "Yaklaşan" değil "Sonuç bekleniyor" olur. */
export function statusStyle(status, scheduledAt) {
  const s = String(status || '').toLowerCase()
  if (s === 'running' || s === 'live')  return { text: 'CANLI',    ...FEXT.status.live }
  if (s === 'finished')                 return { text: 'Bitti',    ...FEXT.status.finished }
  // İptal (çoğu hükmen) ve ertelenen maç "Sonuç bekleniyor" sayılmaz
  if (s === 'canceled' || s === 'cancelled') return { text: 'İptal', ...FEXT.status.upcoming }
  if (s === 'postponed')                return { text: 'Ertelendi', ...FEXT.status.upcoming }
  if (saatiGecti(scheduledAt))          return { text: 'Sonuç bekleniyor', kisa: 'Bekleniyor', color: FEXT.warn, fg: 'var(--altin-fg)', bg: 'rgba(224,162,77,.12)' }
  return { text: 'Yaklaşan', ...FEXT.status.upcoming } // not_started / upcoming / diğer
}
