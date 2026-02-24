/**
 * PlayerSearch — Oyuncu arama + scout detay modalı
 *
 * Scout Analytics (match_stats.stats JSONB'den türetilir):
 *   stats = { score: N, games_detail: [{position, winner_id, length_seconds, status}] }
 *
 *  • Map Win Rate (Game 1/2/3) — progress bar
 *  • Overall Win Rate
 *  • Match Impact Score (bileşik metrik, 0-100)
 *  • Ortalama maç süresi (galibiyet vs mağlubiyet)
 *
 *  K/D/A: PandaScore ücretsiz tier'da yok — UI'da açıkça belirtilir.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { getRoleBadge } from './roleHelper'
import {
  getFollowedPlayers, followPlayer, unfollowPlayer, isFollowedPlayer
} from './favoritesHelper'

// ── Sabitler ────────────────────────────────────────────────────────────────

const IMPACT_LEVELS = [
  { min: 85, label: 'Elite',       color: '#a78bfa', icon: '🏆' },
  { min: 70, label: 'Dominant',    color: '#4ade80', icon: '⚔️'  },
  { min: 55, label: 'Balanced',    color: '#60a5fa', icon: '⚖️'  },
  { min: 40, label: 'Struggling',  color: '#fbbf24', icon: '📉'  },
  { min: 0,  label: 'Rebuilding',  color: '#f87171', icon: '🔄'  },
]

function getImpactLevel(score) {
  return IMPACT_LEVELS.find(l => score >= l.min) || IMPACT_LEVELS.at(-1)
}

function barColor(rate) {
  if (rate == null) return '#444'
  if (rate >= 65)   return '#4CAF50'
  if (rate >= 50)   return '#FFB800'
  return '#FF4655'
}

function fmt(seconds) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

// ── Scout Analytics Hesaplayıcı ─────────────────────────────────────────────

/**
 * match_stats satırları ve takım ID'sinden scout metriklerini üretir.
 * @param {Array<{match_id: number, team_id: number, stats: object}>} statsRows
 * @param {number} teamId  — player.team_pandascore_id
 */
function computeScoutAnalytics(statsRows, teamId) {
  let totalMatches = 0
  let wonMatches   = 0

  // Game 1, 2, 3 bazında istatistik
  const mapStats = {
    1: { won: 0, total: 0 },
    2: { won: 0, total: 0 },
    3: { won: 0, total: 0 },
  }
  const winLengths  = []   // kazanılan oyunların süreleri (saniye)
  const lossLengths = []   // kaybedilen oyunların süreleri

  for (const row of statsRows) {
    const stats = row.stats || {}
    const games = stats.games_detail || []

    totalMatches++

    // Maç sonucu: score > karşı takımın skoru
    // score = bu takımın kazandığı oyun sayısı
    const finishedGames  = games.filter(g => g.status === 'finished')
    const teamScore      = stats.score ?? 0
    const oppScore       = finishedGames.length - teamScore
    const matchWon       = teamScore > oppScore
    if (matchWon) wonMatches++

    for (const g of finishedGames) {
      const pos = g.position
      if (pos >= 1 && pos <= 3) {
        mapStats[pos].total++
        // winner_id JSON'dan sayı olarak gelir; teamId de bigint → number
        const gameWon = Number(g.winner_id) === Number(teamId)
        if (gameWon) mapStats[pos].won++

        if (g.length_seconds) {
          if (gameWon) winLengths.push(g.length_seconds)
          else         lossLengths.push(g.length_seconds)
        }
      }
    }
  }

  const overallWinRate = totalMatches > 0 ? (wonMatches / totalMatches) * 100 : 0

  const mapWinRates = {}
  for (const [pos, s] of Object.entries(mapStats)) {
    mapWinRates[pos] = s.total > 0
      ? { rate: (s.won / s.total) * 100, total: s.total, won: s.won }
      : null
  }

  const avgWinLen  = winLengths.length  > 0 ? winLengths.reduce( (a,b) => a+b, 0) / winLengths.length  : null
  const avgLossLen = lossLengths.length > 0 ? lossLengths.reduce((a,b) => a+b, 0) / lossLengths.length : null

  // Impact Score:
  //   50% → genel galibiyet oranı
  //   30% → Game 1+2 ortalaması (erken baskı gücu)
  //   20% → Game 3 performansı (clutch / gerilim altında)
  const m1 = mapWinRates[1]?.rate ?? 50
  const m2 = mapWinRates[2]?.rate ?? 50
  const m3 = mapWinRates[3]?.rate ?? 50
  const earlyMapAvg = (m1 + m2) / 2
  const impactScore = Math.round(overallWinRate * 0.50 + earlyMapAvg * 0.30 + m3 * 0.20)

  return {
    totalMatches,
    wonMatches,
    lostMatches: totalMatches - wonMatches,
    overallWinRate,
    mapWinRates,
    avgWinLen,
    avgLossLen,
    impactScore,
  }
}

