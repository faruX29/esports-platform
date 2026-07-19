import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useUser } from '../context/UserContext'
import { supabase } from '../supabaseClient'
import TeamPicker from '../components/TeamPicker'
import InitialsImage from '../components/InitialsImage'
import PasswordInput from '../components/PasswordInput'
import { normalizeGameId } from '../utils/gameUtils'

const GAME_SHORT = { valorant: 'VAL', cs2: 'CS2', lol: 'LOL', dota2: 'DOTA2' }
const GAME_COLOR = { valorant: '#FF4655', cs2: '#F0A500', lol: '#C89B3C', dota2: '#9d2226' }

// Takip ettiğim takımlar — listele, çıkar, ara & ekle. (Takipler follows tablosuna
// UserContext üzerinden yazılır; oyun ataması bir sonraki yüklemede takımdan türetilir.)
function FollowedTeamsManager() {
  const { followedTeamIds, followTeam, unfollowTeam, isTeamFollowed } = useUser()
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(false)
  const [pickerKey, setPickerKey] = useState(0)

  useEffect(() => {
    let alive = true
    async function load() {
      if (!followedTeamIds.length) { setTeams([]); return }
      setLoading(true)
      const { data } = await supabase
        .from('teams')
        .select('id,name,logo_url,game:games(id,name,slug)')
        .in('id', followedTeamIds)
      if (!alive) return
      const byId = new Map((data || []).map(t => [t.id, t]))
      setTeams(followedTeamIds.map(id => byId.get(id)).filter(Boolean))
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [followedTeamIds])

  function handleAdd(id) {
    if (!id) return
    if (!isTeamFollowed(id)) followTeam(id)
    setPickerKey(k => k + 1)
  }

  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Takip Ettiğim Takımlar ({followedTeamIds.length})</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>Buradaki takımların maçları ve haberleri akışında öne çıkar.</div>

      {followedTeamIds.length === 0 && !loading && (
        <div style={{ fontSize: 12, color: 'var(--text-4)', border: '1px dashed var(--line)', borderRadius: 10, padding: 12, textAlign: 'center', marginBottom: 12 }}>
          Henüz takım takip etmiyorsun. Aşağıdan arayıp ekleyebilirsin.
        </div>
      )}

      {teams.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {teams.map(team => {
            const g = normalizeGameId(team?.game?.slug ?? team?.game?.name)
            const color = GAME_COLOR[g] || 'var(--text-3)'
            return (
              <div key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 11, padding: '8px 12px' }}>
                <InitialsImage src={team.logo_url} name={team.name} width={26} height={26} borderRadius={6} objectFit="contain" />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
                {g && (
                  <span style={{ fontSize: 9, fontWeight: 800, color, background: `${color}1f`, border: `1px solid ${color}55`, borderRadius: 5, padding: '2px 6px', flexShrink: 0 }}>
                    {GAME_SHORT[g] || g.toUpperCase()}
                  </span>
                )}
                <button type="button" onClick={() => unfollowTeam(team.id)} title="Takibi bırak" style={{ background: 'transparent', border: '1px solid var(--line-2)', color: 'var(--text-3)', borderRadius: 8, width: 26, height: 26, cursor: 'pointer', flexShrink: 0, fontSize: 15, lineHeight: 1 }}>×</button>
              </div>
            )
          })}
        </div>
      )}

      <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Takım ekle</span>
      <TeamPicker key={pickerKey} value={null} onChange={id => handleAdd(id)} placeholder="Takip etmek için takım ara..." />
    </div>
  )
}

