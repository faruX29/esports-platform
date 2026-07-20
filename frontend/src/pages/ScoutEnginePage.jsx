import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import SeoHead from '../components/SeoHead'
import InitialsImage from '../components/InitialsImage'
import { BarChart3, TrendingUp, Target, Search, Gamepad2, Trophy, Shield, User, CalendarDays, CircleCheck } from 'lucide-react'
import { FEXT } from '../theme'

/**
 * Scout Engine — B2B "Private Beta / Waitlist" landing.
 *
 * Gemini stratejisi (%30 B2B): devasa dashboard yerine waitlist + 3-5 örnek
 * scouting raporu. Ajansları kapalı betaya çekerken B2C trafiğiyle güç gösterir.
 * Örnek raporlar gerçek oyuncu isimleriyle beslenir (graceful fallback).
 */

const ACCENT = FEXT.accent  // feXt moru — marka tutarlılığı (eski teal kaldırıldı)

const FEATURES = [
  { Icon: BarChart3, title: 'Derin Performans Analitiği', desc: 'Harita bazlı KDA, Impact skoru, HS% ve tempo metrikleri — hibrit veri hattıyla zenginleştirilmiş.' },
  { Icon: TrendingUp, title: 'Form & Trend Takibi', desc: 'Oyuncunun son N maçtaki yükseliş/düşüş eğrisi, ajan/rol bazlı tutarlılık.' },
  { Icon: Target, title: 'Rakip & Uyum Analizi', desc: 'Oyuncunun takım oyun tarzına uyumu, güçlü/zayıf harita profili, transfer uygunluğu.' },
  { Icon: Search, title: 'Erken Yetenek Tespiti', desc: 'Alt liglerden yükselen oyuncular için otomatik radar — rakiplerden önce keşfet.' },
]

const SAMPLE_REPORTS = [
  {
    role: 'Duelist', game: 'VALORANT',
    verdict: 'Yüksek Tavan',
    note: 'Agresif giriş oyuncusu. Pistol round dönüşüm oranı lig ortalamasının %18 üstünde; clutch durumlarda soğukkanlı. Yapı oturmuş takımda patlama potansiyeli yüksek.',
    metrics: [['Etki', '1.24'], ['K/D', '1.31'], ['Opening WR', '%58']],
  },
  {
    role: 'IGL / Controller', game: 'VALORANT',
    verdict: 'İstikrar Çapası',
    note: 'Düşük varyanslı, takım odaklı oyuncu. Bireysel istatistikleri orta seviye ama harita kontrolü ve util kullanımı elit. Genç kadroya liderlik için ideal.',
    metrics: [['Etki', '0.98'], ['Util/round', '3.4'], ['Map WR', '%61']],
  },
  {
    role: 'AWPer', game: 'CS2',
    verdict: 'Takip Listesi',
    note: 'Yüksek tavan/düşük taban profili. İyi günlerinde maç çeviriyor ama tutarlılık riski var. Yapılandırılmış bir sistemde değer kazanır. 6 ay izleme önerilir.',
    metrics: [['Rating 2.0', '1.15'], ['Opening K', '0.19'], ['HS%', '%41']],
  },
]

/* ── Sayıyı dürüst eşiğe yuvarla ("+" ile) — asla abartmaz ── */
function plusFloor(n, step) {
  if (!n || n < step) return null
  return (Math.floor(n / step) * step).toLocaleString('tr-TR') + '+'
}