// ── Debounce Hook ────────────────────────────────────────────────────────────

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ── Ana Bileşen ──────────────────────────────────────────────────────────────

function PlayerSearch() {
  const navigate = useNavigate()

  const [query,         setQuery]         = useState('')
  const [results,       setResults]       = useState([])
  const [searching,     setSearching]     = useState(false)
  const [selected,      setSelected]      = useState(null)
  const [recentMatches, setRecentMatches] = useState([])
  const [analytics,     setAnalytics]     = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [followedPlayers, setFollowedPlayers] = useState(() => getFollowedPlayers())

  function toggleFollow(player, e) {
    e?.stopPropagation()
    if (isFollowedPlayer(player.id)) {
      setFollowedPlayers(unfollowPlayer(player.id))
    } else {
      setFollowedPlayers(followPlayer(player))
    }
  }

  const debouncedQuery = useDebounce(query, 350)

  // ── Arama ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (debouncedQuery.trim().length < 2) { setResults([]); return }
    doSearch(debouncedQuery.trim())
  }, [debouncedQuery])

  async function doSearch(q) {
    setSearching(true)
    try {
      const { data, error } = await supabase
        .from('players')
        .select('id, nickname, real_name, role, image_url, team_pandascore_id')
        .or(`nickname.ilike.%${q}%,real_name.ilike.%${q}%`)
        .limit(24)

      if (error) throw error
      setResults(data || [])
    } catch (err) {
      console.error('Player search error:', err)
    } finally {
      setSearching(false)
    }
  }

  // ── Detay Yükleme ─────────────────────────────────────────────────────────
  async function openDetail(player) {
    setSelected(player)
    setLoadingDetail(true)
    setRecentMatches([])
    setAnalytics(null)

    try {
      const teamId = player.team_pandascore_id
      if (!teamId) { setLoadingDetail(false); return }

      // 1) Son 50 match_stats kaydı → analytics için
      const { data: statsRows, error: statsErr } = await supabase
        .from('match_stats')
        .select('match_id, team_id, stats')
        .eq('team_id', teamId)
        .limit(50)

      if (statsErr) throw statsErr

      const rows = statsRows || []

      // 2) Scout analytics hesapla (tamamen istemci tarafında)
      if (rows.length > 0) {
        setAnalytics(computeScoutAnalytics(rows, teamId))
      }

      // 3) Son 10 maç → görüntüleme için matches tablosundan çek
      const matchIds = rows.slice(0, 10).map(r => r.match_id).filter(Boolean)
      if (matchIds.length > 0) {
        const { data: matchRows, error: matchErr } = await supabase
          .from('matches')
          .select(`
            id, scheduled_at, status, winner_id,
            team_a_id, team_b_id, team_a_score, team_b_score,
            team_a:teams!matches_team_a_id_fkey(id, name, logo_url),
            team_b:teams!matches_team_b_id_fkey(id, name, logo_url),
            game:games(name)
          `)
          .in('id', matchIds)
          .eq('status', 'finished')
          .order('scheduled_at', { ascending: false })

        if (matchErr) throw matchErr
        setRecentMatches(matchRows || [])
      }
    } catch (err) {
      console.error('Player detail error:', err)
    } finally {
      setLoadingDetail(false)
    }
  }

  function closeDetail() {
    setSelected(null)
    setRecentMatches([])
    setAnalytics(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto', color: 'white' }}>
      <h1 style={{ textAlign: 'center', fontSize: '26px', marginBottom: '6px' }}>🔍 Player Search</h1>
      <p style={{ textAlign: 'center', color: '#666', fontSize: '13px', marginBottom: followedPlayers.length > 0 ? '16px' : '28px' }}>
        nickname veya gerçek isimle ara · {'\u00a0'} 193 kayıtlı oyuncu
      </p>

      {/* ── Takip Ettiklerin ───────────────────────────────────────────── */}
      {followedPlayers.length > 0 && (
        <div style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '4px 12px', borderRadius: '16px',
              background: 'rgba(255,215,0,.1)', border: '1px solid rgba(255,215,0,.3)',
            }}>
              <span style={{ fontSize: '12px' }}>⭐</span>
              <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '1px', color: '#FFD700', textTransform: 'uppercase' }}>
                Takip Ettiklerin
              </span>
              <span style={{
                padding: '1px 6px', borderRadius: '8px',
                background: 'rgba(255,215,0,.2)', color: '#FFD700',
                fontSize: '11px', fontWeight: 700,
              }}>
                {followedPlayers.length}
              </span>
            </div>
            <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg,rgba(255,215,0,.25),transparent)' }} />
          </div>
          <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
            {followedPlayers.map(fp => (
              <div
                key={fp.id}
                onClick={() => openDetail(fp)}
                style={{
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 12px',
                  background: '#141414', border: '1.5px solid rgba(255,215,0,.4)',
                  borderRadius: '12px', cursor: 'pointer',
                  transition: 'transform .18s, border-color .18s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = '#FFD700' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'rgba(255,215,0,.4)' }}
              >
                <Avatar src={fp.image_url} name={fp.nickname} size={32} border='2px solid rgba(255,215,0,.5)' />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap' }}>{fp.nickname}</div>
                  {fp.role && (
                    <div style={{ fontSize: '10px', color: '#666' }}>{fp.role}</div>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setFollowedPlayers(unfollowPlayer(fp.id)) }}
                  style={{
                    marginLeft: '2px', background: 'none', border: 'none',
                    color: '#FFD700', fontSize: '13px', cursor: 'pointer', padding: '2px', lineHeight: 1,
                  }}
                  title="Takibi bırak"
                >⭐</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Arama Kutusu */}
      <div style={{ position: 'relative', maxWidth: '520px', margin: '0 auto 32px' }}>
        <input
          type="text"
          placeholder="🎮  s1mple, NiKo, yekinder..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '14px 46px 14px 16px',
            borderRadius: '12px',
            border: '2px solid #333',
            background: '#141414',
            color: 'white', fontSize: '15px', outline: 'none',
            transition: 'border-color .2s',
          }}
          onFocus={e  => (e.target.style.borderColor = '#FF4655')}
          onBlur={e   => (e.target.style.borderColor = '#333')}
        />
        <span style={{
          position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
          color: '#555', fontSize: '16px', pointerEvents: 'none',
        }}>
          {searching ? '⏳' : ''}
        </span>
        {!searching && query && (
          <button
            onClick={() => { setQuery(''); setResults([]) }}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: '#666', fontSize: '20px',
              cursor: 'pointer', padding: '4px',
            }}
          >✕</button>
        )}
      </div>

      {/* Sonuç ızgarası */}
      {results.length > 0 && !selected && (
        <>
          <div style={{ textAlign: 'center', color: '#555', fontSize: '12px', marginBottom: '14px' }}>
            {results.length} oyuncu bulundu
            {followedPlayers.length > 0 && (
              <span style={{ marginLeft: '10px', color: '#FFD700', fontWeight: 600 }}>
                · ⭐ {followedPlayers.length} takip
              </span>
            )}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: '12px',
          }}>
            {results.map(p => (
              <PlayerCard
                key={p.id}
                player={p}
                onClick={() => openDetail(p)}
                followed={followedPlayers.some(f => f.id === p.id)}
                onToggleFollow={e => toggleFollow(p, e)}
              />
            ))}
          </div>
        </>
      )}

      {/* Boş durum */}
      {!searching && query.length >= 2 && results.length === 0 && !selected && (
        <div style={{ textAlign: 'center', color: '#444', padding: '48px' }}>
          <div style={{ fontSize: '38px', marginBottom: '10px' }}>🔎</div>
          <div style={{ color: '#666' }}>
            "<strong style={{ color: '#aaa' }}>{query}</strong>" için oyuncu bulunamadı
          </div>
        </div>
      )}

      {/* Detay Modalı */}
      {selected && (
        <PlayerDetailModal
          player={selected}
          matches={recentMatches}
          analytics={analytics}
          loading={loadingDetail}
          onClose={closeDetail}
          onTeamPage={id => navigate(`/team/${id}`)}
          followed={followedPlayers.some(f => f.id === selected.id)}
          onToggleFollow={e => toggleFollow(selected, e)}
        />
      )}
    </div>
  )
}

