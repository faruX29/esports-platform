import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { signUp } = useAuth()

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function onSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      await signUp({ username, email, password })
      setSuccess('Kayit tamamlandi. E-posta dogrulama adimini kontrol edin.')
      setTimeout(() => navigate('/login'), 900)
    } catch (err) {
      setError(err.message || 'Kayit basarisiz.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'grid', placeItems: 'center', padding: 16, background: 'radial-gradient(ellipse at 78% 12%, rgba(200,16,46,.16), transparent 45%), radial-gradient(ellipse at 20% 88%, rgba(255,255,255,.05), transparent 45%), #0a0a0a' }}>
      <div style={{ width: 'min(500px, 100%)', borderRadius: 18, border: '1px solid #1c1c1c', background: 'linear-gradient(160deg,#111,#0d0d0d)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ background: 'linear-gradient(90deg,#f7f7f7,#C8102E 55%,#930d22)', padding: 9, textAlign: 'center', fontSize: 11, color: '#111', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>New Account Registration</div>
        <div style={{ padding: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, color: '#f2f2f2' }}>Kayit Ol</h1>
          <p style={{ margin: '6px 0 18px', fontSize: 13, color: '#747474' }}>Kisisel profilin ve favorilerin bulutta saklansin.</p>

          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
            <input required value={username} onChange={e => setUsername(e.target.value)} placeholder="Kullanici adi" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px' }} />
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="E-posta" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px' }} />
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Sifre (min 6)" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px' }} />
            <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#C8102E,#ff4b63)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Kaydediliyor...' : 'Kayit Ol'}</button>
            {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
            {success && <div style={{ fontSize: 12, color: '#4ade80' }}>{success}</div>}
          </form>

          <div style={{ marginTop: 14, fontSize: 12, color: '#777' }}>
            Zaten hesabin var mi? <Link to="/login" style={{ color: '#f2f2f2' }}>Giris yap</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
