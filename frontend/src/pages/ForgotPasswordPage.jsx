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
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'radial-gradient(ellipse at 20% 10%, rgba(200,16,46,.15), transparent 45%), #0b0f19' }}>
      <div style={{ width: 'min(460px, 100%)', borderRadius: 18, border: '1px solid #172032', background: 'linear-gradient(160deg,#131b2b,#131b2b)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ background: 'linear-gradient(90deg,#C8102E,#930d22 45%,#e2e8f0)', padding: 9, textAlign: 'center', fontSize: 11, color: '#fff', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>Password Recovery</div>
        <div style={{ padding: 22 }}>
          <h1 style={{ margin: 0, fontSize: 26, color: '#e2e8f0' }}>Şifreni mi unuttun?</h1>
          <p style={{ margin: '6px 0 18px', fontSize: 13, color: '#64748b' }}>E-postanı gir, sıfırlama bağlantısı gönderelim.</p>

          {sent ? (
            <div style={{ fontSize: 14, color: '#4ade80', lineHeight: 1.6 }}>
              <CircleCheck size={15} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} /> Sıfırlama bağlantısı <b style={{ color: '#ddfffb' }}>{email}</b> adresine gönderildi.
              E-postandaki linke tıklayıp yeni şifreni belirle.
              <div style={{ marginTop: 14, fontSize: 12, color: '#64748b' }}>
                <Link to="/login" style={{ color: '#e2e8f0' }}>Girişe dön</Link>
              </div>
            </div>
          ) : (
            <>
              <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" style={{ background: '#131b2b', border: '1px solid #26324a', color: '#fff', borderRadius: 11, padding: '11px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} />
                <Turnstile ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken('')} />
                <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#C8102E,#ff4b63)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Gönderiliyor...' : 'Sıfırlama Bağlantısı Gönder'}</button>
                {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
              </form>
              <div style={{ marginTop: 14, fontSize: 12, color: '#64748b' }}>
                <Link to="/login" style={{ color: '#e2e8f0' }}>Girişe dön</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
