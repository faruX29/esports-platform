import { useState } from 'react'
import { isTurkishTeam } from './constants'

// ─── Static data ─────────────────────────────────────────────────────────────

const STATIC_NEWS = [
  {
    id: 1,
    game: 'Valorant',
    title: 'VCT EMEA 2025: Roster Değişiklikleri ve İlk Hafta Tahminleri',
    summary:
      'VCT EMEA sahnesinde büyük roster değişiklikleri yaşandı. Birçok takım yeni isimlerle sezona hazırlanırken, AI tahmin modelimiz favori ekipleri belirledi.',
    date: '2026-02-18',
    tag: 'TOURNAMENT',
    image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=220&fit=crop',
    turkish: false,
    source: 'EsportsHub AI',
  },
  {
    id: 2,
    game: 'Valorant',
    title: 'BBL Esports VCT EMEA\'ya Hazır: "Bu Sezon Şampiyonluk Hedefliyoruz"',
    summary:
      'Türkiye\'nin gururu BBL Esports, VCT EMEA 2025 sezonu için büyük iddialar ortaya koydu. Kaptan Turko ile özel röportaj.',
    date: '2026-02-17',
    tag: 'TÜRK ESPOR',
    image: 'https://images.unsplash.com/photo-1560253023-3ec5d502959f?w=400&h=220&fit=crop',
    turkish: true,
    source: 'EsportsHub',
  },
  {
    id: 3,
    game: 'Counter-Strike 2',
    title: 'CS2 Major 2025 Qualifier Sonuçları: Hangi Takımlar Geçti?',
    summary:
      'ESL Pro League Season 21 qualifier aşaması sona erdi. Eternal Fire, bölge elemelerinden güçlü çıkarak Major biletini kaptı.',
    date: '2026-02-16',
    tag: 'TOURNAMENT',
    image: 'https://images.unsplash.com/photo-1593305841991-05c297ba4575?w=400&h=220&fit=crop',
    turkish: false,
    source: 'PandaScore',
  },
  {
    id: 4,
    game: 'Counter-Strike 2',
    title: 'Eternal Fire\'da Büyük Transfer: Çelik Kadroyu Güçlendiriyor',
    summary:
      'Eternal Fire, CS2 kadrosuna güçlü bir ekleme yaptı. Türk espor tarihinin en büyük transfer bedellerinden biri olduğu öğrenildi.',
    date: '2026-02-15',
    tag: 'TRANSFER',
    image: 'https://images.unsplash.com/photo-1542751110-97427bbecfd8?w=400&h=220&fit=crop',
    turkish: true,
    source: 'EsportsHub',
  },
  {
    id: 5,
    game: 'League of Legends',
    title: 'LEC 2025 Spring Split: Orta Sezon Değerlendirmesi',
    summary:
      'LEC Spring Split ilk yarısını geride bıraktı. G2 Esports ve Fnatic arasındaki rekabet ligin seyrini belirliyor.',
    date: '2026-02-14',
    tag: 'TOURNAMENT',
    image: 'https://images.unsplash.com/photo-1598550476439-6847785fcea6?w=400&h=220&fit=crop',
    turkish: false,
    source: 'Riot Games',
  },
  {
    id: 6,
    game: 'League of Legends',
    title: 'CS2 Şubat Yaması: Silah Dengesi ve Harita Güncellemeleri',
    summary:
      'Valve, CS2 için kapsamlı bir denge yaması yayınladı. Yeni harita rotasyonu ve silah değişiklikleri profesyonel sahneyi nasıl etkileyecek?',
    date: '2026-02-13',
    tag: 'PATCH',
    image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=400&h=220&fit=crop',
    turkish: false,
    source: 'Valve',
  },
]

const TAG_COLORS = {
  TOURNAMENT: { bg: 'rgba(255,70,85,.15)', color: '#FF4655', border: 'rgba(255,70,85,.3)' },
  TRANSFER:   { bg: 'rgba(240,165,0,.15)',  color: '#F0A500', border: 'rgba(240,165,0,.3)' },
  PATCH:      { bg: 'rgba(76,175,80,.15)',  color: '#4CAF50', border: 'rgba(76,175,80,.3)' },
  'TÜRK ESPOR': { bg: 'rgba(200,16,46,.2)', color: '#ff6b7a', border: 'rgba(200,16,46,.4)' },
  LEC:        { bg: 'rgba(200,156,60,.15)', color: '#C89B3C', border: 'rgba(200,156,60,.3)' },
}

const GAME_TABS = [
  { id: 'all', label: 'Tümü' },
  { id: 'Valorant', label: '⚡ VAL' },
  { id: 'Counter-Strike 2', label: '🎯 CS2' },
  { id: 'League of Legends', label: '🏆 LoL' },
]

const TAG_OPTIONS = ['TOURNAMENT', 'TRANSFER', 'PATCH', 'TÜRK ESPOR', 'LEC']

// ─── NewsCard ─────────────────────────────────────────────────────────────────

