import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { isTurkishTeam } from '../constants'
import {
  buildFinishedStory,
  buildUpcomingStory,
  storyExplainability,
} from '../utils/newsStories'

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

  const [story, setStory] = useState(location.state?.story || null)
  const [matchData, setMatchData] = useState(null)
  const [statsRows, setStatsRows] = useState([])
  const [loading, setLoading] = useState(!location.state?.story)
  const [error, setError] = useState('')

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

        if (!cancelled) {
          setMatchData(match)
          setStatsRows(statRows || [])
          setStory(generated)
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
  }, [newsId])

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
              {story.visuals.teamA.logo_url
                ? <img src={story.visuals.teamA.logo_url} alt={story.visuals.teamA.name || ''} style={{ width: 52, height: 52, objectFit: 'contain', borderRadius: 12, background: '#111', padding: 5, border: '1px solid #2a2a2a' }} />
                : <div style={{ width: 52, height: 52, borderRadius: 12, background: '#171717', border: '1px solid #2a2a2a' }} />}
              {story.visuals.teamB.logo_url
                ? <img src={story.visuals.teamB.logo_url} alt={story.visuals.teamB.name || ''} style={{ width: 52, height: 52, objectFit: 'contain', borderRadius: 12, background: '#111', padding: 5, border: '1px solid #2a2a2a' }} />
                : <div style={{ width: 52, height: 52, borderRadius: 12, background: '#171717', border: '1px solid #2a2a2a' }} />}
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
      </div>
    </div>
  )
}
