import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useUser } from '../context/UserContext'
import { GAMES } from '../GameContext'
import { isTurkishTeam } from '../constants'
import {
  NEWS_LIMIT,
  HERO_TIERS,
  buildFinishedStory,
  buildUpcomingStory,
} from '../utils/newsStories'
import { isStoryForYou, prioritizeStoriesForYou } from '../utils/newsPersonalization'

const GAME_FILTERS = GAMES.filter(game => !game.soon && game.id !== 'all' && ['valorant', 'cs2', 'lol'].includes(game.id))
const CATEGORY_TABS = [
  { id: 'all', label: 'Hepsi' },
  { id: 'valorant', label: 'Valorant' },
  { id: 'lol', label: 'LoL' },
  { id: 'cs2', label: 'CS2' },
]
const NEWS_PAGE_SIZE = 6

function fmtDate(iso) {
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function NewsTrustLayer({ item, onReport }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #282828', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: '#8f8f8f' }}>PandaScore verileriyle otomatik uretilmistir.</span>
      <button
        onClick={e => {
          e.stopPropagation()
          onReport(item)
        }}
        style={{
          border: '1px solid #353535',
          background: '#121212',
          color: '#d6d6d6',
          borderRadius: 8,
          padding: '5px 8px',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Hata Bildir
      </button>
    </div>
  )
}

function buildScoutRows(item) {
  const source = item?.source || {}
  const rows = []

  if (source.mapCount || source.mapTempo) {
    rows.push({
      label: 'Harita Profili',
      value: `${source.mapCount || '?'} map · ${source.mapTempo || 'tempo bilinmiyor'}`,
    })
  }

  if (source.impactTeam || source.impactScore != null) {
    rows.push({
      label: 'MVP Sinyali',
      value: `${source.impactTeam || 'Takim'}${source.impactScore != null ? ` (${source.impactScore})` : ''}`,
    })
  }

  if (source.favorite || source.predictionEdge != null) {
    rows.push({
      label: 'Model Ayraci',
      value: `${source.favorite || 'Belirsiz'}${source.predictionEdge != null ? ` +${source.predictionEdge}` : ''}`,
    })
  }

  if (source.upset) {
    rows.push({ label: 'Durum', value: 'Surpriz sonucu sinifi' })
  }

  return rows.slice(0, 3)
}

function ScoutNoteCard({ item, compact = false }) {
  const rows = buildScoutRows(item)
  if (!rows.length) return null

  return (
    <div style={{
      marginTop: compact ? 9 : 12,
      border: '1px solid rgba(94,234,212,.22)',
      background: 'linear-gradient(130deg, rgba(20,184,166,.12), rgba(16,16,16,.92))',
      borderRadius: 11,
      padding: compact ? '8px 9px' : '10px 11px',
    }}>
      <div style={{ fontSize: 10, color: '#93f5ea', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', marginBottom: 6 }}>
        Gozcu Notu
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {rows.map((row, idx) => (
          <div key={`${row.label}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: compact ? 11 : 12 }}>
            <span style={{ color: '#9dd8d0' }}>{row.label}</span>
            <span style={{ color: '#ddfffb', fontWeight: 700, textAlign: 'right' }}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function NewsCard({ item, likes, liked, comments, onLike, onComment, canInteract, onOpenDetail, onReport, isForYou, isMobile = false }) {
  const [commentInput, setCommentInput] = useState('')
  const [sending, setSending] = useState(false)
  const { visuals } = item

  async function submitComment(e) {
    e.preventDefault()
    e.stopPropagation()
    const text = commentInput.trim()
    if (!text) return
    setSending(true)
    try {
      await onComment(item.id, text)
      setCommentInput('')
    } finally {
      setSending(false)
    }
  }

  return (
    <article
      onClick={() => onOpenDetail(item)}
      style={{
        background: 'linear-gradient(180deg,#101010 0%,#0b0b0b 100%)',
        border: '1px solid #1f1f22',
        borderRadius: 18,
        padding: 16,
        boxShadow: visuals.turkish ? '0 18px 40px rgba(200,16,46,.08)' : 'none',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: visuals.turkish
          ? 'radial-gradient(circle at 10% 10%, rgba(200,16,46,.18), transparent 34%)'
          : 'radial-gradient(circle at 85% 0%, rgba(255,255,255,.05), transparent 28%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isForYou && (
              <span style={{ fontSize: 10, color: '#ffe5ac', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', padding: '4px 8px', borderRadius: 999, background: 'rgba(255,183,0,.16)', border: '1px solid rgba(255,183,0,.42)' }}>
                For You
              </span>
            )}
            <span style={{ fontSize: 10, color: '#f4f4f4', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, padding: '4px 8px', borderRadius: 999, background: `${visuals.gameColor}22`, border: `1px solid ${visuals.gameColor}55` }}>
              {item.tag}
            </span>
            <span style={{ fontSize: 10, color: '#d8d8d8', padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,.04)', border: '1px solid #272727' }}>
              {visuals.gameLabel}
            </span>
            <span style={{ fontSize: 10, color: HERO_TIERS.has(visuals.tier) ? '#ffb3bd' : '#a5a5a5', padding: '4px 8px', borderRadius: 999, background: HERO_TIERS.has(visuals.tier) ? 'rgba(200,16,46,.18)' : 'rgba(255,255,255,.03)', border: HERO_TIERS.has(visuals.tier) ? '1px solid rgba(200,16,46,.35)' : '1px solid #242424' }}>
              Tier {visuals.tier}
            </span>
          </div>
          <span style={{ fontSize: 10, color: '#7f7f7f' }}>{fmtDate(item.publishedAt)}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'auto 1fr auto', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start', gap: 8 }}>
            {visuals.teamA.logo_url
              ? <img src={visuals.teamA.logo_url} alt={visuals.teamA.name || ''} style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 10, background: '#111', padding: 4, border: '1px solid #242424' }} />
              : <div style={{ width: 34, height: 34, borderRadius: 10, background: '#151515', border: '1px solid #242424' }} />}
            {visuals.teamB.logo_url
              ? <img src={visuals.teamB.logo_url} alt={visuals.teamB.name || ''} style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 10, background: '#111', padding: 4, border: '1px solid #242424' }} />
              : <div style={{ width: 34, height: 34, borderRadius: 10, background: '#151515', border: '1px solid #242424' }} />}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#a9a9a9', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{visuals.tournamentName}</div>
            <h3 style={{ margin: 0, fontSize: 19, lineHeight: 1.3 }}>{item.title}</h3>
          </div>

          {!isMobile && visuals.turkish && (
            <div style={{ fontSize: 10, fontWeight: 800, color: '#ffd9df', padding: '5px 8px', borderRadius: 999, border: '1px solid rgba(200,16,46,.38)', background: 'rgba(200,16,46,.16)' }}>
              Turkish Pride
            </div>
          )}
        </div>

        <div style={{ fontSize: 14, color: '#f0d3d8', marginBottom: 8, fontWeight: 700 }}>{item.heroScore}</div>
        <p style={{ margin: 0, color: '#c6c6c6', lineHeight: 1.6 }}>{item.summary}</p>

        <ScoutNoteCard item={item} compact />

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            disabled={!canInteract}
            onClick={e => {
              e.stopPropagation()
              onLike(item.id)
            }}
            style={{
              border: `1px solid ${liked ? '#ffc857' : '#333'}`,
              background: liked ? 'linear-gradient(140deg, rgba(255,200,87,.22), rgba(35,25,8,.95))' : '#151515',
              color: liked ? '#ffe7b1' : '#b1b1b1',
              borderRadius: 8,
              padding: '6px 10px',
              cursor: canInteract ? 'pointer' : 'not-allowed',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.3px',
            }}
          >
            {liked ? 'STARRED' : 'STAR'} ({likes})
          </button>
          <span style={{ fontSize: 12, color: '#888' }}>Yorum: {comments.length}</span>
          {!canInteract && <span style={{ fontSize: 11, color: '#6a6a6a' }}>Etkilesim icin giris yapin</span>}
        </div>

        {comments.length > 0 && (
          <div style={{ marginTop: 10, borderTop: '1px solid #232323', paddingTop: 8, display: 'grid', gap: 7 }}>
            {comments.slice(0, 3).map(comment => (
              <div key={comment.id} style={{ fontSize: 12, color: '#c7c7c7', background: '#121212', borderRadius: 8, padding: '7px 9px', border: '1px solid #1f1f1f' }}>
                <div style={{ fontSize: 10, color: '#777', marginBottom: 3 }}>{comment.author}</div>
                {comment.comment_text}
              </div>
            ))}
          </div>
        )}

        {canInteract && (
          <form onSubmit={submitComment} style={{ marginTop: 10, display: 'flex', gap: 8, flexDirection: isMobile ? 'column' : 'row' }} onClick={e => e.stopPropagation()}>
            <input
              value={commentInput}
              onChange={e => setCommentInput(e.target.value)}
              placeholder='Yorum yaz...'
              style={{ flex: 1, background: '#131313', border: '1px solid #2a2a2a', borderRadius: 8, color: '#f5f5f5', padding: '8px 10px', fontSize: 12 }}
            />
            <button disabled={sending || !commentInput.trim()} style={{ border: '1px solid #444', background: '#1b1b1b', color: '#ddd', borderRadius: 8, padding: '8px 10px', fontSize: 12, cursor: 'pointer', width: isMobile ? '100%' : 'auto' }}>
              Gonder
            </button>
          </form>
        )}

        <NewsTrustLayer item={item} onReport={onReport} />
      </div>
    </article>
  )
}

export default function NewsPage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { followedTeamIds } = useUser()
  const [activeCategory, setActiveCategory] = useState('all')

  const [loading, setLoading] = useState(true)
  const [stories, setStories] = useState([])
  const [likesByNews, setLikesByNews] = useState({})
  const [likedSet, setLikedSet] = useState(new Set())
  const [commentsByNews, setCommentsByNews] = useState({})
  const [page, setPage] = useState(1)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 900)
  const commentsWarningShownRef = useRef(false)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isMissingNewsCommentsTable = useCallback((err) => {
    if (!err) return false
    const code = String(err.code || '')
    const message = String(err.message || '').toLowerCase()
    return code === '42P01' || message.includes('news_comments') || message.includes('relation')
  }, [])

  const warnMissingCommentsTable = useCallback((err) => {
    if (commentsWarningShownRef.current) return
    commentsWarningShownRef.current = true
    console.warn('news_comments tablosu bulunamadi, yorum ozelligi fallback modunda calisiyor.', err?.message || err)
  }, [])

  const hydrateInteractions = useCallback(async newsIds => {
    if (!newsIds.length) return

    const [{ data: likesRows }, commentsRes] = await Promise.all([
      supabase.from('news_likes').select('id,news_id,user_id').in('news_id', newsIds),
      supabase.from('news_comments').select('id,news_id,user_id,comment_text,created_at').in('news_id', newsIds).order('created_at', { ascending: false }),
    ])

    let commentsRows = commentsRes?.data || []
    if (commentsRes?.error) {
      if (isMissingNewsCommentsTable(commentsRes.error)) {
        warnMissingCommentsTable(commentsRes.error)
        commentsRows = []
      } else {
        throw commentsRes.error
      }
    }

    const likeMap = {}
    const liked = new Set()
    for (const row of (likesRows || [])) {
      likeMap[row.news_id] = (likeMap[row.news_id] || 0) + 1
      if (user?.id && row.user_id === user.id) liked.add(row.news_id)
    }

    const commentMap = {}
    for (const row of (commentsRows || [])) {
      if (!commentMap[row.news_id]) commentMap[row.news_id] = []
      commentMap[row.news_id].push({
        ...row,
        author: row.user_id === user?.id ? (profile?.username || 'Sen') : `User ${String(row.user_id || '').slice(0, 6)}`,
      })
    }

    setLikesByNews(likeMap)
    setLikedSet(liked)
    setCommentsByNews(commentMap)
  }, [isMissingNewsCommentsTable, profile?.username, user?.id, warnMissingCommentsTable])

  const loadStories = useCallback(async () => {
    setLoading(true)
    try {
      const now = new Date()
      const since = new Date(now.getTime() - (24 * 60 * 60 * 1000))
      const upcomingUntil = new Date(now.getTime() + (72 * 60 * 60 * 1000))

      const commonSelect = `
        id, scheduled_at, status, winner_id,
        team_a_id, team_b_id, team_a_score, team_b_score,
        prediction_team_a, prediction_team_b,
        team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
        team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
        tournament:tournaments(id,name,tier),
        game:games(id,name,slug)
      `

      const [finishedRes, upcomingRes] = await Promise.all([
        supabase
          .from('matches')
          .select(commonSelect)
          .eq('status', 'finished')
          .gte('scheduled_at', since.toISOString())
          .order('scheduled_at', { ascending: false })
          .limit(14),
        supabase
          .from('matches')
          .select(commonSelect)
          .eq('status', 'not_started')
          .gte('scheduled_at', now.toISOString())
          .lte('scheduled_at', upcomingUntil.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(10),
      ])

      if (finishedRes.error) throw finishedRes.error
      if (upcomingRes.error) throw upcomingRes.error

      const finishedMatches = finishedRes.data || []
      const upcomingMatches = upcomingRes.data || []

      const matchIds = finishedMatches.map(match => match.id)
      const { data: statsRows, error: statsError } = matchIds.length
        ? await supabase.from('match_stats').select('match_id,team_id,stats').in('match_id', matchIds)
        : { data: [], error: null }

      if (statsError) throw statsError

      const statsByMatch = new Map()
      for (const row of (statsRows || [])) {
        if (!statsByMatch.has(row.match_id)) statsByMatch.set(row.match_id, [])
        statsByMatch.get(row.match_id).push(row)
      }

      const generated = [
        ...finishedMatches.map(match => buildFinishedStory(match, statsByMatch, isTurkishTeam)),
        ...upcomingMatches.map(match => buildUpcomingStory(match, isTurkishTeam)),
      ]
        .filter(story => story.visuals.gameId)
        .slice(0, NEWS_LIMIT)

      const prioritized = prioritizeStoriesForYou(generated, followedTeamIds)
        .map(story => ({
          ...story,
          isForYou: isStoryForYou(story, followedTeamIds),
        }))

      setStories(prioritized)
      await hydrateInteractions(prioritized.map(item => item.id))
    } catch (err) {
      console.error('NewsPage loadStories:', err.message || err)
      setStories([])
    } finally {
      setLoading(false)
    }
  }, [followedTeamIds, hydrateInteractions])

  useEffect(() => {
    loadStories()
  }, [loadStories])

  const filteredStories = useMemo(() => {
    const scoped = stories.filter(story => activeCategory === 'all' || story.visuals.gameId === activeCategory)
    return prioritizeStoriesForYou(scoped, followedTeamIds).map(story => ({
      ...story,
      isForYou: isStoryForYou(story, followedTeamIds),
    }))
  }, [activeCategory, followedTeamIds, stories])

  useEffect(() => {
    setPage(1)
  }, [activeCategory, stories.length])

  const hero = filteredStories.find(story => HERO_TIERS.has(story.visuals.tier)) || filteredStories[0] || null
  const agenda = filteredStories.filter(story => story.id !== hero?.id)
  const totalPages = Math.max(1, Math.ceil(agenda.length / NEWS_PAGE_SIZE))
  const pagedAgenda = agenda.slice((page - 1) * NEWS_PAGE_SIZE, page * NEWS_PAGE_SIZE)
  const canInteract = !!user?.id

  async function toggleLike(newsId) {
    if (!canInteract) return
    const alreadyLiked = likedSet.has(newsId)

    if (alreadyLiked) {
      const { error } = await supabase.from('news_likes').delete().eq('news_id', newsId).eq('user_id', user.id)
      if (!error) {
        const next = new Set(likedSet)
        next.delete(newsId)
        setLikedSet(next)
        setLikesByNews(prev => ({ ...prev, [newsId]: Math.max((prev[newsId] || 1) - 1, 0) }))
      }
      return
    }

    const { error } = await supabase.from('news_likes').insert({ news_id: newsId, user_id: user.id })
    if (!error) {
      const next = new Set(likedSet)
      next.add(newsId)
      setLikedSet(next)
      setLikesByNews(prev => ({ ...prev, [newsId]: (prev[newsId] || 0) + 1 }))
    }
  }

  async function addComment(newsId, text) {
    if (!canInteract) return
    try {
      const { data, error } = await supabase
        .from('news_comments')
        .insert({ news_id: newsId, user_id: user.id, comment_text: text })
        .select('id,news_id,user_id,comment_text,created_at')
        .single()

      if (error) {
        if (isMissingNewsCommentsTable(error)) {
          warnMissingCommentsTable(error)
          return
        }
        throw error
      }

      if (data) {
        setCommentsByNews(prev => ({
          ...prev,
          [newsId]: [
            {
              ...data,
              author: profile?.username || 'Sen',
            },
            ...(prev[newsId] || []),
          ],
        }))
      }
    } catch (error) {
      console.error('addComment error:', error?.message || error)
    }
  }

  async function reportStoryIssue(item) {
    const payload = {
      news_id: item.id,
      match_id: item.matchId,
      game_id: item.visuals.gameId,
      status: item.status,
      title: item.title,
    }

    try {
      const { error } = await supabase.from('news_feedback').insert({
        news_id: item.id,
        reported_by: user?.id || null,
        payload,
      })

      if (error) throw error
      window.alert('Geri bildirimin alindi. Tesekkurler!')
    } catch {
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload))
      } catch {
        // no-op
      }
      window.alert('Geri bildirim altyapisi hazir degil. Haber ozeti panoya kopyalandi.')
    }
  }

  function openStoryDetail(item) {
    navigate(`/news/${item.id}`, {
      state: {
        story: item,
      },
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#090909', color: '#f2f2f2' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: isMobile ? '14px 10px 34px' : '22px 16px 48px' }}>
        <div style={{ borderRadius: 18, border: '1px solid #1f1f1f', overflow: 'hidden', marginBottom: 18, background: 'linear-gradient(180deg,#0b0b0b 0%,#111 100%)' }}>
          <div style={{ background: 'linear-gradient(90deg,#C8102E,#8c0e20 45%,#f4f4f4)', color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', textAlign: 'center', padding: 8 }}>
            Esports News Desk
          </div>
          <div style={{ padding: 18, background: 'radial-gradient(circle at 78% 20%, rgba(198,27,51,.18), transparent 36%), radial-gradient(circle at 10% 12%, rgba(255,255,255,.05), transparent 24%), #111' }}>
            <h1 style={{ margin: 0, fontSize: isMobile ? 26 : 34, lineHeight: 1.1 }}>Gunun E-Spor Bulteni</h1>
            <p style={{ margin: '8px 0 16px', color: '#9b9b9b', fontSize: isMobile ? 13 : 14 }}>
              Tier oncelikli mansetler, skora dayali sonuc haberleri ve yaklasan haftanin maclari tek akista.
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CATEGORY_TABS.map(tab => {
                const active = tab.id === activeCategory
                const game = GAME_FILTERS.find(item => item.id === tab.id)
                const color = game?.color || '#8f8f8f'
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveCategory(tab.id)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 999,
                      border: active ? `1px solid ${color}` : '1px solid #2a2a2a',
                      background: active ? `${color}22` : '#121212',
                      color: active ? '#ffffff' : '#9e9e9e',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '.2px',
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {loading && <div style={{ color: '#888', fontSize: 13 }}>Haberler hazirlaniyor...</div>}

        {hero && (
          <section style={{ marginBottom: 18 }}>
            <div style={{ marginBottom: 8, fontSize: 11, color: '#c61b33', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 800 }}>
              {hero.isForYou ? 'Manset · For You' : 'Manset'}
            </div>
            <article onClick={() => openStoryDetail(hero)} style={{ borderRadius: 18, padding: isMobile ? 14 : 20, border: '1px solid #2a2a2a', background: 'linear-gradient(145deg,#171717,#101010)', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: hero.visuals.turkish ? 'radial-gradient(circle at 12% 18%, rgba(200,16,46,.22), transparent 34%)' : 'radial-gradient(circle at 90% 10%, rgba(255,255,255,.05), transparent 24%)' }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {hero.isForYou && (
                      <span style={{ fontSize: 10, color: '#ffe5ac', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', padding: '5px 9px', borderRadius: 999, background: 'rgba(255,183,0,.16)', border: '1px solid rgba(255,183,0,.42)' }}>
                        For You
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: '#ffd2d8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.1, padding: '5px 9px', borderRadius: 999, background: 'rgba(200,16,46,.18)', border: '1px solid rgba(200,16,46,.38)' }}>
                      Manset
                    </span>
                    <span style={{ fontSize: 10, color: '#f0f0f0', padding: '5px 9px', borderRadius: 999, background: `${hero.visuals.gameColor}22`, border: `1px solid ${hero.visuals.gameColor}55` }}>
                      {hero.visuals.gameLabel}
                    </span>
                    <span style={{ fontSize: 10, color: '#f7b6bf', padding: '5px 9px', borderRadius: 999, background: 'rgba(200,16,46,.18)', border: '1px solid rgba(200,16,46,.34)' }}>
                      Tier {hero.visuals.tier}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#a0a0a0' }}>{fmtDate(hero.publishedAt)}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'auto 1fr', gap: 16, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start', gap: 10 }}>
                    {hero.visuals.teamA.logo_url
                      ? <img src={hero.visuals.teamA.logo_url} alt={hero.visuals.teamA.name || ''} style={{ width: isMobile ? 50 : 56, height: isMobile ? 50 : 56, objectFit: 'contain', borderRadius: 14, background: '#111', padding: 6, border: '1px solid #2c2c2c' }} />
                      : <div style={{ width: isMobile ? 50 : 56, height: isMobile ? 50 : 56, borderRadius: 14, background: '#151515', border: '1px solid #2c2c2c' }} />}
                    {hero.visuals.teamB.logo_url
                      ? <img src={hero.visuals.teamB.logo_url} alt={hero.visuals.teamB.name || ''} style={{ width: isMobile ? 50 : 56, height: isMobile ? 50 : 56, objectFit: 'contain', borderRadius: 14, background: '#111', padding: 6, border: '1px solid #2c2c2c' }} />
                      : <div style={{ width: isMobile ? 50 : 56, height: isMobile ? 50 : 56, borderRadius: 14, background: '#151515', border: '1px solid #2c2c2c' }} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#b3b3b3', fontSize: 12, marginBottom: 6 }}>{hero.visuals.tournamentName}</div>
                    <h2 style={{ margin: '0 0 10px', fontSize: isMobile ? 24 : 32, lineHeight: 1.1 }}>{hero.title}</h2>
                    <div style={{ color: '#f0d3d8', fontSize: 17, fontWeight: 700 }}>{hero.heroScore}</div>
                  </div>
                </div>

                <p style={{ margin: 0, color: '#d8d8d8', lineHeight: 1.7 }}>{hero.summary}</p>

                <ScoutNoteCard item={hero} />

                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    disabled={!canInteract}
                    onClick={e => {
                      e.stopPropagation()
                      toggleLike(hero.id)
                    }}
                    style={{
                      border: `1px solid ${likedSet.has(hero.id) ? '#ffc857' : '#383838'}`,
                      background: likedSet.has(hero.id) ? 'linear-gradient(140deg, rgba(255,200,87,.22), rgba(35,25,8,.95))' : '#151515',
                      color: likedSet.has(hero.id) ? '#ffe7b1' : '#c8c8c8',
                      borderRadius: 9,
                      padding: '7px 11px',
                      cursor: canInteract ? 'pointer' : 'not-allowed',
                      fontWeight: 700,
                      letterSpacing: '.3px',
                    }}
                  >
                    {likedSet.has(hero.id) ? 'STARRED' : 'STAR'} ({likesByNews[hero.id] || 0})
                  </button>
                  <span style={{ fontSize: 12, color: '#8b8b8b' }}>Yorum: {(commentsByNews[hero.id] || []).length}</span>
                </div>

                <NewsTrustLayer item={hero} onReport={reportStoryIssue} />
              </div>
            </article>
          </section>
        )}

        <section>
          <div style={{ marginBottom: 10, fontSize: 11, color: '#f4f4f4', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 800 }}>Gundem</div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit,minmax(320px,1fr))' }}>
            {pagedAgenda.map(item => (
              <NewsCard
                key={item.id}
                item={item}
                likes={likesByNews[item.id] || 0}
                liked={likedSet.has(item.id)}
                comments={commentsByNews[item.id] || []}
                onLike={toggleLike}
                onComment={addComment}
                canInteract={canInteract}
                onOpenDetail={openStoryDetail}
                onReport={reportStoryIssue}
                isForYou={item.isForYou}
                isMobile={isMobile}
              />
            ))}
          </div>

          {agenda.length > NEWS_PAGE_SIZE && (
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => setPage(prev => Math.max(1, prev - 1))}
                disabled={page === 1}
                style={{ border: '1px solid #303030', background: page === 1 ? '#111' : '#181818', color: page === 1 ? '#666' : '#ddd', borderRadius: 8, padding: '6px 10px', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
              >
                ‹ Onceki
              </button>
              <span style={{ fontSize: 12, color: '#9d9d9d' }}>Sayfa {page} / {totalPages}</span>
              <button
                onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
                style={{ border: '1px solid #303030', background: page >= totalPages ? '#111' : '#181818', color: page >= totalPages ? '#666' : '#ddd', borderRadius: 8, padding: '6px 10px', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
              >
                Sonraki ›
              </button>
            </div>
          )}
        </section>

        {!loading && filteredStories.length === 0 && (
          <div style={{ marginTop: 18, color: '#777', fontSize: 13 }}>Su an secili oyun icin gosterilecek taze haber bulunamadi.</div>
        )}
      </div>
    </div>
  )
}
