import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import SeoHead from '../components/SeoHead'
import FextopusIcon from '../components/FextopusIcon'
import { FEXT } from '../theme'

/**
 * /stats — Fextopus isabet matrisi (Gemini kararı #65).
 *
 * Sayılar SABİT DEĞİL: `fextopus_isabet` görünümünden her istekte canlı
 * hesaplanır (backend/sql/fextopus_isabet_view.sql). Amaç, 17 Eylül B2B
 * demosunda "%75 isabetliyiz" demek yerine "işte tam dağılım, kendiniz
 * bakın" diyebilmek — şeffaf matematik abartılı iddiadan çok satar.
 */

// Bantlar ÖRTÜŞMEZ. Önce "≥%65" ve "≥%70" birlikte gösteriliyordu; ikincisi
// birincinin içindeydi ve tablo hatalı görünüyordu. Ayrık bantlar hem doğru
// hem daha iyi bir hikâye: isabet, katman yükseldikçe düzgün artıyor.
const KATMANLAR = [
  { key: 'dusuk',  ad: 'Az emin',   aralik: '%50–54', renk: FEXT.textMute },
  { key: 'orta',   ad: 'Orta emin', aralik: '%55–64', renk: FEXT.textDim },
  { key: 'yuksek', ad: 'Emin',      aralik: '%65–69', renk: '#a78bfa' },
  { key: 'zirve',  ad: 'Çok emin',  aralik: '%70+',   renk: FEXT.good },
]

const DONEMLER = [
  { key: 'tum', ad: 'Tüm zamanlar' },
  { key: '90g', ad: 'Son 90 gün' },
  { key: '30g', ad: 'Son 30 gün' },
]

const sayi = (n) => Number(n || 0).toLocaleString('tr-TR')

