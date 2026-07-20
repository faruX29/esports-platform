import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Turnstile from '../components/Turnstile'
import PasswordInput from '../components/PasswordInput'
import GoogleIcon from '../components/GoogleIcon'
import { MessageCircle } from 'lucide-react'
import { DISCORD_ENABLED, GOOGLE_ENABLED, TURNSTILE_ENABLED } from '../features'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { signUp, signInWithDiscord, signInWithGoogle } = useAuth()

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
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
    setSuccess('')
    try {
      const data = await signUp({ username, email, password, captchaToken })
      // Doğrulama AÇIK ise session gelmez → e-posta onayı iste.
      // KAPALI ise session döner → direkt giriş.
      if (data?.session) {
        setSuccess('Kayıt tamamlandı! Yönlendiriliyorsun...')
        setTimeout(() => navigate('/', { replace: true }), 700)
      } else {
        setSuccess('Kayıt alındı! E-postana gönderdiğimiz doğrulama linkine tıkla, sonra giriş yap.')
        setTimeout(() => navigate('/login'), 3500)
      }
    } catch (err) {
      setError(err.message || 'Kayıt başarısız.')
      // Turnstile token tek-kullanımlık — hatadan sonra yenile.
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

  const inputStyle = { background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 11, padding: '11px 12px', minWidth: 0, width: '100%', boxSizing: 'border-box' }
  const oauthEnabled = DISCORD_ENABLED || GOOGLE_ENABLED

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'radial-gradient(ellipse at 78% 12%, rgba(223,72,136,.16), transparent 45%), radial-gradient(ellipse at 20% 88%, rgba(106,41,127,.14), transparent 45%), var(--bg)' }}>
      <div style={{ width: 'min(460px, 100%)', borderRadius: 18, border: '1px solid var(--line)', background: 'var(--surface)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ height: 4, background: 'linear-gradient(90deg,#DF4888,#8B3AA0 55%,#6A297F)' }} />
        <div style={{ padding: 24 }}>
          <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.1, color: 'var(--text)' }}>Kayıt Ol</h1>
          <p style={{ margin: '6px 0 18px', fontSize: 13, color: 'var(--text-3)' }}>Takip ettiğin takımların maçları, transferleri ve haberleri tek yerde — profilin bulutta saklansın.</p>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
            <input required value={username} onChange={e => setUsername(e.target.value)} placeholder="Kullanıcı adı" autoComplete="username" style={inputStyle} />
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" autoComplete="email" style={inputStyle} />
            <PasswordInput required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Şifre (min 6)" autoComplete="new-password" style={inputStyle} />
            <Turnstile ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken('')} />
            <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Kaydediliyor...' : 'Kayıt Ol'}</button>
            {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
            {success && <div style={{ fontSize: 12, color: '#4ade80' }}>{success}</div>}
          </form>

          {oauthEnabled && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-4)' }}>veya</span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {GOOGLE_ENABLED && (
                  <button type="button" onClick={onGoogle} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: 'var(--text)', fontWeight: 700, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <GoogleIcon /> <span style={{ color: '#1f2937' }}>Google ile Kayıt Ol</span>
                  </button>
                )}
                {DISCORD_ENABLED && (
                  <button type="button" onClick={onDiscord} style={{ width: '100%', border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: '#5865F2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <MessageCircle size={16} /> Discord ile Kayıt Ol
                  </button>
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-3)' }}>
            Zaten hesabın var mı? <Link to="/login" style={{ color: 'var(--text)' }}>Giriş yap</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
