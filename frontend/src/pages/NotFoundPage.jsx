import { Link } from 'react-router-dom'
import { FEXT } from '../theme'
import Mascot from '../components/Mascot'

// Tanımsız yol (ör. /bu-sayfa-yok). Bu yollar middleware matcher'ı dışında →
// vercel.json rewrite'ı index.html'i 200 ile verir; statü kodu değiştirilemez,
// o yüzden Google'a noindex ile "dizine alma" denir (soft 404 kapatma, Denetim Faz 5).
export default function NotFoundPage() {
  return (
    <div style={{ textAlign: 'center', padding: '80px 16px', minHeight: 'calc(100vh - 58px)' }}>
      <title>Sayfa bulunamadı | feXt</title>
      <meta name="robots" content="noindex, follow" />
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Mascot size={86} dim /></div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>Sayfa bulunamadı</h1>
      <p style={{ fontSize: 14, color: 'var(--text-4)', marginBottom: 24 }}>Aradığınız sayfa yok ya da taşınmış olabilir.</p>
      <Link to="/" style={{ display: 'inline-block', padding: '10px 24px', background: FEXT.accentGrad, borderRadius: 10, color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
        Ana sayfaya dön
      </Link>
    </div>
  )
}
