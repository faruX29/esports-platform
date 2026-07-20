import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useUser } from '../context/UserContext'
import { GAMES } from '../context/GameContext'
import { isTurkishTeam } from '../constants'
import {
  NEWS_LIMIT,
  HERO_TIERS,
  buildUpcomingStory,
  normalizeGameId,
  normalizeTier,
  getGameMeta,
  tierWeight,
} from '../utils/newsStories'
import { isStoryFollowedTeam, prioritizeStoriesForYou } from '../utils/newsPersonalization'
import ShareButton from '../components/ShareButton'
import SeoHead from '../components/SeoHead'
import NewsCover, { scoreFromHero } from '../components/NewsCover'
import { cleanDisplayName } from '../utils/nameCleaner'
import { buildNewsSlug } from '../utils/newsSlug'
import { MessageSquare, Library } from 'lucide-react'
import { FEXT } from '../theme'

const GAME_FILTERS = GAMES.filter(game => !game.soon && game.id !== 'all' && ['valorant', 'cs2', 'lol'].includes(game.id))
const CATEGORY_TABS = [
  { id: 'all', label: 'Hepsi' },
  { id: 'valorant', label: 'Valorant' },
  { id: 'lol', label: 'LoL' },
  { id: 'cs2', label: 'CS2' },
]
const NEWS_PAGE_SIZE = 6

function normalizeStoryGameId(raw) {
  const normalized = normalizeGameId(raw)
  if (normalized) return normalized
  return String(raw || '').trim().toLowerCase() || null
}