export default function StatsPage() {
  const [satirlar, setSatirlar] = useState([])
  const [donem, setDonem] = useState('tum')
  const [durum, setDurum] = useState('yukleniyor')

  useEffect(() => {
    let iptal = false
    ;(async () => {
      const { data, error } = await supabase
        .from('fextopus_isabet')
        .select('donem, katman, mac, dogru, isabet')
      if (iptal) return
      if (error || !data?.length) {
        console.error('fextopus_isabet:', error?.message)
        setDurum('hata')
        return
      }
      setSatirlar(data)
      setDurum('hazir')
    })()
    return () => { iptal = true }
  }, [])

  const gorunen = useMemo(() => {
    const harita = new Map(satirlar.filter(r => r.donem === donem).map(r => [r.katman, r]))
    return KATMANLAR.map(k => ({ ...k, ...(harita.get(k.key) || { mac: 0, dogru: 0, isabet: 0 }) }))
  }, [satirlar, donem])

  const toplam = useMemo(() => {
    const mac = gorunen.reduce((a, r) => a + (r.mac || 0), 0)
    const dogru = gorunen.reduce((a, r) => a + (r.dogru || 0), 0)
    return { mac, dogru, isabet: mac ? (100 * dogru / mac) : 0 }
  }, [gorunen])

  const zirve = gorunen.find(r => r.key === 'zirve')

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 64px' }}>
      <SeoHead
        title="Fextopus İsabet Oranları"
        description="Fextopus tahmin motorunun güven katmanına göre isabet oranları — sonuçlanmış 36.000+ maç üzerinde canlı hesaplanır."
        type="website"
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <FextopusIcon size={34} />
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-1)', margin: 0 }}>
          Fextopus İsabet Oranları
        </h1>
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-4)', lineHeight: 1.6, margin: '0 0 22px' }}>
        Fextopus her maç için iki takımın kazanma olasılığını hesaplar. Aşağıdaki tablo,
        motor ne kadar eminse gerçekte ne kadar isabetli olduğunu gösterir. Sayılar sabit
        değil — her açılışta sonuçlanmış maçlardan yeniden hesaplanır.
      </p>

      {durum === 'yukleniyor' && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-5)', fontSize: 13 }}>
          Hesaplanıyor…
        </div>
      )}

      {durum === 'hata' && (
        <div style={{
          padding: 20, borderRadius: 12, background: 'var(--surface)',
          border: '1px solid var(--line)', color: 'var(--text-4)', fontSize: 13,
        }}>
          İsabet verisi şu an yüklenemedi. Lütfen biraz sonra tekrar deneyin.
        </div>
      )}

      {durum === 'hazir' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {DONEMLER.map(d => {
              const aktif = d.key === donem
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setDonem(d.key)}
                  style={{
                    padding: '7px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', transition: 'all .15s',
                    background: aktif ? FEXT.accentSoftBg : 'var(--surface)',
                    border: `1px solid ${aktif ? FEXT.accentBorder : 'var(--line)'}`,
                    color: aktif ? 'var(--accent-fg)' : 'var(--text-4)',
                  }}
                >{d.ad}</button>
              )
            })}
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center',
            padding: '18px 20px', borderRadius: 16, marginBottom: 22,
            background: 'var(--surface)', border: `1px solid ${FEXT.accentBorder}`,
          }}>
            <div>
              <div style={{ fontSize: 34, fontWeight: 800, color: FEXT.good, lineHeight: 1 }}>
                %{Number(zirve?.isabet || 0).toFixed(0)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-5)', marginTop: 6 }}>
                en güvendiği maçlarda
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200, fontSize: 13, color: 'var(--text-4)', lineHeight: 1.6 }}>
              Fextopus bir takıma <strong style={{ color: 'var(--text-2)' }}>%70 ve üzeri</strong> şans
              verdiğinde, {sayi(zirve?.mac)} maçlık örneklemde {sayi(zirve?.dogru)} kez haklı çıktı.
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {gorunen.map(k => {
              const oran = Number(k.isabet || 0)
              return (
                <div key={k.key} style={{
                  padding: '14px 16px', borderRadius: 14,
                  background: 'var(--surface)', border: '1px solid var(--line)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-2)' }}>{k.ad}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-5)' }}>{k.aralik}</span>
                    <span style={{
                      marginLeft: 'auto', fontSize: 20, fontWeight: 800, color: k.renk,
                      fontVariantNumeric: 'tabular-nums',
                    }}>%{oran.toFixed(1)}</span>
                  </div>
                  <div style={{ height: 10, borderRadius: 5, background: 'var(--track)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.max(0, Math.min(100, oran))}%`, height: '100%',
                      background: k.renk, transition: 'width .4s',
                    }} />
                  </div>
                  <div style={{
                    marginTop: 8, fontSize: 11, color: 'var(--text-5)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {sayi(k.mac)} maç · {sayi(k.dogru)} doğru
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{
            marginTop: 18, padding: '14px 16px', borderRadius: 14,
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Genel isabet (tüm katmanlar birlikte)
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: 18, fontWeight: 800, color: 'var(--text-2)',
              fontVariantNumeric: 'tabular-nums',
            }}>%{toplam.isabet.toFixed(1)}</span>
            <span style={{ width: '100%', fontSize: 11, color: 'var(--text-5)' }}>
              {sayi(toplam.mac)} sonuçlanmış maç · {sayi(toplam.dogru)} doğru tahmin
            </span>
          </div>

          <div style={{
            marginTop: 26, padding: '16px 18px', borderRadius: 14,
            background: 'var(--surface)', border: '1px solid var(--line)',
          }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-2)', margin: '0 0 10px' }}>
              Bu tablo nasıl okunur?
            </h2>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-4)', lineHeight: 1.8 }}>
              <li>Katmanlar <strong style={{ color: 'var(--text-3)' }}>örtüşmez</strong>; her maç yalnızca bir bantta sayılır.</li>
              <li>Bir maça %58 verilip o takım kaybettiyse tahmin <em>yanlış</em> sayılır. Kısmi puan yok.</li>
              <li>Az emin katmanının yazı-tura civarında kalması beklenir — orada zaten iddia yok.</li>
              <li>Fextopus <strong style={{ color: 'var(--text-3)' }}>bahis tavsiyesi değildir</strong>; istatistiksel bir analiz aracıdır.</li>
            </ul>
          </div>

          <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-5)' }}>
            Tahminleri maçların yanında görmek için{' '}
            <Link to="/matches" style={{ color: 'var(--accent-fg)' }}>maç programına</Link> göz at.
          </div>
        </>
      )}
    </div>
  )
}
