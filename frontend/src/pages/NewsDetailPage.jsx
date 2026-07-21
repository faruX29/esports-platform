import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase, subscribeToNewsComments } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { isTurkishTeam } from '../constants'
import {
  buildFinishedStory,
  buildUpcomingStory,
  normalizeTier,
  storyExplainability,
} from '../utils/newsStories'
import {
  getScoutEmblem,
  getScoutRank,
  getScoutVoteDelta,
  normalizeScoutScore,
} from '../utils/scoutRank'
import InitialsImage from '../components/InitialsImage'
import ShareButton from '../components/ShareButton'
import SeoHead from '../components/SeoHead'
import NewsCover, { scoreFromHero } from '../components/NewsCover'
import { cleanDisplayName } from '../utils/nameCleaner'
import { buildNewsSlug, parseNewsRef } from '../utils/newsSlug'
import { getEsportsName } from '../utils/esportsName'
import { X as XIcon, MessageSquare } from 'lucide-react'
import { FEXT } from '../theme'
import { isUncertainPrediction } from '../utils/prediction'

function isMissingTableError(error, tableName) {
  const code = error?.code || ''
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || message.includes(tableName) || (message.includes('relation') && message.includes('does not exist'))
}

function explainCommentInsertError(error) {
  const code = String(error?.code || '').trim()
  const message = String(error?.message || '').toLowerCase()

  if (code === '42501' || message.includes('row-level security') || message.includes('rls')) {
    return 'Yorum izni reddedildi. Lütfen giriş yapıp tekrar deneyin.'
  }
  if (code === '23505') {
    return 'Aynı yorum tekrarlandı. Lütfen farklı bir içerik deneyin.'
  }
  if (code === '23514') {
    return 'Yorum metni geçerli değil. Lütfen metni kontrol edin.'
  }

  return 'Yorum gönderilemedi, lütfen tekrar deneyin.'
}

function classifyCommentInsertIssue(error) {
  const code = String(error?.code || '').trim()
  const message = String(error?.message || '').toLowerCase()

  if (code === '42501' || message.includes('row-level security') || message.includes('rls') || message.includes('permission denied')) {
    return 'RLS'
  }
  if (code === '42703' || message.includes('schema cache') || (message.includes('column') && message.includes('news_comments'))) {
    return 'SCHEMA'
  }
  if (code === '23502' || code === '23514') {
    return 'DATA'
  }
  return 'UNKNOWN'
}

const TABLE_EXISTS_CACHE = new Map()
const COMMENT_CONTENT_COLUMN = 'content'

async function checkTable(tableName) {
  if (TABLE_EXISTS_CACHE.has(tableName)) {
    return TABLE_EXISTS_CACHE.get(tableName)
  }

  try {
    const { data, error } = await supabase
      .schema('information_schema')
      .from('tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_name', tableName)
      .maybeSingle()

    if (error) {
      return true
    }

    const exists = Boolean(data?.table_name)
    TABLE_EXISTS_CACHE.set(tableName, exists)
    return exists
  } catch {
    return true
  }
}

function fmtDate(iso) {
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}


/** news_articles transfer satırını detay sayfası story şekline çevirir. */
function mapTransferRowToStory(row) {
  return {
    id: `transfer_${row.id}`,
    matchId: null,
    status: 'transfer',
    variant: 'transfer',
    publishedAt: row.created_at,
    title: row.title || '',
    summary: row.summary || '',
    content: row.content || '',
    heroScore: row.hero_score || '',
    visuals: {
      gameId: row.game_slug || null,
      gameLabel: (row.game_slug || 'ESPORTS').toUpperCase(),
      gameColor: FEXT.accent,
      tier: normalizeTier(row.tier),
      tournamentName: row.tournament_name || 'Transfer Haberi',
      turkish: false,
      teamA: { name: row.team_a_name, logo_url: row.team_a_logo },
      teamB: { name: row.team_b_name, logo_url: row.team_b_logo },
    },
    source: {},
  }
}

/** news_articles turnuva-recap satırını detay sayfası story şekline çevirir. */
function mapTournamentRowToStory(row) {
  return {
    id: `tournament_${row.tournament_id}`,
    matchId: null,
    status: 'tournament',
    variant: 'tournament',
    publishedAt: row.created_at,
    title: row.title || '',
    summary: row.summary || '',
    content: row.content || '',
    heroScore: row.hero_score || '',
    visuals: {
      gameId: row.game_slug || null,
      gameLabel: (row.game_slug || 'ESPORTS').toUpperCase(),
      gameColor: FEXT.accent,
      tier: normalizeTier(row.tier),
      tournamentName: row.tournament_name || 'Turnuva',
      turkish: false,
      teamA: { name: row.team_a_name, logo_url: row.team_a_logo },
      teamB: { name: row.team_b_name, logo_url: row.team_b_logo },
    },
    source: {},
  }
}

function commentScore(voteState) {
  const up = Number(voteState?.up || 0)
  const down = Number(voteState?.down || 0)
  return up - down
}

function ScoutRankBadge({ score }) {
  const rank = getScoutRank(score)
  const emblem = getScoutEmblem(rank.icon)

  return (
    <span
      title={`${rank.label} (${rank.score})`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        borderRadius: 999,
        padding: '2px 8px',
        border: `1px solid ${rank.border}`,
        background: rank.background,
        boxShadow: `0 0 14px ${rank.glow}`,
        color: rank.accent,
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '.35px',
        textTransform: 'uppercase',
      }}
    >
      <span style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.34)',
        border: `1px solid ${rank.border}`,
        color: '#fff',
        fontSize: 9,
        lineHeight: 1,
      }}>
        {emblem}
      </span>
      <span style={{ color: rank.accent }}>{rank.badge}</span>
      <span style={{ color: 'var(--text-1)', opacity: 0.9 }}>#{rank.score}</span>
    </span>
  )
}

