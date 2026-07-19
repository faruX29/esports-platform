import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * PasswordInput — göz simgesiyle göster/gizle destekli şifre alanı.
 * Standart <input> proplarını (value, onChange, required, minLength, placeholder,
 * autoComplete) geçirir; `style` alanın kendisine uygulanır.
 */
export default function PasswordInput({ style, ...props }) {
  const [show, setShow] = useState(false)
  const base = {
    background: 'var(--surface)', border: '1px solid var(--line)', color: '#fff',
    borderRadius: 11, padding: '11px 42px 11px 12px', width: '100%',
    minWidth: 0, boxSizing: 'border-box',
  }
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input {...props} type={show ? 'text' : 'password'} style={{ ...base, ...style }} />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        aria-label={show ? 'Şifreyi gizle' : 'Şifreyi göster'}
        title={show ? 'Şifreyi gizle' : 'Şifreyi göster'}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', color: 'var(--text-4)', cursor: 'pointer',
          padding: 6, display: 'inline-flex', alignItems: 'center', borderRadius: 8,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-2)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-4)')}
        tabIndex={-1}
      >
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  )
}
