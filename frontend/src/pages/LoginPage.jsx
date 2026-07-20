import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Turnstile from '../components/Turnstile'
import PasswordInput from '../components/PasswordInput'
import GoogleIcon from '../components/GoogleIcon'
import { DISCORD_ENABLED, GOOGLE_ENABLED, TURNSTILE_ENABLED } from '../features'
import { MessageCircle } from 'lucide-react'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn, signInWithDiscord, signInWithGoogle } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
      await signIn({ email, password, captchaToken })
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message || 'Giriş başarısız.')
      captchaRef.current?.reset()
      setCaptchaToken('')
    } finally {
      setLoading(false)
    }
  }

  async function onDiscord() {
    setError('')
    try { await signInWithDiscord() } catch (err) { setError(err.message || 'Discord girişi başarısız.') }
  }
  async function onGoogle() {
    setError('')
    try { await signInWithGoogle() } catch (err) { setError(err.message || 'Google girişi başarısız.') }
  }

  const inputStyle = { background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 11, padding: '11px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }
  const oauthEnabled = DISCORD_ENABLED || GOOGLE_ENABLED

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'radial-gradient(ellipse at 20% 10%, rgba(223,72,136,.15), transparent 45%), radial-gradient(ellipse at 80% 90%, rgba(106,41,127,.14), transparent 45%), var(--bg)' }}>
      <div style={{ width: 'min(440px, 100%)', borderRadius: 18, border: '1px solid var(--line)', background: 'var(--surface)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ height: 4, background: 'linear-gradient(90deg,#DF4888,#8B3AA0 55%,#6A297F)' }} />
        <div style={{ padding: 24 }}>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.1, color: 'var(--text)' }}>Giriş Yap</h1>
          <p style={{ margin: '6px 0 18px', fontSize: 13, color: 'var(--text-3)' }}>Hesabına bağlan, takip akışını senkronize et.</p>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" autoComplete="email" style={inputStyle} />
            <PasswordInput required value={password} onChange={e => setPassword(e.target.value)} placeholder="Şifre" autoComplete="current-password" style={inputStyle} />
            <Turnstile ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken('')} />
            <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Bağlanılıyor...' : 'Giriş Yap'}</button>
            {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
          </form>

          <div style={{ marginTop: 10, textAlign: 'right' }}>
            <Link to="/forgot-password" style={{ fontSize: 12, color: '#c98bd6', textDecoration: 'none' }}>Şifremi unuttum?</Link>
          </div>

          {oauthEnabled && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-4)' }}>veya</span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {GOOGLE_ENABLED && (
                  <button type="button" onClick={onGoogle} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', fontWeight: 700, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <GoogleIcon /> <span style={{ color: '#1f2937' }}>Google ile Giriş Yap</span>
                  </button>
                )}
                {DISCORD_ENABLED && (
                  <button type="button" onClick={onDiscord} style={{ width: '100%', border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: '#5865F2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <MessageCircle size={16} /> Discord ile Giriş Yap
                  </button>
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-3)' }}>
            Hesabın yok mu? <Link to="/register" style={{ color: 'var(--text)' }}>Kayıt ol</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
