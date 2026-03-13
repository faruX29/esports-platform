import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await signIn({ email, password })
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      setError(err.message || 'Giris basarisiz.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'grid', placeItems: 'center', padding: 16, background: 'radial-gradient(ellipse at 20% 10%, rgba(200,16,46,.15), transparent 45%), radial-gradient(ellipse at 80% 90%, rgba(255,255,255,.06), transparent 45%), #0a0a0a' }}>
      <div style={{ width: 'min(460px, 100%)', borderRadius: 18, border: '1px solid #1c1c1c', background: 'linear-gradient(160deg,#111,#0d0d0d)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ background: 'linear-gradient(90deg,#C8102E,#930d22 45%,#f7f7f7)', padding: 9, textAlign: 'center', fontSize: 11, color: '#fff', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>Esports Portal Access</div>
        <div style={{ padding: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, color: '#f2f2f2' }}>Giris Yap</h1>
          <p style={{ margin: '6px 0 18px', fontSize: 13, color: '#747474' }}>Hesabina baglan ve takip akisini senkronize et.</p>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px' }} />
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Sifre" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px' }} />
            <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#C8102E,#ff4b63)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Baglaniliyor...' : 'Giris Yap'}</button>
            {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
          </form>

          <div style={{ marginTop: 14, fontSize: 12, color: '#777' }}>
            Hesabin yok mu? <Link to="/register" style={{ color: '#f2f2f2' }}>Kayit ol</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