function AIProbabilityBar({ story }) {
  const predA = Number(story.source?.predictionA)
  const predB = Number(story.source?.predictionB)
  if (!Number.isFinite(predA) || !Number.isFinite(predB) || predA + predB <= 0) return null

  const total = predA + predB
  const pctA = (predA / total) * 100
  const pctB = (predB / total) * 100
  const teamA = story.visuals?.teamA || {}
  const teamB = story.visuals?.teamB || {}
  const uncertain = isUncertainPrediction(predA, predB)
  const aFavored = !uncertain && predA >= predB
  const bFavored = !uncertain && predB > predA

  return (
    <section style={{ marginTop: 16, borderRadius: 16, border: '1px solid #1a2a3a', background: 'linear-gradient(145deg,#0a1520,var(--surface))', padding: 16 }}>
      <div style={{ fontSize: 11, color: '#7dd3fc', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, marginBottom: 14 }}>
        AI Güç Dengesi
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: '1 1 0' }}>
          <InitialsImage
            src={teamA.logo_url} alt={teamA.name || ''} name={teamA.name}
            width={26} height={26} borderRadius={7} objectFit='contain'
            style={{ background: 'var(--surface)', padding: 3, border: '1px solid var(--line)', flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: aFavored ? 'var(--text-1)' : 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {teamA.name}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: aFavored ? '#86efac' : '#9ca3af' }}>{pctA.toFixed(1)}%</span>
          <span style={{ fontSize: 11, color: 'var(--text-6)' }}>:</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: bFavored ? '#86efac' : '#9ca3af' }}>{pctB.toFixed(1)}%</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flex: '1 1 0', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: bFavored ? 'var(--text-1)' : 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {teamB.name}
          </span>
          <InitialsImage
            src={teamB.logo_url} alt={teamB.name || ''} name={teamB.name}
            width={26} height={26} borderRadius={7} objectFit='contain'
            style={{ background: 'var(--surface)', padding: 3, border: '1px solid var(--line)', flexShrink: 0 }}
          />
        </div>
      </div>

      <div style={{ height: 10, borderRadius: 999, overflow: 'hidden', display: 'flex', background: 'var(--surface)' }}>
        <div style={{ width: `${pctA}%`, background: aFavored ? 'linear-gradient(90deg,#8B3AA0,#DF4888)' : 'linear-gradient(90deg,var(--text-6),var(--text-5))', transition: 'width 0.4s ease' }} />
        <div style={{ flex: 1, background: bFavored ? 'linear-gradient(270deg,#1d4ed8,#60a5fa)' : 'linear-gradient(270deg,var(--line),var(--text-6))', transition: 'flex 0.4s ease' }} />
      </div>

      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-5)', textAlign: 'center' }}>
        {uncertain ? 'Fextopus iki takımı başa baş görüyor' : 'Fextopus öngörüsü: favori tarafın rengi vurgulanır'}
      </div>
    </section>
  )
}

function TrustLayer({ story, onReport }) {
  const isTransfer = story?.variant === 'transfer' || story?.status === 'transfer'
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
        {isTransfer
          ? <>Transfer verisi <a href="https://liquipedia.net" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-3)', textDecoration: 'underline' }}>Liquipedia</a> kaynaklıdır; haber otomatik üretildi.</>
          : 'PandaScore verileriyle otomatik uretilmistir.'}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ShareButton path={`/news/${buildNewsSlug(story)}`} title={story.title} />
        <button
          onClick={() => onReport(story)}
          style={{ border: '1px solid var(--text-6)', background: 'var(--surface)', color: 'var(--text-1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
        >
          Hata Bildir
        </button>
      </div>
    </div>
  )
}

