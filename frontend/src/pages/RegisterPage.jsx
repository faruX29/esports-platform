import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import TeamPicker from '../components/TeamPicker'
import Turnstile from '../components/Turnstile'
import { getEsportsName } from '../utils/esportsName'
import { DISCORD_ENABLED, TURNSTILE_ENABLED } from '../features'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { signUp, signInWithDiscord } = useAuth()

  const [firstName, setFirstName] = useState('')
  const [gamertag, setGamertag] = useState('')
  const [lastName, setLastName] = useState('')
  const [favoriteTeamId, setFavoriteTeamId] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const captchaRef = useRef(null)

  const preview = getEsportsName({ first_name: firstName, last_name: lastName, username: gamertag })

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
      const data = await signUp({
        username: gamertag,
        first_name: firstName,
        last_name: lastName,
        favorite_team_id: favoriteTeamId,
        email,
        password,
        captchaToken,
      })
      // Doğrulama AÇIK ise session gelmez → e-posta onayı iste.
      // KAPALI ise session döner → direkt giriş.
      if (data?.session) {
        setSuccess('Kayıt tamamlandı! Yönlendiriliyorsun...')
        setTimeout(() => navigate('/', { replace: true }), 700)
      } else {
        setSuccess('✅ Kayıt alındı! E-postana gönderdiğimiz doğrulama linkine tıkla, sonra giriş yap.')
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

  const inputStyle = { background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px' }

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'grid', placeItems: 'center', padding: 16, background: 'radial-gradient(ellipse at 78% 12%, rgba(200,16,46,.16), transparent 45%), radial-gradient(ellipse at 20% 88%, rgba(255,255,255,.05), transparent 45%), #0a0a0a' }}>
      <div style={{ width: 'min(500px, 100%)', borderRadius: 18, border: '1px solid #1c1c1c', background: 'linear-gradient(160deg,#111,#0d0d0d)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ background: 'linear-gradient(90deg,#f7f7f7,#C8102E 55%,#930d22)', padding: 9, textAlign: 'center', fontSize: 11, color: '#111', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>New Account Registration</div>
        <div style={{ padding: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, color: '#f2f2f2' }}>Kayıt Ol</h1>
          <p style={{ margin: '6px 0 18px', fontSize: 13, color: '#747474' }}>Espor kimliğini oluştur — profilin ve favorilerin bulutta saklansın.</p>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Ad" style={inputStyle} />
              <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Soyad" style={inputStyle} />
            </div>
            <input required value={gamertag} onChange={e => setGamertag(e.target.value)} placeholder="Gamertag / Oyuncu Adı" style={inputStyle} />
            {gamertag.trim() && (
              <div style={{ fontSize: 12, color: '#8fd6c9', marginTop: -4 }}>
                Görünen adın: <b style={{ color: '#ddfffb' }}>{preview}</b>
              </div>
            )}
            <TeamPicker value={favoriteTeamId} onChange={id => setFavoriteTeamId(id)} />
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" style={inputStyle} />
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Şifre (min 6)" style={inputStyle} />
            <Turnstile ref={captchaRef} onVerify={setCaptchaToken} onExpire={() => setCaptchaToken('')} />
            <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#C8102E,#ff4b63)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Kaydediliyor...' : 'Kayıt Ol'}</button>
            {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
            {success && <div style={{ fontSize: 12, color: '#4ade80' }}>{success}</div>}
          </form>

          {DISCORD_ENABLED && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
                <div style={{ flex: 1, height: 1, background: '#222' }} />
                <span style={{ fontSize: 11, color: '#666' }}>veya</span>
                <div style={{ flex: 1, height: 1, background: '#222' }} />
              </div>
              <button type="button" onClick={onDiscord} style={{ width: '100%', border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: '#5865F2', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>🎮</span> Discord ile Kayıt Ol
              </button>
            </>
          )}

          <div style={{ marginTop: 14, fontSize: 12, color: '#777' }}>
            Zaten hesabın var mı? <Link to="/login" style={{ color: '#f2f2f2' }}>Giriş yap</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
