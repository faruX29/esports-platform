import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Turnstile from '../components/Turnstile'
import { DISCORD_ENABLED, TURNSTILE_ENABLED } from '../features'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn, signInWithDiscord } = useAuth()

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
      setError(err.message || 'Giris basarisiz.')
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

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'radial-gradient(ellipse at 20% 10%, rgba(200,16,46,.15), transparent 45%), radial-gradient(ellipse at 80% 90%, rgba(255,255,255,.06), transparent 45%), #0a0a0a' }}>
      <div style={{ width: 'min(460px, 100%)', borderRadius: 18, border: '1px solid #1c1c1c', background: 'linear-gradient(160deg,#111,#0d0d0d)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ background: 'linear-gradient(90deg,#C8102E,#930d22 45%,#f7f7f7)', padding: 9, textAlign: 'center', fontSize: 11, color: '#fff', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>Esports Portal Access</div>
        <div style={{ padding: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, color: '#f2f2f2' }}>Giris Yap</h1>
          <p style={{ margin: '6px 0 18px', fontSize: 13, color: '#747474' }}>Hesabina baglan ve takip akisini senkronize et.</p>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} />
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Sifre" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} />
            <Turnstile ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken('')} />
            <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#C8102E,#ff4b63)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Baglaniliyor...' : 'Giris Yap'}</button>
            {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
          </form>

          <div style={{ marginTop: 10, textAlign: 'right' }}>
            <Link to="/forgot-password" style={{ fontSize: 12, color: '#9db4ff', textDecoration: 'none' }}>Şifremi unuttum?</Link>
          </div>

          {DISCORD_ENABLED && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
                <div style={{ flex: 1, height: 1, background: '#222' }} />
                <span style={{ fontSize: 11, color: '#666' }}>veya</span>
                <div style={{ flex: 1, height: 1, background: '#222' }} />
              </div>
              <button type="button" onClick={onDiscord} style={{ width: '100%', border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: '#5865F2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>🎮</span> Discord ile Giriş Yap
              </button>
            </>
          )}

          <div style={{ marginTop: 14, fontSize: 12, color: '#777' }}>
            Hesabin yok mu? <Link to="/register" style={{ color: '#f2f2f2' }}>Kayit ol</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
