/**
 * LigPage.jsx
 * /lig/:slug — kalıcı lig sayfası (ör. /lig/worlds, /lig/vct-emea, /lig/tcl)
 *
 * Adres hiç değişmez; ligin EN GÜNCEL etkinliğinin tüm aşamalarını (Play-In / Group /
 * Playoffs) tek sayfada gösterir. Etkinlik seçimi DB'de (`lig_sayfasi`, ligler.sql).
 * Aşama gövdesi turnuva sayfasıyla ortak (AsamaIcerigi).
 *
 * • Başlık     — "<Lig> <yıl>" + "Fikstür, Puan Durumu ve Sonuçlar"
 * • Türk takımları bu etkinlikte (varsa)
 * • Sıradaki maçlar (tüm aşamalar)
 * • Aşama seçici + seçili aşamanın puan durumu / ağacı / maçları
 * • Önceki etkinlikler (eski turnuva sayfalarına link)
 */
import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { CalendarDays, Layers, Radio, History, ChevronRight, Gamepad2, CircleCheck } from 'lucide-react'
import { supabase } from '../supabaseClient'
import { FEXT } from '../theme'
import SeoHead from '../components/SeoHead'
import Mascot from '../components/Mascot'
import TrBadge from '../components/TrBadge'
import NotFoundPage from './NotFoundPage'
import { AsamaIcerigi, MatchListCard, ST, Sk } from './TournamentPage'
import { GAMES } from '../context/GameContext'
import { normalizeGameId } from '../utils/gameUtils'
import { cleanDisplayName } from '../utils/nameCleaner'
import { tournamentDisplayName } from '../utils/tournamentDisplay'
import { isTurkishTeam, useTurkTakimlar } from '../utils/turkTakimlar'
import { normalizeTurnuvaMaci, TURNUVA_MAC_SECIMI } from '../utils/turnuvaMaci'
import { ligSayfasiGetir, ligBaslik } from '../utils/ligler'

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function trTarih(iso) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return `${t.getDate()} ${AYLAR[t.getMonth()]} ${t.getFullYear()}`
}

const BOS = []

const zaman = m => {
  const t = Date.parse(m.scheduled_at || m.begin_at || '')
  return Number.isNaN(t) ? 0 : t
}

// Açılışta gösterilecek aşama: canlı maçı olan; yoksa başlamış ve oynanacak maçı
// kalan; yoksa son başlayan (bitmiş etkinlikte son aşama = genelde Playoffs).
function varsayilanAsama(turnuvalar, maclarByAsama) {
  const simdi = Date.now()
  const durumlu = s => maclarByAsama.get(String(s.id)) || []
  const canli = turnuvalar.find(s => durumlu(s).some(m => m.status === 'running'))
  if (canli) return canli
  const basladi = turnuvalar.filter(s => !s.begin_at || Date.parse(s.begin_at) <= simdi)
  const suren = basladi.filter(s => durumlu(s).some(m => m.status === 'not_started'))
  if (suren.length) return suren[suren.length - 1]
  if (basladi.length) return basladi[basladi.length - 1]
  return turnuvalar[0] || null
}

