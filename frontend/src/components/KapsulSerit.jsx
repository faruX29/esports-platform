/**
 * Yatay kapsül şeridi: başlık + DragScroll (masaüstünde ok + fareyle sürükleme,
 * mobilde parmakla kaydırma). Lig şeridi (/tournaments) ve aşama şeritleri
 * (/lig/<slug>, /tournament/<id>) aynı görünümü buradan alır; kapsül stili
 * `utils/kapsul.js`'te.
 */
import DragScroll from './DragScroll'

export default function KapsulSerit({ Icon, baslik, ariaLabel, minHeight, children }) {
  return (
    <div>
      {baslik && (
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase',
          color: 'var(--text-4)', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {Icon && <Icon size={12} />} {baslik}
        </div>
      )}
      <DragScroll
        className="scroll-fade-x"
        ariaLabel={ariaLabel || baslik || 'Kapsüller'}
        style={{ gap: 7, paddingBottom: 3, alignItems: 'center', minHeight }}
      >
        {children}
      </DragScroll>
    </div>
  )
}
