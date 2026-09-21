import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CountUp } from '../components/AnimatedNumber'
import { supabase } from '../supabaseClient'
import SeoHead from '../components/SeoHead'
import InitialsImage from '../components/InitialsImage'
import { LIQUIPEDIA_SON_TARIH } from '../components/LiquipediaCredit'
import { Gamepad2, Trophy, Shield, User, CalendarDays, Target, CircleCheck, Plus, X, ArrowUp, ArrowDown, Search, ChevronDown } from 'lucide-react'
import { FEXT } from '../theme'

/**
 * Scout — VALORANT oyuncu karşılaştırma aracı (2026-09-13, eskiden bekleme listesi).
 *
 * Tek veri kaynağı `get_scout_players` RPC'si (backend/sql/get_scout_players.sql).
 * Eskiden sayfa player_match_stats'ten limit(1000) çekip tarayıcıda topluyordu;
 * tablo 7 bin satırı geçince oyuncu rakamları sessizce eksik çıkıyordu.
 *
 * ⚠️ VERİ SINIRLARI — arayüzde bunların ötesini vaat etme:
 *   • kill/ölüm/asist/galibiyet MAÇ toplamıdır; harita bazında KDA YOK.
 *   • ajan ve harita havuzu HARİTA bazında gerçektir (stats->'maps').
 *   • "/harita" oranları listelenen harita sayısına bölünür. PandaScore bazı Bo5'leri
 *     Bo3 diye etiketliyor ama harita başına ölüm (14,6) listenin doğru olduğunu
 *     gösterdi — number_of_games ile KIRPMA.
 *   • HS% ve impact skoru veritabanında boş/sıfır → gösterilmez.
 */

const ACCENT = FEXT.accent
const MAX_COMPARE = 3
const PAGE_SIZE = 25
const SMALL_SAMPLE = 10
const ACTIVE_DAYS = 90
const MIN_ACS_SAMPLES = 3

