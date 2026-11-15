import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import InitialsImage from './InitialsImage'
import { FEXT } from '../theme'

/**
 * Takip edilen takımın maçı başlayınca çıkan kart (react-hot-toast `toast.custom` içinde).
 * Köşeden kayarak gelir, ~6 sn sonra kendisi gider; "İzle" maç sayfasını açar.
 * `mac`: { id, team_a, team_b } (takımlar: id, name, acronym, logo_url); `takipId`: takip edilen takımın id'si.
 */
export default function MacBasladiKarti({ t, mac, takipId }) {
  const takip = Number(mac.team_b?.id) === Number(takipId) ? mac.team_b : mac.team_a
  const rakip = takip === mac.team_a ? mac.team_b : mac.team_a
  const ad = takip?.name || 'Takip ettiğin takım'
  return (
    <div
      role="status"
      style={{
        width: 300, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12,
        background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--line-2)',
        boxShadow: '0 10px 26px var(--shadow)',
        transform: t.visible ? 'translateX(0)' : 'translateX(115%)', opacity: t.visible ? 1 : 0,
        transition: 'transform .45s cubic-bezier(.3,1.4,.5,1), opacity .3s',
      }}
    >
      <InitialsImage src={takip?.logo_url} name={ad} width={36} height={36} borderRadius={8} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad} maçı başladı</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--canli-fg)', fontWeight: 800 }}>CANLI</span> · {rakip?.name ? `${rakip.name} ile` : 'Şimdi'}
        </div>
      </div>
      <Link
        to={`/match/${mac.id}`}
        onClick={() => toast.dismiss(t.id)}
        style={{ color: FEXT.accentText, fontSize: 12.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap', padding: '6px 4px' }}
      >
        İzle
      </Link>
    </div>
  )
}
