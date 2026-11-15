import Mascot from './Mascot'

/**
 * Yükleme iskeletinin (Sk / shimmer blok) ortasında süzülen Fextopus + gölgesi.
 * Ebeveyn `position: relative` olmalı; mutlak konumlu olduğu için düzeni (CLS) değiştirmez.
 * Hareketi azaltta süzülme durur, maskot yerinde kalır.
 */
export default function YukleniyorFextopus({ size = 64, yazi = 'Yükleniyor' }) {
  return (
    <div role="status" aria-label={yazi} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div className="fx-yukle-suzul"><Mascot size={size} /></div>
      <div className="fx-yukle-golge" style={{ width: size * 0.62, height: Math.max(5, size * 0.1), marginTop: 4, borderRadius: '50%', background: '#000' }} />
      <style>{`
        .fx-yukle-suzul { animation: fxYukleSuzul 1.6s ease-in-out infinite; }
        .fx-yukle-golge { opacity: .3; animation: fxYukleGolge 1.6s ease-in-out infinite; }
        @keyframes fxYukleSuzul { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
        @keyframes fxYukleGolge { 0%,100% { transform: scaleX(1); opacity: .3 } 50% { transform: scaleX(.7); opacity: .16 } }
        @media (prefers-reduced-motion: reduce) { .fx-yukle-suzul, .fx-yukle-golge { animation: none; } }
      `}</style>
    </div>
  )
}
