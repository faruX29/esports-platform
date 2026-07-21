import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../supabaseClient'
import PasswordInput from '../components/PasswordInput'
import { authErrorMessage } from '../utils/authError'
import { CircleCheck } from 'lucide-react'

/**
 * Şifre sıfırlama — kullanıcı e-postadaki linke tıklayınca buraya gelir.
 * Supabase detectSessionInUrl ile URL'deki recovery token'ı işleyip geçici bir
 * oturum kurar (PASSWORD_RECOVERY event → AuthContext recoveryMode=true). Kullanıcı
 * yeni şifresini belirleyene kadar RecoveryGate onu bu sayfada tutar.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const { updatePassword, clearRecoveryMode, signOut } = useAuth()
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
      clearRecoveryMode()
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 1200)
    } catch (err) {
      setError(authErrorMessage(err, 'Şifre güncellenemedi. Bağlantının süresi dolmuş olabilir.'))
    } finally {
      setLoading(false)
    }
  }

  async function onCancel() {
    try { await signOut() } catch { /* yoksay */ }
    clearRecoveryMode()
    navigate('/login', { replace: true })
  }

  const inputStyle = { background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 11, padding: '11px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }

  return (
    <div style={{ minHeight: 'calc(100vh - 58px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'radial-gradient(ellipse at 20% 10%, rgba(223,72,136,.14), transparent 45%), var(--bg)' }}>
      <div style={{ width: 'min(460px, 100%)', borderRadius: 18, border: '1px solid var(--line)', background: 'var(--surface)', overflow: 'hidden', boxShadow: '0 18px 40px rgba(0,0,0,.5)' }}>
        <div style={{ height: 4, background: 'linear-gradient(90deg,#DF4888,#8B3AA0 55%,#6A297F)' }} />
        <div style={{ padding: 24 }}>
          <h1 style={{ margin: 0, fontSize: 24, color: 'var(--text)' }}>Yeni Şifre Belirle</h1>
          {done ? (
            <p style={{ marginTop: 14, fontSize: 14, color: 'var(--success-fg)', display: 'flex', alignItems: 'center', gap: 6 }}><CircleCheck size={15} /> Şifren güncellendi! Yönlendiriliyorsun...</p>
          ) : (
            <>
              <p style={{ margin: '8px 0 18px', fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
                {ready
                  ? 'Hesabına girebilmen için yeni bir şifre belirle. Bunu tamamlamadan devam edemezsin.'
                  : 'Bağlantı doğrulanıyor... (e-postadaki linkten geldiysen birkaç saniye sürebilir)'}
              </p>
              <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
                <PasswordInput required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="Yeni şifre (min 6)" autoComplete="new-password" style={inputStyle} />
                <PasswordInput required minLength={6} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Yeni şifre (tekrar)" autoComplete="new-password" style={inputStyle} />
                <button disabled={loading} style={{ marginTop: 4, border: 'none', borderRadius: 11, padding: '11px 12px', cursor: 'pointer', color: '#fff', fontWeight: 800, background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)', opacity: loading ? 0.6 : 1 }}>{loading ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}</button>
                {error && <div style={{ fontSize: 12, color: '#FF4655' }}>{error}</div>}
              </form>
              <button type="button" onClick={onCancel} style={{ marginTop: 14, background: 'transparent', border: 'none', color: 'var(--text-4)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                Vazgeç ve çıkış yap
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
