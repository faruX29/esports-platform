import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useUser } from '../context/UserContext'
import { supabase } from '../supabaseClient'
import TeamPicker from '../components/TeamPicker'
import InitialsImage from '../components/InitialsImage'
import { getEsportsName } from '../utils/esportsName'
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
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid #26324a' }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Takip Ettiğim Takımlar ({followedTeamIds.length})</div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>Buradaki takımların maçları ve haberleri akışında öne çıkar.</div>

      {followedTeamIds.length === 0 && !loading && (
        <div style={{ fontSize: 12, color: '#64748b', border: '1px dashed #26324a', borderRadius: 10, padding: 12, textAlign: 'center', marginBottom: 12 }}>
          Henüz takım takip etmiyorsun. Aşağıdan arayıp ekleyebilirsin.
        </div>
      )}

      {teams.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {teams.map(team => {
            const g = normalizeGameId(team?.game?.slug ?? team?.game?.name)
            const color = GAME_COLOR[g] || '#94a3b8'
            return (
              <div key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#172032', border: '1px solid #26324a', borderRadius: 11, padding: '8px 12px' }}>
                <InitialsImage src={team.logo_url} name={team.name} width={26} height={26} borderRadius={6} objectFit="contain" />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
                {g && (
                  <span style={{ fontSize: 9, fontWeight: 800, color, background: `${color}1f`, border: `1px solid ${color}55`, borderRadius: 5, padding: '2px 6px', flexShrink: 0 }}>
                    {GAME_SHORT[g] || g.toUpperCase()}
                  </span>
                )}
                <button type="button" onClick={() => unfollowTeam(team.id)} title="Takibi bırak" style={{ background: 'transparent', border: '1px solid #33415d', color: '#94a3b8', borderRadius: 8, width: 26, height: 26, cursor: 'pointer', flexShrink: 0, fontSize: 15, lineHeight: 1 }}>×</button>
              </div>
            )
          })}
        </div>
      )}

      <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Takım ekle</span>
      <TeamPicker key={pickerKey} value={null} onChange={id => handleAdd(id)} placeholder="Takip etmek için takım ara..." />
    </div>
  )
}

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

  const inputStyle = { background: '#172032', border: '1px solid #26324a', borderRadius: 10, color: '#f8fafc', padding: '10px 12px', width: '100%', minWidth: 0, boxSizing: 'border-box' }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 16px 48px' }}>
      <div style={{ background: 'linear-gradient(90deg,#C8102E,#a00d25 40%,#001f6d)', borderRadius: '14px 14px 0 0', padding: 8, display: 'flex', justifyContent: 'center', gap: 8, fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>
        <span>Turkish Pride</span>
      </div>

      <div style={{ background: '#131b2b', border: '1px solid #26324a', borderTop: 'none', borderRadius: '0 0 16px 16px', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Profil Ayarları</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{user?.email}</div>
          </div>
          <button onClick={() => navigate(-1)} style={{ background: '#172032', color: '#94a3b8', border: '1px solid #26324a', borderRadius: 10, padding: '7px 11px', cursor: 'pointer' }}>Geri</button>
        </div>

        <form onSubmit={onSave} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Ad</span>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Ömer Faruk" style={inputStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Soyad</span>
              <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Selçuk" style={inputStyle} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Gamertag / Oyuncu Adı</span>
            <input value={gamertag} onChange={e => setGamertag(e.target.value)} placeholder="faruks" style={inputStyle} />
          </label>

          {gamertag.trim() && (
            <div style={{ fontSize: 12, color: '#8fd6c9', marginTop: -4 }}>
              Görünen adın: <b style={{ color: '#ddfffb' }}>{preview}</b>
            </div>
          )}

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Favori Takım</span>
            <TeamPicker value={favoriteTeamId} onChange={id => setFavoriteTeamId(id)} />
          </label>

          {/* Rozet tercihi — kullanıcı isterse takım logosunu gizler */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: '#172032', border: '1px solid #26324a', borderRadius: 10, padding: '10px 12px' }}>
            <input type="checkbox" checked={showBadge} onChange={e => setShowBadge(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#FF4655' }} />
            <span style={{ fontSize: 13, color: '#cbd5e1' }}>
              Forum yorumlarımda favori takım logomu <b>göster</b>
              <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>Kapatırsan yorumlarında takım rozeti çıkmaz.</span>
            </span>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Avatar URL</span>
            <input value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: '2px solid #26324a' }} />
              : <div style={{ width: 42, height: 42, borderRadius: '50%', border: '2px solid #26324a', display: 'grid', placeItems: 'center', color: '#94a3b8', fontWeight: 800 }}>{fallbackAvatar}</div>
            }
            <button disabled={saving} style={{ background: 'linear-gradient(135deg,#FF4655,#F0A500)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
            {msg && <span style={{ fontSize: 12, color: msg.startsWith('Hata') ? '#FF4655' : '#4ade80' }}>{msg}</span>}
          </div>
        </form>

        <FollowedTeamsManager />
      </div>
    </div>
  )
}
