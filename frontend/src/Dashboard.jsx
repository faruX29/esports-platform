/**
 * Dashboard.jsx
 * Ana sayfa: FavoritesBar → Bento (live maçlar) → Hızlı istatistikler
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link }                from 'react-router-dom'
import { supabase }                         from './supabaseClient'
import { useGame, gameMatchesFilter }       from './GameContext'
import { isTurkishTeam }                   from './constants'
import {
  getFavorites,
  toggleFavorite,
  isFavorite,
} from './favoritesHelper'

/* ══════════════════════════════════════════════════════════════════════════════
   FavoritesBar — yatay "My Favorites" şeridi
   Props: navigate (useNavigate hook'u)
══════════════════════════════════════════════════════════════════════════════ */
function FavoritesBar({ navigate }) {
  const [favTeamIds, setFavTeamIds] = useState(() => getFavorites())
  const [matches,    setMatches]    = useState([])
  const [loading,    setLoading]    = useState(false)

  /* localStorage değişimini dinle (başka tab / bileşen) */
  useEffect(() => {
    function onStorage() { setFavTeamIds(getFavorites()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /* Favori takımların maçlarını çek */
  useEffect(() => {
    if (favTeamIds.length === 0) { setMatches([]); return }
    setLoading(true)
    const orFilter = favTeamIds
      .flatMap(id => [`team_a_id.eq.${id}`, `team_b_id.eq.${id}`])
      .join(',')

    supabase
      .from('matches')
      .select(`
        id, status, scheduled_at,
        team_a_id, team_b_id, winner_id,
        team_a_score, team_b_score,
        team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
        team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
        tournament:tournaments(id,name),
        game:games(id,name)
      `)
      .or(orFilter)
      .order('scheduled_at', { ascending: true })
      .limit(30)
      .then(({ data }) => { setMatches(data || []); setLoading(false) })
  }, [favTeamIds])

  /* Anlık fav toggle */
  function handleToggle(e, teamId) {
    e.stopPropagation()
    toggleFavorite(teamId)
    setFavTeamIds(getFavorites())
  }

  if (favTeamIds.length === 0) return null

  return (
    <div style={{ marginBottom: 28 }}>

      {/* ── Başlık ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <div style={{
          display:'flex', alignItems:'center', gap:8,
          padding:'5px 14px', borderRadius:20,
          background:'linear-gradient(135deg,rgba(255,215,0,.18),rgba(255,165,0,.08))',
          border:'1px solid rgba(255,215,0,.45)',
        }}>
          <span style={{ fontSize:14 }}>⭐</span>
          <span style={{ fontSize:11, fontWeight:800, letterSpacing:'1.2px', color:'#FFD700', textTransform:'uppercase' }}>
            My Favorites
          </span>
        </div>
        <span style={{ padding:'1px 8px', borderRadius:10, background:'rgba(255,215,0,.2)', color:'#FFD700', fontSize:11, fontWeight:700 }}>
          {matches.length}
        </span>
        <div style={{ flex:1, height:1, background:'linear-gradient(90deg,rgba(255,215,0,.3),transparent)' }} />
        <span style={{ fontSize:11, color:'#444' }}>{favTeamIds.length} takip</span>
      </div>

      {/* ── Şerit ── */}
      {loading ? (
        <div style={{ display:'flex', gap:12, overflow:'hidden' }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{
              flexShrink:0, width:220, height:108, borderRadius:16,
              background:'linear-gradient(90deg,#111 25%,#1a1a1a 50%,#111 75%)',
              backgroundSize:'200% 100%', animation:'fbShimmer 1.4s infinite',
            }} />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div style={{
          padding:'18px 20px', borderRadius:14,
          background:'rgba(255,215,0,.04)', border:'1px dashed rgba(255,215,0,.2)',
          fontSize:12, color:'#3a3a2a', textAlign:'center',
        }}>
          Takip ettiğin takımların yaklaşan maçı yok
        </div>
      ) : (
        <div style={{
          display:'flex', gap:12,
          overflowX:'auto', paddingBottom:6,
          scrollbarWidth:'thin', scrollbarColor:'#FFD70033 transparent',
        }}>
          {matches.map(m => {
            const isLive = m.status === 'running'
            const isFin  = m.status === 'finished'
            const favA   = isFavorite(m.team_a_id || m.team_a?.id)
            const favB   = isFavorite(m.team_b_id || m.team_b?.id)
            const aWon   = isFin && m.winner_id === (m.team_a_id || m.team_a?.id)
            const bWon   = isFin && m.winner_id === (m.team_b_id || m.team_b?.id)

            return (
              <div key={m.id} onClick={() => navigate(`/match/${m.id}`)} style={{
                flexShrink:0, width:220,
                borderRadius:16, padding:'12px 14px',
                background: isLive
                  ? 'linear-gradient(145deg,#1a0f0f,#110a0a)'
                  : 'linear-gradient(145deg,#13110a,#0d0d0d)',
                border: isLive
                  ? '1.5px solid rgba(255,70,85,.55)'
                  : '1.5px solid rgba(255,215,0,.35)',
                boxShadow: isLive
                  ? '0 0 18px rgba(255,70,85,.12)'
                  : '0 0 18px rgba(255,215,0,.07)',
                cursor:'pointer', transition:'transform .2s, box-shadow .2s',
                position:'relative', overflow:'hidden',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-3px)'
                  e.currentTarget.style.boxShadow = isLive
                    ? '0 8px 28px rgba(255,70,85,.22)'
                    : '0 8px 28px rgba(255,215,0,.18)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = isLive
                    ? '0 0 18px rgba(255,70,85,.12)'
                    : '0 0 18px rgba(255,215,0,.07)'
                }}
              >
                {/* Altın / kırmızı üst çizgi */}
                <div style={{
                  position:'absolute', top:0, left:0, right:0, height:2,
                  background: isLive
                    ? 'linear-gradient(90deg,#FF4655,#ff7043)'
                    : 'linear-gradient(90deg,#FFD700,#FF8C00)',
                }} />

                {/* Oyun + Durum */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <span style={{ fontSize:9, fontWeight:700, letterSpacing:'.5px', color:'#555', textTransform:'uppercase' }}>
                    {m.game?.name || '—'}
                  </span>
                  {isLive && <span style={{ fontSize:9, fontWeight:800, color:'#FF4655', animation:'fbPulse 1.2s infinite' }}>● LIVE</span>}
                  {isFin  && <span style={{ fontSize:9, fontWeight:700, color:'#2a2a2a' }}>BİTTİ</span>}
                  {!isLive && !isFin && (
                    <span style={{ fontSize:9, color:'#444' }}>
                      {new Date(m.scheduled_at).toLocaleTimeString('tr-TR',{ hour:'2-digit', minute:'2-digit' })}
                    </span>
                  )}
                </div>

                {/* Team A */}
                <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:5, opacity: isFin&&bWon ? 0.4 : 1 }}>
                  {m.team_a?.logo_url
                    ? <img src={m.team_a.logo_url} alt="" style={{ width:22, height:22, objectFit:'contain', flexShrink:0 }} />
                    : <div style={{ width:22, height:22, background:'#1e1e1e', borderRadius:4, flexShrink:0 }} />
                  }
                  <span style={{
                    fontSize:11, fontWeight: aWon ? 700 : 500,
                    color: aWon ? '#4CAF50' : favA ? '#FFD700' : '#ccc',
                    flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  }}>{m.team_a?.name || '?'}</span>
                  {(isLive||isFin) && (
                    <span style={{ fontSize:13, fontWeight:900, color:aWon?'#4CAF50':'#555', fontVariantNumeric:'tabular-nums' }}>
                      {m.team_a_score ?? 0}
                    </span>
                  )}
                </div>

                {/* Team B */}
                <div style={{ display:'flex', alignItems:'center', gap:7, opacity: isFin&&aWon ? 0.4 : 1 }}>
                  {m.team_b?.logo_url
                    ? <img src={m.team_b.logo_url} alt="" style={{ width:22, height:22, objectFit:'contain', flexShrink:0 }} />
                    : <div style={{ width:22, height:22, background:'#1e1e1e', borderRadius:4, flexShrink:0 }} />
                  }
                  <span style={{
                    fontSize:11, fontWeight: bWon ? 700 : 500,
                    color: bWon ? '#4CAF50' : favB ? '#FFD700' : '#ccc',
                    flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  }}>{m.team_b?.name || '?'}</span>
                  {(isLive||isFin) && (
                    <span style={{ fontSize:13, fontWeight:900, color:bWon?'#4CAF50':'#555', fontVariantNumeric:'tabular-nums' }}>
                      {m.team_b_score ?? 0}
                    </span>
                  )}
                </div>

                {/* Turnuva + fav toggle */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
                  <span style={{ fontSize:9, color:'#2a2a2a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>
                    {m.tournament?.name || ''}
                  </span>
                  <button
                    onClick={e => handleToggle(e, m.team_a_id || m.team_a?.id)}
                    style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, padding:'0 2px', flexShrink:0, color:favA?'#FFD700':'#2a2a2a', transition:'color .15s' }}
                    title={favA ? 'Favoriden çıkar' : 'Favoriye ekle'}
                  >{favA ? '⭐' : '☆'}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes fbShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes fbPulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
   Yardımcılar
══════════════════════════════════════════════════════════════════════════════ */
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' })
}
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('tr-TR', { day:'2-digit', month:'short' })
}
function gameColor(name = '') {
  const s = name.toLowerCase()
  if (s.includes('valorant'))                   return '#FF4655'
  if (s.includes('counter') || s.includes('cs')) return '#F0A500'
  if (s.includes('league'))                     return '#C89B3C'
  return '#6366f1'
}

/* ── Skeleton ───────────────────────────────────────────────────────────────── */
function Sk({ w = '100%', h = '16px', r = '8px' }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, flexShrink: 0,
      background: 'linear-gradient(90deg,#111 25%,#1a1a1a 50%,#111 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
    }} />
  )
}

/* ── LiveMatchCard ──────────────────────────────────────────────────────────── */
function LiveMatchCard({ match, onClick, favs, onToggleFav }) {
  const gc   = gameColor(match.game?.name || '')
  const hasTR = isTurkishTeam(match.team_a?.name || '') || isTurkishTeam(match.team_b?.name || '')
  const favA  = favs.includes(match.team_a_id || match.team_a?.id)
  const favB  = favs.includes(match.team_b_id || match.team_b?.id)

  return (
    <div onClick={onClick} style={{
      borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
      background: 'linear-gradient(145deg,#1a0808,#110505)',
      border: hasTR ? '2px solid rgba(200,16,46,.6)' : '2px solid rgba(255,70,85,.5)',
      boxShadow: '0 0 24px rgba(255,70,85,.15)',
      transition: 'transform .2s, box-shadow .2s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform='translateY(-4px)'; e.currentTarget.style.boxShadow='0 12px 32px rgba(255,70,85,.3)' }}
      onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)';    e.currentTarget.style.boxShadow='0 0 24px rgba(255,70,85,.15)' }}
    >
      {/* Turkish banner */}
      {hasTR && (
        <div style={{ background:'linear-gradient(90deg,#C8102E,#001f6d)', padding:'3px 0', textAlign:'center', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          <span style={{ fontSize:10 }}>🇹🇷</span>
          <span style={{ fontSize:8, fontWeight:800, letterSpacing:'1.5px', color:'#fff', textTransform:'uppercase' }}>Turkish Pride</span>
          <span style={{ fontSize:10 }}>🇹🇷</span>
        </div>
      )}

      <div style={{ padding:'14px 16px' }}>
        {/* Üst: oyun + LIVE */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:5, background:`${gc}22`, border:`1px solid ${gc}44`, color:gc, textTransform:'uppercase', letterSpacing:'.5px' }}>
            {match.game?.name || '—'}
          </span>
          <span style={{ fontSize:9, fontWeight:800, color:'#FF4655', animation:'pulse 1.2s infinite' }}>● LIVE</span>
        </div>

        {/* Takımlar + Skor */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', alignItems:'center', gap:8, marginBottom:10 }}>
          {/* Team A */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            {match.team_a?.logo_url
              ? <img src={match.team_a.logo_url} alt="" style={{ width:36, height:36, objectFit:'contain' }} />
              : <div style={{ width:36, height:36, background:'#1e1e1e', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>🛡️</div>
            }
            <span style={{ fontSize:10, fontWeight:700, color: favA?'#FFD700':'#ccc', textAlign:'center', lineHeight:1.2, maxWidth:70, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {favA && '⭐ '}{match.team_a?.name || '?'}
            </span>
          </div>

          {/* Skor */}
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:22, fontWeight:900, color:'#FF4655', letterSpacing:3, fontVariantNumeric:'tabular-nums', textShadow:'0 0 16px rgba(255,70,85,.5)' }}>
              {match.team_a_score ?? 0}:{match.team_b_score ?? 0}
            </div>
            {match.tournament && (
              <div style={{ fontSize:8, color:'#2a2a2a', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:80 }}>
                {match.tournament.name}
              </div>
            )}
          </div>

          {/* Team B */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            {match.team_b?.logo_url
              ? <img src={match.team_b.logo_url} alt="" style={{ width:36, height:36, objectFit:'contain' }} />
              : <div style={{ width:36, height:36, background:'#1e1e1e', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>🛡️</div>
            }
            <span style={{ fontSize:10, fontWeight:700, color: favB?'#FFD700':'#ccc', textAlign:'center', lineHeight:1.2, maxWidth:70, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {favB && '⭐ '}{match.team_b?.name || '?'}
            </span>
          </div>
        </div>

        {/* Fav butonları */}
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <button onClick={e => { e.stopPropagation(); onToggleFav(match.team_a_id || match.team_a?.id) }}
            style={{ background:'none', border:`1px solid ${favA?'#FFD70044':'#1e1e1e'}`, borderRadius:6, color:favA?'#FFD700':'#333', fontSize:10, padding:'2px 8px', cursor:'pointer' }}>
            {favA ? '⭐' : '☆'} {match.team_a?.name?.slice(0,8) || '?'}
          </button>
          <button onClick={e => { e.stopPropagation(); onToggleFav(match.team_b_id || match.team_b?.id) }}
            style={{ background:'none', border:`1px solid ${favB?'#FFD70044':'#1e1e1e'}`, borderRadius:6, color:favB?'#FFD700':'#333', fontSize:10, padding:'2px 8px', cursor:'pointer' }}>
            {favB ? '⭐' : '☆'} {match.team_b?.name?.slice(0,8) || '?'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── UpcomingRow ────────────────────────────────────────────────────────────── */
function UpcomingRow({ match, onClick }) {
  const gc   = gameColor(match.game?.name || '')
  const hasTR = isTurkishTeam(match.team_a?.name || '') || isTurkishTeam(match.team_b?.name || '')

  return (
    <div onClick={onClick} style={{
      display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
      borderRadius:12, background:'#0d0d0d', cursor:'pointer', transition:'all .18s',
      border: hasTR ? '1px solid rgba(212,175,55,.2)' : '1px solid #161616',
      position:'relative', overflow:'hidden',
    }}
      onMouseEnter={e => { e.currentTarget.style.background='#111'; e.currentTarget.style.borderColor=hasTR?'rgba(212,175,55,.4)':`${gc}33` }}
      onMouseLeave={e => { e.currentTarget.style.background='#0d0d0d'; e.currentTarget.style.borderColor=hasTR?'rgba(212,175,55,.2)':'#161616' }}
    >
      {hasTR && <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:'linear-gradient(90deg,#C8102E,#001f6d)' }} />}

      <div style={{ flexShrink:0, width:38, textAlign:'center' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#4CAF50' }}>{fmtTime(match.scheduled_at)}</div>
        <div style={{ fontSize:9, color:'#2a2a2a' }}>{fmtDate(match.scheduled_at)}</div>
      </div>

      <span style={{ fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:4, background:`${gc}18`, border:`1px solid ${gc}33`, color:gc, textTransform:'uppercase', letterSpacing:'.4px', flexShrink:0 }}>
        {match.game?.name?.slice(0,3).toUpperCase() || '?'}
      </span>

      <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:6 }}>
        {match.team_a?.logo_url && <img src={match.team_a.logo_url} alt="" style={{ width:18, height:18, objectFit:'contain', flexShrink:0 }} />}
        <span style={{ fontSize:11, fontWeight:600, color:'#ccc', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {match.team_a?.name || '?'}
        </span>
      </div>

      <span style={{ fontSize:10, fontWeight:800, color:'#333', flexShrink:0 }}>VS</span>

      <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6 }}>
        <span style={{ fontSize:11, fontWeight:600, color:'#ccc', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {match.team_b?.name || '?'}
        </span>
        {match.team_b?.logo_url && <img src={match.team_b.logo_url} alt="" style={{ width:18, height:18, objectFit:'contain', flexShrink:0 }} />}
      </div>

      {match.prediction_team_a != null && (
        <div style={{ flexShrink:0, textAlign:'right', minWidth:36 }}>
          <div style={{ fontSize:9, color:'#6366f1', fontWeight:700 }}>
            🔮 {Math.round(Math.max(match.prediction_team_a, match.prediction_team_b) * 100)}%
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════════
   Dashboard — default export
══════════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const navigate       = useNavigate()
  const { activeGame } = useGame()

  const [liveMatches,     setLiveMatches]     = useState([])
  const [upcomingMatches, setUpcomingMatches] = useState([])
  const [stats,           setStats]           = useState({ total:0, live:0, today:0, teams:0 })
  const [loading,         setLoading]         = useState(true)
  const [favorites,       setFavorites]       = useState(() => getFavorites())

  /* ── Veri çekme ── */
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const todayStart = new Date(); todayStart.setHours(0,0,0,0)
      const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999)

      const [liveRes, upcomingRes] = await Promise.all([
        supabase
          .from('matches')
          .select(`
            id, status, scheduled_at,
            team_a_id, team_b_id, team_a_score, team_b_score,
            prediction_team_a, prediction_team_b,
            team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
            team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
            tournament:tournaments(id,name),
            game:games(id,name)
          `)
          .eq('status', 'running')
          .order('scheduled_at', { ascending: true })
          .limit(20),

        supabase
          .from('matches')
          .select(`
            id, status, scheduled_at,
            team_a_id, team_b_id, team_a_score, team_b_score,
            prediction_team_a, prediction_team_b,
            team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
            team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
            tournament:tournaments(id,name),
            game:games(id,name)
          `)
          .eq('status', 'not_started')
          .gte('scheduled_at', new Date().toISOString())
          .lte('scheduled_at', todayEnd.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(30),
      ])

      const live     = (liveRes.data     || []).filter(m => gameMatchesFilter(m.game?.name || '', activeGame))
      const upcoming = (upcomingRes.data || []).filter(m => gameMatchesFilter(m.game?.name || '', activeGame))

      setLiveMatches(live)
      setUpcomingMatches(upcoming)
      setStats({
        live:  live.length,
        today: upcoming.length,
        total: live.length + upcoming.length,
        teams: new Set([...live, ...upcoming].flatMap(m => [m.team_a_id, m.team_b_id])).size,
      })
    } catch (e) { console.error('Dashboard fetch:', e.message) }
    finally { setLoading(false) }
  }, [activeGame])

  useEffect(() => { fetchData() }, [fetchData])

  /* ── Fav toggle ── */
  function handleToggleFav(teamId) {
    if (!teamId) return
    toggleFavorite(teamId)
    setFavorites(getFavorites())
  }

  /* ── Render ── */
  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:'24px 20px 60px', color:'white' }}>

      {/* ── My Favorites şeridi ── */}
      <FavoritesBar navigate={navigate} />

      {/* ── Hero Header ── */}
      <div style={{ marginBottom:28, textAlign:'center' }}>
        <h1 style={{ margin:'0 0 6px', fontSize:26, fontWeight:900, letterSpacing:'-.5px',
          background:'linear-gradient(135deg,#FF4655,#F0A500)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
          ⚡ EsportsHub
        </h1>
        <p style={{ margin:0, fontSize:12, color:'#383838' }}>
          Canlı veri · her saat güncellenir · PandaScore
        </p>
      </div>

      {/* ── İstatistik Şeridi ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:28 }}>
        {[
          { icon:'🔴', value: loading ? '…' : stats.live,  label:'Canlı Maç',  color:'#FF4655' },
          { icon:'⏳', value: loading ? '…' : stats.today, label:'Bugün',      color:'#FFB800' },
          { icon:'🎮', value: loading ? '…' : stats.total, label:'Toplam',     color:'#6366f1' },
          { icon:'🛡️', value: loading ? '…' : stats.teams, label:'Takım',      color:'#4CAF50' },
        ].map(s => (
          <div key={s.label} style={{
            padding:'14px 12px', borderRadius:14, textAlign:'center',
            background:'#111', border:`1px solid ${s.color}22`,
          }}>
            <div style={{ fontSize:20 }}>{s.icon}</div>
            <div style={{ fontSize:20, fontWeight:900, color:s.color, lineHeight:1.1, marginTop:4 }}>{s.value}</div>
            <div style={{ fontSize:9, color:'#383838', textTransform:'uppercase', letterSpacing:'.5px', marginTop:3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── LIVE Maçlar ── */}
      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:14, marginBottom:28 }}>
          {[1,2,3].map(i => <Sk key={i} h="160px" r="16px" />)}
        </div>
      ) : liveMatches.length > 0 ? (
        <div style={{ marginBottom:28 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
            <span style={{ fontSize:12, fontWeight:800, color:'#FF4655', letterSpacing:'1.5px', textTransform:'uppercase' }}>
              <span style={{ animation:'pulse 1.2s infinite', display:'inline-block', marginRight:5 }}>🔴</span>
              Live Now
            </span>
            <span style={{ padding:'1px 8px', borderRadius:10, background:'rgba(255,70,85,.15)', color:'#FF4655', fontSize:11, fontWeight:700 }}>{liveMatches.length}</span>
            <div style={{ flex:1, height:1, background:'linear-gradient(90deg,rgba(255,70,85,.3),transparent)' }} />
            <Link to="/matches" style={{ fontSize:11, color:'#555', textDecoration:'none' }}>Tümünü gör →</Link>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:12 }}>
            {liveMatches.map(m => (
              <LiveMatchCard key={m.id} match={m} onClick={() => navigate(`/match/${m.id}`)} favs={favorites} onToggleFav={handleToggleFav} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ marginBottom:28, padding:'20px 24px', borderRadius:14, background:'#0d0d0d', border:'1px solid #161616', textAlign:'center' }}>
          <div style={{ fontSize:24, marginBottom:6 }}>😴</div>
          <div style={{ fontSize:12, color:'#383838' }}>Şu an canlı maç yok</div>
        </div>
      )}

      {/* ── Bugünün Maçları ── */}
      <div style={{ marginBottom:28 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <span style={{ fontSize:12, fontWeight:800, color:'#4CAF50', letterSpacing:'1.5px', textTransform:'uppercase' }}>⏳ Bugün</span>
          {!loading && <span style={{ padding:'1px 8px', borderRadius:10, background:'rgba(76,175,80,.15)', color:'#4CAF50', fontSize:11, fontWeight:700 }}>{upcomingMatches.length}</span>}
          <div style={{ flex:1, height:1, background:'linear-gradient(90deg,rgba(76,175,80,.3),transparent)' }} />
          <Link to="/matches" style={{ fontSize:11, color:'#555', textDecoration:'none' }}>Tümünü gör →</Link>
        </div>

        {loading ? (
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            {[1,2,3,4,5].map(i => <Sk key={i} h="46px" r="12px" />)}
          </div>
        ) : upcomingMatches.length === 0 ? (
          <div style={{ padding:'18px 24px', borderRadius:14, background:'#0d0d0d', border:'1px solid #161616', textAlign:'center', fontSize:12, color:'#383838' }}>
            Bugün için yaklaşan maç bulunamadı
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {upcomingMatches.slice(0, 12).map(m => (
              <UpcomingRow key={m.id} match={m} onClick={() => navigate(`/match/${m.id}`)} />
            ))}
            {upcomingMatches.length > 12 && (
              <Link to="/matches" style={{
                display:'block', textAlign:'center', padding:'10px',
                borderRadius:10, background:'#0d0d0d', border:'1px solid #1a1a1a',
                fontSize:11, color:'#555', textDecoration:'none', transition:'all .15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='#333'; e.currentTarget.style.color='#ccc' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='#1a1a1a'; e.currentTarget.style.color='#555' }}
              >
                +{upcomingMatches.length - 12} maç daha → Maçlar sayfasına git
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── Hızlı Linkler ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:10 }}>
        {[
          { to:'/matches',  icon:'📅', label:'Maç Takvimi',  sub:'14 günlük görünüm',  color:'#FF4655' },
          { to:'/rankings', icon:'🏆', label:'Sıralamalar',  sub:'Takım & oyuncu',     color:'#FFB800' },
          { to:'/players',  icon:'🔍', label:'Oyuncu Ara',   sub:'193+ oyuncu',         color:'#6366f1' },
          { to:'/news',     icon:'📰', label:'Haberler',     sub:'Son gelişmeler',      color:'#4CAF50' },
        ].map(l => (
          <Link key={l.to} to={l.to} style={{ textDecoration:'none' }}>
            <div style={{
              padding:'16px', borderRadius:14, background:'#0d0d0d',
              border:`1px solid ${l.color}22`, transition:'all .18s', cursor:'pointer',
            }}
              onMouseEnter={e => { e.currentTarget.style.background=`${l.color}0c`; e.currentTarget.style.borderColor=`${l.color}55`; e.currentTarget.style.transform='translateY(-2px)' }}
              onMouseLeave={e => { e.currentTarget.style.background='#0d0d0d'; e.currentTarget.style.borderColor=`${l.color}22`; e.currentTarget.style.transform='translateY(0)' }}
            >
              <div style={{ fontSize:22, marginBottom:6 }}>{l.icon}</div>
              <div style={{ fontSize:12, fontWeight:700, color:l.color, marginBottom:3 }}>{l.label}</div>
              <div style={{ fontSize:10, color:'#2a2a2a' }}>{l.sub}</div>
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </div>
  )
}

