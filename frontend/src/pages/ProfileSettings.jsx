import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import TeamPicker from '../components/TeamPicker'
import { getEsportsName } from '../utils/esportsName'

export default function ProfileSettings() {
  const navigate = useNavigate()
  const { user, profile, updateProfile } = useAuth()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [gamertag, setGamertag] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [favoriteTeamId, setFavoriteTeamId] = useState(null)
  const [showBadge, setShowBadge] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setFirstName(profile?.first_name || '')
    setLastName(profile?.last_name || '')
    setGamertag(profile?.username || '')
    setAvatarUrl(profile?.avatar_url || '')
    setFavoriteTeamId(profile?.favorite_team_id ?? null)
    setShowBadge(profile?.show_team_badge !== false)
  }, [profile])

  const preview = getEsportsName({ first_name: firstName, last_name: lastName, username: gamertag })
  const fallbackAvatar = useMemo(() => {
    const source = gamertag || user?.email || 'ES'
    return source.slice(0, 2).toUpperCase()
  }, [gamertag, user?.email])

  async function onSave(e) {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    try {
      await updateProfile({
        username: gamertag.trim() || null,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        favorite_team_id: favoriteTeamId ?? null,
        show_team_badge: showBadge,
      })
      setMsg('Profil kaydedildi.')
    } catch (err) {
      setMsg(`Hata: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = { background: '#0d0d0d', border: '1px solid #222', borderRadius: 10, color: '#fff', padding: '10px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 16px 48px' }}>
      <div style={{ background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)', borderRadius: '14px 14px 0 0', padding: 8, display: 'flex', justifyContent: 'center', gap: 8, fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>
        <span>Turkish Pride</span>
      </div>

      <div style={{ background: '#111', border: '1px solid #1a1a1a', borderTop: 'none', borderRadius: '0 0 16px 16px', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Profil Ayarları</div>
            <div style={{ fontSize: 12, color: '#666' }}>{user?.email}</div>
          </div>
          <button onClick={() => navigate(-1)} style={{ background: '#0d0d0d', color: '#777', border: '1px solid #242424', borderRadius: 10, padding: '7px 11px', cursor: 'pointer' }}>Geri</button>
        </div>

        <form onSubmit={onSave} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#888' }}>Ad</span>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Ömer Faruk" style={inputStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#888' }}>Soyad</span>
              <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Selçuk" style={inputStyle} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888' }}>Gamertag / Oyuncu Adı</span>
            <input value={gamertag} onChange={e => setGamertag(e.target.value)} placeholder="faruks" style={inputStyle} />
          </label>

          {gamertag.trim() && (
            <div style={{ fontSize: 12, color: '#8fd6c9', marginTop: -4 }}>
              Görünen adın: <b style={{ color: '#ddfffb' }}>{preview}</b>
            </div>
          )}

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888' }}>Favori Takım</span>
            <TeamPicker value={favoriteTeamId} onChange={id => setFavoriteTeamId(id)} />
          </label>

          {/* Rozet tercihi — kullanıcı isterse takım logosunu gizler */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: '#0d0d0d', border: '1px solid #222', borderRadius: 10, padding: '10px 12px' }}>
            <input type="checkbox" checked={showBadge} onChange={e => setShowBadge(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#C8102E' }} />
            <span style={{ fontSize: 13, color: '#ddd' }}>
              Forum yorumlarımda favori takım logomu <b>göster</b>
              <span style={{ display: 'block', fontSize: 11, color: '#777' }}>Kapatırsan yorumlarında takım rozeti çıkmaz.</span>
            </span>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888' }}>Avatar URL</span>
            <input value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: '2px solid #262626' }} />
              : <div style={{ width: 42, height: 42, borderRadius: '50%', border: '2px solid #262626', display: 'grid', placeItems: 'center', color: '#bbb', fontWeight: 800 }}>{fallbackAvatar}</div>
            }
            <button disabled={saving} style={{ background: 'linear-gradient(135deg,#FF4655,#F0A500)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
            {msg && <span style={{ fontSize: 12, color: msg.startsWith('Hata') ? '#FF4655' : '#4ade80' }}>{msg}</span>}
          </div>
        </form>
      </div>
    </div>
  )
}