// ── PlayerCard ───────────────────────────────────────────────────────────────

function PlayerCard({ player, onClick, followed, onToggleFollow }) {
  const badge = getRoleBadge(player.role)
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: '#141414',
        border: followed ? '1.5px solid rgba(255,215,0,.5)' : '1px solid #2a2a2a',
        borderRadius: '14px', padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: '12px',
        cursor: 'pointer', transition: 'border-color .2s, transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s',
        boxShadow: followed ? '0 0 14px rgba(255,215,0,.08)' : 'none',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor  = followed ? '#FFD700' : '#FF4655'
        e.currentTarget.style.transform    = 'translateY(-3px) scale(1.01)'
        e.currentTarget.style.boxShadow    = followed
          ? '0 6px 22px rgba(255,215,0,.18)'
          : '0 4px 18px rgba(255,70,85,.18)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor  = followed ? 'rgba(255,215,0,.5)' : '#2a2a2a'
        e.currentTarget.style.transform    = 'none'
        e.currentTarget.style.boxShadow    = followed ? '0 0 14px rgba(255,215,0,.08)' : 'none'
      }}
    >
      {/* Follow star */}
      <button
        onClick={onToggleFollow}
        title={followed ? 'Takibi bırak' : 'Takip et'}
        style={{
          position: 'absolute', top: '8px', right: '8px',
          background: 'none', border: 'none',
          fontSize: '16px', cursor: 'pointer', padding: '2px',
          opacity: followed ? 1 : 0.4,
          transition: 'opacity .2s, transform .2s',
          lineHeight: 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1.2)' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = followed ? '1' : '0.4'; e.currentTarget.style.transform = 'scale(1)' }}
      >{followed ? '⭐' : '☆'}</button>

      <Avatar src={player.image_url} name={player.nickname} size={46} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '20px' }}>
          {player.nickname}
        </div>
        {player.real_name && (
          <div style={{ fontSize: '11px', color: '#666', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {player.real_name}
          </div>
        )}
        {player.role && (
          <span style={{
            display: 'inline-block', marginTop: '6px',
            padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 700,
            background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color,
          }}>
            {badge.label}
          </span>
        )}
      </div>
      <div style={{ color: '#444', fontSize: '18px' }}>›</div>
    </div>
  )
}

// ── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ src, name, size, border }) {
  const [err, setErr] = useState(false)
  const s = {
    width: size, height: size, borderRadius: '50%',
    objectFit: 'cover', flexShrink: 0,
    border: border || '2px solid #2a2a2a',
  }
  if (src && !err) return <img src={src} alt={name} style={s} onError={() => setErr(true)} />
  return (
    <div style={{ ...s, background: '#1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, border: border || '2px solid #2a2a2a' }}>
      👤
    </div>
  )
}

// ── PlayerDetailModal ────────────────────────────────────────────────────────

function PlayerDetailModal({ player, matches, analytics, loading, onClose, onTeamPage, followed, onToggleFollow }) {
  const badge   = getRoleBadge(player.role)
  const impact  = analytics ? getImpactLevel(analytics.impactScore) : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,.88)',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        zIndex: 1000, padding: '16px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#111', borderRadius: '18px',
          padding: '28px', maxWidth: '580px', width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          border: '2px solid #FF4655', position: 'relative',
          scrollbarWidth: 'thin', scrollbarColor: '#333 #111',
        }}
      >
        {/* Kapat */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 12, right: 14,
            background: 'none', border: 'none',
            color: '#555', fontSize: '26px', cursor: 'pointer', lineHeight: 1,
          }}
          onMouseEnter={e => (e.target.style.color = '#fff')}
          onMouseLeave={e => (e.target.style.color = '#555')}
        >×</button>

        {/* ── Oyuncu Başlığı ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '18px', alignItems: 'center', marginBottom: '24px' }}>
          <Avatar src={player.image_url} name={player.nickname} size={76}
            border={followed ? '3px solid #FFD700' : '3px solid #FF4655'} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '22px', fontWeight: 800 }}>{player.nickname}</div>
            {player.real_name && (
              <div style={{ fontSize: '13px', color: '#666', marginTop: '3px' }}>{player.real_name}</div>
            )}
            {player.role && (
              <span style={{
                display: 'inline-block', marginTop: '8px',
                padding: '4px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
                background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color,
                boxShadow: `0 0 10px ${badge.border}`,
              }}>
                {badge.label}
              </span>
            )}
          </div>
          {/* Follow Button */}
          <button
            onClick={onToggleFollow}
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', borderRadius: '10px',
              border: followed ? '1.5px solid #FFD700' : '1.5px solid #444',
              background: followed ? 'rgba(255,215,0,.12)' : 'rgba(255,255,255,.04)',
              color: followed ? '#FFD700' : '#777',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              transition: 'all .2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#FFD700'
              e.currentTarget.style.color = '#FFD700'
              e.currentTarget.style.background = 'rgba(255,215,0,.15)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = followed ? '#FFD700' : '#444'
              e.currentTarget.style.color = followed ? '#FFD700' : '#777'
              e.currentTarget.style.background = followed ? 'rgba(255,215,0,.12)' : 'rgba(255,255,255,.04)'
            }}
          >
            {followed ? '⭐' : '☆'}
            <span style={{ fontSize: '12px' }}>{followed ? 'Takip Ediliyor' : 'Takip Et'}</span>
          </button>
        </div>

        {/* ── Takım Sayfasına Git ──────────────────────────────────────── */}
        {player.team_pandascore_id && (
          <button
            onClick={() => onTeamPage(player.team_pandascore_id)}
            style={{
              width: '100%', padding: '10px',
              marginBottom: '20px',
              background: 'rgba(255,70,85,.12)',
              border: '1px solid rgba(255,70,85,.5)',
              borderRadius: '10px',
              color: '#FF4655', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
              transition: 'background .2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,70,85,.25)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,70,85,.12)')}
          >
            🏟️ Takım Sayfasına Git →
          </button>
        )}

        {/* ── Loading ─────────────────────────────────────────────────── */}
        {loading && (
          <div style={{ textAlign: 'center', color: '#555', padding: '32px', fontSize: '13px' }}>
            ⏳ Scout verileri yükleniyor...
          </div>
        )}

        {/* ── Scout Analytics ─────────────────────────────────────────── */}
        {!loading && analytics && <ScoutAnalytics analytics={analytics} impact={impact} />}

        {/* ── K/D/A Notu ──────────────────────────────────────────────── */}
        {!loading && (
          <div style={{
            padding: '10px 14px', marginBottom: '20px',
            background: 'rgba(255,184,0,.06)',
            border: '1px solid rgba(255,184,0,.25)',
            borderRadius: '8px', fontSize: '12px', color: '#777',
          }}>
            ℹ️ Bireysel K/D/A verisi mevcut değil — PandaScore ücretsiz tier sadece maç skoru ve harita detayı sağlar.
          </div>
        )}

        {/* ── Son Maçlar ──────────────────────────────────────────────── */}
        {!loading && (
          <RecentMatchesList
            matches={matches}
            teamId={player.team_pandascore_id}
          />
        )}
      </div>
    </div>
  )
}

