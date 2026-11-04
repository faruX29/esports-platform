/**
 * Kalıcı lig sayfalarına (/lig/<slug>) giden şerit. Ligler oyuna göre gruplu
 * (LoL / VALORANT / CS2, aralarında ince ayraç), her grubun başında Türk ligleri
 * (`ligler.turk`, DB'de). Oyunu kapsüldeki logo gösterir. Lig listesi ve sırası
 * `lig_listesi` RPC'sinden gelir; burada ad eşlemesi yapılmaz.
 */
import { Link } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import KapsulSerit from './KapsulSerit'
import { kapsulStili, kapsulHover } from '../utils/kapsul'
import GameLogo from './GameLogo'
import TrBadge from './TrBadge'
import { GAMES } from '../context/GameContext'
import { normalizeGameId } from '../utils/gameUtils'
import { ligPath, ligBaslik } from '../utils/ligler'

const OYUN_SIRASI = ['lol', 'valorant', 'cs2']

/** [{ oyun, ligler }] — oyun sırası sabit, grup içinde Türk ligleri önce, sonra DB sırası. */
function ligleriGrupla(ligler) {
  const gruplar = new Map()
  ;(ligler || []).forEach((l, i) => {
    const oyun = normalizeGameId(l.oyun) || String(l.oyun || '')
    if (!gruplar.has(oyun)) gruplar.set(oyun, [])
    gruplar.get(oyun).push({ l, i })
  })
  const sira = o => { const i = OYUN_SIRASI.indexOf(o); return i < 0 ? 99 : i }
  return [...gruplar.entries()]
    .sort((a, b) => sira(a[0]) - sira(b[0]))
    .map(([oyun, liste]) => ({
      oyun,
      ligler: liste.sort((a, b) => (b.l.turk === true) - (a.l.turk === true) || a.i - b.i).map(x => x.l),
    }))
}

export default function LigSeridi({ ligler, aktifSlug = null }) {
  // null = yükleniyor: yer tutar (CLS); boş liste hiç çizilmez
  if (Array.isArray(ligler) && ligler.length === 0) return null
  const gruplar = ligleriGrupla(ligler)

  return (
    <nav aria-label="Lig sayfaları">
      <KapsulSerit Icon={Trophy} baslik="Lig sayfaları — tüm aşamalar tek yerde" ariaLabel="Lig sayfaları" minHeight={36}>
        {gruplar.map((g, gi) => {
          const oyun = GAMES.find(x => x.id === g.oyun)
          const renk = oyun?.color || 'var(--text-3)'
          return [
            gi > 0 && (
              <span key={`ayrac-${g.oyun}`} aria-hidden="true" style={{
                flexShrink: 0, width: 1, height: 22, margin: '0 5px', background: 'var(--line-2)',
              }} />
            ),
            ...g.ligler.map(l => {
              const aktif = l.slug === aktifSlug
              return (
                <Link
                  key={l.slug}
                  to={ligPath(l.slug)}
                  aria-current={aktif ? 'page' : undefined}
                  title={`${ligBaslik(l)} — ${oyun?.label || 'Espor'}`}
                  style={kapsulStili(aktif)}
                  {...kapsulHover(aktif)}
                >
                  <GameLogo game={g.oyun} size={13} color={renk} />
                  {ligBaslik(l)}
                  {l.turk && <TrBadge style={{ margin: 0, fontSize: 9 }} />}
                </Link>
              )
            }),
          ]
        })}
      </KapsulSerit>
    </nav>
  )
}