/* ── Gerçek player_match_stats'ten scouting raporu üret ── */
function buildRealReports(rows) {
  const acc = {}
  for (const r of rows) {
    const pid = r.player_id
    if (!pid) continue
    if (!acc[pid]) acc[pid] = {
      nickname: r.player?.nickname, image_url: r.player?.image_url, role: r.player?.role,
      k: 0, d: 0, a: 0, n: 0, wins: 0, wc: 0, acsSum: 0, acsN: 0,
    }
    const p = acc[pid]
    p.k += Number(r.kills) || 0
    p.d += Number(r.deaths) || 0
    p.a += Number(r.assists) || 0
    p.n += 1
    if (r.is_win != null) { p.wc += 1; if (r.is_win) p.wins += 1 }
    const acs = r.stats?.acs_avg
    if (acs != null) { p.acsSum += Number(acs); p.acsN += 1 }
  }
  return Object.values(acc)
    .filter(p => p.nickname && p.n >= 3)   // ≥3 maç: güvenilir örneklem (thin 2-maç fluke'ları eleme)
    .map(p => {
      const kd = p.d > 0 ? p.k / p.d : p.k
      const acs = p.acsN > 0 ? Math.round(p.acsSum / p.acsN) : null
      const wr = p.wc > 0 ? Math.round((p.wins / p.wc) * 100) : null
      const strong = kd >= 1.15
      const goodWin = wr != null && wr >= 55
      const lowWin = wr != null && wr < 40

      // Bağlam-farkında verdict + içgörü — K/D ile galibiyeti birlikte değerlendirir
      // (tekrar eden şablon yerine gerçek scout yorumu; "%0 win Elit Fragcı" çelişkisini çözer)
      let verdict, insight
      if (strong && goodWin) {
        verdict = 'Elit Fragcı'
        insight = 'Hem bireysel etki hem galibiyet üretimi yüksek — kadro çekirdeği için birinci sınıf aday.'
      } else if (strong && lowWin) {
        verdict = 'Yüksek Tavan'
        insight = 'Yüksek bireysel tavan ama takım sonuçları zayıf — doğru sistemde patlama potansiyeli olan sığ-pazar fırsatı.'
      } else if (strong) {
        verdict = 'Elit Fragcı'
        insight = 'Güçlü bireysel etki — kadro çekirdeği için güçlü aday.'
      } else if (kd >= 1.0) {
        verdict = 'İstikrarlı Katkı'
        insight = goodWin
          ? 'Dengeli katkı + kazanan takım profili — sistemli bir kadroda güvenilir rol oyuncusu.'
          : 'Dengeli katkı — sistemli bir takımda güvenilir rol oyuncusu.'
      } else {
        verdict = 'Takım Oyuncusu'
        insight = 'Takım odaklı profil — destek/oyun kurucu rolünde değer kazanır.'
      }

      const metrics = [['K/D', kd.toFixed(2)]]
      if (acs != null) metrics.push(['ACS', String(acs)])
      if (wr != null) metrics.push(['Win%', `%${wr}`])
      const note = `Son ${p.n} maçta ${p.k}/${p.d}/${p.a} K/D/A`
        + (acs != null ? `, ${acs} ort. ACS` : '')
        + (wr != null ? `, %${wr} galibiyet` : '') + '. '
        + insight
      return {
        _kd: kd,
        report: { role: p.role || 'Pro', game: '', verdict, note, metrics },
        player: { nickname: p.nickname, image_url: p.image_url },
      }
    })
    .sort((a, b) => b._kd - a._kd)
    .slice(0, 3)
}