export default function LigPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  useTurkTakimlar()

  // Sonuç hangi slug'a aitse onunla saklanır; slug değişince yükleniyor hali türetilir
  const [sonuc, setSonuc] = useState({ slug: null, durum: 'yukleniyor', lig: null, maclar: [] })
  const durum = sonuc.slug === slug ? sonuc.durum : 'yukleniyor' // yukleniyor | hazir | yok | hata
  const lig = sonuc.slug === slug ? sonuc.lig : null
  const maclar = sonuc.slug === slug ? sonuc.maclar : BOS

  useEffect(() => {
    let iptal = false
    ;(async () => {
      try {
        const veri = await ligSayfasiGetir(slug)
        if (iptal) return
        if (!veri) { setSonuc({ slug, durum: 'yok', lig: null, maclar: [] }); return }
        const idler = (veri.turnuvalar || []).map(t => t.id)
        let satirlar = []
        if (idler.length) {
          const { data, error } = await supabase
            .from('matches')
            .select(TURNUVA_MAC_SECIMI)
            .in('tournament_id', idler)
            .order('scheduled_at', { ascending: true })
            .limit(1000)
          if (error) throw error
          satirlar = (data || []).map(normalizeTurnuvaMaci)
        }
        if (iptal) return
        setSonuc({ slug, durum: 'hazir', lig: veri, maclar: satirlar })
      } catch (e) {
        console.error('LigPage fetch error:', e)
        if (!iptal) setSonuc({ slug, durum: 'hata', lig: null, maclar: [] })
      }
    })()
    return () => { iptal = true }
  }, [slug])

  const turnuvalar = useMemo(() => lig?.turnuvalar || [], [lig])
  const maclarByAsama = useMemo(() => {
    const harita = new Map()
    for (const m of maclar) {
      const k = String(m.tournament_id)
      if (!harita.has(k)) harita.set(k, [])
      harita.get(k).push(m)
    }
    return harita
  }, [maclar])

  const secilenId = searchParams.get('asama')
  const asama = useMemo(() => (
    turnuvalar.find(t => String(t.id) === secilenId) || varsayilanAsama(turnuvalar, maclarByAsama)
  ), [turnuvalar, secilenId, maclarByAsama])

  const siradaki = useMemo(() => (
    maclar.filter(m => ['running', 'not_started'].includes(m.status))
      .sort((a, b) => (a.status === 'running' ? -1 : 0) - (b.status === 'running' ? -1 : 0) || zaman(a) - zaman(b))
      .slice(0, 6)
  ), [maclar])

  const turkTakimlar = (() => {
    const harita = new Map()
    for (const m of maclar) {
      for (const t of [m.team_a, m.team_b]) {
        if (t?.id != null && !harita.has(t.id) && isTurkishTeam(t)) harita.set(t.id, t)
      }
    }
    return [...harita.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr'))
  })()

  if (durum === 'yok') return <NotFoundPage />

  const gameId = normalizeGameId(lig?.oyun)
  const oyun = GAMES.find(g => g.id === gameId)
  const gc = oyun?.color || '#818cf8'
  const baslik = ligBaslik(lig)
  const etkinlikAdi = lig ? tournamentDisplayName({ league_name: lig.league_name, event_name: lig.etkinlik }, { withStage: false }) : ''
  const tarihler = lig ? [trTarih(lig.baslangic), trTarih(lig.bitis)].filter(Boolean).join(' – ') : ''
  const canliSayisi = maclar.filter(m => m.status === 'running').length
  const yaklasanSayisi = maclar.filter(m => m.status === 'not_started').length
  const bitenSayisi = maclar.filter(m => m.status === 'finished').length
  const aciklama = lig
    ? `${etkinlikAdi} fikstürü, puan durumu ve maç sonuçları: ${turnuvalar.map(t => cleanDisplayName(t.name) || t.name).join(', ')}. Tüm aşamalar tek sayfada — feXt.`
    : ''

  // ── Yükleniyor: başlık + aşama şeridi + içerik iskeleti (CLS) ──────────────
  if (durum === 'yukleniyor') return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px' }}>
      <Sk h="190px" r="20px" />
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {[1, 2, 3].map(i => <Sk key={i} w="110px" h="36px" r="999px" />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12, marginTop: 20 }}>
        {[1, 2, 3, 4].map(i => <Sk key={i} h="120px" r="14px" />)}
      </div>
    </div>
  )

  if (durum === 'hata') return (
    <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center', color: 'var(--text-1)', padding: '0 16px' }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Mascot size={86} dim /></div>
      <div style={{ fontSize: 18, color: '#FF4655', marginBottom: 8 }}>Lig yüklenemedi.</div>
      <button
        onClick={() => window.location.reload()}
        style={{ padding: '10px 24px', background: FEXT.accentGrad, border: 'none',
          borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
      >Yeniden dene</button>
    </div>
  )

  const asamaMaclari = asama ? (maclarByAsama.get(String(asama.id)) || []) : []
  const pill = aktif => ({
    flexShrink: 0, cursor: aktif ? 'default' : 'pointer',
    padding: '7px 13px', minHeight: 36, borderRadius: 999,
    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
    border: aktif ? `1px solid ${FEXT.accentBorder}` : '1px solid var(--line-2)',
    background: aktif ? FEXT.accentSoftBg : 'var(--surface)',
    color: aktif ? FEXT.accentText : 'var(--text-2)',
  })

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 100px', color: 'var(--text-1)' }}>
      <SeoHead
        title={`${baslik} Fikstür, Puan Durumu ve Sonuçlar`}
        description={aciklama}
        type="article"
        schema={lig?.baslangic ? {
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: etkinlikAdi,
          sport: 'Esports',
          startDate: lig.baslangic,
          endDate: lig.bitis || undefined,
          eventStatus: 'https://schema.org/EventScheduled',
          eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
          location: { '@type': 'VirtualLocation', url: `https://fextesports.com/lig/${lig.slug}` },
          description: aciklama,
          organizer: { '@type': 'Organization', name: 'feXt' },
          url: `https://fextesports.com/lig/${lig.slug}`,
        } : null}
      />
      {/* Etkinliği olmayan lig (tanımlı ama henüz turnuva yok) dizine girmesin */}
      {!turnuvalar.length && <meta name="robots" content="noindex, follow" />}

      {/* ══════════════ BAŞLIK ══════════════════════════════════════ */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: '0 0 24px 24px',
        background: 'var(--surface)',
        borderBottom: `1px solid ${gc}33`,
        padding: '22px 24px 24px',
        marginBottom: 28,
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(ellipse at 50% 0%,${gc}18 0%,transparent 65%)`,
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              background: `${gc}18`, border: `1px solid ${gc}44`, color: gc,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: gc }} /> {oyun?.label || 'Espor'}</span>
            {canliSayisi > 0 && (
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800,
                background: 'rgba(255,70,85,.15)', border: '1px solid rgba(255,70,85,.5)', color: '#FF4655',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF4655' }} /> CANLI</span>
            )}
          </div>

          <h1 style={{ margin: '0 0 10px', lineHeight: 1.15 }}>
            <span style={{ display: 'block', fontSize: 30, fontWeight: 900, color: 'var(--text-1)' }}>{baslik}</span>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--text-3)', marginTop: 6 }}>
              Fikstür, Puan Durumu ve Sonuçlar
            </span>
          </h1>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-4)', marginBottom: 14 }}>
            {etkinlikAdi && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Layers size={12} /> {etkinlikAdi}</span>}
            {tarihler && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CalendarDays size={12} /> {tarihler}</span>}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { Icon: Gamepad2, label: 'Maç', value: maclar.length, color: '#818cf8' },
              { Icon: CircleCheck, label: 'Yaklaşan', value: yaklasanSayisi, color: '#4CAF50' },
              { Icon: CircleCheck, label: 'Bitti', value: bitenSayisi, color: '#FF8C00' },
              { Icon: Radio, label: 'Canlı', value: canliSayisi, color: '#FF4655' },
            ].filter(s => s.value > 0).map(s => (
              <div key={s.label} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20,
                background: `${s.color}10`, border: `1px solid ${s.color}25`,
              }}>
                <s.Icon size={13} color={s.color} />
                <span style={{ fontSize: 14, fontWeight: 900, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px' }}>
        {!turnuvalar.length && (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-4)', background: 'var(--surface)',
            borderRadius: 16, border: '1px dashed var(--surface-2)', marginBottom: 36 }}>
            Bu lig için henüz etkinlik yok.
          </div>
        )}

        {/* ── Türk takımları bu etkinlikte ─────────────────────────── */}
        {turkTakimlar.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <ST Icon={Layers} label="Bu etkinlikteki Türk takımları" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {turkTakimlar.map(t => (
                <Link key={t.id} to={`/team/${t.id}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 12,
                  background: 'rgba(200,16,46,.08)', border: '1px solid rgba(200,16,46,.35)',
                  color: 'var(--text-1)', fontSize: 13, fontWeight: 700, textDecoration: 'none',
                }}>
                  {t.logo_url && <img src={t.logo_url} alt="" width={20} height={20} style={{ objectFit: 'contain' }} />}
                  {t.name}<TrBadge />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Sıradaki maçlar (tüm aşamalar) ───────────────────────── */}
        {siradaki.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <ST Icon={Radio} label="Sıradaki maçlar" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
              {siradaki.map(m => <MatchListCard key={m.id} m={m} navigate={navigate} gc={gc} />)}
            </div>
          </div>
        )}

        {/* ── Aşamalar ─────────────────────────────────────────────── */}
        {turnuvalar.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={12} /> Aşamalar
            </div>
            <div className="scroll-fade-x" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 3, scrollbarWidth: 'none' }}>
              {turnuvalar.map(t => {
                const aktif = String(t.id) === String(asama?.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => { if (!aktif) setSearchParams({ asama: String(t.id) }, { replace: true }) }}
                    aria-pressed={aktif}
                    style={pill(aktif)}
                  >
                    {cleanDisplayName(t.name) || t.name || 'Aşama'}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {asama && (
          <div key={asama.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--text-1)' }}>
                {cleanDisplayName(asama.name) || asama.name}
              </h2>
              <Link to={`/tournament/${asama.id}`} style={{ fontSize: 12, fontWeight: 700, color: FEXT.accentText, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                Aşama sayfası <ChevronRight size={13} />
              </Link>
            </div>
            {asamaMaclari.length > 0 ? (
              <AsamaIcerigi tournament={asama} matches={asamaMaclari} navigate={navigate} gc={gc} />
            ) : (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-4)', background: 'var(--surface)',
                borderRadius: 16, border: '1px dashed var(--surface-2)' }}>
                Bu aşamanın maçları henüz açıklanmadı.
              </div>
            )}
          </div>
        )}

        {/* ── Önceki etkinlikler ───────────────────────────────────── */}
        {lig?.gecmis?.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <ST Icon={History} label="Önceki etkinlikler" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {lig.gecmis.map(g => (
                <Link key={g.turnuva_id} to={`/tournament/${g.turnuva_id}`} style={{
                  padding: '7px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                  background: 'var(--surface)', border: '1px solid var(--line-2)',
                  color: 'var(--text-2)', textDecoration: 'none',
                }}>
                  {tournamentDisplayName({ league_name: lig.league_name, event_name: g.etkinlik }, { withStage: false })}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