export default function NewsDetailPage() {
  const { newsId } = useParams()
  const location = useLocation()
  const { user, profile } = useAuth()

  const [story, setStory] = useState(location.state?.story || null)
  const [matchData, setMatchData] = useState(null)
  const [loading, setLoading] = useState(!location.state?.story)
  const [error, setError] = useState('')
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentInput, setCommentInput] = useState('')
  const [replyTo, setReplyTo] = useState(null)      // yanıtlanan yorum id'si
  const [replyText, setReplyText] = useState('')
  const [commentWarning, setCommentWarning] = useState('')
  const [commentSuccess, setCommentSuccess] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [votesByComment, setVotesByComment] = useState({})
  const [myVotes, setMyVotes] = useState({})
  const [forumFallback, setForumFallback] = useState(false)
  const [forumComingSoon, setForumComingSoon] = useState(false)
  const [votesFallback, setVotesFallback] = useState(false)
  const [votePulse, setVotePulse] = useState({ commentId: null, direction: 0, token: 0 })
  const [sortMode, setSortMode] = useState('best')
  const canInteract = !!user?.id

  // Yanıtları parent'a göre grupla (okuma sırası: eskiden yeniye)
  const repliesByParent = useMemo(() => {
    const map = {}
    for (const c of comments) {
      if (!c.parent_id) continue
      if (!map[c.parent_id]) map[c.parent_id] = []
      map[c.parent_id].push(c)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    }
    return map
  }, [comments])

  const rankedComments = useMemo(() => {
    const list = comments.filter(c => !c.parent_id)  // sadece üst-seviye
    if (sortMode === 'newest') {
      list.sort((left, right) => {
        const lTs = new Date(left.created_at || 0).getTime()
        const rTs = new Date(right.created_at || 0).getTime()
        return rTs - lTs
      })
    } else {
      list.sort((left, right) => {
        const lVotes = votesByComment[left.id] || { up: 0, down: 0 }
        const rVotes = votesByComment[right.id] || { up: 0, down: 0 }

        const lScore = commentScore(lVotes)
        const rScore = commentScore(rVotes)
        if (rScore !== lScore) return rScore - lScore

        const lTotal = Number(lVotes.up || 0) + Number(lVotes.down || 0)
        const rTotal = Number(rVotes.up || 0) + Number(rVotes.down || 0)
        if (rTotal !== lTotal) return rTotal - lTotal

        const lTs = new Date(left.created_at || 0).getTime()
        const rTs = new Date(right.created_at || 0).getTime()
        return rTs - lTs
      })
    }
    return list
  }, [comments, votesByComment, sortMode])

  const topCommentId = rankedComments[0]?.id || null

  function triggerVotePulse(commentId, direction) {
    const token = Date.now()
    setVotePulse({ commentId, direction, token })
    window.setTimeout(() => {
      setVotePulse(prev => (prev.token === token ? { commentId: null, direction: 0, token: 0 } : prev))
    }, 260)
  }

  const applyLocalVoteDelta = useCallback((commentId, previousVote, nextVote) => {
    setVotesByComment(prev => {
      const base = prev[commentId] || { up: 0, down: 0 }
      const next = { ...base }

      if (previousVote === 1) next.up = Math.max(0, next.up - 1)
      if (previousVote === -1) next.down = Math.max(0, next.down - 1)

      if (nextVote === 1) next.up += 1
      if (nextVote === -1) next.down += 1

      return { ...prev, [commentId]: next }
    })
  }, [])

  const applyLocalScoutDelta = useCallback((authorUserId, delta) => {
    if (!authorUserId || !delta) return

    setComments(prev => prev.map(comment => {
      if (comment.user_id !== authorUserId) return comment
      return {
        ...comment,
        authorScoutScore: normalizeScoutScore(comment.authorScoutScore) + delta,
      }
    }))
  }, [])

  const loadForum = useCallback(async (currentNewsId) => {
    if (!currentNewsId) {
      setComments([])
      setVotesByComment({})
      setMyVotes({})
      return
    }

    setCommentsLoading(true)
    setCommentWarning('')
    setCommentSuccess('')

    try {
      const hasCommentsTable = await checkTable('news_comments')
      if (!hasCommentsTable) {
        setForumComingSoon(true)
        setForumFallback(false)
        setVotesFallback(false)
        setComments([])
        setVotesByComment({})
        setMyVotes({})
        return
      }

      setForumComingSoon(false)

      const { data: commentRows, error: commentsErr } = await supabase
        .from('news_comments')
        .select('id,news_id,user_id,content,created_at,parent_id')
        .eq('news_id', currentNewsId)
        .order('created_at', { ascending: false })

      if (commentsErr) {
        if (isMissingTableError(commentsErr, 'news_comments')) {
          TABLE_EXISTS_CACHE.set('news_comments', false)
          setForumComingSoon(true)
          setForumFallback(false)
          setComments([])
          setVotesByComment({})
          setMyVotes({})
          return
        }
        throw commentsErr
      }

      setForumFallback(false)
      const mappedComments = (commentRows || []).map(row => ({
        ...row,
        comment_text: row.content ?? '',
      }))

      const authorIds = [...new Set(mappedComments.map(row => row.user_id).filter(Boolean))]
      let profilesById = new Map()
      if (authorIds.length) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('id,username,first_name,last_name,scout_score,avatar_url,favorite_team_id,show_team_badge')
          .in('id', authorIds)

        if (!profileError) {
          profilesById = new Map((profileRows || []).map(row => [row.id, row]))
        }
      }

      // Rozet gösteren yazarların favori takım logolarını çek (tercih: show_team_badge)
      const badgeTeamIds = [...new Set(
        Array.from(profilesById.values())
          .filter(p => p.show_team_badge !== false && p.favorite_team_id)
          .map(p => p.favorite_team_id)
      )]
      let teamsById = new Map()
      if (badgeTeamIds.length) {
        const { data: teamRows } = await supabase.from('teams').select('id,name,logo_url').in('id', badgeTeamIds)
        teamsById = new Map((teamRows || []).map(t => [t.id, t]))
      }

      const enrichedComments = mappedComments.map(row => {
        const authorProfile = row.user_id ? profilesById.get(row.user_id) : null
        const isMe = row.user_id === user?.id
        const fallbackName = isMe ? (getEsportsName(profile) || 'Sen') : 'Topluluk'
        const fallbackScore = isMe ? normalizeScoutScore(profile?.scout_score) : 0
        const badgeTeam = authorProfile && authorProfile.show_team_badge !== false && authorProfile.favorite_team_id
          ? teamsById.get(authorProfile.favorite_team_id)
          : null

        return {
          ...row,
          author: authorProfile ? getEsportsName(authorProfile) : fallbackName,
          authorScoutScore: normalizeScoutScore(authorProfile?.scout_score ?? fallbackScore),
          authorAvatarUrl: authorProfile?.avatar_url ?? null,
          authorTeamLogo: badgeTeam?.logo_url ?? null,
          authorTeamName: badgeTeam?.name ?? null,
        }
      })

      setComments(enrichedComments)

      const commentIds = enrichedComments.map(row => row.id)
      if (!commentIds.length) {
        setVotesByComment({})
        setMyVotes({})
        return
      }

      const hasVotesTable = await checkTable('news_comment_votes')
      if (!hasVotesTable) {
        setVotesFallback(true)
        const emptyVotes = {}
        for (const commentId of commentIds) emptyVotes[commentId] = { up: 0, down: 0 }
        setVotesByComment(emptyVotes)
        setMyVotes({})
        return
      }

      const { data: voteRows, error: votesErr } = await supabase
        .from('news_comment_votes')
        .select('comment_id,user_id,vote_type')
        .in('comment_id', commentIds)

      if (votesErr) {
        if (isMissingTableError(votesErr, 'news_comment_votes')) {
          TABLE_EXISTS_CACHE.set('news_comment_votes', false)
          setVotesFallback(true)
          const emptyVotes = {}
          for (const commentId of commentIds) emptyVotes[commentId] = { up: 0, down: 0 }
          setVotesByComment(emptyVotes)
          setMyVotes({})
          return
        }
        throw votesErr
      }

      setVotesFallback(false)
      const byComment = {}
      const mine = {}
      for (const commentId of commentIds) byComment[commentId] = { up: 0, down: 0 }

      for (const voteRow of (voteRows || [])) {
        if (!byComment[voteRow.comment_id]) byComment[voteRow.comment_id] = { up: 0, down: 0 }
        if (voteRow.vote_type === 1) byComment[voteRow.comment_id].up += 1
        if (voteRow.vote_type === -1) byComment[voteRow.comment_id].down += 1
        if (voteRow.user_id === user?.id) mine[voteRow.comment_id] = voteRow.vote_type
      }

      setVotesByComment(byComment)
      setMyVotes(mine)
    } catch (forumErr) {
      console.error('forum load error:', forumErr?.message || forumErr)
      setCommentWarning('Forum verileri yuklenemedi.')
      setComments([])
      setVotesByComment({})
      setMyVotes({})
    } finally {
      setCommentsLoading(false)
    }
  }, [profile?.scout_score, profile?.username, user?.id])

  useEffect(() => {
    let cancelled = false

    async function loadFromSource() {
      const ref = parseNewsRef(newsId)

      // ── Transfer haberi: maç yok, news_articles'tan uuid ile yükle ──
      if (ref.type === 'transfer') {
        setLoading(true)
        setError('')
        try {
          const { data: art, error: artErr } = await supabase
            .from('news_articles')
            .select('*')
            .eq('id', ref.id)
            .maybeSingle()
          if (artErr) throw artErr
          if (!art) throw new Error('Haber bulunamadı.')
          const transferStory = mapTransferRowToStory(art)
          if (!cancelled) {
            setStory(transferStory)
            await loadForum(transferStory.id)
          }
        } catch (err) {
          if (!cancelled) setError(err.message || 'Transfer haberi yuklenemedi.')
        } finally {
          if (!cancelled) setLoading(false)
        }
        return
      }

      // ── Turnuva recap: maç yok, news_articles'tan tournament_id ile yükle ──
      if (ref.type === 'tournament') {
        setLoading(true)
        setError('')
        try {
          const { data: art, error: artErr } = await supabase
            .from('news_articles')
            .select('*')
            .eq('content_type', 'tournament')
            .eq('tournament_id', ref.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (artErr) throw artErr
          if (!art) throw new Error('Turnuva özeti bulunamadı.')
          const tournamentStory = mapTournamentRowToStory(art)
          if (!cancelled) {
            setStory(tournamentStory)
            await loadForum(tournamentStory.id)
          }
        } catch (err) {
          if (!cancelled) setError(err.message || 'Turnuva özeti yuklenemedi.')
        } finally {
          if (!cancelled) setLoading(false)
        }
        return
      }

      const matchId = ref.id
      if (!matchId) {
        setError('Geçerli bir haber kimliği bulunamadı.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')

      try {
        const commonSelect = `
          id, scheduled_at, status, winner_id,
          team_a_id, team_b_id, team_a_score, team_b_score,
          prediction_team_a, prediction_team_b,
          team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
          team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
          tournament:tournaments(id,name,tier),
          game:games(id,name,slug)
        `

        const { data: match, error: matchErr } = await supabase
          .from('matches')
          .select(commonSelect)
          .eq('id', matchId)
          .maybeSingle()

        if (matchErr) throw matchErr
        if (!match) throw new Error('Haber bulunamadı.')

        const { data: statRows, error: statErr } = await supabase
          .from('match_stats')
          .select('match_id,team_id,stats')
          .eq('match_id', matchId)

        if (statErr) throw statErr

        const byMatch = new Map([[matchId, statRows || []]])
        const generated = match.status === 'finished'
          ? buildFinishedStory(match, byMatch, isTurkishTeam)
          : buildUpcomingStory(match, isTurkishTeam)

        const tournamentId = Number(match?.tournament?.id ?? match?.tournament_id)
        let realtimeTournament = null
        if (Number.isFinite(tournamentId)) {
          const { data: tournamentRow, error: tournamentErr } = await supabase
            .from('tournaments')
            .select('id,name,tier')
            .eq('id', tournamentId)
            .maybeSingle()

          if (!tournamentErr && tournamentRow) {
            realtimeTournament = tournamentRow
          }
        }

        const storyWithRealtimeTier = {
          ...generated,
          visuals: {
            ...generated.visuals,
            tier: normalizeTier(realtimeTournament?.tier ?? generated?.visuals?.tier),
            tournamentName: cleanDisplayName(realtimeTournament?.name || generated?.visuals?.tournamentName || 'Ana Sahne') || 'Ana Sahne',
          },
        }

        const matchWithRealtimeTournament = realtimeTournament
          ? {
              ...match,
              tournament: {
                ...(match?.tournament || {}),
                ...realtimeTournament,
                name: cleanDisplayName(realtimeTournament?.name || match?.tournament?.name || '') || match?.tournament?.name,
              },
            }
          : match

        if (!cancelled) {
          setMatchData(matchWithRealtimeTournament)
          setStory(storyWithRealtimeTier)
          await loadForum(storyWithRealtimeTier.id)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Haber detayları yüklenemedi.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadFromSource()
    return () => { cancelled = true }
  }, [loadForum, newsId])

  // ── Realtime forum: başkalarının yorumları anında görünür ──
  useEffect(() => {
    if (!story?.id || forumComingSoon) return

    const enrichRealtimeRow = async (row) => {
      let author = 'Topluluk'
      let authorScoutScore = 0
      let authorAvatarUrl = null
      let authorTeamLogo = null
      let authorTeamName = null
      if (row.user_id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('username,first_name,last_name,scout_score,avatar_url,favorite_team_id,show_team_badge')
          .eq('id', row.user_id)
          .maybeSingle()
        if (prof) {
          author = getEsportsName(prof) || author
          authorScoutScore = normalizeScoutScore(prof.scout_score)
          authorAvatarUrl = prof.avatar_url ?? null
          if (prof.show_team_badge !== false && prof.favorite_team_id) {
            const { data: team } = await supabase.from('teams').select('name,logo_url').eq('id', prof.favorite_team_id).maybeSingle()
            if (team) { authorTeamLogo = team.logo_url ?? null; authorTeamName = team.name ?? null }
          }
        }
      }
      return { ...row, comment_text: row.content ?? '', author, authorScoutScore, authorAvatarUrl, authorTeamLogo, authorTeamName }
    }

    const unsubscribe = subscribeToNewsComments(story.id, {
      onInsert: async (row) => {
        // Kendi optimistic eklediğim yorum zaten listede → enrich için fetch yapma
        const enriched = await enrichRealtimeRow(row)
        setComments(prev =>
          prev.some(c => String(c.id) === String(enriched.id)) ? prev : [enriched, ...prev]
        )
      },
      onDelete: (row) => {
        setComments(prev => prev.filter(c => String(c.id) !== String(row.id)))
      },
    })

    return unsubscribe
  }, [story?.id, forumComingSoon])

  async function submitComment(e) {
    e.preventDefault()
    if (forumComingSoon) return
    const text = commentInput.trim()
    if (!text || !story?.id) return

    if (forumFallback) {
      const fallbackComment = {
        id: `local_${Date.now()}`,
        news_id: story.id,
        user_id: user?.id || null,
        comment_text: text,
        created_at: new Date().toISOString(),
        author: profile?.username || (user?.id ? 'Sen' : 'Misafir'),
        authorScoutScore: normalizeScoutScore(profile?.scout_score),
      }
      setComments(prev => [fallbackComment, ...prev])
      setCommentInput('')
      setCommentSuccess('Yorum yerel olarak eklendi.')
      setCommentWarning('')
      return
    }

    // Misafir DB'ye yazamaz (RLS/NOT NULL) — girişe yönlendir, insert deneme
    if (!canInteract) {
      setCommentWarning('Yorum yazmak için giriş yapmalısın.')
      setCommentSuccess('')
      return
    }

    setCommentSubmitting(true)
    setCommentWarning('')
    setCommentSuccess('')

    try {
      const { data, error: insertErr } = await supabase
        .from('news_comments')
        .insert({ news_id: story.id, user_id: user?.id || null, [COMMENT_CONTENT_COLUMN]: text })
        .select('id,news_id,user_id,content,created_at,parent_id')
        .single()

      if (insertErr) {
        if (isMissingTableError(insertErr, 'news_comments')) {
          TABLE_EXISTS_CACHE.set('news_comments', false)
          setForumComingSoon(true)
          setForumFallback(false)
          return
        }
        throw insertErr
      }

      if (data) {
        setComments(prev => [
          {
            ...data,
            comment_text: data.content ?? text,
            author: profile?.username || (user?.id ? 'Sen' : 'Misafir'),
            authorScoutScore: normalizeScoutScore(profile?.scout_score),
          },
          ...prev,
        ])
      } else {
        await loadForum(story.id)
      }
      setCommentInput('')
      setCommentSuccess('Yorum başarıyla gönderildi.')
    } catch (commentErr) {
      const issueType = classifyCommentInsertIssue(commentErr)
      const details = {
        issueType,
        code: commentErr?.code || null,
        message: commentErr?.message || String(commentErr),
        hint: commentErr?.hint || null,
      }
      console.error('submitComment error details:', details)
      if (issueType === 'RLS') {
        window.alert('Yorum kaydedilemedi: yetki hatası. Lütfen giriş yapıp tekrar deneyin.')
      } else if (issueType === 'SCHEMA') {
        window.alert('Yorum kaydedilemedi: veri yapısı uyuşmazlığı tespit edildi.')
      }
      setCommentWarning(explainCommentInsertError(commentErr))
      setCommentSuccess('')
    } finally {
      setCommentSubmitting(false)
    }
  }

  async function submitReply(parentId) {
    const text = replyText.trim()
    if (!text || !story?.id || forumComingSoon) return
    if (!canInteract && !forumFallback) {
      setCommentWarning('Yanıtlamak için giriş yapmalısın.')
      return
    }
    // Fallback (offline) modda yerel yanıt
    if (forumFallback || !canInteract) {
      setComments(prev => [...prev, {
        id: `local_${Date.now()}`, news_id: story.id, user_id: user?.id || null,
        parent_id: parentId, comment_text: text, created_at: new Date().toISOString(),
        author: getEsportsName(profile) || 'Sen', authorScoutScore: normalizeScoutScore(profile?.scout_score),
      }])
      setReplyTo(null); setReplyText('')
      return
    }
    try {
      const { data, error: insertErr } = await supabase
        .from('news_comments')
        .insert({ news_id: story.id, user_id: user.id, [COMMENT_CONTENT_COLUMN]: text, parent_id: parentId })
        .select('id,news_id,user_id,content,created_at,parent_id')
        .single()
      if (insertErr) throw insertErr
      if (data) {
        setComments(prev => [...prev, {
          ...data, comment_text: data.content ?? text,
          author: getEsportsName(profile) || 'Sen', authorScoutScore: normalizeScoutScore(profile?.scout_score),
        }])
      }
      setReplyTo(null); setReplyText('')
    } catch (err) {
      console.error('submitReply error:', err?.message || err)
      setCommentWarning('Yanıt gönderilemedi.')
    }
  }

  async function voteComment(commentId, direction) {
    if (!canInteract || !commentId || forumComingSoon) return

    const previousVote = myVotes[commentId] || 0
    const nextVote = previousVote === direction ? 0 : direction
    const commentRow = comments.find(comment => String(comment.id) === String(commentId))
    const authorUserId = commentRow?.user_id || null
    const scoutDelta = getScoutVoteDelta(previousVote, nextVote)

    if (forumFallback || votesFallback || String(commentId).startsWith('local_')) {
      setMyVotes(prev => ({ ...prev, [commentId]: nextVote }))
      applyLocalVoteDelta(commentId, previousVote, nextVote)
      if (authorUserId && authorUserId !== user?.id && scoutDelta !== 0) {
        applyLocalScoutDelta(authorUserId, scoutDelta)
      }
      return
    }

    try {
      const { error: deleteErr } = await supabase
        .from('news_comment_votes')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_id', user.id)

      if (deleteErr) {
        if (isMissingTableError(deleteErr, 'news_comment_votes')) {
          TABLE_EXISTS_CACHE.set('news_comment_votes', false)
          setVotesFallback(true)
          setMyVotes(prev => ({ ...prev, [commentId]: nextVote }))
          applyLocalVoteDelta(commentId, previousVote, nextVote)
          return
        }
        throw deleteErr
      }

      if (nextVote !== 0) {
        const { error: insertErr } = await supabase
          .from('news_comment_votes')
          .insert({ comment_id: commentId, user_id: user.id, vote_type: nextVote })

        if (insertErr) {
          if (isMissingTableError(insertErr, 'news_comment_votes')) {
            TABLE_EXISTS_CACHE.set('news_comment_votes', false)
            setVotesFallback(true)
            setMyVotes(prev => ({ ...prev, [commentId]: nextVote }))
            applyLocalVoteDelta(commentId, previousVote, nextVote)
            return
          }
          throw insertErr
        }
      }

      setMyVotes(prev => ({ ...prev, [commentId]: nextVote }))
      applyLocalVoteDelta(commentId, previousVote, nextVote)
      if (authorUserId && authorUserId !== user?.id && scoutDelta !== 0) {
        applyLocalScoutDelta(authorUserId, scoutDelta)
      }
      // Optimistic update yeterli — tüm forum'u yeniden çekmeye gerek yok (flicker önlenir)
    } catch (voteErr) {
      console.error('voteComment error:', voteErr?.message || voteErr)
      setCommentWarning('Yorum oyu kaydedilemedi.')
    }
  }

  async function deleteComment(commentId) {
    if (!user?.id || !commentId) return
    setComments(prev => prev.filter(c => String(c.id) !== String(commentId)))
    try {
      const { error: deleteErr } = await supabase
        .from('news_comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', user.id)
      if (deleteErr) throw deleteErr
    } catch (err) {
      console.error('deleteComment error:', err?.message || err)
      setCommentWarning('Yorum silinemedi.')
      if (story?.id) await loadForum(story.id)
    }
  }

  async function reportStoryIssue(currentStory) {
    if (!currentStory) return
    const payload = {
      news_id: currentStory.id,
      match_id: currentStory.matchId,
      game_id: currentStory.visuals?.gameId,
      status: currentStory.status,
      title: currentStory.title,
    }

    try {
      const { error: insertErr } = await supabase.from('news_feedback').insert({
        news_id: currentStory.id,
        reported_by: null,
        payload,
      })

      if (insertErr) throw insertErr
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

  const explain = useMemo(() => {
    if (!story) return { classification: 'Gündem', explanations: [] }
    return storyExplainability(story)
  }, [story])

  if (loading) {
    return <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', color: 'var(--text-3)' }}>Haber detayı yükleniyor...</div>
  }

  if (error || !story) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', color: 'var(--text-1)' }}>
        <div style={{ marginBottom: 14, color: '#ff8c9a' }}>{error || 'Haber bulunamadı.'}</div>
        <Link to='/news' style={{ color: '#ffb3bd' }}>Haber akışına dön</Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <SeoHead
        title={story.title}
        description={story.summary || story.heroScore || ''}
        image={story.visuals?.teamA?.logo_url || story.visuals?.teamB?.logo_url || ''}
        type="article"
        schema={{
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: story.title,
          description: story.summary || story.heroScore || '',
          datePublished: story.publishedAt || undefined,
          dateModified: story.publishedAt || undefined,
          inLanguage: 'tr-TR',
          image: [story.visuals?.teamA?.logo_url, story.visuals?.teamB?.logo_url].filter(Boolean),
          author: { '@type': 'Organization', name: 'feXt', url: 'https://fextesports.com/' },
          publisher: {
            '@type': 'Organization', name: 'feXt',
            logo: { '@type': 'ImageObject', url: 'https://fextesports.com/icons/icon-512.png' },
          },
          mainEntityOfPage: typeof window !== 'undefined' ? window.location.href : 'https://fextesports.com/',
        }}
      />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '22px 16px 48px' }}>
        <style>{`
          @keyframes voteUpPop {
            0% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-2px) scale(1.06); }
            100% { transform: translateY(0) scale(1); }
          }
          @keyframes voteDownPop {
            0% { transform: translateY(0) scale(1); }
            50% { transform: translateY(2px) scale(1.06); }
            100% { transform: translateY(0) scale(1); }
          }
        `}</style>

        <Link to='/news' style={{ color: '#ffb3bd', fontSize: 13, textDecoration: 'none' }}>← Haber akışına dön</Link>

        <section style={{ marginTop: 14, borderRadius: 20, border: '1px solid var(--line)', background: 'linear-gradient(145deg,var(--surface),var(--surface))', padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#ffd2d8', padding: '4px 8px', borderRadius: 999, background: 'rgba(200,16,46,.18)', border: '1px solid rgba(200,16,46,.34)', textTransform: 'uppercase', letterSpacing: 1 }}>
              {explain.classification}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-1)', padding: '4px 8px', borderRadius: 999, background: `${story.visuals.gameColor}22`, border: `1px solid ${story.visuals.gameColor}55` }}>
              {story.visuals.gameLabel}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-3)', padding: '4px 8px', borderRadius: 999, border: '1px solid var(--line)' }}>
              Tier {story.visuals.tier}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{fmtDate(story.publishedAt)}</span>
          </div>

          <div style={{ marginBottom: 14 }}>
            <NewsCover visuals={story.visuals} score={story.status === 'transfer' ? '➜' : story.status === 'tournament' ? '🏆' : scoreFromHero(story.heroScore)} height={220} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 38, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.3px', textAlign: 'left' }}>{story.title}</h1>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f0d3d8' }}>{story.heroScore}</div>
          </div>

          <p style={{ margin: 0, color: '#9fa3af', lineHeight: 1.85, textAlign: 'left', fontSize: 15 }}>{story.summary}</p>

          {story.content && story.content !== story.summary && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--surface-2)' }}>
              {story.content.split('\n\n').filter(para => para.trim()).map((para, idx) => (
                <p key={idx} style={{ margin: idx === 0 ? 0 : '14px 0 0', color: '#9fa3af', lineHeight: 1.85, textAlign: 'left', fontSize: 15 }}>
                  {para.trim()}
                </p>
              ))}
            </div>
          )}

          <TrustLayer story={story} onReport={reportStoryIssue} />
        </section>

        <AIProbabilityBar story={story} />

        <section style={{ marginTop: 16, borderRadius: 16, border: '1px solid var(--surface-2)', background: 'var(--surface)', padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--accent-fg)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, marginBottom: 10 }}>
            Maç Analizi
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {explain.explanations.map((line, idx) => (
              <div key={idx} style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)' }}>
                {line}
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 16, borderRadius: 16, border: '1px solid var(--surface-2)', background: 'var(--surface)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-1)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800 }}>
                Forum
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{comments.length} yorum</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[{ key: 'best', label: 'En İyi' }, { key: 'newest', label: 'En Yeni' }].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortMode(key)}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                    border: sortMode === key ? `1px solid ${FEXT.accent}` : '1px solid var(--line)',
                    background: sortMode === key ? FEXT.accentSoftBg : 'transparent',
                    color: sortMode === key ? FEXT.accentText : 'var(--text-4)',
                    cursor: 'pointer', letterSpacing: '.3px',
                  }}
                >{label}</button>
              ))}
            </div>
          </div>

          {commentWarning && !forumComingSoon && (
            <div style={{ marginBottom: 10, borderRadius: 10, border: '1px solid rgba(221,182,109,.4)', background: 'rgba(221,182,109,.12)', color: '#b6893b', padding: '8px 10px', fontSize: 12 }}>
              {commentWarning}
            </div>
          )}

          {commentSuccess && !forumComingSoon && (
            <div style={{ marginBottom: 10, borderRadius: 10, border: '1px solid rgba(70,182,88,.4)', background: 'rgba(70,182,88,.12)', color: '#3d9950', padding: '8px 10px', fontSize: 12 }}>
              {commentSuccess}
            </div>
          )}

          {forumComingSoon ? (
            <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: '12px', color: 'var(--text-3)', fontSize: 12 }}>
              Yorumlar yakında.
            </div>
          ) : (
            <form onSubmit={submitComment} style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              <textarea
                value={commentInput}
                onChange={e => {
                  setCommentInput(e.target.value)
                  if (commentWarning) setCommentWarning('')
                  if (commentSuccess) setCommentSuccess('')
                }}
                placeholder='Maç analizi veya görüşünü yaz...'
                rows={3}
                style={{ resize: 'vertical', minHeight: 86, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-1)', padding: '10px 12px', fontSize: 13 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: commentInput.length > 900 ? '#ff6b6b' : 'var(--text-5)' }}>
                  {commentInput.length}/1000
                </span>
                <button
                  disabled={!commentInput.trim() || commentSubmitting || (!canInteract && !forumFallback)}
                  style={{ border: '1px solid var(--text-6)', background: 'var(--surface-2)', color: 'var(--text-1)', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: (!canInteract && !forumFallback) ? 'not-allowed' : 'pointer', opacity: (!canInteract && !forumFallback) ? 0.5 : 1 }}
                >
                  {commentSubmitting ? 'Gönderiliyor...' : 'Yorumu Gönder'}
                </button>
              </div>
              {canInteract
                ? <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Yorumun hesabınla paylaşılır.</div>
                : <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    Yorum yazmak icin{' '}
                    <Link to="/login" style={{ color: FEXT.accentText, textDecoration: 'none', fontWeight: 600 }}>giriş yap</Link>
                    {' '}veya{' '}
                    <Link to="/register" style={{ color: FEXT.accentText, textDecoration: 'none', fontWeight: 600 }}>kayıt ol</Link>.
                  </div>
              }
            </form>
          )}

          {commentsLoading && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Forum yukleniyor...</div>}
          {!commentsLoading && comments.length === 0 && (
            <div style={{ border: '1px dashed var(--line)', borderRadius: 10, padding: '12px', color: 'var(--text-3)', fontSize: 12 }}>
              Henüz yorum yok. İlk yorumu sen yaz.
            </div>
          )}

          {!commentsLoading && rankedComments.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {rankedComments.map(comment => {
                const voteState = votesByComment[comment.id] || { up: 0, down: 0 }
                const myVote = myVotes[comment.id] || 0
                const score = commentScore(voteState)
                const isTopComment = comment.id === topCommentId

                return (
                  <div key={comment.id} style={{ border: isTopComment ? '1px solid rgba(194,92,208,.42)' : '1px solid var(--line)', borderRadius: 12, background: isTopComment ? 'linear-gradient(145deg, rgba(194,92,208,.10), var(--surface))' : 'var(--surface)', padding: '10px 11px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap' }}>
                        <InitialsImage
                          src={comment.authorAvatarUrl}
                          name={comment.author || 'Topluluk'}
                          width={28}
                          height={28}
                          borderRadius="50%"
                          objectFit="cover"
                          textScale={0.38}
                        />
                        <div style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{comment.author || 'Topluluk'}</div>
                        {comment.authorTeamLogo && (
                          <img src={comment.authorTeamLogo} alt={comment.authorTeamName || ''} title={comment.authorTeamName || ''}
                            style={{ width: 16, height: 16, borderRadius: 4, objectFit: 'contain', flexShrink: 0 }} />
                        )}
                        <ScoutRankBadge score={comment.authorScoutScore} />
                        {isTopComment && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: '#c86fd8', border: '1px solid rgba(194,92,208,.45)', background: 'rgba(194,92,208,.14)', borderRadius: 999, padding: '2px 8px', letterSpacing: '.4px' }}>
                            En İyi Yorum
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{fmtDate(comment.created_at)}</div>
                        {user?.id && comment.user_id === user.id && (
                          <button
                            type="button"
                            onClick={() => deleteComment(comment.id)}
                            title="Yorumu sil"
                            style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#ff6b6b' }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-4)' }}
                          ><XIcon size={14} /></button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)', marginBottom: 8 }}>{comment.comment_text}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type='button'
                        onClick={() => {
                          triggerVotePulse(comment.id, 1)
                          voteComment(comment.id, 1)
                        }}
                        disabled={!canInteract}
                        style={{ border: myVote === 1 ? '1px solid #2f6846' : '1px solid var(--line)', background: myVote === 1 ? '#10281a' : 'var(--surface)', color: myVote === 1 ? '#8de3af' : 'var(--text-2)', borderRadius: 8, padding: '5px 8px', fontSize: 12, cursor: canInteract ? 'pointer' : 'not-allowed', animation: votePulse.commentId === comment.id && votePulse.direction === 1 ? 'voteUpPop .26s ease' : 'none' }}
                      >
                        ▲ {voteState.up || 0}
                      </button>
                      <button
                        type='button'
                        onClick={() => {
                          triggerVotePulse(comment.id, -1)
                          voteComment(comment.id, -1)
                        }}
                        disabled={!canInteract}
                        style={{ border: myVote === -1 ? '1px solid #7a3636' : '1px solid var(--line)', background: myVote === -1 ? '#2a1313' : 'var(--surface)', color: myVote === -1 ? '#ff9f9f' : 'var(--text-2)', borderRadius: 8, padding: '5px 8px', fontSize: 12, cursor: canInteract ? 'pointer' : 'not-allowed', animation: votePulse.commentId === comment.id && votePulse.direction === -1 ? 'voteDownPop .26s ease' : 'none' }}
                      >
                        ▼ {voteState.down || 0}
                      </button>
                      <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--text-3)' }}>Skor: {score}</span>
                      {!forumComingSoon && (
                        <button
                          type="button"
                          onClick={() => { setReplyTo(replyTo === comment.id ? null : comment.id); setReplyText('') }}
                          style={{ marginLeft: 'auto', border: 'none', background: 'none', color: '#7dd3fc', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        ><MessageSquare size={12} /> Yanıtla</button>
                      )}
                    </div>

                    {/* Inline yanıt input */}
                    {replyTo === comment.id && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                        <input
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitReply(comment.id) }}
                          placeholder={`${comment.author || 'yoruma'} yanıt yaz...`}
                          autoFocus
                          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text-1)', padding: '7px 10px', fontSize: 12 }}
                        />
                        <button type="button" onClick={() => submitReply(comment.id)} disabled={!replyText.trim()} style={{ border: '1px solid rgba(70,182,88,.45)', background: 'rgba(70,182,88,.15)', color: '#3d9950', borderRadius: 8, padding: '0 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Gönder</button>
                      </div>
                    )}

                    {/* Yanıtlar (iç içe) */}
                    {(repliesByParent[comment.id] || []).length > 0 && (
                      <div style={{ marginTop: 8, marginLeft: 14, paddingLeft: 10, borderLeft: '2px solid var(--line)', display: 'grid', gap: 6 }}>
                        {(repliesByParent[comment.id] || []).map(reply => (
                          <div key={reply.id} style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 9, padding: '7px 9px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>{reply.author || 'Topluluk'}</span>
                              {reply.authorTeamLogo && (
                                <img src={reply.authorTeamLogo} alt={reply.authorTeamName || ''} title={reply.authorTeamName || ''}
                                  style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'contain', flexShrink: 0 }} />
                              )}
                              <ScoutRankBadge score={reply.authorScoutScore} />
                              <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 'auto' }}>{fmtDate(reply.created_at)}</span>
                              {user?.id && reply.user_id === user.id && (
                                <button type="button" onClick={() => deleteComment(reply.id)} title="Yanıtı sil" style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}><XIcon size={12} /></button>
                              )}
                            </div>
                            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-2)' }}>{reply.comment_text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
