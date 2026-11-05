import { Flame } from 'lucide-react'
import FextopusIcon from './FextopusIcon'
import { yazi } from '../theme'

/**
 * FextopusEtiketi — maç kartlarında oran çubuğunun ortasındaki küçük
 * "Fextopus" etiketi: yüzdenin kimden geldiği görünsün (rapor 5 Kas, Adım 3).
 * Kartın kendisi link olabildiği için bu düz yazı; link değil.
 * belirsiz → "Fextopus · Başa baş", sicak → turuncu + alev (güven > %80).
 */
export default function FextopusEtiketi({ belirsiz = false, sicak = false, boyut = 10 }) {
  const renk = sicak ? '#ff8c42' : 'var(--text-3)'
  return (
    <span
      title="Fextopus tahmini"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        fontSize: yazi(boyut), fontWeight: 700, color: renk, lineHeight: 1, whiteSpace: 'nowrap',
      }}
    >
      <FextopusIcon size={boyut + 4} title="Fextopus tahmini" />
      {sicak && <Flame size={boyut} strokeWidth={2.5} aria-hidden="true" />}
      Fextopus{belirsiz ? ' · Başa baş' : ''}
    </span>
  )
}