// ── Scout Analytics Bölümü ────────────────────────────────────────────────────

function ScoutAnalytics({ analytics, impact }) {
  const { totalMatches, wonMatches, lostMatches, overallWinRate, mapWinRates, avgWinLen, avgLossLen, impactScore } = analytics

  const mapLabels = { 1: 'Game 1', 2: 'Game 2', 3: 'Game 3 (Decider)' }

  return (
    <div style={{ marginBottom: '22px' }}>

      {/* ── Başlık ────────────────── */}
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '14px' }}>
        📋 Scout Analytics · Son {totalMatches} Maç
      </div>

      {/* ── Impact Score + W/L Record ── */}
      <div style={{
        display: 'flex', gap: '10px', marginBottom: '16px',
      }}>
        {/* Impact Gauge */}
        <div style={{
          flex: 1, background: '#1a1a1a',
          border: `1px solid ${impact.color}40`,
          borderRadius: '12px', padding: '14px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        }}>
          <div style={{ fontSize: '22px' }}>{impact.icon}</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: impact.color, lineHeight: 1 }}>
            {impactScore}
          </div>
          <div style={{ fontSize: '11px', color: impact.color, fontWeight: 700 }}>
            {impact.label}
          </div>
          <div style={{ fontSize: '10px', color: '#555' }}>Match Impact</div>
        </div>

        {/* Win / Loss */}
        <div style={{ flex: 2, background: '#1a1a1a', borderRadius: '12px', padding: '14px', border: '1px solid #2a2a2a' }}>
          <div style={{ fontSize: '11px', color: '#555', marginBottom: '10px' }}>Win / Loss Record</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '24px', fontWeight: 800, color: '#4CAF50' }}>{wonMatches}W</span>
            <span style={{ color: '#444' }}>–</span>
            <span style={{ fontSize: '24px', fontWeight: 800, color: '#FF4655' }}>{lostMatches}L</span>
          </div>
          {/* Kazanma oranı bar */}
          <div style={{ height: '6px', background: '#2a2a2a', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{
              width: `${overallWinRate}%`, height: '100%',
              background: `linear-gradient(90deg, ${barColor(overallWinRate)}, ${barColor(overallWinRate)}aa)`,
              borderRadius: '4px', transition: 'width .6s ease',
            }} />
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '5px', textAlign: 'right' }}>
            {overallWinRate.toFixed(1)}% kazanma oranı
          </div>
        </div>
      </div>

      {/* ── Map Win Rate Progress Bars ── */}
      <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', marginBottom: '12px', border: '1px solid #2a2a2a' }}>
        <div style={{ fontSize: '11px', color: '#555', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '14px' }}>
          🗺️ Harita (Oyun) Performansı
        </div>
        {[1, 2, 3].map(pos => {
          const d = mapWinRates[pos]
          const rate = d?.rate ?? null
          return (
            <div key={pos} style={{ marginBottom: pos === 3 ? 0 : '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontSize: '12px', color: '#aaa' }}>
                  {mapLabels[pos]}
                  {pos === 3 && (
                    <span style={{ fontSize: '10px', color: '#555', marginLeft: '6px' }}>clutch</span>
                  )}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: rate != null ? barColor(rate) : '#444' }}>
                  {rate != null ? `${rate.toFixed(0)}%` : 'N/A'}
                  {d && <span style={{ fontSize: '10px', color: '#555', fontWeight: 400, marginLeft: '4px' }}>({d.won}/{d.total})</span>}
                </span>
              </div>
              <div style={{ height: '8px', background: '#252525', borderRadius: '6px', overflow: 'hidden' }}>
                {rate != null ? (
                  <div style={{
                    width: `${rate}%`, height: '100%', borderRadius: '6px',
                    background: `linear-gradient(90deg, ${barColor(rate)}, ${barColor(rate)}bb)`,
                    boxShadow: `0 0 6px ${barColor(rate)}55`,
                    transition: 'width .7s ease',
                  }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: '#1e1e1e', borderRadius: '6px' }} />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Ortalama Süre ── */}
      {(avgWinLen || avgLossLen) && (
        <div style={{ display: 'flex', gap: '10px', marginBottom: '4px' }}>
          {avgWinLen && (
            <div style={{ flex: 1, background: 'rgba(76,175,80,.08)', border: '1px solid rgba(76,175,80,.25)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px' }}>Ort. Kazanma Süresi</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#4CAF50' }}>{fmt(avgWinLen)}</div>
            </div>
          )}
          {avgLossLen && (
            <div style={{ flex: 1, background: 'rgba(255,70,85,.06)', border: '1px solid rgba(255,70,85,.2)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#555', marginBottom: '4px' }}>Ort. Mağlubiyet Süresi</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#FF4655' }}>{fmt(avgLossLen)}</div>
            </div>
          )}
        </div>
      )}

      {/* Açıklama */}
      <div style={{ fontSize: '10px', color: '#444', marginTop: '10px', lineHeight: 1.5 }}>
        * Impact Score = Kazanma Oranı (%50) + Erken Harita Hakimiyeti (%30) + Decider Performansı (%20)
      </div>
    </div>
  )
}

// ── Son Maçlar Listesi ────────────────────────────────────────────────────────

function RecentMatchesList({ matches, teamId }) {
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '12px' }}>
        🏆 Son Maçlar (Takım Bazlı)
      </div>
      {matches.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#444', padding: '20px', fontSize: '13px' }}>
          Maç verisi bulunamadı.
        </div>
      ) : (
        matches.map(m => {
          const isA    = m.team_a_id === teamId
          const myTeam = isA ? m.team_a : m.team_b
          const opp    = isA ? m.team_b : m.team_a
          const myScore  = isA ? m.team_a_score : m.team_b_score
          const oppScore = isA ? m.team_b_score : m.team_a_score
          const won    = m.winner_id === teamId
          return (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', marginBottom: '8px',
              background: '#0d0d0d', borderRadius: '10px',
              borderLeft: `3px solid ${won ? '#4CAF50' : '#FF4655'}`,
            }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '7px', flexShrink: 0,
                background: won ? 'rgba(76,175,80,.2)' : 'rgba(255,70,85,.2)',
                border: `1px solid ${won ? '#4CAF50' : '#FF4655'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '13px', color: won ? '#4CAF50' : '#FF4655',
              }}>
                {won ? 'W' : 'L'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {myTeam?.name ?? '?'}
                  <span style={{ color: '#444', margin: '0 5px' }}>vs</span>
                  {opp?.name ?? '?'}
                </div>
                <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
                  {m.game?.name} · {new Date(m.scheduled_at).toLocaleDateString('tr-TR')}
                </div>
              </div>
              {myScore != null && (
                <div style={{ fontSize: '14px', fontWeight: 800, color: won ? '#4CAF50' : '#FF4655', flexShrink: 0 }}>
                  {myScore} — {oppScore}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

export default PlayerSearch
