// Maçın turnuva bağlamını (Çeyrek Final / Grup A / Yarı Final ...) kısa bir
// Türkçe etikete çevirir. Veri seyrek olabilir → eşleşme yoksa null döner
// (çağıran taraf rozeti hiç göstermez). matches tablosundaki round_info /
// stage_name / bracket_type / name alanlarından okur.

function pickText(match) {
  return [match?.round_info, match?.stage_name, match?.bracket_type, match?.name]
    .filter(v => typeof v === 'string' && v.trim())
    .join(' ')
    .toLowerCase()
}

export function roundLabel(match) {
  const s = pickText(match)
  if (!s) return null

  // 3.'lük / bronz maçı
  if (/(3rd[\s_-]*place|third[\s_-]*place|bronze)/.test(s)) return "3.'lük Maçı"
  if (/(grand[\s_-]*final|büyük final)/.test(s)) return 'Büyük Final'
  // GSL grup maçları (IEM grupları): "Winners match" ayak sanılmasın
  if (/\bwinner'?s'?[\s_-]*match\b/.test(s)) return 'Kazananlar Maçı'
  if (/\belimination[\s_-]*match\b/.test(s)) return 'Eleme Maçı'
  if (/\bdecider[\s_-]*match\b/.test(s)) return 'Belirleyici Maç'

  // Ayak ÖNCE tespit edilir: "Lower Bracket Quarterfinal" eskiden "Çeyrek Final"
  // görünüyordu (alt ayaktaki eleme maçı turnuvanın çeyrek finali sanılıyordu).
  const ayak = /\b(lower|lb|losers?)\b/.test(s) ? 'Alt Ayak'
    : /\b(upper|ub|winners?)\b/.test(s) ? 'Üst Ayak' : null

  if (/(semi[\s_-]*final|\bsf\b|round[\s_-]*of[\s_-]*4|\bro4\b|1\/2)/.test(s)) return ayak ? `${ayak} Yarı Finali` : 'Yarı Final'
  if (/(quarter[\s_-]*final|\bqf\b|round[\s_-]*of[\s_-]*8|\bro8\b|1\/4)/.test(s)) return ayak ? `${ayak} Çeyrek Finali` : 'Çeyrek Final'
  if (/(round[\s_-]*of[\s_-]*16|\bro16\b|1\/8)/.test(s)) return ayak ? `${ayak} Son 16` : 'Son 16'
  if (/(round[\s_-]*of[\s_-]*32|\bro32\b|1\/16)/.test(s)) return ayak ? `${ayak} Son 32` : 'Son 32'
  // Ayak finalleri "Final" değil (alt ayak finali turnuvanın finali sanılıyordu)
  if (/\bfinal\b/.test(s)) return ayak ? `${ayak} Finali` : 'Final'

  // Grup / İsviçre / lig aşamaları
  const grp = s.match(/group[\s_-]*([a-z0-9]+)/)
  if (grp) return `Grup ${grp[1].toUpperCase()}`
  if (/\bswiss\b/.test(s)) return 'İsviçre Aşaması'
  const wk = s.match(/(?:game[\s_-]*week|week)[\s_-]*(\d+)/)
  if (wk) return `Hafta ${wk[1]}`

  // Alt/üst ayak turları
  const lb = s.match(/(?:lower|lb|losers?)[\s_-]*(?:bracket[\s_-]*)?(?:round|r)?[\s_-]*(\d+)/)
  if (lb) return `Alt Ayak Tur ${lb[1]}`
  const ub = s.match(/(?:upper|ub|winners?)[\s_-]*(?:bracket[\s_-]*)?(?:round|r)?[\s_-]*(\d+)/)
  if (ub) return `Üst Ayak Tur ${ub[1]}`
  const rn = s.match(/(?:^|\s)(?:round|r)[\s_-]*(\d+)/)
  if (rn) return `Tur ${rn[1]}`

  if (/(play[\s_-]*off|playoff)/.test(s)) return 'Playoff'
  if (/(group[\s_-]*stage|league[\s_-]*stage)/.test(s)) return 'Grup Aşaması'
  return null
}
