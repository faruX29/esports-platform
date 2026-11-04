import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, CalendarDays, Trophy, Newspaper, Flag } from 'lucide-react'
import { FEXT } from '../theme'
import Mascot from '../components/Mascot'

// Tanımsız yol (ör. /bu-sayfa-yok). Bu yollar middleware matcher'ı dışında →
// vercel.json rewrite'ı index.html'i 200 ile verir; statü kodu değiştirilemez,
// o yüzden Google'a noindex ile "dizine alma" denir (soft 404 kapatma, Denetim Faz 5).
// Çıkmaz sokak olmasın: arama kutusu + en çok gidilen sayfalar.
const ONERILER = [
  { to: '/matches', label: 'Maçlar', Icon: CalendarDays },
  { to: '/tournaments', label: 'Turnuvalar', Icon: Trophy },
  { to: '/news', label: 'Haberler', Icon: Newspaper },
  { to: '/turk-takimlari', label: 'Türk Takımları', Icon: Flag },
]

export default function NotFoundPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  function ara(e) {
    e.preventDefault()
    const t = q.trim()
    if (t) navigate(`/search?q=${encodeURIComponent(t)}`)
  }

  return (
    <div style={{ textAlign: 'center', padding: '80px 16px', minHeight: 'calc(100vh - 58px)' }}>
      <title>Sayfa bulunamadı | feXt</title>
      <meta name="robots" content="noindex, follow" />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Mascot size={86} dim /></div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>Sayfa bulunamadı</h1>
      <p style={{ fontSize: 14, color: 'var(--text-4)', marginBottom: 22 }}>Aradığın sayfa yok ya da taşınmış olabilir. Takım, oyuncu ya da turnuva ara:</p>

      <form onSubmit={ara} role="search" style={{ maxWidth: 420, margin: '0 auto 22px', display: 'flex', gap: 8 }}>
        <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 999, border: '1px solid var(--line-2)', background: 'var(--surface)' }}>
          <Search size={15} color="var(--text-4)" aria-hidden="true" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="ör. Eternal Fire, TCL, Worlds"
            aria-label="Sitede ara"
            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--text-1)', fontSize: 14 }}
          />
        </label>
        <button type="submit" style={{ padding: '9px 18px', borderRadius: 999, border: 'none', background: FEXT.accentGrad, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Ara</button>
      </form>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 26 }}>
        {ONERILER.map(o => (
          <Link key={o.to} to={o.to} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            <o.Icon size={14} aria-hidden="true" /> {o.label}
          </Link>
        ))}
      </div>

      <Link to="/" style={{ display: 'inline-block', padding: '10px 24px', background: FEXT.accentGrad, borderRadius: 10, color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
        Ana sayfaya dön
      </Link>
    </div>
  )
}