export default function ProfileSettings() {
  const navigate = useNavigate()
  const { user, profile, updateProfile, updatePassword } = useAuth()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [gamertag, setGamertag] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [favoriteTeamId, setFavoriteTeamId] = useState(null)
  const [showBadge, setShowBadge] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Şifre değiştirme (aynı sayfada, ayrı form)
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState('')

  // Profil fotoğrafı yükleme (Supabase Storage)
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    setFirstName(profile?.first_name || '')
    setLastName(profile?.last_name || '')
    setGamertag(profile?.username || '')
    setAvatarUrl(profile?.avatar_url || '')
    setFavoriteTeamId(profile?.favorite_team_id ?? null)
    setShowBadge(profile?.show_team_badge !== false)
  }, [profile])

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

  async function onChangePassword(e) {
    e.preventDefault()
    setPwMsg('')
    if (newPass.length < 6) { setPwMsg('Hata: Şifre en az 6 karakter olmalı.'); return }
    if (newPass !== confirmPass) { setPwMsg('Hata: Şifreler eşleşmiyor.'); return }
    setPwSaving(true)
    try {
      await updatePassword(newPass)
      setNewPass(''); setConfirmPass('')
      setPwMsg('Şifren güncellendi.')
    } catch (err) {
      setPwMsg(`Hata: ${err.message}`)
    } finally {
      setPwSaving(false)
    }
  }

  async function handleAvatarFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // aynı dosyayı tekrar seçebilmek için sıfırla
    if (!file) return
    if (!file.type.startsWith('image/')) { setMsg('Hata: Lütfen bir görsel dosyası seç.'); return }
    if (file.size > 3 * 1024 * 1024) { setMsg('Hata: Görsel en fazla 3 MB olabilir.'); return }
    if (!user?.id) { setMsg('Hata: Önce giriş yapmalısın.'); return }
    setUploading(true); setMsg('')
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const path = `${user.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = data.publicUrl
      setAvatarUrl(url)
      await updateProfile({ avatar_url: url }) // fotoğrafı anında kaydet (Kaydet'e basmaya gerek yok)
      setMsg('Profil fotoğrafı güncellendi.')
    } catch (err) {
      setMsg(`Hata: ${err.message || 'Yükleme başarısız.'}`)
    } finally {
      setUploading(false)
    }
  }

  async function removeAvatar() {
    setAvatarUrl('')
    setMsg('')
    try { await updateProfile({ avatar_url: null }) } catch (err) { setMsg(`Hata: ${err.message}`) }
  }

  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', padding: '10px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 16px 48px' }}>
      <div style={{ height: 4, background: 'linear-gradient(90deg,#DF4888,#8B3AA0 55%,#6A297F)', borderRadius: '14px 14px 0 0' }} />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderTop: 'none', borderRadius: '0 0 16px 16px', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Profil Ayarları</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{user?.email}</div>
          </div>
          <button onClick={() => navigate(-1)} style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--line)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer' }}>Geri</button>
        </div>

        <form onSubmit={onSave} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Ad</span>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Ömer Faruk" style={inputStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Soyad</span>
              <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Selçuk" style={inputStyle} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Kullanıcı Adı</span>
            <input value={gamertag} onChange={e => setGamertag(e.target.value)} placeholder="kullanici_adi" style={inputStyle} />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Favori Takım</span>
            <TeamPicker value={favoriteTeamId} onChange={id => setFavoriteTeamId(id)} />
          </label>

          {/* Rozet tercihi — kullanıcı isterse takım logosunu gizler */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
            <input type="checkbox" checked={showBadge} onChange={e => setShowBadge(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#DF4888' }} />
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
              Forum yorumlarımda favori takım logomu <b>göster</b>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>Kapatırsan yorumlarında takım rozeti çıkmaz.</span>
            </span>
          </label>

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Profil Fotoğrafı</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line)', flexShrink: 0 }} />
                : <div style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid var(--line)', display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontWeight: 800, flexShrink: 0 }}>{fallbackAvatar}</div>
              }
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 14px', fontWeight: 700, cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
                  {uploading ? 'Yükleniyor...' : (avatarUrl ? 'Fotoğrafı Değiştir' : 'Fotoğraf Seç')}
                </button>
                {avatarUrl && (
                  <button type="button" onClick={removeAvatar} disabled={uploading} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '9px 14px', fontWeight: 700, cursor: 'pointer' }}>
                    Kaldır
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarFile} style={{ display: 'none' }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Bilgisayarından JPG/PNG seç — en fazla 3 MB. Fotoğraf anında kaydedilir.</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <button disabled={saving} style={{ background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
            {msg && <span style={{ fontSize: 12, color: msg.startsWith('Hata') ? '#FF4655' : '#4ade80' }}>{msg}</span>}
          </div>
        </form>

        {/* Şifre değiştirme — sadece e-posta/şifre ile giriş yapanlar için anlamlı;
            Google/Discord kullanıcıları da yeni bir şifre atayarak e-posta girişi açabilir. */}
        <form onSubmit={onChangePassword} style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--line)', display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Şifre Değiştir</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PasswordInput value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Yeni şifre (min 6)" autoComplete="new-password" style={{ ...inputStyle, background: 'var(--surface)' }} />
            <PasswordInput value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Yeni şifre (tekrar)" autoComplete="new-password" style={{ ...inputStyle, background: 'var(--surface)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button disabled={pwSaving || !newPass} style={{ background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 16px', fontWeight: 700, cursor: 'pointer', opacity: (pwSaving || !newPass) ? 0.6 : 1 }}>{pwSaving ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}</button>
            {pwMsg && <span style={{ fontSize: 12, color: pwMsg.startsWith('Hata') ? '#FF4655' : '#4ade80' }}>{pwMsg}</span>}
          </div>
        </form>

        <FollowedTeamsManager />
      </div>
    </div>
  )
}
