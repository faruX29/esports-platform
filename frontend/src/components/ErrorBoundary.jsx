import { Component } from 'react'
import Mascot from './Mascot'

/**
 * Bir sayfa bileşeni render sırasında hata fırlatırsa tüm SPA'nın beyaz ekrana
 * düşmesini engeller; dostça bir Türkçe hata + kurtarma butonları gösterir.
 * `resetKey` (pathname) değişince otomatik toparlanır → kullanıcı başka sayfaya
 * gidince hatalı ekranda kilitli kalmaz.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  static getDerivedStateFromProps(props, state) {
    // Rota değişince (resetKey farklıysa) hata durumunu temizle
    if (state.hasError && props.resetKey !== state.lastKey) {
      return { hasError: false, lastKey: props.resetKey }
    }
    if (props.resetKey !== state.lastKey) {
      return { lastKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error, info) {
    // Geliştirici için konsola; kullanıcıya ham hata sızmaz
    console.error('ErrorBoundary yakaladı:', error, info?.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 20px', textAlign: 'center', color: 'var(--text-1)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Mascot size={80} dim /></div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 10px' }}>Bir şeyler ters gitti</h1>
        <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 22 }}>
          Bu sayfa yüklenirken beklenmedik bir hata oluştu. Sayfayı yenilemeyi ya da
          ana sayfaya dönmeyi deneyebilirsin.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg,#DF4888,#8B3AA0 55%,#6A297F)' }}
          >
            Sayfayı Yenile
          </button>
          <button
            onClick={() => { window.location.href = '/' }}
            style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--line-2)', cursor: 'pointer', fontWeight: 700, color: 'var(--text-2)', background: 'var(--surface)' }}
          >
            Ana Sayfaya Dön
          </button>
        </div>
      </div>
    )
  }
}
