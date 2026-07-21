import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import InitialsImage from './InitialsImage'
import { normalizeGameId } from '../utils/gameUtils'

const GAME_SHORT = { valorant: 'VAL', cs2: 'CS2', lol: 'LOL', dota2: 'DOTA2' }
const GAME_COLOR = { valorant: '#FF4655', cs2: '#F0A500', lol: '#C89B3C', dota2: '#9d2226' }

// Oyun etiketi — aynı isimli takımlar farklı oyunlarda olabildiği için (karışmasın).
function GameTag({ team }) {
  const g = normalizeGameId(team?.game?.slug ?? team?.game?.name)
  if (!g) return null
  const color = GAME_COLOR[g] || 'var(--text-3)'
  return (
    <span style={{ fontSize: 9, fontWeight: 800, color, background: `${color}1f`, border: `1px solid ${color}55`, borderRadius: 5, padding: '2px 6px', flexShrink: 0, letterSpacing: '.3px' }}>
      {GAME_SHORT[g] || g.toUpperCase()}
    </span>
  )
}

/**
 * Favori takım seçici — aranabilir (2569 takım, dropdown uygun değil).
 * Kullanıcı yazar → Supabase teams ilike → seçer. value = team_id.
 * onChange(teamId | null, team | null). Sonuçlarda oyun etiketi gösterilir.
 */
export default function TeamPicker({ value, onChange, placeholder = 'Favori takımını ara (opsiyonel)' }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)

  // Seçili takımı value'dan yükle (dışarıdan set edilirse)
  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (selected?.id === value) return
    let alive = true
    supabase.from('teams').select('id,name,logo_url,game:games(id,name,slug)').eq('id', value).maybeSingle()
      .then(({ data }) => { if (alive && data) setSelected(data) })
    return () => { alive = false }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setResults([]); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const q = query.trim()
      const { data } = await supabase
        .from('teams')
        .select('id,name,acronym,logo_url,game:games(id,name,slug)')
        .or(`name.ilike.%${q}%,acronym.ilike.%${q}%`)
        .order('name', { ascending: true })
        .limit(8)
      setResults(data || [])
      setOpen(true)
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  function pick(team) {
    setSelected(team)
    setQuery('')
    setResults([])
    setOpen(false)
    onChange?.(team.id, team)
  }

  function clear() {
    setSelected(null)
    onChange?.(null, null)
  }

  const inputStyle = { background: 'var(--surface)', border: '1px solid var(--line-2)', color: 'var(--text)', borderRadius: 11, padding: '11px 12px', width: '100%', boxSizing: 'border-box' }

  if (selected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 11, padding: '8px 12px' }}>
        <InitialsImage src={selected.logo_url} name={selected.name} width={26} height={26} borderRadius={6} objectFit="contain" />
        <span style={{ flex: 1, color: 'var(--text)', fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</span>
        <GameTag team={selected} />
        <button type="button" onClick={clear} style={{ background: 'transparent', border: '1px solid var(--line-2)', color: 'var(--text-3)', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>Değiştir</button>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        style={inputStyle}
      />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 11, overflow: 'hidden', maxHeight: 260, overflowY: 'auto', boxShadow: '0 12px 28px rgba(0,0,0,.55)' }}>
          {results.map(team => (
            <button
              key={team.id}
              type="button"
              onClick={() => pick(team)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', color: 'var(--text-1)', padding: '9px 12px', cursor: 'pointer', fontSize: 14 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <InitialsImage src={team.logo_url} name={team.name} width={22} height={22} borderRadius={5} objectFit="contain" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</span>
              <GameTag team={team} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
