import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../supabaseClient'

/**
 * Şifre sıfırlama — kullanıcı e-postadaki linke tıklayınca buraya gelir.
 * Supabase detectSessionInUrl ile URL'deki recovery token'ı işleyip geçici
 * bir oturum kurar (PASSWORD_RECOVERY event). Kullanıcı yeni şifresini belirler.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Recovery oturumu kuruldu mu? (URL token'ı işlendikten sonra session olur)
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive && data.session) setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  async function onSubmit(e) {
    e.preventDefault()
    if (password.length < 6) { setError('Şifre en az 6 karakter olmalı.'); return }
    if (password !== confirm) { setError('Şifreler eşleşmiyor.'); return }
    setLoading(true)
    setError('')
    try {
      await updatePassword(password)
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 1200)
    } catch (err) {
      setError(err.message || 'Şifre güncellenemedi. Bağlantının süresi dolmuş olabilir.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'radial-gradient(ellipse at 20% 10%, rgba(200,16,46,.15), transparent 45%), #0a0a0a' }}>
      <div style={{ width: 'min(460px, 100%)', borderRadius: 18, border: '1px solid #1c1c1c', background: 'linear-gradient(160deg,#111,#0d0d0d)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ background: 'linear-gradient(90deg,#C8102E,#930d22 45%,#f7f7f7)', padding: 9, textAlign: 'center', fontSize: 11, color: '#fff', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>Set New Password</div>
        <div style={{ padding: 22 }}>
          <h1 style={{ margin: 0, fontSize: 26, color: '#f2f2f2' }}>Yeni Şifre Belirle</h1>
          {done ? (
            <p style={{ marginTop: 14, fontSize: 14, color: '#4ade80' }}>✅ Şifren güncellendi! Yönlendiriliyorsun...</p>
          ) : (
            <>
              <p style={{ margin: '6px 0 18px', fontSize: 13, color: '#747474' }}>
                {ready ? 'Yeni şifreni gir.' : 'Bağlantı doğrulanıyor... (e-postadaki linkten geldiysen birkaç saniye sürebilir)'}
              </p>
              <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
                <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Yeni şifre (min 6)" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} />
                <input type="password" required minLength={6} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Yeni şifre (tekrar)" style={{ background: '#0c0c0c', border: '1px solid #232323', color: '#fff', borderRadius: 11, padding: '11px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }} />
                <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#C8102E,#ff4b63)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}</button>
                {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
