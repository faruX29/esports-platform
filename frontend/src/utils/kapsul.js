/**
 * Kapsül (pill) stili: lig şeridi ve aşama şeritleri (`components/KapsulSerit.jsx`)
 * aynı görünümü buradan alır.
 */
import { FEXT } from '../theme'

/** Tek kapsülün stili; `aktif` = seçili / bulunulan sayfa. */
export function kapsulStili(aktif) {
  return {
    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
    cursor: aktif ? 'default' : 'pointer',
    padding: '7px 13px', minHeight: 36, boxSizing: 'border-box', borderRadius: 999,
    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', textDecoration: 'none',
    border: aktif ? `1px solid ${FEXT.accentBorder}` : '1px solid var(--line-2)',
    background: aktif ? FEXT.accentSoftBg : 'var(--surface)',
    color: aktif ? FEXT.accentText : 'var(--text-2)',
    transition: 'border-color .15s',
  }
}

/** Fareyle üzerine gelince kenar vurgusu (seçili kapsülde yok). */
export function kapsulHover(aktif) {
  if (aktif) return {}
  return {
    onMouseEnter: e => { e.currentTarget.style.borderColor = FEXT.accentBorder },
    onMouseLeave: e => { e.currentTarget.style.borderColor = 'var(--line-2)' },
  }
}
