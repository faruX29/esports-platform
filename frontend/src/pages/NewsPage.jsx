import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

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

function pickTag(item) {
  if (item.type === 'upset') return 'Surpriz Sonuc'
  if (item.type === 'blowout') return 'Buyuk Fark'
  if (item.type === 'mvp') return 'Oyuncu Performansi'
  return 'Mac Ozeti'
}

function buildStoryFromMatch(match, statsByMatch) {
  const aName = match.team_a?.name || 'Team A'
  const bName = match.team_b?.name || 'Team B'
  const aScore = Number(match.team_a_score ?? 0)
  const bScore = Number(match.team_b_score ?? 0)
  const winner = Number(match.winner_id)
  const aId = Number(match.team_a_id || match.team_a?.id)
  const bId = Number(match.team_b_id || match.team_b?.id)
  const winnerName = winner === aId ? aName : winner === bId ? bName : 'Beraberlik'
  const loserName = winner === aId ? bName : aName
  const margin = Math.abs(aScore - bScore)
  const predA = typeof match.prediction_team_a === 'number' ? match.prediction_team_a : null
  const actualAWin = winner === aId
  const upset = predA != null && ((predA > 0.6 && !actualAWin) || (predA < 0.4 && actualAWin))

  const statsRows = statsByMatch.get(match.id) || []
  const scoreRows = statsRows
    .map(r => ({
      team_id: Number(r.team_id),
      score: Number(r.stats?.score ?? 0),
      opp: Number(r.stats?.opponent_score ?? 0),
    }))
    .filter(r => Number.isFinite(r.score))

  const topImpact = scoreRows.sort((x, y) => y.score - x.score)[0]
  const impactTeam = topImpact?.team_id === aId ? aName : topImpact?.team_id === bId ? bName : null

  const tournament = match.tournament?.name || 'Playoffs'
  const publishedAt = match.scheduled_at || new Date().toISOString()

  if (upset) {
    return {
      id: `upset_${match.id}`,
      matchId: match.id,
      type: 'upset',
      title: `Playoffs'ta Surpriz Sonuc: ${winnerName} Kazandi!`,
      summary: `${tournament} sahnesinde beklentilerin aksine ${winnerName}, ${loserName} karsisinda ${aScore}:${bScore} ile galip geldi. Tahmin modelleri farkli bir sonuca isaret ederken gelen galibiyet tablonun dengesini degistirdi.`,
      publishedAt,
      tournament,
      heroScore: `${aName} ${aScore} - ${bScore} ${bName}`,
      tag: pickTag({ type: 'upset' }),
      priority: 100,
    }
  }

  if (margin >= 2) {
    return {
      id: `blowout_${match.id}`,
      matchId: match.id,
      type: 'blowout',
      title: `${winnerName}, ${tournament} macinda net ustunluk kurdu`,
      summary: `${winnerName}, ${loserName} karsisinda ${aScore}:${bScore} skoruyla farkli kazandi. Serinin temposu boyunca kontrolu elinde tutan ekip, turnuva rekabetinde kritik bir adim atti.`,
      publishedAt,
      tournament,
      heroScore: `${aName} ${aScore} - ${bScore} ${bName}`,
      tag: pickTag({ type: 'blowout' }),
      priority: 80,
    }
  }

  return {
    id: `summary_${match.id}`,
    matchId: match.id,
    type: impactTeam ? 'mvp' : 'summary',
    title: `${tournament}: ${winnerName} kritik galibiyet aldi`,
    summary: impactTeam
      ? `${aName} ile ${bName} arasindaki seride ${winnerName} ${aScore}:${bScore} ile sonuca gitti. Mac istatistiklerinde one cikan ${impactTeam}, sonucun belirleyici faktoru oldu.`
      : `${aName} ile ${bName} arasindaki karsilasmada ${winnerName}, ${aScore}:${bScore} skoruyla kazandi. Sonuc, turnuvada puan dengesini yeniden sekillendirdi.`,
    publishedAt,
    tournament,
    heroScore: `${aName} ${aScore} - ${bScore} ${bName}`,
    tag: pickTag({ type: impactTeam ? 'mvp' : 'summary' }),
    priority: 60,
  }
}