function SampleReportCard({ report, player, real = false }) {
  return (
    <div style={{
      background: 'linear-gradient(160deg, rgba(194,92,208,.06), var(--surface))',
      border: '1px solid rgba(194,92,208,.18)', borderRadius: 16, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <InitialsImage
          src={player?.image_url} name={player?.nickname || report.role}
          width={44} height={44} borderRadius={10} objectFit="cover"
          style={{ border: '1px solid rgba(194,92,208,.25)', flexShrink: 0 }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {player?.nickname || 'Örnek Oyuncu'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ai)' }}>
            {report.role}{report.game ? ` · ${report.game}` : ''}{player?.team_name ? ` · ${player.team_name}` : ''}
          </div>
        </div>
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: '#fff',
          background: ACCENT, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
        }}>
          {report.verdict}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {report.metrics.map(([label, val]) => (
          <div key={label} style={{ flex: 1, background: 'var(--hover)', border: '1px solid var(--line)', borderRadius: 9, padding: '7px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{val}</div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
          </div>
        ))}
      </div>

      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-2)' }}>{report.note}</p>

      <div style={{ marginTop: 'auto', fontSize: 9, color: 'var(--text-5)', letterSpacing: '.6px' }}>
        {real
          ? <>GERÇEK MAÇ VERİSİ · Data powered by <a href="https://liquipedia.net" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-4)' }}>Liquipedia</a></>
          : <span style={{ textTransform: 'uppercase' }}>Örnek Scout Raporu · İllüstratif</span>}
      </div>
    </div>
  )
}

/* ── Canlı arşiv-derinliği kanıt şeridi (gerçek DB sayıları) ──
   depth: null = yükleniyor (skeleton) · false = hata (gizle) · obj = veri.
   Skeleton, gerçek kutularla aynı boyutta → layout shift (CLS) olmaz. */
const DEPTH_LABELS = ['Analiz edilen maç', 'Turnuva', 'Takım profili', 'Oyuncu', 'Veri derinliği', 'AI net isabet']

function DepthStrip({ depth }) {
  if (depth === false) return null
  const loading = depth == null

  const tiles = loading ? [] : [
    { Icon: Gamepad2,     value: plusFloor(depth.matches, 1000),     label: 'Analiz edilen maç' },
    { Icon: Trophy,       value: plusFloor(depth.tournaments, 100),  label: 'Turnuva' },
    { Icon: Shield,       value: plusFloor(depth.teams, 100),        label: 'Takım profili' },
    { Icon: User,         value: plusFloor(depth.players, 100),      label: 'Oyuncu' },
    { Icon: CalendarDays, value: depth.earliestYear ? `${depth.earliestYear}→` : null, label: 'Veri derinliği' },
    { Icon: Target,       value: depth.confidentPct != null ? `%${Math.round(depth.confidentPct)}` : null, label: 'AI net isabet' },
  ].filter(t => t.value)

  if (!loading && tiles.length === 0) return null

  const tileBox = {
    background: 'linear-gradient(160deg, rgba(194,92,208,.06), var(--surface))',
    border: '1px solid rgba(194,92,208,.16)', borderRadius: 13, padding: '13px 12px', textAlign: 'center',
  }

  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 8px ${ACCENT}`, flexShrink: 0, animation: 'scoutPulse 1.6s ease-in-out infinite' }} />
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ai)' }}>
          Canlı arşiv — şu an bu derinlikte çalışıyor
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        {loading
          ? DEPTH_LABELS.map((lbl, i) => (
              <div key={i} style={{ ...tileBox, animation: 'scoutPulse 1.6s ease-in-out infinite' }}>
                <div style={{ height: 15, marginBottom: 5 }} />
                <div style={{ height: 22, width: '62%', margin: '0 auto', borderRadius: 6, background: 'rgba(194,92,208,.10)' }} />
                <div style={{ fontSize: 10, color: 'var(--text-5)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>{lbl}</div>
              </div>
            ))
          : tiles.map(t => (
              <div key={t.label} style={tileBox}>
                <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center', opacity: .85 }}>{t.Icon && <t.Icon size={18} color={ACCENT} />}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{t.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>{t.label}</div>
              </div>
            ))}
      </div>
      <style>{`@keyframes scoutPulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
    </section>
  )
}

