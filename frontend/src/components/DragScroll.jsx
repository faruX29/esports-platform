import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Yatay şerit: görünür scrollbar YOK.
 *  - Mobil: parmakla basılı tutup kaydırma (native touch scroll — dokunmuyoruz).
 *  - Masaüstü: fareyle basılı tutup sürükleme + kenarlardaki oklarla YUMUŞAK kayma.
 *
 * Sürükleme sonrası yanlışlıkla karta tıklanmasın diye 5px'ten fazla kaydıysa
 * sonraki click capture aşamasında yutulur.
 *
 * @param {number} step  ok butonunun bir basışta kaydıracağı px (varsayılan: görünen genişliğin %80'i)
 */
export default function DragScroll({ children, className = '', style, step, ariaLabel = 'Yatay liste' }) {
  const ref = useRef(null)
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false })
  const [edges, setEdges] = useState({ left: false, right: false })

  const syncEdges = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    syncEdges()
    el.addEventListener('scroll', syncEdges, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncEdges) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', syncEdges); ro?.disconnect() }
  }, [syncEdges, children])

  // ── Fareyle sürükleyerek kaydırma (mobilde native touch zaten çalışıyor) ──
  const onPointerDown = e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    const el = ref.current
    if (!el) return
    drag.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false }
  }
  const onPointerMove = e => {
    const d = drag.current
    const el = ref.current
    if (!d.active || !el) return
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > 5) d.moved = true
    el.scrollLeft = d.startScroll - dx
    if (d.moved) e.preventDefault()
  }
  const endDrag = () => {
    const d = drag.current
    d.active = false
    if (d.moved) {
      // Sürükleme bitişindeki click'i yut → kart açılmasın.
      const swallow = ev => { ev.stopPropagation(); ev.preventDefault() }
      ref.current?.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => ref.current?.removeEventListener('click', swallow, { capture: true }), 0)
    }
  }

  const scrollByStep = dir => {
    const el = ref.current
    if (!el) return
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const amount = step || Math.max(160, Math.round(el.clientWidth * 0.8))
    el.scrollBy({ left: dir * amount, behavior: reduce ? 'auto' : 'smooth' })
  }

  const arrowStyle = side => ({
    position: 'absolute', top: '50%', [side]: -6, transform: 'translateY(-50%)',
    width: 30, height: 30, borderRadius: '50%', zIndex: 2,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--surface-2)', border: '1px solid var(--line-2)',
    color: 'var(--text-3)', cursor: 'pointer', padding: 0,
    boxShadow: '0 4px 14px rgba(0,0,0,.35)',
    transition: 'background .15s, color .15s',
  })

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={ref}
        className={`drag-scroll ${className}`}
        style={{ display: 'flex', overflowX: 'auto', ...style }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onDragStart={e => e.preventDefault()}
      >
        {children}
      </div>
      {edges.left && (
        <button
          type="button" className="hide-sm" aria-label={`${ariaLabel}: geri kaydır`}
          onClick={() => scrollByStep(-1)} style={arrowStyle('left')}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)'; e.currentTarget.style.color = 'var(--text-1)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-3)' }}
        ><ChevronLeft size={16} /></button>
      )}
      {edges.right && (
        <button
          type="button" className="hide-sm" aria-label={`${ariaLabel}: ileri kaydır`}
          onClick={() => scrollByStep(1)} style={arrowStyle('right')}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)'; e.currentTarget.style.color = 'var(--text-1)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-3)' }}
        ><ChevronRight size={16} /></button>
      )}
    </div>
  )
}
