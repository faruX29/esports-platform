// Kayan aç/kapa anahtarı (işaret kutusu yerine). Gerçek input görünmez ama
// yerinde durur: klavye (boşluk) ve ekran okuyucu onu kullanır; satırı saran
// <label> tıklamayı ona iletir. Açıkken topuz sağa kayar, zemin markanın pembesi.
export default function Anahtar({ checked, onChange, disabled = false }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: 42, height: 24, flexShrink: 0, opacity: disabled ? 0.5 : 1 }}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: disabled ? 'not-allowed' : 'pointer', zIndex: 1 }}
      />
      <span aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius: 999, background: checked ? '#DF4888' : 'var(--surface-2)', border: `1px solid ${checked ? '#DF4888' : 'var(--line-2)'}`, transition: 'background .22s ease, border-color .22s ease' }} />
      <span aria-hidden="true" style={{ position: 'absolute', top: 3, left: 3, width: 18, height: 18, borderRadius: '50%', background: checked ? '#fff' : 'var(--text-3)', boxShadow: '0 1px 3px rgba(0,0,0,.35)', transform: checked ? 'translateX(18px)' : 'translateX(0)', transition: 'transform .22s cubic-bezier(.4,0,.2,1), background .22s ease' }} />
    </span>
  )
}
