import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Turnstile from '../components/Turnstile'
import { TURNSTILE_ENABLED } from '../features'
import { CircleCheck } from 'lucide-react'

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const captchaRef = useRef(null)

  async function onSubmit(e) {
    e.preventDefault()
    if (TURNSTILE_ENABLED && !captchaToken) {
      setError('Lütfen "robot değilim" doğrulamasını tamamla.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await requestPasswordReset(email, captchaToken)
      setSent(true)
    } catch (err) {
      setError(err.message || 'İşlem başarısız.')
      captchaRef.current?.reset()
      setCaptchaToken('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'radial-gradient(ellipse at 20% 10%, rgba(223,72,136,.14), transparent 45%), var(--bg)' }}>
      <div style={{ width: 'min(440px, 100%)', borderRadius: 18, border: '1px solid var(--line)', background: 'var(--surface)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ height: 4, background: 'linear-gradient(90deg,#DF4888,#8B3AA0 55%,#6A297F)' }} />
        <div style={{ padding: 24 }}>
          <h1 style={{ margin: 0, fontSize: 24, color: 'var(--text)' }}>Şifreni mi unuttun?</h1>
          <p style={{ margin: '6px 0 18px', fontSize: 13, color: 'var(--text-3)' }}>E-postanı gir, sıfırlama bağlantısı gönderelim.</p>

          {sent ? (
            <div style={{ fontSize: 14, color: '#4ade80', lineHeight: 1.6 }}>
              <CircleCheck size={15} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} /> Sıfırlama bağlantısı <b style={{ color: '#ddfffb' }}>{email}</b> adresine gönderildi.
              E-postandaki linke tıklayıp yeni şifreni belirle.
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-4)' }}>
                <Link to="/login" style={{ color: 'var(--text-1)' }}>Girişe dön</Link>
              </div>
            </div>
          ) : (
            <>
              <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 11, padding: '11px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} />
                <Turnstile ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken('')} />
                <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Gönderiliyor...' : 'Sıfırlama Bağlantısı Gönder'}</button>
                {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
              </form>
              <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-4)' }}>
                <Link to="/login" style={{ color: 'var(--text-1)' }}>Girişe dön</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