// VALORANT ajan sınıfları. Veritabanındaki 28 ajanın hepsi kapsanıyor (13 Eyl);
// yeni bir ajan gelirse "Diğer"e düşer, sayfa bozulmaz.
const AGENT_CLASS = {
  Jett: 'duelist', Phoenix: 'duelist', Reyna: 'duelist', Raze: 'duelist', Yoru: 'duelist',
  Neon: 'duelist', Iso: 'duelist', Waylay: 'duelist',
  Brimstone: 'controller', Viper: 'controller', Omen: 'controller', Astra: 'controller',
  Harbor: 'controller', Clove: 'controller',
  Sova: 'initiator', Breach: 'initiator', Skye: 'initiator', 'KAY/O': 'initiator',
  Fade: 'initiator', Gekko: 'initiator', Tejo: 'initiator',
  Killjoy: 'sentinel', Cypher: 'sentinel', Sage: 'sentinel', Chamber: 'sentinel',
  Deadlock: 'sentinel', Vyse: 'sentinel', Veto: 'sentinel',
}
// Renkler roleHelper.js ile aynı — sitenin geri kalanıyla tutarlı.
const CLASSES = [
  { key: 'duelist',    label: 'Duelist',    color: '#f87171' },
  { key: 'controller', label: 'Controller', color: '#2dd4bf' },
  { key: 'initiator',  label: 'Initiator',  color: '#fb923c' },
  { key: 'sentinel',   label: 'Sentinel',   color: '#a78bfa' },
]
const FLEX_ROLE = { key: 'flex', label: 'Esnek', color: '#94a3b8' }

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const f1 = n => (n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const f2 = n => (n == null ? '—' : n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const pct = n => (n == null ? '—' : `%${Math.round(n)}`)
const trDate = iso => (iso ? new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/* ── RPC satırından türetilmiş metrikler ── */
function derive(p) {
  const maps = Number(p.maps_played) || 0
  const classCounts = {}
  let classTotal = 0
  for (const [agent, n] of Object.entries(p.agents || {})) {
    const k = AGENT_CLASS[agent] || 'other'
    classCounts[k] = (classCounts[k] || 0) + n
    classTotal += n
  }
  // Birincil rol: haritaların yarısından fazlasında aynı sınıf. Değilse "Esnek".
  let role = FLEX_ROLE
  for (const c of CLASSES) {
    if (classTotal > 0 && (classCounts[c.key] || 0) / classTotal > 0.5) role = c
  }
  const lastMs = p.last_played ? new Date(p.last_played).getTime() : 0
  return {
    ...p,
    kd: p.deaths > 0 ? p.kills / p.deaths : null,
    kpm: maps > 0 ? p.kills / maps : null,
    dpm: maps > 0 ? p.deaths / maps : null,
    apm: maps > 0 ? p.assists / maps : null,
    win: p.decided > 0 ? (100 * p.wins) / p.decided : null,
    // Son 5, oyuncunun tüm maçlarıyla aynıysa "form" bilgisi taşımaz.
    r5kd: p.matches > 5 && p.r5_deaths > 0 ? p.r5_kills / p.r5_deaths : null,
    acs: p.acs_n >= MIN_ACS_SAMPLES ? Number(p.acs_avg) : null,
    classCounts, classTotal, role,
    active: lastMs > 0 && Date.now() - lastMs <= ACTIVE_DAYS * 864e5,
  }
}

/* ── Küçük parçalar ── */
function Avatar({ p, size = 36 }) {
  return (
    <InitialsImage
      src={p.image_url} name={p.nickname}
      width={size} height={size} borderRadius={Math.round(size / 4)} objectFit="cover"
      style={{ border: '1px solid var(--line)', flexShrink: 0 }}
    />
  )
}

function RoleChip({ role }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700,
      color: role.color, background: `${role.color}1f`, border: `1px solid ${role.color}55`,
      borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      {role.label}
    </span>
  )
}

function RoleBar({ p }) {
  if (!p.classTotal) return <span style={{ color: 'var(--text-5)' }}>—</span>
  const parts = CLASSES
    .map(c => ({ ...c, n: p.classCounts[c.key] || 0 }))
    .filter(c => c.n > 0)
    .sort((a, b) => b.n - a.n)
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--hover)' }} aria-hidden="true">
        {parts.map(c => (
          <div key={c.key} style={{ width: `${(100 * c.n) / p.classTotal}%`, background: c.color }} />
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
        {parts.slice(0, 2).map((c, i) => (
          <span key={c.key}>
            {i > 0 && ' · '}
            <span style={{ color: c.color, fontWeight: 700 }}>{c.label}</span> %{Math.round((100 * c.n) / p.classTotal)}
          </span>
        ))}
      </div>
    </div>
  )
}

function TopList({ obj, limit = 3 }) {
  const entries = Object.entries(obj || {}).slice(0, limit)  // RPC zaten çoktan aza sıralı
  if (!entries.length) return <span style={{ color: 'var(--text-5)' }}>—</span>
  return (
    <div style={{ display: 'grid', gap: 3, fontSize: 12.5 }}>
      {entries.map(([name, n]) => (
        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ color: 'var(--text-2)' }}>{name}</span>
          <span style={{ color: 'var(--text-4)', fontVariantNumeric: 'tabular-nums' }}>{n} harita</span>
        </div>
      ))}
    </div>
  )
}

function FormValue({ p }) {
  if (p.r5kd == null) return <span style={{ color: 'var(--text-5)' }}>—</span>
  const diff = p.kd != null ? p.r5kd - p.kd : 0
  const Icon = diff >= 0.05 ? ArrowUp : diff <= -0.05 ? ArrowDown : null
  const color = diff >= 0.05 ? '#46B658' : diff <= -0.05 ? '#ff6b7a' : 'var(--text-4)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {f2(p.r5kd)}
      {Icon && <Icon size={13} color={color} aria-label={diff > 0 ? 'genel ortalamanın üstünde' : 'genel ortalamanın altında'} />}
    </span>
  )
}