function NewsCard({ item, likes, liked, comments, onLike, onComment, canInteract }) {
  const [commentInput, setCommentInput] = useState('')
  const [sending, setSending] = useState(false)

  async function submitComment(e) {
    e.preventDefault()
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
    <article style={{ background: '#0f0f10', border: '1px solid #1f1f20', borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#c61b33', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 }}>{item.tag}</span>
        <span style={{ fontSize: 10, color: '#6a6a6a' }}>{fmtDate(item.publishedAt)}</span>
      </div>
      <h3 style={{ margin: '8px 0 6px', fontSize: 18, lineHeight: 1.25 }}>{item.title}</h3>
      <div style={{ fontSize: 12, color: '#8a8a8a', marginBottom: 8 }}>{item.tournament} · {item.heroScore}</div>
      <p style={{ margin: 0, color: '#cfcfcf', lineHeight: 1.5 }}>{item.summary}</p>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          disabled={!canInteract}
          onClick={() => onLike(item.id)}
          style={{
            border: `1px solid ${liked ? '#c61b33' : '#333'}`,
            background: liked ? 'rgba(198,27,51,.16)' : '#151515',
            color: liked ? '#ff6a7f' : '#b1b1b1',
            borderRadius: 8,
            padding: '6px 10px',
            cursor: canInteract ? 'pointer' : 'not-allowed',
            fontSize: 12,
          }}
        >
          ♥ Begen ({likes})
        </button>
        <span style={{ fontSize: 12, color: '#888' }}>Yorum: {comments.length}</span>
        {!canInteract && <span style={{ fontSize: 11, color: '#6a6a6a' }}>Etkilesim icin giris yapin</span>}
      </div>

      {comments.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid #232323', paddingTop: 8, display: 'grid', gap: 7 }}>
          {comments.slice(0, 3).map(c => (
            <div key={c.id} style={{ fontSize: 12, color: '#c7c7c7', background: '#121212', borderRadius: 8, padding: '7px 9px', border: '1px solid #1f1f1f' }}>
              <div style={{ fontSize: 10, color: '#777', marginBottom: 3 }}>{c.author}</div>
              {c.comment_text}
            </div>
          ))}
        </div>
      )}

      {canInteract && (
        <form onSubmit={submitComment} style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <input
            value={commentInput}
            onChange={e => setCommentInput(e.target.value)}
            placeholder="Yorum yaz..."
            style={{ flex: 1, background: '#131313', border: '1px solid #2a2a2a', borderRadius: 8, color: '#f5f5f5', padding: '8px 10px', fontSize: 12 }}
          />
          <button disabled={sending || !commentInput.trim()} style={{ border: '1px solid #444', background: '#1b1b1b', color: '#ddd', borderRadius: 8, padding: '8px 10px', fontSize: 12, cursor: 'pointer' }}>
            Gonder
          </button>
        </form>
      )}
    </article>
  )
}

export default function NewsPage() {
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stories, setStories] = useState([])
  const [likesByNews, setLikesByNews] = useState({})
  const [likedSet, setLikedSet] = useState(new Set())
  const [commentsByNews, setCommentsByNews] = useState({})

  const hero = stories[0] || null
  const agenda = stories.slice(1)

  const hydrateInteractions = useCallback(async (newsIds) => {
    if (!newsIds.length) return

    const [{ data: likesRows }, { data: commentsRows }] = await Promise.all([
      supabase.from('news_likes').select('id,news_id,user_id').in('news_id', newsIds),
      supabase.from('news_comments').select('id,news_id,user_id,comment_text,created_at').in('news_id', newsIds).order('created_at', { ascending: false }),
    ])

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
  }, [user?.id, profile?.username])

  const loadStories = useCallback(async () => {
    setLoading(true)
    try {
      const now = new Date()
      const since = new Date(now.getTime() - (24 * 60 * 60 * 1000))

      let { data: matches, error } = await supabase
        .from('matches')
        .select(`
          id, scheduled_at, status, winner_id,
          team_a_id, team_b_id, team_a_score, team_b_score,
          prediction_team_a,
          team_a:teams!matches_team_a_id_fkey(id,name),
          team_b:teams!matches_team_b_id_fkey(id,name),
          tournament:tournaments(id,name)
        `)
        .eq('status', 'finished')
        .gte('scheduled_at', since.toISOString())
        .order('scheduled_at', { ascending: false })
        .limit(40)

      if (error) throw error

      if (!matches || matches.length === 0) {
        const fallbackRes = await supabase
          .from('matches')
          .select(`
            id, scheduled_at, status, winner_id,
            team_a_id, team_b_id, team_a_score, team_b_score,
            prediction_team_a,
            team_a:teams!matches_team_a_id_fkey(id,name),
            team_b:teams!matches_team_b_id_fkey(id,name),
            tournament:tournaments(id,name)
          `)
          .eq('status', 'finished')
          .order('scheduled_at', { ascending: false })
          .limit(24)
        matches = fallbackRes.data || []
      }

      const matchIds = matches.map(m => m.id)
      const { data: statsRows } = matchIds.length
        ? await supabase.from('match_stats').select('match_id,team_id,stats').in('match_id', matchIds)
        : { data: [] }

      const statsByMatch = new Map()
      for (const row of (statsRows || [])) {
        if (!statsByMatch.has(row.match_id)) statsByMatch.set(row.match_id, [])
        statsByMatch.get(row.match_id).push(row)
      }

      const generated = matches
        .map(m => buildStoryFromMatch(m, statsByMatch))
        .sort((a, b) => b.priority - a.priority || new Date(b.publishedAt) - new Date(a.publishedAt))

      setStories(generated)
      await hydrateInteractions(generated.map(x => x.id))
    } catch (err) {
      console.error('NewsPage loadStories:', err.message || err)
      setStories([])
    } finally {
      setLoading(false)
    }
  }, [hydrateInteractions])

  useEffect(() => { loadStories() }, [loadStories])

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
    const { data, error } = await supabase
      .from('news_comments')
      .insert({ news_id: newsId, user_id: user.id, comment_text: text })
      .select('id,news_id,user_id,comment_text,created_at')
      .single()

    if (!error && data) {
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
  }

  const emptyMsg = useMemo(() => !loading && stories.length === 0, [loading, stories.length])

  return (
    <div style={{ minHeight: '100vh', background: '#090909', color: '#f2f2f2' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '22px 16px 48px' }}>
        <div style={{ borderRadius: 16, border: '1px solid #1f1f1f', overflow: 'hidden', marginBottom: 18 }}>
          <div style={{ background: 'linear-gradient(90deg,#C8102E,#8c0e20 45%,#f4f4f4)', color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', textAlign: 'center', padding: 8 }}>
            Esports News Desk
          </div>
          <div style={{ padding: 18, background: 'radial-gradient(circle at 78% 20%, rgba(198,27,51,.15), transparent 40%), #111' }}>
            <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1 }}>Gunun E-Spor Bulteni</h1>
            <p style={{ margin: '8px 0 0', color: '#9b9b9b', fontSize: 14 }}>Son maclardan AI destekli, otomatik uretilen manset ve gundem haberleri.</p>
          </div>
        </div>

        {loading && <div style={{ color: '#888', fontSize: 13 }}>Haberler hazirlaniyor...</div>}

        {hero && (
          <section style={{ marginBottom: 18 }}>
            <div style={{ marginBottom: 8, fontSize: 11, color: '#c61b33', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 800 }}>Manset</div>
            <article style={{ borderRadius: 16, padding: 18, border: '1px solid #2a2a2a', background: 'linear-gradient(145deg,#151515,#101010)' }}>
              <div style={{ fontSize: 11, color: '#888' }}>{fmtDate(hero.publishedAt)} · {hero.tournament}</div>
              <h2 style={{ margin: '10px 0 8px', fontSize: 30, lineHeight: 1.15 }}>{hero.title}</h2>
              <div style={{ color: '#bcbcbc', marginBottom: 8 }}>{hero.heroScore}</div>
              <p style={{ margin: 0, color: '#d8d8d8', lineHeight: 1.6 }}>{hero.summary}</p>

              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  disabled={!canInteract}
                  onClick={() => toggleLike(hero.id)}
                  style={{ border: `1px solid ${likedSet.has(hero.id) ? '#c61b33' : '#383838'}`, background: likedSet.has(hero.id) ? 'rgba(198,27,51,.18)' : '#151515', color: likedSet.has(hero.id) ? '#ff6a7f' : '#c8c8c8', borderRadius: 9, padding: '7px 11px', cursor: canInteract ? 'pointer' : 'not-allowed' }}
                >
                  ♥ Begen ({likesByNews[hero.id] || 0})
                </button>
                <span style={{ fontSize: 12, color: '#8b8b8b' }}>Yorum: {(commentsByNews[hero.id] || []).length}</span>
              </div>
            </article>
          </section>
        )}

        <section>
          <div style={{ marginBottom: 10, fontSize: 11, color: '#f4f4f4', textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: 800 }}>Gundem</div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))' }}>
            {agenda.map(item => (
              <NewsCard
                key={item.id}
                item={item}
                likes={likesByNews[item.id] || 0}
                liked={likedSet.has(item.id)}
                comments={commentsByNews[item.id] || []}
                onLike={toggleLike}
                onComment={addComment}
                canInteract={canInteract}
              />
            ))}
          </div>
        </section>

        {emptyMsg && (
          <div style={{ marginTop: 18, color: '#777', fontSize: 13 }}>Su an haber uretecek yeterli mac verisi bulunamadi.</div>
        )}
      </div>
    </div>
  )
}
