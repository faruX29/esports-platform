import { useEffect, useState } from 'react'

/**
 * Canlı maç sayfası açıkken sekme başlığı ve favicon (başka sekmedeki kullanıcı skoru görsün).
 * Skor seri skorudur (harita/oyun); raund verisi yok. Bir taraf skor alınca başlık ~8 sn
 * "EF haritayı aldı!" der.
 */


/** Sayfa başlığı (SeoHead `title`'ı) için: canlı değilse null döner, çağıran kendi başlığını kullanır. */
export function useCanliSekmeBasligi(match, skorA, skorB) {
  const canli = match?.status === 'running'
  const id = match?.id ?? null
  // Önceki skoru durumda tut (render sırasında güncellenir: React'in "önceki prop" kalıbı);
  // hangi tarafın skor aldığı buradan çıkar.
  const [iz, setIz] = useState({ id, a: skorA, b: skorB, taraf: null, n: 0 })
  if (iz.id !== id || iz.a !== skorA || iz.b !== skorB) {
    const ayniMac = iz.id === id && canli && iz.a != null && iz.b != null && skorA != null && skorB != null
    const taraf = ayniMac ? (skorA > iz.a ? 'a' : skorB > iz.b ? 'b' : null) : null
    setIz({ id, a: skorA, b: skorB, taraf, n: iz.n + (taraf ? 1 : 0) })
  }
  const [kapanan, setKapanan] = useState(0)
  useEffect(() => {
    if (!iz.n) return undefined
    const t = setTimeout(() => setKapanan(iz.n), 8000)
    return () => clearTimeout(t)
  }, [iz.n])

  if (!canli) return null
  const kisa = (t) => String(t?.acronym || t?.name || '?').trim()
  const a = kisa(match.team_a), b = kisa(match.team_b)
  const skor = `${a} ${skorA ?? 0}–${skorB ?? 0} ${b}`
  if (iz.taraf && iz.n !== kapanan) {
    const birim = Number(match.game_id) === 3 ? 'oyunu' : 'haritayı' // 3 = LoL
    return `${iz.taraf === 'a' ? a : b} ${birim} aldı! ${skor}`
  }
  return `${skor} · Canlı`
}