function NewsCard({ item }) {
  const [hov, setHov] = useState(false)
  const tagStyle = TAG_COLORS[item.tag] || { bg: '#1e1e1e', color: '#888', border: '#333' }

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: '#111', borderRadius: 16,
        border: `1px solid ${hov ? '#333' : '#1a1a1a'}`,
        overflow: 'hidden', cursor: 'pointer',
        transform: hov ? 'translateY(-4px) scale(1.012)' : 'none',
        transition: 'transform .22s cubic-bezier(.34,1.56,.64,1), border-color .15s',
        boxShadow: hov ? '0 8px 24px rgba(0,0,0,.4)' : 'none',
      }}
    >
      {/* Turkish Pride banner */}
      {item.turkish && (
        <div style={{
          height: 5,
          background: 'linear-gradient(90deg,#C8102E 0%,#a00d25 40%,#001f6d 100%)',
        }} />
      )}

      {/* Image */}
      <div style={{ overflow: 'hidden', height: 180 }}>
        <img
          src={item.image}
          alt={item.title}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: hov ? 'scale(1.06)' : 'scale(1)',
            transition: 'transform .4s ease',
          }}
          onError={e => { e.target.onerror = null; e.target.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='180'><rect width='400' height='180' fill='%231a1a1a'/><text x='200' y='95' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif' font-size='13' fill='%23444'>No Image</text></svg>" }}
        />
      </div>

      <div style={{ padding: '14px 16px 18px' }}>
        {/* Tags row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            background: tagStyle.bg, color: tagStyle.color,
            border: `1px solid ${tagStyle.border}`,
            borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700,
          }}>
            {item.tag}
          </span>
          <span style={{
            background: '#1a1a1a', color: '#666',
            borderRadius: 6, padding: '2px 8px', fontSize: 11,
          }}>
            {item.game}
          </span>
          {item.turkish && (
            <span style={{
              background: 'rgba(200,16,46,.2)', color: '#ff6b7a',
              borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700,
            }}>
              🇹🇷 Türk Espor
            </span>
          )}
        </div>

        {/* Title */}
        <div style={{
          fontSize: 15, fontWeight: 700, color: '#f0f0f0',
          lineHeight: 1.4, marginBottom: 8,
        }}>
          {item.title}
        </div>

        {/* Summary */}
        <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6, marginBottom: 12 }}>
          {item.summary}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#444' }}>{item.source}</span>
          <span style={{ fontSize: 11, color: '#444' }}>
            {new Date(item.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>

      {/* Turkish Pride footer */}
      {item.turkish && (
        <div style={{
          background: 'linear-gradient(90deg,#C8102E 0%,#a00d25 40%,#001f6d 100%)',
          textAlign: 'center', padding: '5px 0', fontSize: 11, fontWeight: 700,
          color: '#fff', letterSpacing: 1,
        }}>
          🇹🇷 TURKISH PRIDE
        </div>
      )}
    </div>
  )
}

// ─── NewsPage (default export) ────────────────────────────────────────────────

export default function NewsPage() {
  const [activeGameTab, setActiveGameTab] = useState('all')
  const [activeTag, setActiveTag] = useState(null)

  const filtered = STATIC_NEWS.filter(item => {
    const gameMatch = activeGameTab === 'all' || item.game === activeGameTab
    const tagMatch = !activeTag || item.tag === activeTag
    return gameMatch && tagMatch
  })

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontSize: 26, fontWeight: 800, color: '#f0f0f0', margin: '0 0 6px',
          background: 'linear-gradient(135deg,#FF4655,#F0A500)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Haberler
        </h1>
        <p style={{ fontSize: 14, color: '#555', margin: 0 }}>
          Espor dünyasından son gelişmeler, transferler ve turnuva haberleri
        </p>
      </div>

      {/* Game filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {GAME_TABS.map(tab => {
          const active = activeGameTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveGameTab(tab.id)}
              style={{
                padding: '7px 16px', borderRadius: 10, cursor: 'pointer',
                background: active ? '#FF4655' : '#111',
                color: active ? '#fff' : '#666',
                border: `1px solid ${active ? '#FF4655' : '#222'}`,
                fontSize: 13, fontWeight: active ? 700 : 500,
                transition: 'all .15s',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tag filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveTag(null)}
          style={{
            padding: '4px 12px', borderRadius: 8, cursor: 'pointer',
            background: !activeTag ? '#1e1e1e' : 'transparent',
            color: !activeTag ? '#ccc' : '#555',
            border: `1px solid ${!activeTag ? '#444' : '#222'}`,
            fontSize: 12, transition: 'all .15s',
          }}
        >
          Tüm Etiketler
        </button>
        {TAG_OPTIONS.map(tag => {
          const tc = TAG_COLORS[tag] || { bg: '#1e1e1e', color: '#888', border: '#333' }
          const active = activeTag === tag
          return (
            <button
              key={tag}
              onClick={() => setActiveTag(active ? null : tag)}
              style={{
                padding: '4px 12px', borderRadius: 8, cursor: 'pointer',
                background: active ? tc.bg : 'transparent',
                color: active ? tc.color : '#555',
                border: `1px solid ${active ? tc.border : '#222'}`,
                fontSize: 12, fontWeight: active ? 700 : 400,
                transition: 'all .15s',
              }}
            >
              {tag}
            </button>
          )
        })}
      </div>

      {/* News grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#444' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 14 }}>Bu filtrelere uygun haber bulunamadı.</div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 20,
        }}>
          {filtered.map(item => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* AI teaser */}
      <div style={{
        marginTop: 48, borderRadius: 16, padding: 28,
        background: 'linear-gradient(135deg, rgba(102,16,242,.12), rgba(255,70,85,.08))',
        border: '1px solid rgba(102,16,242,.25)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🤖</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#f0f0f0', marginBottom: 8 }}>
          AI Destekli Haberler Geliyor
        </div>
        <div style={{ fontSize: 14, color: '#666', maxWidth: 460, margin: '0 auto' }}>
          Yapay zeka destekli haber özetleri, maç analizleri ve kişiselleştirilmiş içerik
          yakında EsportsHub\'da. Şimdiden takip et.
        </div>
        <div style={{
          marginTop: 16, display: 'inline-block',
          background: 'rgba(102,16,242,.2)', color: '#9c6ef5',
          border: '1px solid rgba(102,16,242,.35)',
          borderRadius: 8, padding: '6px 18px', fontSize: 13, fontWeight: 700,
        }}>
          Yakında — Coming Soon
        </div>
      </div>
    </div>
  )
}
