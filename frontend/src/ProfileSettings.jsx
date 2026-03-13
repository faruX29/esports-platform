import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { useAuth } from './context/AuthContext'
import { useUser } from './context/UserContext'

export default function ProfileSettings() {
  const navigate = useNavigate()
  const { user, profile, updateProfile } = useAuth()
  const { followedTeamIds } = useUser()

  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [favoriteTeamId, setFavoriteTeamId] = useState('')
  const [teams, setTeams] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setUsername(profile?.username || '')
    setAvatarUrl(profile?.avatar_url || '')
    setFavoriteTeamId(profile?.favorite_team_id ? String(profile.favorite_team_id) : '')
  }, [profile])

  useEffect(() => {
    async function fetchTeams() {
      if (!followedTeamIds.length) {
        setTeams([])
        return
      }
      const { data } = await supabase
        .from('teams')
        .select('id,name,logo_url')
        .in('id', followedTeamIds)
      setTeams(data || [])
    }
    fetchTeams()
  }, [followedTeamIds])

  const fallbackAvatar = useMemo(() => {
    const source = username || user?.email || 'ES'
    return source.slice(0, 2).toUpperCase()
  }, [username, user?.email])

  async function onSave(e) {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    try {
      await updateProfile({
        username: username.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        favorite_team_id: favoriteTeamId ? Number(favoriteTeamId) : null,
      })
      setMsg('Profil kaydedildi.')
    } catch (err) {
      setMsg(`Hata: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 16px 48px' }}>
      <div style={{
        background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)',
        borderRadius: '14px 14px 0 0',
        padding: 8,
        display: 'flex', justifyContent: 'center', gap: 8,
        fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
      }}>
        <span>Turkish Pride</span>
      </div>

      <div style={{ background: '#111', border: '1px solid #1a1a1a', borderTop: 'none', borderRadius: '0 0 16px 16px', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Profil Ayarlari</div>
            <div style={{ fontSize: 12, color: '#666' }}>{user?.email}</div>
          </div>
          <button onClick={() => navigate(-1)} style={{ background: '#0d0d0d', color: '#777', border: '1px solid #242424', borderRadius: 10, padding: '7px 11px', cursor: 'pointer' }}>Geri</button>
        </div>

        <form onSubmit={onSave} style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888' }}>Kullanici Adi</span>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="ornek: cimbomfan" style={{ background: '#0d0d0d', border: '1px solid #222', borderRadius: 10, color: '#fff', padding: '10px 12px' }} />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888' }}>Avatar URL</span>
            <input value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder="https://..." style={{ background: '#0d0d0d', border: '1px solid #222', borderRadius: 10, color: '#fff', padding: '10px 12px' }} />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888' }}>Favori Takim</span>
            <select value={favoriteTeamId} onChange={e => setFavoriteTeamId(e.target.value)} style={{ background: '#0d0d0d', border: '1px solid #222', borderRadius: 10, color: '#fff', padding: '10px 12px' }}>
              <option value="">Secili degil</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
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
