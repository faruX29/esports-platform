import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
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
import { cleanDisplayName } from '../utils/nameCleaner'

function isMissingTableError(error, tableName) {
  const code = error?.code || ''
  const message = String(error?.message || '').toLowerCase()
  return code === '42P01' || message.includes(tableName) || (message.includes('relation') && message.includes('does not exist'))
}

function explainCommentInsertError(error) {
  const code = String(error?.code || '').trim()
  const message = String(error?.message || '').toLowerCase()

  if (code === '42501' || message.includes('row-level security') || message.includes('rls')) {
    return 'Yorum izni reddedildi (RLS). Supabase policy ayarlarini kontrol edin.'
  }
  if (code === '23505') {
    return 'Ayni yorum tekrarlandi. Lutfen farkli bir icerik deneyin.'
  }
  if (code === '23514') {
    return 'Yorum metni gecerli degil. Lutfen metni kontrol edin.'
  }

  return 'Yorum gonderilemedi, lutfen tekrar deneyin.'
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

function parseMatchId(newsId) {
  if (!newsId) return null
  if (newsId.startsWith('match_')) {
    const v = Number(newsId.replace('match_', ''))
    return Number.isFinite(v) ? v : null
  }
  const v = Number(newsId)
  return Number.isFinite(v) ? v : null
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
      <span style={{ color: '#f1f1f1', opacity: 0.9 }}>#{rank.score}</span>
    </span>
  )
}