function normalizeTournamentId(raw) {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function applyRealtimeTournamentToStory(story, tournamentById) {
  const tournamentId = normalizeTournamentId(story?.tournamentId)
  if (tournamentId == null) return story

  const tournament = tournamentById.get(tournamentId)
  if (!tournament) return story

  return {
    ...story,
    visuals: {
      ...story.visuals,
      tier: normalizeTier(tournament.tier ?? story?.visuals?.tier),
      tournamentName: cleanDisplayName(tournament.name || story?.visuals?.tournamentName || 'Ana Sahne') || 'Ana Sahne',
    },
  }
}

function getCommentContent(comment) {
  return comment?.content ?? comment?.comment_text ?? ''
}

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

function getArticleStoryTag(variant) {
  if (variant === 'transfer') return 'Transfer'
  if (variant === 'tournament') return 'Turnuva Özeti'
  if (variant === 'preview') return 'Önizleme'
  if (variant === 'upset') return 'Sürpriz Sonuç'
  if (variant === 'stomp') return 'Skor Haberi'
  if (variant === 'close') return 'Seri Ozeti'
  return 'Gündem'
}

function articleRowToStory(row) {
  const gameId = normalizeStoryGameId(row.game_slug)
  const game = getGameMeta(gameId)
  const tier = normalizeTier(row.tier)
  const isTransfer = row.content_type === 'transfer'
  const isTournament = row.content_type === 'tournament'
  const isPreview = row.variant === 'preview'
  // Transfer → transfer_<uuid>; turnuva → tournament_<id>; maç → match_<id>
  const storyId = isTransfer ? `transfer_${row.id}`
    : isTournament ? `tournament_${row.tournament_id}`
    : `match_${row.match_id}`
  return {
    id: storyId,
    matchId: (isTransfer || isTournament) ? null : row.match_id,
    tournamentId: row.tournament_id,
    status: isTransfer ? 'transfer' : isTournament ? 'tournament' : (isPreview ? 'not_started' : 'finished'),
    variant: row.variant || 'close',
    publishedAt: row.created_at,
    priority: (tierWeight(tier) * 100) + (isTournament ? 40 : isTransfer ? 30 : row.variant === 'upset' ? 35 : row.variant === 'stomp' ? 24 : 12),
    title: row.title || '',
    summary: row.summary || '',
    content: row.content || '',
    tag: getArticleStoryTag(isTransfer ? 'transfer' : isTournament ? 'tournament' : row.variant),
    heroScore: row.hero_score || '',
    visuals: {
      gameId,
      gameLabel: game?.shortLabel || game?.label || 'ESPORTS',
      gameColor: game?.color || FEXT.accent,
      gameIcon: game?.icon || null,
      tournamentName: row.tournament_name || 'Ana Sahne',
      tier,
      turkish: Boolean(isTurkishTeam?.(row.team_a_name) || isTurkishTeam?.(row.team_b_name)),
      teamA: { name: row.team_a_name, logo_url: row.team_a_logo },
      teamB: { name: row.team_b_name, logo_url: row.team_b_logo },
    },
    source: {
      upset: row.variant === 'upset',
    },
  }
}

function NewsTrustLayer({ item, onReport }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>PandaScore verileriyle otomatik uretilmistir.</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <ShareButton path={`/news/${buildNewsSlug(item)}`} title={item.title} compact />
        <button
          onClick={e => {
            e.stopPropagation()
            onReport(item)
          }}
          style={{
            border: '1px solid var(--text-6)',
            background: 'var(--surface)',
            color: 'var(--text-1)',
            borderRadius: 8,
            padding: '5px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Hata Bildir
        </button>
      </div>
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
    const scoreLabel = source.impactScore != null ? ` (${Number(source.impactScore).toFixed(0)} puan)` : ''
    rows.push({
      label: 'MVP Sinyali',
      value: `${source.impactTeam || 'Takım'}${scoreLabel}`,
    })
  }

  if (source.favorite || source.predictionEdge != null) {
    const edgeLabel = source.predictionEdge != null
      ? ` +%${(Number(source.predictionEdge) * 100).toFixed(1)}`
      : ''
    rows.push({
      label: 'Model Ayraci',
      value: `${source.favorite || 'Belirsiz'}${edgeLabel}`,
    })
  }

  if (source.upset) {
    rows.push({ label: 'Durum', value: 'Sürpriz sonucu sınıfı' })
  }

  return rows.slice(0, 3)
}

function ScoutNoteCard({ item, compact = false }) {
  const rows = buildScoutRows(item)
  if (!rows.length) return null

  return (
    <div style={{
      marginTop: compact ? 9 : 12,
      border: '1px solid rgba(194,92,208,.22)',
      background: 'linear-gradient(130deg, rgba(194,92,208,.12), var(--surface))',
      borderRadius: 11,
      padding: compact ? '8px 9px' : '10px 11px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--ai)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', marginBottom: 6 }}>
        Gozcu Notu
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {rows.map((row, idx) => (
          <div key={`${row.label}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: compact ? 11 : 12 }}>
            <span style={{ color: 'var(--text-3)' }}>{row.label}</span>
            <span style={{ color: '#ddfffb', fontWeight: 700, textAlign: 'right' }}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function NewsCard({ item, likes, liked, comments, onLike, canInteract, onOpenDetail, onReport, isForYou, isMobile = false }) {
  const { visuals } = item

  return (
    <article
      onClick={() => onOpenDetail(item)}
      style={{
        background: 'linear-gradient(180deg,var(--surface) 0%,var(--bg) 100%)',
        border: '1px solid #1f1f22',
        borderRadius: 18,
        padding: 16,
        boxShadow: visuals.turkish ? '0 18px 40px rgba(194,92,208,.08)' : 'none',
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
          ? 'radial-gradient(circle at 10% 10%, rgba(194,92,208,.18), transparent 34%)'
          : 'radial-gradient(circle at 85% 0%, var(--hover), transparent 28%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isForYou && (
              <span style={{ fontSize: 10, color: '#ffe5ac', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', padding: '4px 8px', borderRadius: 999, background: 'rgba(255,183,0,.16)', border: '1px solid rgba(255,183,0,.42)' }}>
                For You
              </span>
            )}
            <span style={{ fontSize: 10, color: 'var(--text-1)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, padding: '4px 8px', borderRadius: 999, background: `${visuals.gameColor}22`, border: `1px solid ${visuals.gameColor}55` }}>
              {item.tag}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-1)', padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,.04)', border: '1px solid var(--line)' }}>
              {visuals.gameLabel}
            </span>
            <span style={{ fontSize: 10, color: HERO_TIERS.has(visuals.tier) ? 'var(--ai)' : 'var(--text-2)', padding: '4px 8px', borderRadius: 999, background: HERO_TIERS.has(visuals.tier) ? 'rgba(194,92,208,.18)' : 'var(--hover)', border: HERO_TIERS.has(visuals.tier) ? '1px solid rgba(194,92,208,.35)' : '1px solid var(--line)' }}>
              Tier {visuals.tier}
            </span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{fmtDate(item.publishedAt)}</span>
        </div>

        <div style={{ marginBottom: 12 }}>
          <NewsCover visuals={visuals} score={item.status === 'transfer' ? '➜' : item.status === 'tournament' ? '🏆' : scoreFromHero(item.heroScore)} height={isMobile ? 150 : 168} compact />
        </div>

        <div style={{ minWidth: 0, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 19, lineHeight: 1.3 }}>{item.title}</h3>
        </div>

        <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8, fontWeight: 700 }}>{item.heroScore}</div>
        <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.6 }}>{item.summary}</p>

        <ScoutNoteCard item={item} compact />

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            disabled={!canInteract}
            onClick={e => {
              e.stopPropagation()
              onLike(item.id)
            }}
            style={{
              border: `1px solid ${liked ? '#ffc857' : 'var(--text-6)'}`,
              background: liked ? 'linear-gradient(140deg, rgba(255,200,87,.22), rgba(35,25,8,.95))' : 'var(--surface)',
              color: liked ? '#ffe7b1' : 'var(--text-2)',
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
          <button
            onClick={e => {
              e.stopPropagation()
              onOpenDetail(item)
            }}
            style={{ fontSize: 11, color: comments.length > 0 ? '#a0c4ff' : 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 8, background: comments.length > 0 ? 'rgba(100,160,255,.08)' : 'var(--surface)', border: comments.length > 0 ? '1px solid rgba(100,160,255,.2)' : '1px solid var(--line)', fontWeight: comments.length > 0 ? 700 : 400, cursor: 'pointer' }}
          >
            <MessageSquare size={12} /> {comments.length > 0 ? `${comments.length} yorum` : 'Yorum yap'} ›
          </button>
          {!canInteract && <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Etkilesim icin giris yapin</span>}
        </div>

        <NewsTrustLayer item={item} onReport={onReport} />
      </div>
    </article>
  )
}

export default function NewsPage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { followedTeamIds, followedGames } = useUser()
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
      supabase.from('news_comments').select('id,news_id,user_id,content,created_at').in('news_id', newsIds).order('created_at', { ascending: false }),
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
      const content = getCommentContent(row)
      commentMap[row.news_id].push({
        ...row,
        content,
        comment_text: content,
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
      // Haberler birikir: son 7 gün penceresi (eski 48s yerine)
      const articlesSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const upcomingFrom = new Date(now.getTime() - 6 * 60 * 60 * 1000)
      const upcomingUntil = new Date(now.getTime() + 72 * 60 * 60 * 1000)

      const upcomingSelect = `
        id, scheduled_at, status, winner_id,
        team_a_id, team_b_id, team_a_score, team_b_score,
        prediction_team_a, prediction_team_b,
        team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
        team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
        tournament:tournaments(id,name,tier),
        game:games(id,name,slug)
      `

      // Fetch LLM-generated articles + upcoming matches in parallel
      const [articlesRes, upcomingRes] = await Promise.all([
        supabase
          .from('news_articles')
          .select('*')
          .gte('created_at', articlesSince.toISOString())
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('matches')
          .select(upcomingSelect)
          .in('status', ['not_started', 'upcoming'])
          .gte('scheduled_at', upcomingFrom.toISOString())
          .lte('scheduled_at', upcomingUntil.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(10),
      ])

      if (articlesRes.error) throw articlesRes.error
      if (upcomingRes.error) throw upcomingRes.error

      const upcomingMatches = upcomingRes.data || []

      // Real-time tournament tier enrichment for upcoming stories only
      const tournamentIds = [...new Set(
        upcomingMatches
          .map(m => normalizeTournamentId(m?.tournament?.id ?? m?.tournament_id))
          .filter(id => id != null)
      )]
      let tournamentById = new Map()
      if (tournamentIds.length > 0) {
        const { data: tournamentRows, error: tournamentError } = await supabase
          .from('tournaments')
          .select('id,name,tier')
          .in('id', tournamentIds)
        if (tournamentError) {
          console.warn('NewsPage tournament tier fetch:', tournamentError.message || tournamentError)
        } else {
          tournamentById = new Map(
            (tournamentRows || []).map(row => [normalizeTournamentId(row.id), row])
          )
        }
      }

      // Map news_articles rows → story objects; generate upcoming stories locally
      const articleStories = (articlesRes.data || [])
        .map(articleRowToStory)
        .filter(story => story.visuals.gameId)

      // Dedup: bir maçın LLM makalesi (recap/önizleme) varsa, yerel upcoming
      // şablon hikayesini kullanma — zengin LLM içeriği kazanır.
      const articleMatchIds = new Set(articleStories.map(s => s.matchId).filter(Boolean))

      const finishedStories = articleStories

      const upcomingStories = upcomingMatches
        .map(match => buildUpcomingStory(match, isTurkishTeam))
        .filter(story => story.visuals.gameId && !articleMatchIds.has(story.matchId))
        .map(story => applyRealtimeTournamentToStory(story, tournamentById))

      const generated = [...finishedStories, ...upcomingStories]
        .map(story => ({
          ...story,
          visuals: {
            ...story.visuals,
            gameId: normalizeStoryGameId(story?.visuals?.gameId),
          },
        }))
        .slice(0, NEWS_LIMIT)

      const prioritized = prioritizeStoriesForYou(generated, followedTeamIds, followedGames)
        .map(story => ({
          ...story,
          isForYou: isStoryFollowedTeam(story, followedTeamIds),
        }))

      setStories(prioritized)
      await hydrateInteractions(prioritized.map(item => item.id))
    } catch (err) {
      console.error('NewsPage loadStories:', err.message || err)
      setStories([])
    } finally {
      setLoading(false)
    }
  }, [followedTeamIds, followedGames, hydrateInteractions])

  useEffect(() => {
    loadStories()
  }, [loadStories])

  const filteredStories = useMemo(() => {
    const scoped = stories.filter(story => {
      if (activeCategory === 'all') return true
      return normalizeStoryGameId(story?.visuals?.gameId) === normalizeStoryGameId(activeCategory)
    })
    return prioritizeStoriesForYou(scoped, followedTeamIds, followedGames).map(story => ({
      ...story,
      isForYou: isStoryFollowedTeam(story, followedTeamIds),
    }))
  }, [activeCategory, followedTeamIds, followedGames, stories])

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
      window.alert('Geri bildirim altyapısı hazır değil. Haber özeti panoya kopyalandı.')
    }
  }

  function openStoryDetail(item) {
    navigate(`/news/${buildNewsSlug(item)}`, {
      state: {
        story: item,
      },
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <SeoHead
        title="Günün E-Spor Bülteni"
        description="Tier öncelikli manşetler, skora dayalı sonuç haberleri ve yaklaşan haftanın maçları tek akışta — Valorant, CS2, LoL."
        type="website"
      />
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: isMobile ? '14px 10px 34px' : '22px 16px 48px' }}>
        <div style={{ borderRadius: 18, border: '1px solid var(--surface-2)', overflow: 'hidden', marginBottom: 18, background: 'linear-gradient(180deg,var(--bg) 0%,var(--surface) 100%)' }}>
          <div style={{ background: FEXT.accentGrad, color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', textAlign: 'center', padding: 8 }}>
            Esports News Desk
          </div>
          <div style={{ padding: 18, background: 'radial-gradient(circle at 78% 20%, rgba(198,27,51,.18), transparent 36%), radial-gradient(circle at 10% 12%, var(--hover), transparent 24%), var(--surface)' }}>
            <h1 style={{ margin: 0, fontSize: isMobile ? 26 : 34, lineHeight: 1.1 }}>Gunun E-Spor Bulteni</h1>
            <p style={{ margin: '8px 0 16px', color: 'var(--text-3)', fontSize: isMobile ? 13 : 14 }}>
              Tier oncelikli mansetler, skora dayali sonuc haberleri ve yaklasan haftanin maclari tek akista.
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CATEGORY_TABS.map(tab => {
                const active = tab.id === activeCategory
                const game = GAME_FILTERS.find(item => item.id === tab.id)
                const color = game?.color || 'var(--text-3)'
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveCategory(tab.id)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 999,
                      border: active ? `1px solid ${color}` : '1px solid var(--line)',
                      background: active ? `${color}22` : 'var(--surface)',
                      color: active ? color : 'var(--text-3)',
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

            <div style={{ marginTop: 14 }}>
              <Link
                to="/news/archive"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12, fontWeight: 700, letterSpacing: '.3px',
                  color: 'var(--text-1)', textDecoration: 'none',
                  padding: '8px 14px', borderRadius: 999,
                  border: '1px solid var(--line)', background: 'var(--surface)',
                }}
              >
                <Library size={13} /> Tüm Haber Arşivi ›
              </Link>
            </div>
          </div>
        </div>

        {loading && <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Haberler hazirlaniyor...</div>}

        {hero && (
          <section style={{ marginBottom: 18 }}>
            <div style={{ marginBottom: 8, fontSize: 11, color: '#c61b33', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 800 }}>
              {hero.isForYou ? 'Manset · For You' : 'Manset'}
            </div>
            <article onClick={() => openStoryDetail(hero)} style={{ borderRadius: 18, padding: isMobile ? 14 : 20, border: '1px solid var(--line)', background: 'linear-gradient(145deg,var(--surface),var(--surface))', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: hero.visuals.turkish ? 'radial-gradient(circle at 12% 18%, rgba(194,92,208,.22), transparent 34%)' : 'radial-gradient(circle at 90% 10%, var(--hover), transparent 24%)' }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {hero.isForYou && (
                      <span style={{ fontSize: 10, color: '#ffe5ac', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', padding: '5px 9px', borderRadius: 999, background: 'rgba(255,183,0,.16)', border: '1px solid rgba(255,183,0,.42)' }}>
                        For You
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--ai)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.1, padding: '5px 9px', borderRadius: 999, background: 'rgba(194,92,208,.18)', border: '1px solid rgba(194,92,208,.38)' }}>
                      Manset
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-1)', padding: '5px 9px', borderRadius: 999, background: `${hero.visuals.gameColor}22`, border: `1px solid ${hero.visuals.gameColor}55` }}>
                      {hero.visuals.gameLabel}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--ai)', padding: '5px 9px', borderRadius: 999, background: 'rgba(194,92,208,.18)', border: '1px solid rgba(194,92,208,.34)' }}>
                      Tier {hero.visuals.tier}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtDate(hero.publishedAt)}</div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <NewsCover visuals={hero.visuals} score={hero.status === 'transfer' ? '➜' : hero.status === 'tournament' ? '🏆' : scoreFromHero(hero.heroScore)} height={isMobile ? 190 : 230} />
                </div>
                <div style={{ minWidth: 0, marginBottom: 12 }}>
                  <h2 style={{ margin: '0 0 8px', fontSize: isMobile ? 24 : 32, lineHeight: 1.1 }}>{hero.title}</h2>
                  <div style={{ color: 'var(--text-2)', fontSize: 17, fontWeight: 700 }}>{hero.heroScore}</div>
                </div>

                <p style={{ margin: 0, color: 'var(--text-1)', lineHeight: 1.7 }}>{hero.summary}</p>

                <ScoutNoteCard item={hero} />

                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    disabled={!canInteract}
                    onClick={e => {
                      e.stopPropagation()
                      toggleLike(hero.id)
                    }}
                    style={{
                      border: `1px solid ${likedSet.has(hero.id) ? '#ffc857' : 'var(--text-6)'}`,
                      background: likedSet.has(hero.id) ? 'linear-gradient(140deg, rgba(255,200,87,.22), rgba(35,25,8,.95))' : 'var(--surface)',
                      color: likedSet.has(hero.id) ? '#ffe7b1' : 'var(--text-2)',
                      borderRadius: 9,
                      padding: '7px 11px',
                      cursor: canInteract ? 'pointer' : 'not-allowed',
                      fontWeight: 700,
                      letterSpacing: '.3px',
                    }}
                  >
                    {likedSet.has(hero.id) ? 'STARRED' : 'STAR'} ({likesByNews[hero.id] || 0})
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Yorum: {(commentsByNews[hero.id] || []).length}</span>
                </div>

                <NewsTrustLayer item={hero} onReport={reportStoryIssue} />
              </div>
            </article>
          </section>
        )}

        <section>
          <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--text-1)', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 800 }}>Gundem</div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit,minmax(320px,1fr))' }}>
            {pagedAgenda.map(item => (
              <NewsCard
                key={item.id}
                item={item}
                likes={likesByNews[item.id] || 0}
                liked={likedSet.has(item.id)}
                comments={commentsByNews[item.id] || []}
                onLike={toggleLike}
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
                style={{ border: '1px solid var(--text-6)', background: page === 1 ? 'var(--surface)' : 'var(--surface-2)', color: page === 1 ? 'var(--text-4)' : 'var(--text-1)', borderRadius: 8, padding: '6px 10px', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
              >
                ‹ Onceki
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Sayfa {page} / {totalPages}</span>
              <button
                onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
                style={{ border: '1px solid var(--text-6)', background: page >= totalPages ? 'var(--surface)' : 'var(--surface-2)', color: page >= totalPages ? 'var(--text-4)' : 'var(--text-1)', borderRadius: 8, padding: '6px 10px', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
              >
                Sonraki ›
              </button>
            </div>
          )}
        </section>

        {!loading && filteredStories.length === 0 && (
          <div style={{ marginTop: 18, color: 'var(--text-4)', fontSize: 13 }}>Su an secili oyun icin gosterilecek taze haber bulunamadi.</div>
        )}
      </div>
    </div>
  )
}