export default function ScoutEnginePage() {
  const [realReports, setRealReports] = useState([])
  const [depth, setDepth] = useState(null)
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState('')
  const [role, setRole] = useState('agency')
  const [status, setStatus] = useState('idle')  // idle | sending | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  // Örnek raporları GERÇEK player_match_stats (hybrid v3) verisinden üret
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('player_match_stats')
          .select('player_id,kills,deaths,assists,is_win,stats,player:players(nickname,image_url,role)')
          .not('kills', 'is', null)
          .limit(1000)
        if (!cancelled && data) setRealReports(buildRealReports(data))
      } catch { /* sessiz — statik örnek raporlara düşer */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Canlı arşiv derinliği — gerçek DB sayıları (B2B güven sinyali)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const countOf = (table) => supabase.from(table).select('*', { count: 'exact', head: true })
        const [mc, tc, tec, pc, earliest, acc] = await Promise.all([
          countOf('matches'),
          countOf('tournaments'),
          countOf('teams'),
          countOf('players'),
          supabase.from('matches').select('scheduled_at').not('scheduled_at', 'is', null)
            .order('scheduled_at', { ascending: true }).limit(1),
          supabase.rpc('get_prediction_accuracy', { days_back: 0 }),
        ])
        if (cancelled) return
        const earliestYear = earliest.data?.[0]?.scheduled_at
          ? new Date(earliest.data[0].scheduled_at).getFullYear()
          : null
        const next = {
          matches: mc.count ?? null,
          tournaments: tc.count ?? null,
          teams: tec.count ?? null,
          players: pc.count ?? null,
          earliestYear,
          confidentPct: acc.data?.confident_pct ?? null,
        }
        // Hiç anlamlı sayı yoksa şeridi gizle (skeleton'da takılı kalma)
        const hasAny = next.matches || next.tournaments || next.teams || next.players || next.earliestYear
        setDepth(hasAny ? next : false)
      } catch {
        if (!cancelled) setDepth(false)  // sessiz — şerit gizlenir
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function submitWaitlist(e) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMsg('Geçerli bir e-posta gir.')
      setStatus('error')
      return
    }
    setStatus('sending')
    setErrorMsg('')
    try {
      const { error } = await supabase.from('scout_waitlist').insert({
        email: trimmed,
        organization: org.trim() || null,
        role,
      })
      // Aynı e-posta zaten kayıtlı (unique violation) → başarı gibi karşıla
      if (error && error.code !== '23505') throw error
      setDoneMsg(error?.code === '23505'
        ? 'Zaten listedesin! Beta açıldığında ilk sen haberdar olacaksın.'
        : 'Listeye eklendin! Beta açıldığında e-posta ile haber vereceğiz.')
      setStatus('done')
      setEmail(''); setOrg('')
    } catch (err) {
      // Tablo yoksa / RLS — yine de kullanıcıya nazik geri bildirim
      setErrorMsg('Kayıt alınamadı. Lütfen daha sonra tekrar dene.')
      setStatus('error')
      console.error('scout_waitlist insert:', err?.message || err)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <SeoHead
        title="Scout Engine — Ajanslar için Espor Scouting (Private Beta)"
        description="Derin performans analitiği, form takibi ve erken yetenek tespiti. Espor ajansları ve scout'lar için kapalı beta — bekleme listesine katıl."
        type="website"
      />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 16px 60px' }}>

        {/* Hero */}
        <section style={{
          borderRadius: 20, border: '1px solid rgba(194,92,208,.2)', overflow: 'hidden',
          background: `radial-gradient(circle at 85% 10%, rgba(194,92,208,.16), transparent 40%), linear-gradient(160deg,var(--surface),var(--bg))`,
          padding: '34px 24px', marginBottom: 22,
        }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: ACCENT, border: `1px solid ${ACCENT}55`, borderRadius: 999, padding: '4px 12px' }}>
            Private Beta · Bekleme Listesi
          </span>
          <h1 style={{ margin: '16px 0 10px', fontSize: 38, lineHeight: 1.1, fontWeight: 900, maxWidth: 720 }}>
            Scout Engine — Ajanslar için Veri Odaklı Espor Scouting
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, color: '#b6c4c1', maxWidth: 680 }}>
            Yüzlerce oyuncuyu manuel izlemeyi bırak. Hibrit veri hattımız harita bazlı KDA,
            Impact skoru ve form trendlerini otomatik analiz eder; sana sadece doğru
            transfer kararını sunar. Rakiplerinden önce yeteneği keşfet.
          </p>
          <a href="#waitlist" style={{
            display: 'inline-block', marginTop: 20, background: ACCENT, color: '#fff',
            fontWeight: 800, fontSize: 14, padding: '11px 22px', borderRadius: 10, textDecoration: 'none',
          }}>
            Bekleme Listesine Katıl →
          </a>
        </section>

        {/* Canlı arşiv derinliği — gerçek sayılar (B2B güven sinyali) */}
        <DepthStrip depth={depth} />

        {/* Features */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12, marginBottom: 26 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
              <div style={{ marginBottom: 10, display: 'flex' }}>{f.Icon && <f.Icon size={22} color={ACCENT} />}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-1)', marginBottom: 5 }}>{f.title}</div>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-3)' }}>{f.desc}</p>
            </div>
          ))}
        </section>

        {/* Sample reports — gerçek veri varsa ondan, yoksa statik */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Örnek Scouting Raporları</h2>
            <span style={{ fontSize: 12, color: realReports.length > 0 ? 'var(--ai)' : 'var(--text-4)' }}>
              {realReports.length > 0 ? '● Canlı veriden üretildi — illüstratif değil' : "Beta'da her oyuncu için otomatik üretilir"}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
            {realReports.length > 0
              ? realReports.map((r, i) => (
                  <SampleReportCard key={i} report={r.report} player={r.player} real />
                ))
              : SAMPLE_REPORTS.map((rep) => (
                  <SampleReportCard key={rep.role} report={rep} player={null} />
                ))}
          </div>
          {realReports.length > 0 && (
            <p style={{ margin: '12px 2px 0', fontSize: 12, color: 'var(--text-4)', lineHeight: 1.6 }}>
              Bu kartlar 2014'ten bugüne uzanan <b style={{ color: 'var(--text-3)' }}>33.000+ gerçek maçlık</b> arşiv
              ve hibrit istatistik hattından otomatik süzüldü. Beta'da her oyuncu ve takım için,
              aradığın role ve oyun tarzına göre anında üretilir.
            </p>
          )}
        </section>

        {/* Waitlist form */}
        <section id="waitlist" style={{
          borderRadius: 18, border: `1px solid ${ACCENT}33`, padding: 24,
          background: 'linear-gradient(160deg, rgba(194,92,208,.07), var(--surface))',
        }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 900 }}>Kapalı Beta'ya Erken Erişim</h2>
          <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--text-2)', maxWidth: 560 }}>
            İlk dalgaya ajanslar ve profesyonel scout'lar davet edilecek. E-postanı bırak,
            sıra sana gelince ilk sen haberdar ol.
          </p>

          {status === 'done' ? (
            <div style={{ border: '1px solid rgba(70,182,88,.4)', background: 'rgba(70,182,88,.12)', color: '#3d9950', borderRadius: 12, padding: '14px 16px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CircleCheck size={16} /> {doneMsg || 'Listeye eklendin! Beta açıldığında e-posta ile haber vereceğiz.'}
            </div>
          ) : (
            <form onSubmit={submitWaitlist} style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
              <input
                type="email" value={email} onChange={e => { setEmail(e.target.value); if (status === 'error') setStatus('idle') }}
                placeholder="E-posta adresin *"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text-1)', padding: '11px 13px', fontSize: 14 }}
              />
              <input
                type="text" value={org} onChange={e => setOrg(e.target.value)}
                placeholder="Organizasyon / takım (opsiyonel)"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text-1)', padding: '11px 13px', fontSize: 14 }}
              />
              <select
                value={role} onChange={e => setRole(e.target.value)}
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text-1)', padding: '11px 13px', fontSize: 14 }}
              >
                <option value="agency">Ajans / Menajerlik</option>
                <option value="team">Takım / Org</option>
                <option value="scout">Bağımsız Scout</option>
                <option value="other">Diğer</option>
              </select>

              {status === 'error' && <div style={{ color: '#ff8c9a', fontSize: 12.5 }}>{errorMsg}</div>}

              <button
                type="submit" disabled={status === 'sending'}
                style={{
                  background: ACCENT, color: '#fff', fontWeight: 800, fontSize: 15,
                  border: 'none', borderRadius: 10, padding: '12px', cursor: status === 'sending' ? 'wait' : 'pointer',
                }}
              >
                {status === 'sending' ? 'Gönderiliyor…' : 'Bekleme Listesine Katıl'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Spam yok. Sadece beta daveti ve büyük güncellemeler.</span>
            </form>
          )}
        </section>

      </div>
    </div>
  )
}