function TrustLayer({ story, onReport }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#9a9a9a' }}>PandaScore verileriyle otomatik uretilmistir.</span>
      <button
        onClick={() => onReport(story)}
        style={{ border: '1px solid #353535', background: '#121212', color: '#ddd', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
      >
        Hata Bildir
      </button>
    </div>
  )
}

export default function NewsDetailPage() {
  const { newsId } = useParams()
  const location = useLocation()
  const { user, profile } = useAuth()

  const [story, setStory] = useState(location.state?.story || null)
  const [matchData, setMatchData] = useState(null)
  const [statsRows, setStatsRows] = useState([])
  const [loading, setLoading] = useState(!location.state?.story)
  const [error, setError] = useState('')
  const [comments, setComments] = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentInput, setCommentInput] = useState('')
  const [commentWarning, setCommentWarning] = useState('')
  const [commentSuccess, setCommentSuccess] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [votesByComment, setVotesByComment] = useState({})
  const [myVotes, setMyVotes] = useState({})
  const [forumFallback, setForumFallback] = useState(false)
  const [forumComingSoon, setForumComingSoon] = useState(false)
  const [votesFallback, setVotesFallback] = useState(false)
  const [votePulse, setVotePulse] = useState({ commentId: null, direction: 0, token: 0 })
  const canInteract = !!user?.id

  const rankedComments = useMemo(() => {
    const list = [...comments]
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
    return list
  }, [comments, votesByComment])

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
        .select('id,news_id,user_id,content,created_at')
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
          .select('id,username,scout_score')
          .in('id', authorIds)

        if (!profileError) {
          profilesById = new Map((profileRows || []).map(row => [row.id, row]))
        }
      }

      const enrichedComments = mappedComments.map(row => {
        const authorProfile = row.user_id ? profilesById.get(row.user_id) : null
        const fallbackName = row.user_id === user?.id ? (profile?.username || 'Sen') : 'Topluluk'
        const fallbackScore = row.user_id === user?.id ? normalizeScoutScore(profile?.scout_score) : 0

        return {
          ...row,
          author: authorProfile?.username || fallbackName,
          authorScoutScore: normalizeScoutScore(authorProfile?.scout_score ?? fallbackScore),
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
      const matchId = parseMatchId(newsId)
      if (!matchId) {
        setError('Gecerli bir haber kimligi bulunamadi.')
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
          .single()

        if (matchErr) throw matchErr

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
          setStatsRows(statRows || [])
          setStory(storyWithRealtimeTier)
          await loadForum(storyWithRealtimeTier.id)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Haber detaylari yuklenemedi.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadFromSource()
    return () => { cancelled = true }
  }, [loadForum, newsId])

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

    setCommentSubmitting(true)
    setCommentWarning('')
    setCommentSuccess('')

    try {
      const { data, error: insertErr } = await supabase
        .from('news_comments')
        .insert({ news_id: story.id, user_id: user?.id || null, [COMMENT_CONTENT_COLUMN]: text })
        .select('id,news_id,user_id,content,created_at')
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
      setCommentSuccess('Yorum basariyla gonderildi.')
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
        window.alert('Yorum kaydedilemedi: Yetki (RLS) hatasi. Policy ayarlari kontrol edilmeli.')
      } else if (issueType === 'SCHEMA') {
        window.alert('Yorum kaydedilemedi: Veri yapisi/sutun uyumsuzlugu tespit edildi.')
      }
      setCommentWarning(explainCommentInsertError(commentErr))
      setCommentSuccess('')
    } finally {
      setCommentSubmitting(false)
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
      if (story?.id) await loadForum(story.id)
    } catch (voteErr) {
      console.error('voteComment error:', voteErr?.message || voteErr)
      setCommentWarning('Yorum oyu kaydedilemedi.')
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
      window.alert('Geri bildirim altyapisi hazir degil. Haber ozeti panoya kopyalandi.')
    }
  }

  const explain = useMemo(() => {
    if (!story) return { classification: 'Gundem', explanations: [] }
    return storyExplainability(story)
  }, [story])

  if (loading) {
    return <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', color: '#888' }}>Haber detayi yukleniyor...</div>
  }

  if (error || !story) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', color: '#ddd' }}>
        <div style={{ marginBottom: 14, color: '#ff8c9a' }}>{error || 'Haber bulunamadi.'}</div>
        <Link to='/news' style={{ color: '#ffb3bd' }}>Haber akisina don</Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#090909', color: '#f2f2f2' }}>
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

        <Link to='/news' style={{ color: '#ffb3bd', fontSize: 13, textDecoration: 'none' }}>← Haber akisina don</Link>

        <section style={{ marginTop: 14, borderRadius: 20, border: '1px solid #242424', background: 'linear-gradient(145deg,#141414,#0f0f0f)', padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#ffd2d8', padding: '4px 8px', borderRadius: 999, background: 'rgba(200,16,46,.18)', border: '1px solid rgba(200,16,46,.34)', textTransform: 'uppercase', letterSpacing: 1 }}>
              {explain.classification}
            </span>
            <span style={{ fontSize: 10, color: '#f0f0f0', padding: '4px 8px', borderRadius: 999, background: `${story.visuals.gameColor}22`, border: `1px solid ${story.visuals.gameColor}55` }}>
              {story.visuals.gameLabel}
            </span>
            <span style={{ fontSize: 10, color: '#9a9a9a', padding: '4px 8px', borderRadius: 999, border: '1px solid #2a2a2a' }}>
              Tier {story.visuals.tier}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#878787' }}>{fmtDate(story.publishedAt)}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <InitialsImage
                src={story.visuals.teamA.logo_url}
                alt={story.visuals.teamA.name || ''}
                name={story.visuals.teamA.name}
                width={52}
                height={52}
                borderRadius={12}
                objectFit='contain'
                style={{ background: '#111', padding: 5, border: '1px solid #2a2a2a' }}
              />
              <InitialsImage
                src={story.visuals.teamB.logo_url}
                alt={story.visuals.teamB.name || ''}
                name={story.visuals.teamB.name}
                width={52}
                height={52}
                borderRadius={12}
                objectFit='contain'
                style={{ background: '#111', padding: 5, border: '1px solid #2a2a2a' }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#9d9d9d', marginBottom: 5 }}>{story.visuals.tournamentName}</div>
              <h1 style={{ margin: '0 0 8px', fontSize: 34, lineHeight: 1.12 }}>{story.title}</h1>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#f0d3d8' }}>{story.heroScore}</div>
            </div>
          </div>

          <p style={{ margin: 0, color: '#d5d5d5', lineHeight: 1.7 }}>{story.summary}</p>
          <TrustLayer story={story} onReport={reportStoryIssue} />
        </section>

        <section style={{ marginTop: 16, borderRadius: 16, border: '1px solid #1f1f1f', background: '#0f0f0f', padding: 16 }}>
          <div style={{ fontSize: 11, color: '#ffb3bd', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, marginBottom: 10 }}>
            Explainability
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {explain.explanations.map((line, idx) => (
              <div key={idx} style={{ fontSize: 13, color: '#d4d4d4', lineHeight: 1.5, padding: '8px 10px', borderRadius: 10, border: '1px solid #252525', background: '#111' }}>
                {line}
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 16, borderRadius: 16, border: '1px solid #1f1f1f', background: '#0f0f0f', padding: 16 }}>
          <div style={{ fontSize: 11, color: '#f4f4f4', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, marginBottom: 10 }}>
            Kaynak Veriler
          </div>

          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', marginBottom: 12 }}>
            <div style={{ border: '1px solid #262626', borderRadius: 10, padding: '9px 10px', background: '#121212' }}>
              <div style={{ fontSize: 10, color: '#7f7f7f' }}>Match ID</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{story.matchId || '-'}</div>
            </div>
            <div style={{ border: '1px solid #262626', borderRadius: 10, padding: '9px 10px', background: '#121212' }}>
              <div style={{ fontSize: 10, color: '#7f7f7f' }}>Durum</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{story.status}</div>
            </div>
            <div style={{ border: '1px solid #262626', borderRadius: 10, padding: '9px 10px', background: '#121212' }}>
              <div style={{ fontSize: 10, color: '#7f7f7f' }}>Tahmin</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>
                {story.source?.predictionA ?? '-'} : {story.source?.predictionB ?? '-'}
              </div>
            </div>
            <div style={{ border: '1px solid #262626', borderRadius: 10, padding: '9px 10px', background: '#121212' }}>
              <div style={{ fontSize: 10, color: '#7f7f7f' }}>Skor Marji</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{story.source?.margin ?? '-'}</div>
            </div>
          </div>

          {matchData && (
            <div style={{ fontSize: 12, color: '#a9a9a9', marginBottom: 8 }}>
              Match schedule: {fmtDate(matchData.scheduled_at)} | Tournament: {matchData.tournament?.name || '-'}
            </div>
          )}

          <div style={{ border: '1px solid #252525', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', padding: '8px 10px', fontSize: 10, color: '#818181', textTransform: 'uppercase', letterSpacing: '.8px', background: '#141414', borderBottom: '1px solid #252525' }}>
              <div>Team</div>
              <div style={{ textAlign: 'right' }}>Score Metric</div>
            </div>
            {statsRows.length === 0 && <div style={{ padding: '10px', color: '#7a7a7a', fontSize: 12 }}>Ek match_stats verisi bulunamadi.</div>}
            {statsRows.map((row, idx) => (
              <div key={`${row.team_id}_${idx}`} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', padding: '9px 10px', fontSize: 12, borderBottom: idx === statsRows.length - 1 ? 'none' : '1px solid #1e1e1e', background: '#101010' }}>
                <div style={{ color: '#cdcdcd' }}>{Number(row.team_id) === Number(matchData?.team_a_id) ? (matchData?.team_a?.name || 'Team A') : (matchData?.team_b?.name || 'Team B')}</div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#f4f4f4', fontWeight: 700 }}>{Number(row?.stats?.score ?? 0)}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 16, borderRadius: 16, border: '1px solid #1f1f1f', background: '#0f0f0f', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: '#f4f4f4', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800 }}>
              Forum
            </div>
            <div style={{ fontSize: 12, color: '#8f8f8f' }}>Yorum: {comments.length}</div>
          </div>

          {commentWarning && !forumComingSoon && (
            <div style={{ marginBottom: 10, borderRadius: 10, border: '1px solid #3a2f19', background: '#1a1408', color: '#ddb66d', padding: '8px 10px', fontSize: 12 }}>
              {commentWarning}
            </div>
          )}

          {commentSuccess && !forumComingSoon && (
            <div style={{ marginBottom: 10, borderRadius: 10, border: '1px solid #23442e', background: '#102117', color: '#9fe2b7', padding: '8px 10px', fontSize: 12 }}>
              {commentSuccess}
            </div>
          )}

          {forumComingSoon ? (
            <div style={{ border: '1px dashed #2d2d2d', borderRadius: 10, padding: '12px', color: '#888', fontSize: 12 }}>
              Yorumlar yakinda.
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
                placeholder='Mac analizi veya gorusunu yaz...'
                rows={3}
                style={{ resize: 'vertical', minHeight: 86, borderRadius: 10, border: '1px solid #2a2a2a', background: '#121212', color: '#e5e5e5', padding: '10px 12px', fontSize: 13 }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  disabled={!commentInput.trim() || commentSubmitting}
                  style={{ border: '1px solid #3b3b3b', background: '#181818', color: '#f1f1f1', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}
                >
                  {commentSubmitting ? 'Gonderiliyor...' : 'Yorumu Gonder'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#8f8f8f' }}>
                {canInteract ? 'Yorumun hesabinla paylasilir.' : 'Misafir olarak yorum yapiyorsun.'}
              </div>
            </form>
          )}

          {commentsLoading && <div style={{ fontSize: 12, color: '#8a8a8a' }}>Forum yukleniyor...</div>}
          {!commentsLoading && comments.length === 0 && (
            <div style={{ border: '1px dashed #2d2d2d', borderRadius: 10, padding: '12px', color: '#888', fontSize: 12 }}>
              Henuz yorum yok. Ilk yorumu sen yaz.
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
                  <div key={comment.id} style={{ border: isTopComment ? '1px solid rgba(255,184,0,.42)' : '1px solid #242424', borderRadius: 12, background: isTopComment ? 'linear-gradient(145deg, rgba(255,184,0,.08), #111)' : '#111', padding: '10px 11px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 12, color: '#d2d2d2', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{comment.author || 'Topluluk'}</div>
                        <ScoutRankBadge score={comment.authorScoutScore} />
                        {isTopComment && (
                          <span style={{ fontSize: 10, fontWeight: 800, color: '#ffd46b', border: '1px solid rgba(255,184,0,.45)', background: 'rgba(255,184,0,.12)', borderRadius: 999, padding: '2px 8px', letterSpacing: '.4px' }}>
                            Top Comment
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#777' }}>{fmtDate(comment.created_at)}</div>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: '#cdcdcd', marginBottom: 8 }}>{comment.comment_text}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type='button'
                        onClick={() => {
                          triggerVotePulse(comment.id, 1)
                          voteComment(comment.id, 1)
                        }}
                        disabled={!canInteract}
                        style={{ border: myVote === 1 ? '1px solid #2f6846' : '1px solid #2d2d2d', background: myVote === 1 ? '#10281a' : '#161616', color: myVote === 1 ? '#8de3af' : '#bfbfbf', borderRadius: 8, padding: '5px 8px', fontSize: 12, cursor: canInteract ? 'pointer' : 'not-allowed', animation: votePulse.commentId === comment.id && votePulse.direction === 1 ? 'voteUpPop .26s ease' : 'none' }}
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
                        style={{ border: myVote === -1 ? '1px solid #7a3636' : '1px solid #2d2d2d', background: myVote === -1 ? '#2a1313' : '#161616', color: myVote === -1 ? '#ff9f9f' : '#bfbfbf', borderRadius: 8, padding: '5px 8px', fontSize: 12, cursor: canInteract ? 'pointer' : 'not-allowed', animation: votePulse.commentId === comment.id && votePulse.direction === -1 ? 'voteDownPop .26s ease' : 'none' }}
                      >
                        ▼ {voteState.down || 0}
                      </button>
                      <span style={{ marginLeft: 4, fontSize: 12, color: '#a2a2a2' }}>Skor: {score}</span>
                    </div>
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