/* ── Oyuncu arama kutusu ── */
function PlayerPicker({ players, excluded, onPick }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const results = useMemo(() => {
    const s = norm(q.trim())
    if (!s) return []
    return players
      .filter(p => !excluded.has(p.id))
      .map(p => {
        const nick = norm(p.nickname)
        const score = nick.startsWith(s) ? 0 : nick.includes(s) ? 1
          : norm(p.team_name).includes(s) || norm(p.real_name).includes(s) ? 2 : -1
        return { p, score }
      })
      .filter(x => x.score >= 0)
      .sort((a, b) => a.score - b.score || b.p.matches - a.p.matches)
      .slice(0, 8)
      .map(x => x.p)
  }, [q, players, excluded])

  function pick(p) {
    onPick(p.id)
    setQ(''); setOpen(false); setActive(0)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={15} color="var(--text-4)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          type="search" value={q}
          placeholder="Oyuncu veya takım ara…"
          aria-label="Karşılaştırmaya oyuncu ekle"
          role="combobox" aria-expanded={open && results.length > 0} aria-controls="scout-picker-list"
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }}
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--surface-2)', border: '1px solid var(--line)',
            borderRadius: 10, color: 'var(--text-1)', padding: '10px 12px 10px 34px', fontSize: 14,
          }}
        />
      </div>
      {open && results.length > 0 && (
        <ul id="scout-picker-list" role="listbox" style={{
          position: 'absolute', zIndex: 20, left: 0, right: 0, top: 'calc(100% + 4px)', margin: 0, padding: 4,
          listStyle: 'none', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: '0 12px 30px rgba(0,0,0,.35)', maxHeight: 320, overflowY: 'auto',
        }}>
          {results.map((p, i) => (
            <li
              key={p.id} role="option" aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); pick(p) }}
              onMouseEnter={() => setActive(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
                background: i === active ? 'var(--hover)' : 'transparent',
              }}
            >
              <Avatar p={p} size={28} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>{p.nickname}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.team_name || 'Takımsız'} · {p.matches} maç
                </div>
              </div>
              <RoleChip role={p.role} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── Karşılaştırma tablosu ── */
// best: hangi yön daha iyi. Maç/harita sayısı "iyi" değil örneklem → vurgulanmaz.
// prec: ekranda gösterilen ondalık. Vurgu bu yuvarlanmış değerle yapılır; yoksa ikisi de
// "1,19" görünen oyunculardan yalnız biri (1,186 vs 1,194) keyfi biçimde vurgulanıyordu.
const COMPARE_ROWS = [
  { label: 'Rol (ajan havuzundan)', render: p => <RoleBar p={p} /> },
  { label: 'Maç / harita', render: p => (
      <span>
        {p.matches} maç · {p.maps_played} harita
        {p.matches < SMALL_SAMPLE && <span style={{ display: 'block', fontSize: 11, color: '#e0a030' }}>Az örneklem</span>}
      </span>
    ) },
  { label: 'K/D', value: p => p.kd, fmt: f2, best: 'max', prec: 2 },
  { label: 'Kill / harita', value: p => p.kpm, fmt: f1, best: 'max', prec: 1 },
  { label: 'Ölüm / harita', value: p => p.dpm, fmt: f1, best: 'min', prec: 1 },
  { label: 'Asist / harita', value: p => p.apm, fmt: f1, best: 'max', prec: 1 },
  { label: 'Galibiyet', value: p => p.win, fmt: pct, best: 'max', prec: 0 },
  { label: 'Son 5 maç K/D', value: p => p.r5kd, render: p => <FormValue p={p} />, best: 'max', prec: 2 },
  { label: 'Ort. ACS', value: p => p.acs, fmt: n => (n == null ? '—' : String(Math.round(n))), best: 'max', prec: 0 },
  { label: 'En çok oynadığı ajanlar', render: p => <TopList obj={p.agents} /> },
  { label: 'En çok oynadığı haritalar', render: p => <TopList obj={p.maps} /> },
  { label: 'Son maç', render: p => trDate(p.last_played) },
]

const roundTo = (v, prec) => (v == null ? null : Math.round(v * 10 ** prec) / 10 ** prec)

function CompareTable({ selected, onRemove }) {
  const bests = COMPARE_ROWS.map(row => {
    if (!row.best || selected.length < 2) return null
    const vals = selected.map(p => roundTo(row.value(p), row.prec)).filter(v => v != null)
    if (vals.length < 2) return null
    return row.best === 'max' ? Math.max(...vals) : Math.min(...vals)
  })
  const cell = { padding: '11px 12px', borderTop: '1px solid var(--line)', verticalAlign: 'top', fontSize: 14, color: 'var(--text-1)' }
  const labelCell = {
    ...cell, position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface)',
    fontSize: 12, color: 'var(--text-3)', fontWeight: 600, minWidth: 120, maxWidth: 150,
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr>
            <th style={{ ...labelCell, borderTop: 'none' }} scope="col"><span className="sr-only">Metrik</span></th>
            {selected.map(p => (
              <th key={p.id} scope="col" style={{ padding: '14px 12px', textAlign: 'left', minWidth: 170, verticalAlign: 'top' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <Avatar p={p} size={40} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Link to={`/player/${p.id}`} style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', textDecoration: 'none' }}>
                      {p.nickname}
                    </Link>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-4)', marginTop: 2 }}>
                      {p.team_id
                        ? <Link to={`/team/${p.team_id}`} style={{ color: 'var(--text-4)' }}>{p.team_name}</Link>
                        : 'Takımsız'}
                    </div>
                  </div>
                  <button
                    type="button" onClick={() => onRemove(p.id)} aria-label={`${p.nickname} karşılaştırmadan çıkar`}
                    style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: 7, color: 'var(--text-4)', cursor: 'pointer', padding: 3, display: 'flex' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row, ri) => (
            <tr key={row.label}>
              <th scope="row" style={{ ...labelCell, textAlign: 'left' }}>{row.label}</th>
              {selected.map(p => {
                const v = row.value ? row.value(p) : null
                const isBest = bests[ri] != null && v != null && roundTo(v, row.prec) === bests[ri]
                return (
                  <td key={p.id} style={{
                    ...cell,
                    fontWeight: isBest ? 800 : 500,
                    color: isBest ? 'var(--accent-fg)' : cell.color,
                    background: isBest ? FEXT.accentSoftBg : 'transparent',
                  }}>
                    {row.render ? row.render(p) : row.fmt(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Keşif tablosu: tüm oyuncular, filtre + sıralama ── */
const SORTS = [
  { key: 'kd',      label: 'K/D',          value: p => p.kd },
  { key: 'kpm',     label: 'Kill/harita',  value: p => p.kpm },
  { key: 'win',     label: 'Galibiyet',    value: p => p.win },
  { key: 'r5kd',    label: 'Son 5 K/D',    value: p => p.r5kd },
  { key: 'matches', label: 'Maç',          value: p => p.matches },
]

function Explorer({ players, selectedIds, onAdd, full }) {
  const [q, setQ] = useState('')
  const [role, setRole] = useState('all')
  const [minMatches, setMinMatches] = useState(SMALL_SAMPLE)
  const [activeOnly, setActiveOnly] = useState(false)
  const [sort, setSort] = useState('kd')
  // Filtre değişince sayfalama başa döner: sayaç, hangi filtre için tutulduğunu bilir.
  const [page, setPage] = useState({ sig: '', n: PAGE_SIZE })

  const rows = useMemo(() => {
    const s = norm(q.trim())
    const sv = SORTS.find(x => x.key === sort).value
    return players
      .filter(p => p.matches >= minMatches)
      .filter(p => !activeOnly || p.active)
      .filter(p => role === 'all' || p.role.key === role)
      .filter(p => !s || norm(p.nickname).includes(s) || norm(p.team_name).includes(s))
      .sort((a, b) => (sv(b) ?? -Infinity) - (sv(a) ?? -Infinity))
  }, [players, q, role, minMatches, activeOnly, sort])

  const sig = [q, role, minMatches, activeOnly, sort].join('|')
  const shown = page.sig === sig ? page.n : PAGE_SIZE

  const chip = on => ({
    fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
    border: `1px solid ${on ? FEXT.accentBorder : 'var(--line)'}`,
    background: on ? FEXT.accentSoftBg : 'transparent',
    color: on ? 'var(--accent-fg)' : 'var(--text-3)',
  })
  const th = { padding: '10px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '.5px', textAlign: 'right', whiteSpace: 'nowrap' }
  const td = { padding: '10px 12px', borderTop: '1px solid var(--line)', fontSize: 13.5, textAlign: 'right', color: 'var(--text-2)' }

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Tüm oyuncular</h2>
        <span style={{ fontSize: 12.5, color: 'var(--text-4)' }}>{rows.length} oyuncu listeleniyor</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {[{ key: 'all', label: 'Tüm roller' }, ...CLASSES, FLEX_ROLE].map(r => (
          <button key={r.key} type="button" onClick={() => setRole(r.key)} style={chip(role === r.key)} aria-pressed={role === r.key}>
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input
          type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Listede ara…" aria-label="Oyuncu listesinde ara"
          style={{ flex: '1 1 200px', minWidth: 0, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 9, color: 'var(--text-1)', padding: '8px 11px', fontSize: 13.5 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-3)' }}>
          En az
          <select value={minMatches} onChange={e => setMinMatches(Number(e.target.value))}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text-1)', padding: '7px 8px', fontSize: 13 }}>
            {[3, 10, 20, 40].map(n => <option key={n} value={n}>{n} maç</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
          Son {ACTIVE_DAYS} günde oynayanlar
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-3)' }}>
          Sırala
          <select value={sort} onChange={e => setSort(e.target.value)}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text-1)', padding: '7px 8px', fontSize: 13 }}>
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface)' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }} scope="col">#</th>
              <th style={{ ...th, textAlign: 'left' }} scope="col">Oyuncu</th>
              <th style={{ ...th, textAlign: 'left' }} scope="col">Rol</th>
              {SORTS.map(s => (
                <th key={s.key} scope="col" style={{ ...th, color: sort === s.key ? 'var(--accent-fg)' : th.color }}
                  aria-sort={sort === s.key ? 'descending' : 'none'}>
                  <button type="button" onClick={() => setSort(s.key)}
                    style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {s.label}{sort === s.key && <ChevronDown size={12} />}
                  </button>
                </th>
              ))}
              <th style={th} scope="col"><span className="sr-only">Karşılaştır</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((p, i) => {
              const isSel = selectedIds.includes(p.id)
              return (
                <tr key={p.id}>
                  <td style={{ ...td, textAlign: 'left', color: 'var(--text-5)', width: 28 }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <Avatar p={p} size={30} />
                      <div style={{ minWidth: 0 }}>
                        <Link to={`/player/${p.id}`} style={{ fontWeight: 700, color: 'var(--text-1)', textDecoration: 'none' }}>{p.nickname}</Link>
                        <div style={{ fontSize: 11.5, color: 'var(--text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}>
                          {p.team_name || 'Takımsız'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'left' }}><RoleChip role={p.role} /></td>
                  <td style={{ ...td, color: sort === 'kd' ? 'var(--text-1)' : td.color, fontWeight: sort === 'kd' ? 700 : 500 }}>{f2(p.kd)}</td>
                  <td style={{ ...td, color: sort === 'kpm' ? 'var(--text-1)' : td.color, fontWeight: sort === 'kpm' ? 700 : 500 }}>{f1(p.kpm)}</td>
                  <td style={{ ...td, color: sort === 'win' ? 'var(--text-1)' : td.color, fontWeight: sort === 'win' ? 700 : 500 }}>{pct(p.win)}</td>
                  <td style={{ ...td, color: sort === 'r5kd' ? 'var(--text-1)' : td.color, fontWeight: sort === 'r5kd' ? 700 : 500 }}><FormValue p={p} /></td>
                  <td style={{ ...td, color: sort === 'matches' ? 'var(--text-1)' : td.color, fontWeight: sort === 'matches' ? 700 : 500 }}>{p.matches}</td>
                  <td style={{ ...td, width: 1 }}>
                    <button
                      type="button" disabled={isSel || full} onClick={() => onAdd(p.id)}
                      aria-label={isSel ? `${p.nickname} seçildi` : `${p.nickname} karşılaştırmaya ekle`}
                      title={full && !isSel ? `En fazla ${MAX_COMPARE} oyuncu karşılaştırılabilir` : undefined}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
                        fontSize: 12, fontWeight: 700, borderRadius: 8, padding: '5px 9px',
                        border: `1px solid ${isSel ? FEXT.accentBorder : 'var(--line)'}`,
                        background: isSel ? FEXT.accentSoftBg : 'transparent',
                        color: isSel ? 'var(--accent-fg)' : 'var(--text-2)',
                        cursor: isSel || full ? 'default' : 'pointer', opacity: full && !isSel ? 0.45 : 1,
                      }}
                    >
                      {isSel ? <><CircleCheck size={13} /> Seçildi</> : <><Plus size={13} /> Karşılaştır</>}
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, textAlign: 'center', padding: 28, color: 'var(--text-4)' }}>
                Bu filtrelerle eşleşen oyuncu yok. Maç eşiğini düşürmeyi dene.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <button type="button" onClick={() => setPage({ sig, n: shown + PAGE_SIZE })}
          style={{ justifySelf: 'center', background: 'transparent', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text-2)', fontWeight: 700, fontSize: 13.5, padding: '9px 18px', cursor: 'pointer' }}>
          {Math.min(PAGE_SIZE, rows.length - shown)} oyuncu daha göster
        </button>
      )}
    </section>
  )
}

/* ── Sayıyı dürüst eşiğe yuvarla ("+" ile) — asla abartmaz ── */
// Yuvarlanmış SAYIYI döndürür (metni değil) — <CountUp /> sayı ister.
function floorTo(n, step) {
  if (!n || n < step) return null
  return Math.floor(n / step) * step
}
const artiBicim = n => `${n.toLocaleString('tr-TR')}+`

/* ── Canlı arşiv-derinliği kanıt şeridi (gerçek DB sayıları) ──
   depth: null = yükleniyor (skeleton) · false = hata (gizle) · obj = veri. */
// ⚠️ ETİKETLER ARŞİV sayılarını anlatır, scouting DERİNLİĞİNİ değil (2026-09-09).
const DEPTH_LABELS = ['Arşivdeki maç', 'Turnuva', 'Takım profili', 'Oyuncu profili', 'Veri derinliği', 'Fextopus emin katman']

function DepthStrip({ depth }) {
  if (depth === false) return null
  const loading = depth == null

  const tiles = loading ? [] : [
    { Icon: Gamepad2,     num: floorTo(depth.matches, 1000),     format: artiBicim, label: 'Arşivdeki maç' },
    { Icon: Trophy,       num: floorTo(depth.tournaments, 100),  format: artiBicim, label: 'Turnuva' },
    { Icon: Shield,       num: floorTo(depth.teams, 100),        format: artiBicim, label: 'Takım profili' },
    { Icon: User,         num: floorTo(depth.players, 100),      format: artiBicim, label: 'Oyuncu profili' },
    // Yıl BİLEREK sayılmıyor: tarihi bir değeri sayaç gibi göstermek anlamsız.
    { Icon: CalendarDays, value: depth.earliestYear ? `${depth.earliestYear}→` : null, label: 'Veri derinliği' },
    { Icon: Target,       num: depth.confidentPct != null ? Math.round(depth.confidentPct) : null,
                          format: n => `%${n}`, label: 'Fextopus emin katman' },
  ].filter(t => t.num != null || t.value)

  if (!loading && tiles.length === 0) return null

  const tileBox = {
    background: 'linear-gradient(160deg, rgba(194,92,208,.06), var(--surface))',
    border: '1px solid rgba(194,92,208,.16)', borderRadius: 13, padding: '13px 12px', textAlign: 'center',
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        {loading
          ? DEPTH_LABELS.map((lbl, i) => (
              <div key={i} style={{ ...tileBox, animation: 'scoutPulse 1.6s ease-in-out infinite' }} className="scout-pulse">
                <div style={{ height: 15, marginBottom: 5 }} />
                <div style={{ height: 22, width: '62%', margin: '0 auto', borderRadius: 6, background: 'rgba(194,92,208,.10)' }} />
                <div style={{ fontSize: 10, color: 'var(--text-5)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>{lbl}</div>
              </div>
            ))
          : tiles.map(t => (
              <div key={t.label} style={tileBox}>
                <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center', opacity: .85 }}>{t.Icon && <t.Icon size={18} color={ACCENT} />}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {t.num != null ? <CountUp value={t.num} format={t.format} /> : t.value}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 6 }}>{t.label}</div>
              </div>
            ))}
      </div>
      {!loading && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.6 }}>
          "Emin katman", Fextopus'un bir takıma %70+ şans verdiği maçlardır — genel
          isabet oranı bundan düşüktür.{' '}
          <Link to="/stats" style={{ color: 'var(--accent-fg)', fontWeight: 700 }}>
            Tüm katmanların kırılımını gör →
          </Link>
        </div>
      )}
    </div>
  )
}

export default function ScoutEnginePage() {
  const [players, setPlayers] = useState(null)   // null = yükleniyor · [] = veri yok/hata
  const [loadError, setLoadError] = useState(false)
  const [depth, setDepth] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState('')
  const [role, setRole] = useState('agency')
  const [status, setStatus] = useState('idle')  // idle | sending | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc('get_scout_players', { p_min_matches: 3 })
      if (cancelled) return
      if (error || !Array.isArray(data)) {
        console.error('get_scout_players:', error?.message || error)
        setLoadError(true); setPlayers([])
        return
      }
      setPlayers(data.map(derive))
    })()
    return () => { cancelled = true }
  }, [])

  // Canlı arşiv derinliği — gerçek DB sayıları (B2B güven sinyali)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // count: 'estimated' — tam sayım 37 bin satırda zaman aşımına düşüyordu (2026-09-09).
        const countOf = (table) => supabase.from(table).select('*', { count: 'estimated', head: true })
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
        const hasAny = next.matches || next.tournaments || next.teams || next.players || next.earliestYear
        setDepth(hasAny ? next : false)
      } catch {
        if (!cancelled) setDepth(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Seçim URL'de tutulur (?p=id,id) → karşılaştırma link olarak paylaşılabilir.
  const byId = useMemo(() => new Map((players || []).map(p => [p.id, p])), [players])
  const selectedIds = useMemo(() => {
    const raw = (searchParams.get('p') || '').split(',').filter(Boolean)
    const uniq = [...new Set(raw)]
    return players ? uniq.filter(id => byId.has(id)).slice(0, MAX_COMPARE) : uniq.slice(0, MAX_COMPARE)
  }, [searchParams, players, byId])
  const selected = selectedIds.map(id => byId.get(id)).filter(Boolean)
  const excluded = useMemo(() => new Set(selectedIds), [selectedIds])
  const full = selectedIds.length >= MAX_COMPARE

  function writeSelection(ids) {
    const next = new URLSearchParams(searchParams)
    if (ids.length) next.set('p', ids.join(','))
    else next.delete('p')
    setSearchParams(next, { replace: true })
  }
  const addPlayer = id => { if (!excluded.has(id) && !full) writeSelection([...selectedIds, id]) }
  const removePlayer = id => writeSelection(selectedIds.filter(x => x !== id))

  // Hızlı başlangıç: aynı takımdan en çok maçı olan 3 oyuncu. Yalnız ≥2 oyuncusu olan takımlar.
  const teamOptions = useMemo(() => {
    const groups = new Map()
    for (const p of players || []) {
      if (!p.team_id || !p.active) continue
      if (!groups.has(p.team_id)) groups.set(p.team_id, { id: p.team_id, name: p.team_name, list: [] })
      groups.get(p.team_id).list.push(p)
    }
    return [...groups.values()]
      .filter(g => g.list.length >= 2)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'))
  }, [players])

  function compareTeam(teamId) {
    const g = teamOptions.find(t => String(t.id) === String(teamId))
    if (!g) return
    writeSelection([...g.list].sort((a, b) => b.matches - a.matches).slice(0, MAX_COMPARE).map(p => p.id))
  }

  const totals = useMemo(() => {
    if (!players?.length) return null
    return {
      players: players.length,
      maps: players.reduce((s, p) => s + (Number(p.maps_played) || 0), 0),
    }
  }, [players])

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
        ? 'Zaten listedesin. Yeni bir şey çıktığında ilk sen haberdar olacaksın.'
        : 'Kaydın alındı. Seninle e-posta üzerinden iletişime geçeceğiz.')
      setStatus('done')
      setEmail(''); setOrg('')
    } catch (err) {
      setErrorMsg('Kayıt alınamadı. Lütfen daha sonra tekrar dene.')
      setStatus('error')
      console.error('scout_waitlist insert:', err?.message || err)
    }
  }

  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text-1)', padding: '11px 13px', fontSize: 14 }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-1)' }}>
      <SeoHead
        title="Scout — VALORANT Oyuncu Karşılaştırma"
        description="Profesyonel VALORANT oyuncularını yan yana karşılaştır: K/D, harita başına kill, galibiyet oranı, son 5 maç formu, ajan ve harita havuzu."
        type="website"
      />
      <style>{`
        @keyframes scoutPulse{0%,100%{opacity:1}50%{opacity:.45}}
        .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        @media (prefers-reduced-motion: reduce){.scout-pulse{animation:none!important}}
      `}</style>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 16px 60px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 28 }}>

        {/* Başlık */}
        <header style={{ display: 'grid', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--accent-fg)' }}>
            Scout · VALORANT
          </span>
          <h1 style={{ margin: 0, fontSize: 'clamp(28px, 5vw, 38px)', lineHeight: 1.1, fontWeight: 900, textWrap: 'balance' }}>
            Oyuncu karşılaştırma
          </h1>
          <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.65, color: 'var(--text-2)', maxWidth: 680 }}>
            {totals
              ? <>En az 3 maç verisi olan <b style={{ color: 'var(--text-1)' }}>{totals.players} profesyonel oyuncu</b>, {totals.maps.toLocaleString('tr-TR')} harita kaydı. </>
              : 'Profesyonel VALORANT oyuncularının maç ve harita verisi. '}
            En fazla {MAX_COMPARE} oyuncu seç, yan yana gör. Seçimin adres çubuğunda saklanır; linki paylaşabilirsin.
          </p>
        </header>

        {/* Karşılaştırma */}
        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }} aria-label="Karşılaştırma">
          {players === null ? (
            <div style={{ height: 220, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', animation: 'scoutPulse 1.6s ease-in-out infinite' }} className="scout-pulse" />
          ) : loadError ? (
            <div style={{ borderRadius: 14, border: '1px solid var(--line)', background: 'var(--surface)', padding: 20, color: 'var(--text-3)', fontSize: 14 }}>
              Oyuncu verisi şu an yüklenemedi. Sayfayı yenilemeyi dene; sorun sürerse iletisim@fextesports.com adresine yaz.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  {full
                    ? <div style={{ fontSize: 13, color: 'var(--text-4)', padding: '10px 2px' }}>
                        {MAX_COMPARE} oyuncu seçili. Yeni oyuncu eklemek için birini çıkar.
                      </div>
                    : <PlayerPicker players={players} excluded={excluded} onPick={addPlayer} />}
                </div>
                {teamOptions.length > 0 && (
                  <select
                    value="" onChange={e => compareTeam(e.target.value)} aria-label="Bir takımın oyuncularını karşılaştır"
                    style={{ ...inputStyle, padding: '10px 12px', flex: '0 1 240px', minWidth: 0 }}
                  >
                    <option value="">Takım kadrosunu karşılaştır…</option>
                    {teamOptions.map(t => <option key={t.id} value={t.id}>{t.name} ({t.list.length})</option>)}
                  </select>
                )}
                {selected.length > 0 && (
                  <button type="button" onClick={() => writeSelection([])}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-4)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>
                    Seçimi temizle
                  </button>
                )}
              </div>

              {selected.length > 0 ? (
                <CompareTable selected={selected} onRemove={removePlayer} />
              ) : (
                <div style={{ borderRadius: 14, border: '1px dashed var(--line)', padding: '26px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14, lineHeight: 1.6 }}>
                  Yukarıdan bir oyuncu ara ya da aşağıdaki listede <b style={{ color: 'var(--text-2)' }}>Karşılaştır</b>'a bas.
                </div>
              )}

              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-4)', lineHeight: 1.7, maxWidth: 820 }}>
                Kill, ölüm, asist ve galibiyet maç toplamlarından hesaplanır; "/harita" değerleri bu toplamların
                oynanan harita sayısına bölümüdür. Rol, ajan ve harita havuzu harita bazındadır. Galibiyet oranı
                oyuncunun takımının başarısını da yansıtır. ACS yalnız en az {MIN_ACS_SAMPLES} maçlık veri olduğunda gösterilir.
                {' '}Oyuncu verisi: <a href="https://liquipedia.net/valorant" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-3)' }}>Liquipedia</a>, {LIQUIPEDIA_SON_TARIH} tarihine kadar oynanan maçlar.
              </p>
            </>
          )}
        </section>

        {players?.length > 0 && (
          <Explorer players={players} selectedIds={selectedIds} onAdd={addPlayer} full={full} />
        )}

        {/* Ajanslar ve takımlar */}
        <section id="waitlist" style={{
          borderRadius: 18, border: `1px solid ${ACCENT}33`, padding: 24, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 18,
          background: 'linear-gradient(160deg, rgba(194,92,208,.07), var(--surface))',
        }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>Ajans veya takım mısın?</h2>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)', maxWidth: 620, lineHeight: 1.65 }}>
              Bu araç şu an VALORANT ile sınırlı. Scouting sürecinde neye ihtiyaç duyduğunu yaz,
              geliştirmeyi ihtiyaca göre yönlendirelim.
            </p>
          </div>

          <DepthStrip depth={depth} />

          {status === 'done' ? (
            <div style={{ border: '1px solid rgba(70,182,88,.4)', background: 'rgba(70,182,88,.12)', color: '#3d9950', borderRadius: 12, padding: '14px 16px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CircleCheck size={16} /> {doneMsg}
            </div>
          ) : (
            <form onSubmit={submitWaitlist} style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
              <input
                type="email" value={email} onChange={e => { setEmail(e.target.value); if (status === 'error') setStatus('idle') }}
                placeholder="E-posta adresin *" aria-label="E-posta adresin" style={inputStyle}
              />
              <input
                type="text" value={org} onChange={e => setOrg(e.target.value)}
                placeholder="Organizasyon / takım (opsiyonel)" aria-label="Organizasyon veya takım" style={inputStyle}
              />
              <select value={role} onChange={e => setRole(e.target.value)} aria-label="Rolün" style={inputStyle}>
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
                {status === 'sending' ? 'Gönderiliyor…' : 'İletişime geçin'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>Spam yok. Yalnız bu konuda yazarız.</span>
            </form>
          )}
        </section>

      </div>
    </div>
  )
}
