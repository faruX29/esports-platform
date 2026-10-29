/**
 * bracketModel.js — turnuva aşamasının eleme ağacı modeli (saf JS, React yok).
 *
 * Kaynak: maçın `round_info`'su (PandaScore maç adının ":"den önceki kısmı, ör.
 * "Upper Bracket Quarterfinal 3", "Lower Bracket Round 1 Match 2", "Grand Final").
 * PandaScore maçlar arası bağlantı (önceki/sonraki maç) vermiyor; bağlantılar
 * TAKIMDAN çıkarılır: bir maçın kazananı aynı ayağın sonraki sütununda oynuyorsa
 * o iki maç bağlıdır. Doğrulanamayan bağlantı çizilmez.
 *
 * Kural: yanlış ağaç göstermektense liste. Etiket tanınmazsa, bir takım aynı
 * sütunda iki kez görünürse, sütun sırası zamanla çelişirse ya da elenen takım
 * aynı ayakta yeniden oynarsa model `ok: false` döner ve sayfa listeye düşer.
 *
 * 29 Ekim'de canlı veride bulunan eski hatalar (bu modül bunları önler):
 *  - "Lower Bracket Round 3" "Alt Ayak Yarı Final" sütununa, "Lower Bracket
 *    Quarterfinal" "Alt Ayak Tur 2"ye yazılıyordu; çakışan maçlar "tekrar" sanılıp
 *    sessizce siliniyordu (16 takımlık çift elemelerde alt ayaktan 4-6 maç kayıp).
 *  - Çeyrek finallerden önceki "Round 1" etiketi tanınmıyor, maçlar "Çeyrek Final"
 *    sütununa yığılıyordu.
 *  - Bitmemiş aşamada sabit sayılarla "TBD" kutuları ekleniyordu (alt ayak tur 1 = 2
 *    gibi); 4 maçlık turlarda yanlış, olmayan maçlar varmış gibi görünüyordu.
 */
import { deriveWinnerTeamId } from './matchResult'

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[_]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const POW2 = new Set([8, 16, 32, 64, 128])

/**
 * round_info → { side, stage, n, slot } ya da null.
 *  side : 'upper' | 'lower' | 'mid' | null (tek eleme ya da ayaksız)
 *  stage: 'round' (n. tur) | 'ro' (son n) | 'qf' | 'sf' | 'final' | 'gf' | 'third'
 *         | 'gsl-opening' | 'gsl-winners' | 'gsl-elim' | 'gsl-decider' | 'vs'
 *         | 'group' | 'week' | 'swiss' | 'tiebreaker' | 'qualification' | 'seeding'
 *  slot : sütundaki maç numarası ("Quarterfinal 3" → 3), yoksa null
 */
export function parseRoundInfo(text) {
  const s = norm(text)
  if (!s) return null

  if (/\b(3rd|third)[\s-]*place|\bbronze\b/.test(s)) return { side: null, stage: 'third' }
  if (/\bgrand[\s-]*finals?\b/.test(s)) return { side: null, stage: 'gf' }

  // GSL grubu (4 takım): açılış → kazananlar / elenme → decider
  if (/^winners? ?match\b/.test(s)) return { side: 'upper', stage: 'gsl-winners' }
  if (/^elimination match\b/.test(s)) return { side: 'lower', stage: 'gsl-elim' }
  if (/^dec(?:ider|iedr) match\b/.test(s)) return { side: 'lower', stage: 'gsl-decider' }
  const op = s.match(/^opening match(?: (\d+))?$/)
  if (op) return { side: 'upper', stage: 'gsl-opening', slot: op[1] ? Number(op[1]) : null }
  // PandaScore etiketsiz maça takım kodlarını yazıyor ("ROSS vs BIG")
  if (/^\S+ vs \S+$/.test(s)) return { side: null, stage: 'vs' }

  if (/^group\b/.test(s)) return { side: null, stage: 'group' }
  if (/\bswiss\b/.test(s)) return { side: null, stage: 'swiss' }
  const wk = s.match(/^(?:game ?)?week (\d+)$/)
  if (wk) return { side: null, stage: 'week', n: Number(wk[1]) }
  if (/^tie[\s-]*breaker/.test(s)) return { side: null, stage: 'tiebreaker' }
  const ql = s.match(/^qualification match(?: (\d+))?$/)
  if (ql) return { side: null, stage: 'qualification', slot: ql[1] ? Number(ql[1]) : null }
  const sd = s.match(/^seeding match(?: (\d+))?$/)
  if (sd) return { side: null, stage: 'seeding', slot: sd[1] ? Number(sd[1]) : null }

  let side = null
  let rest = s
  // "brackek" gibi yazım hataları da var
  const sm = s.match(/^(upper|winners?|ub|lower|losers?|lb|mid(?:dle)?)(?: brack\w*)?\b ?(.*)$/)
  if (sm) {
    const k = sm[1]
    side = /^(upper|winner|ub)/.test(k) ? 'upper' : /^(lower|loser|lb)/.test(k) ? 'lower' : 'mid'
    rest = sm[2]
  } else {
    rest = rest.replace(/^bracket /, '')
  }

  // Sondaki maç numarası: "... match 2", "... 3"
  const slotOf = (tail) => {
    const m = String(tail || '').trim().match(/^(?:match ?)?(\d+)$/)
    return m ? Number(m[1]) : null
  }

  let m
  if ((m = rest.match(/^(?:round of|ro) ?(\d+)(.*)$/))) {
    const tail = m[2].trim()
    if (tail && slotOf(tail) == null) return null
    return { side, stage: 'ro', n: Number(m[1]), slot: slotOf(tail) }
  }
  // Yazım hataları da var: "quartefinal", "quarterinal"
  if ((m = rest.match(/^quart?e?r?[\s-]*f?inals?(.*)$/))) {
    const tail = m[1].trim()
    if (tail && slotOf(tail) == null) return null
    return { side, stage: 'qf', slot: slotOf(tail) }
  }
  if ((m = rest.match(/^semi[\s-]*f(?:inals?|nials?)(.*)$/))) {
    const tail = m[1].trim()
    if (tail && slotOf(tail) == null) return null
    return { side, stage: 'sf', slot: slotOf(tail) }
  }
  if ((m = rest.match(/^finals?(.*)$/))) {
    const tail = m[1].trim()
    if (tail && slotOf(tail) == null) return null
    return { side, stage: 'final', slot: slotOf(tail) }
  }
  // "Lower bracket 1 match 1" (tur kelimesi düşmüş) yalnız ayaklı etikette
  if ((m = rest.match(/^(?:round )?(\d+)(.*)$/)) && (side || rest.startsWith('round '))) {
    const tail = m[2].trim()
    // "Round 1 high/low" gibi ekler: anlamı belirsiz → tanınmadı
    if (tail && slotOf(tail) == null) return null
    return { side, stage: 'round', n: Number(m[1]), slot: slotOf(tail) }
  }
  return null
}

const BRACKET_STAGES = new Set(['round', 'ro', 'qf', 'sf', 'final', 'gf', 'third'])
const GSL_STAGES = new Set(['gsl-opening', 'gsl-winners', 'gsl-elim', 'gsl-decider', 'vs'])

function ts(m) {
  const v = m?.begin_at || m?.scheduled_at
  const t = v ? new Date(v).getTime() : NaN
  return Number.isFinite(t) ? t : 0
}

const teamIds = (m) => [m?.team_a?.id ?? m?.team_a_id, m?.team_b?.id ?? m?.team_b_id]
  .filter(v => v != null)
  .map(String)

function winnerOf(m) {
  if (m?.status !== 'finished') return null
  const w = deriveWinnerTeamId(m)
  return w == null ? null : String(w)
}

function loserOf(m) {
  const w = winnerOf(m)
  if (!w) return null
  return teamIds(m).find(id => id !== w) ?? null
}

// Sütun sırası: numaralı turlar önce (1, 2, 3 …), sonra adlı aşamalar
function stageRank(tok) {
  switch (tok.stage) {
    case 'round': return tok.n
    case 'ro': return 100 - Math.log2(tok.n)   // son 16 → 96, son 32 → 95
    case 'qf': return 97
    case 'sf': return 98
    case 'final': return 99
    case 'gf': return 100
    case 'gsl-opening': case 'vs': case 'gsl-elim': return 1
    case 'gsl-winners': case 'gsl-decider': return 2
    default: return null
  }
}

/**
 * Sütun etiketi (Türkçe). `tek`: tek eleme ağacı mı (final "Final", çift elemede
 * büyük final "Büyük Final").
 */
function columnLabel(side, tok, tek) {
  switch (tok.stage) {
    case 'round': return `Tur ${tok.n}`
    case 'ro': return `Son ${tok.n}`
    case 'qf': return 'Çeyrek Final'
    case 'sf': return 'Yarı Final'
    case 'final':
      if (side === 'lower') return 'Alt Ayak Finali'
      if (side === 'mid') return 'Orta Ayak Finali'
      return tek ? 'Final' : 'Üst Ayak Finali'
    case 'gf': return tek ? 'Final' : 'Büyük Final'
    case 'gsl-opening': case 'vs': return 'Açılış Maçları'
    case 'gsl-winners': return 'Kazananlar Maçı'
    case 'gsl-elim': return 'Elenme Maçı'
    case 'gsl-decider': return 'Decider Maçı'
    default: return ''
  }
}

const SIDE_ORDER = ['upper', 'mid', 'lower']

/** Liste görünümü için maçın tur etiketi (Türkçe); bilinmiyorsa null. */
export function turEtiketi(match) {
  const tok = parseRoundInfo(match?.round_info)
  if (!tok) return null
  const ayak = tok.side === 'upper' ? 'Üst Ayak ' : tok.side === 'lower' ? 'Alt Ayak ' : tok.side === 'mid' ? 'Orta Ayak ' : ''
  switch (tok.stage) {
    case 'third': return 'Üçüncülük Maçı'
    case 'gf': return 'Büyük Final'
    case 'gsl-opening': case 'vs': return 'Açılış Maçı'
    case 'gsl-winners': return 'Kazananlar Maçı'
    case 'gsl-elim': return 'Elenme Maçı'
    case 'gsl-decider': return 'Decider Maçı'
    case 'group': return null
    case 'swiss': return null
    case 'week': return `Hafta ${tok.n}`
    case 'tiebreaker': return 'Eşitlik Bozma Maçı'
    case 'qualification': return 'Kalifikasyon Maçı'
    case 'seeding': return 'Sıralama Maçı'
    case 'round': return `${ayak}Tur ${tok.n}`.trim()
    case 'ro': return `${ayak}Son ${tok.n}`.trim()
    case 'qf': return `${ayak}Çeyrek Final`.trim()
    case 'sf': return `${ayak}Yarı Final`.trim()
    case 'final': return tok.side ? `${ayak}Finali`.trim() : 'Final'
    default: return null
  }
}

/** Maç İsviçre/lig usulü bir "Tur n" mi (ayaksız numaralı tur)? */
export function ayaksizTurNo(match) {
  const tok = parseRoundInfo(match?.round_info)
  return tok && tok.stage === 'round' && !tok.side ? tok.n : null
}

function fail(reason, detail) {
  return { ok: false, reason, detail }
}

/**
 * Maçlardan ağaç modeli kurar.
 * @returns {{ok:true, kind:'single'|'double'|'gsl', sides:Array, third:object|null}
 *          | {ok:false, reason:string, detail?:any}}
 *
 * sides[i] = { side, columns: [{ key, label, rank, matches: [m…] }], edges, children }
 * Sütunlar soldan sağa, maçlar yukarıdan aşağıya sıralı; `placeholder` maçlar
 * (henüz rakibi belli olmayan, yapısı kesin maçlar) `is_virtual: true` taşır.
 */
export function buildBracketModel(matches, { tournament = null, now = Date.now() } = {}) {
  const live = (matches || []).filter(m => m && m.status !== 'canceled')
  if (live.length === 0) return fail('bos')

  const toks = live.map(m => ({ m, tok: parseRoundInfo(m.round_info) }))
  const unknown = toks.filter(x => !x.tok)
  if (unknown.length) return fail('etiket', unknown.map(x => x.m.round_info))

  const stages = new Set(toks.map(x => x.tok.stage))
  const isGsl = [...stages].some(s => s.startsWith('gsl-'))
  let kind
  if (isGsl) {
    if (![...stages].every(s => GSL_STAGES.has(s))) return fail('gsl-karisik', [...stages])
    kind = 'gsl'
  } else {
    if (![...stages].every(s => BRACKET_STAGES.has(s))) return fail('eleme-degil', [...stages])
    const named = ['ro', 'qf', 'sf', 'final', 'gf'].some(s => stages.has(s))
    const hasSides = toks.some(x => x.tok.side)
    // Yalnız "Round n" → İsviçre/lig usulü, ağaç değil
    if (!named && !hasSides) return fail('lig-usulu')
    // Alt/orta ayak yoksa "Upper bracket" öneki anlamsız: tek eleme. Çift elemede
    // ayaksız maçlar (ör. IEM Play-In'de "Round of 16") üst ayağa yazılır; yanlışsa
    // aşağıdaki doğrulama (sütun-zaman, elenen takım) yakalar.
    kind = toks.some(x => x.tok.side === 'lower' || x.tok.side === 'mid') ? 'double' : 'single'
  }
  const tek = kind === 'single'

  // Tek elemede "Round 16" = son 16 (QF/SF varken)
  const hasQfSf = stages.has('qf') || stages.has('sf')
  const items = toks.map(({ m, tok }) => {
    let t = tok
    if (t.stage === 'round' && !t.side && hasQfSf && POW2.has(t.n)) t = { ...t, stage: 'ro' }
    if (t.stage === 'final' && t.side !== 'lower' && t.side !== 'mid' && tek && !stages.has('gf')) t = { ...t, stage: 'gf' }
    let side = t.side
    if (t.stage === 'gf') side = 'upper'
    if (t.stage === 'vs') side = 'upper'
    if (!side && t.stage !== 'third') side = 'upper'
    return { m, tok: t, side, rank: t.stage === 'third' ? null : stageRank(t) }
  })

  const thirdItems = items.filter(x => x.tok.stage === 'third')
  if (thirdItems.length > 1) return fail('ucunculuk-cift')
  const third = thirdItems[0]?.m ?? null

  // ── Ayaklar ve sütunlar ──────────────────────────────────────────────
  const sidesMap = new Map()
  for (const it of items) {
    if (it.tok.stage === 'third') continue
    if (!sidesMap.has(it.side)) sidesMap.set(it.side, new Map())
    const cols = sidesMap.get(it.side)
    if (!cols.has(it.rank)) cols.set(it.rank, { rank: it.rank, tok: it.tok, items: [] })
    cols.get(it.rank).items.push(it)
  }

  const sides = []
  for (const side of SIDE_ORDER) {
    const cols = sidesMap.get(side)
    if (!cols) continue
    const columns = [...cols.values()].sort((a, b) => a.rank - b.rank)
    sides.push({ side, columns })
  }

  // ── Doğrulama ────────────────────────────────────────────────────────
  for (const s of sides) {
    // (a) takım bir sütunda bir kez
    for (const c of s.columns) {
      const seen = new Set()
      for (const it of c.items) {
        for (const id of teamIds(it.m)) {
          if (seen.has(id)) return fail('sutunda-cift-takim', { side: s.side, col: c.rank, team: id })
          seen.add(id)
        }
      }
    }
    // (b) takımın bu ayaktaki maçları zamanla ilerleyen sütunlarda
    const byTeam = new Map()
    for (const c of s.columns) {
      for (const it of c.items) {
        for (const id of teamIds(it.m)) {
          if (!byTeam.has(id)) byTeam.set(id, [])
          byTeam.get(id).push({ rank: c.rank, t: ts(it.m), m: it.m, gf: it.tok.stage === 'gf' })
        }
      }
    }
    for (const [id, list] of byTeam) {
      list.sort((x, y) => x.rank - y.rank)
      for (let i = 1; i < list.length; i++) {
        if (list[i].t && list[i - 1].t && list[i].t < list[i - 1].t) {
          return fail('sutun-zaman-celiskisi', { side: s.side, team: id, a: list[i - 1].m.round_info, b: list[i].m.round_info })
        }
        // (c) bu ayakta kaybeden aynı ayakta bir daha oynamaz (büyük final hariç:
        // alt ayaktan gelen takım üst ayakta kaybetmiş olabilir)
        const prevLoser = loserOf(list[i - 1].m)
        if (prevLoser === id && !list[i].gf) {
          return fail('elenen-yeniden-oynuyor', { side: s.side, team: id, a: list[i - 1].m.round_info, b: list[i].m.round_info })
        }
      }
    }
  }
  // Alt ayakta kaybeden turnuvadan çıkar: daha sonra hiçbir yerde oynamaz
  if (kind === 'double' || kind === 'gsl') {
    const lower = sides.find(s => s.side === 'lower')
    if (lower) {
      const all = items.filter(x => x.tok.stage !== 'third')
      for (const c of lower.columns) {
        for (const it of c.items) {
          const l = loserOf(it.m)
          if (!l) continue
          const later = all.find(x => x !== it && ts(x.m) > ts(it.m) && teamIds(x.m).includes(l))
          if (later) return fail('alt-ayakta-elenen-yeniden-oynuyor', { team: l, a: it.m.round_info, b: later.m.round_info })
        }
      }
    }
  }

  // ── Tamamlandı mı? (yer tutucu kutu yalnız sürmekte olan aşamada) ──────
  const endAt = tournament?.end_at ? new Date(tournament.end_at).getTime() : NaN
  const terminal = items.find(x => x.tok.stage === 'gf')
  const complete = (terminal && terminal.m.status === 'finished')
    || (Number.isFinite(endAt) && endAt < now - 24 * 3600 * 1000)
    || (live.every(m => m.status === 'finished') && Math.max(...live.map(ts)) < now - 14 * 24 * 3600 * 1000)

  // ── Her ayak için: bağlantılar, sıralama, yer tutucular ───────────────
  let virtualSeq = 0
  const makeVirtual = (side, col, slot) => ({
    id: `bos-${side}-${col.rank}-${slot ?? virtualSeq}-${virtualSeq++}`,
    team_a: null, team_b: null, team_a_id: null, team_b_id: null,
    team_a_score: null, team_b_score: null, winner_id: null,
    status: 'not_started', is_virtual: true, __slot: slot ?? null,
  })

  const outSides = sides.map(s => {
    const columns = s.columns.map(c => ({
      key: `${s.side}:${c.rank}`,
      rank: c.rank,
      label: columnLabel(s.side, c.tok, tek),
      stage: c.tok.stage,
      matches: c.items.map(it => ({ ...it.m, __slot: it.tok.slot ?? null })),
    }))

    if (!complete && kind !== 'gsl') {
      // (1) Numara boşlukları: "Çeyrek Final 1, 2, 4" varsa 3 numara bekleniyor
      for (const col of columns) {
        const slots = col.matches.map(m => m.__slot).filter(Number.isFinite)
        if (slots.length !== col.matches.length || slots.length === 0) continue
        const max = Math.max(...slots)
        for (let k = 1; k <= max; k++) {
          if (!slots.includes(k)) col.matches.push(makeVirtual(s.side, col, k))
        }
      }
      // (2) Yapısı kesin sütunlar: yarı final 2 maç, final 1 maç; tek elemede
      // son 16 → çeyrek → yarı → final zinciri. Sayısı belirsiz olanlara dokunulmaz.
      if (s.side === 'upper') {
        const named = (stage) => columns.find(c => c.stage === stage)
        const ensure = (stage, rank, count) => {
          let col = named(stage)
          if (!col) {
            col = { key: `${s.side}:${rank}`, rank, label: columnLabel(s.side, { stage }, tek), stage, matches: [] }
            columns.push(col)
          }
          const real = col.matches.length
          for (let k = real; k < count; k++) col.matches.push(makeVirtual(s.side, col, null))
        }
        const maxRank = Math.max(...columns.map(c => c.rank))
        if (named('sf') || named('qf')) ensure('sf', 98, 2)
        if (tek) {
          const ro = columns.filter(c => c.stage === 'ro').sort((a, b) => b.rank - a.rank)[0]
          // son 16'dan sonra çeyrek final 4 maç
          if (ro && ro.label === 'Son 16' && !named('qf')) ensure('qf', 97, 4)
          if (named('sf') && maxRank <= 98) ensure('gf', 100, 1)
        }
      }
      columns.sort((a, b) => a.rank - b.rank)
    }

    // ── Bağlantılar: kazanan aynı ayağın sonraki maçında mı? ──────────────
    const parentOf = new Map()   // child id → { parent, colIdx, slotKey: 'a'|'b' }
    const childrenOf = new Map() // parent id → [child…]
    columns.forEach((col, ci) => {
      for (const m of col.matches) {
        const w = winnerOf(m)
        if (!w) continue
        for (let cj = ci + 1; cj < columns.length; cj++) {
          const p = columns[cj].matches.find(x => !x.is_virtual && teamIds(x).includes(w) && ts(x) >= ts(m))
          if (p) {
            const aId = String(p.team_a?.id ?? p.team_a_id ?? '')
            parentOf.set(String(m.id), { parent: p, colIdx: cj, slotKey: aId === w ? 'a' : 'b' })
            if (!childrenOf.has(String(p.id))) childrenOf.set(String(p.id), [])
            childrenOf.get(String(p.id)).push(m)
            break
          }
        }
      }
    })

    // Yer tutucuya yapısal (kesik çizgili) bağlantı: önceki sütun tam iki katıysa,
    // ebeveyni olmayan maçlar sırayla eşlenir
    const structural = new Map() // child id → parent (virtual)

    // ── Sıralama: sağdan sola; ebeveyn sırası, sonra slot (a üstte) ───────
    const order = new Map() // match id → index in its column
    for (let ci = columns.length - 1; ci >= 0; ci--) {
      const col = columns[ci]
      const next = columns[ci + 1]
      const n = col.matches.length
      const key = (m, i) => {
        const p = parentOf.get(String(m.id))
        if (p && order.has(String(p.parent.id))) {
          return order.get(String(p.parent.id)) + (p.slotKey === 'a' ? 0 : 0.5)
        }
        // Ebeveyni yok: numarasıyla orantılı yer (sonraki sütuna göre)
        const nNext = next ? next.matches.length : 1
        const slot = Number.isFinite(m.__slot) ? m.__slot - 1 : null
        if (slot != null && n > 0) return (slot + 0.25) * nNext / n
        return (i + 0.25) * nNext / Math.max(n, 1) + 1e-3
      }
      const base = col.matches
        .map((m, i) => ({ m, i, t: ts(m) }))
        .sort((x, y) => {
          const sx = Number.isFinite(x.m.__slot) ? x.m.__slot : Infinity
          const sy = Number.isFinite(y.m.__slot) ? y.m.__slot : Infinity
          return sx - sy || (x.m.is_virtual ? 1 : 0) - (y.m.is_virtual ? 1 : 0) || x.t - y.t
        })
      if (!next) {
        col.matches = base.map(x => x.m)
      } else {
        col.matches = base
          .map((x, i) => ({ ...x, k: key(x.m, i) }))
          .sort((x, y) => x.k - y.k || x.i - y.i)
          .map(x => x.m)
      }
      col.matches.forEach((m, i) => order.set(String(m.id), i))
    }

    // Yapısal eşleme (yalnız yer tutucu ebeveynler için)
    for (let ci = 0; ci < columns.length - 1; ci++) {
      const cur = columns[ci].matches
      const nxt = columns[ci + 1].matches
      if (cur.length !== nxt.length * 2) continue
      nxt.forEach((p, j) => {
        if (!p.is_virtual) return
        for (const c of [cur[2 * j], cur[2 * j + 1]]) {
          if (c && !parentOf.has(String(c.id))) structural.set(String(c.id), p)
        }
      })
    }

    const edges = []
    for (const [cid, info] of parentOf) edges.push({ from: cid, to: String(info.parent.id), slot: info.slotKey, verified: true })
    for (const [cid, p] of structural) edges.push({ from: cid, to: String(p.id), slot: null, verified: false })

    return { side: s.side, columns, edges }
  })

  // Alt/orta ayağın finalinden büyük finale bağlantı (ayaklar arası)
  const upper = outSides.find(s => s.side === 'upper')
  const gfCol = upper?.columns.find(c => c.stage === 'gf')
  if (gfCol) {
    for (const gf of gfCol.matches.filter(x => !x.is_virtual)) {
      const aId = String(gf.team_a?.id ?? gf.team_a_id ?? '')
      for (const s of outSides) {
        if (s === upper || !s.columns.length) continue
        for (const m of s.columns[s.columns.length - 1].matches) {
          const w = winnerOf(m)
          if (w && teamIds(gf).includes(w) && ts(gf) >= ts(m)) {
            upper.edges.push({ from: String(m.id), to: String(gf.id), slot: aId === w ? 'a' : 'b', verified: true, cross: true })
          }
        }
      }
    }
  }

  return { ok: true, kind, sides: outSides, third, complete }
}

// ─── Yerleşim ────────────────────────────────────────────────────────────────

export const BRACKET_DIM = {
  cardW: 212,    // kart genişliği
  headH: 22,     // kartın üst şeridi (tarih · Bo)
  rowH: 30,      // takım satırı
  vGap: 14,      // kartlar arası dikey boşluk
  colGap: 44,    // sütunlar arası (bağlantı çizgileri burada)
  colHead: 32,   // sütun başlığı satırı
  secHead: 28,   // ayak başlığı satırı ("Üst Ayak")
  blockGap: 30,  // ayaklar arası
}

export const SIDE_LABEL = { upper: 'Üst Ayak', mid: 'Orta Ayak', lower: 'Alt Ayak' }

/**
 * Modeli koordinatlara çevirir. Tüm ayaklar tek tuvalde alt alta; çok ayaklı
 * ağaçta büyük final en sağdaki ayrı sütuna gider (üst ve alt ayağın finali ona bağlanır).
 * Kart, çocuklarının (kendisine takım gönderen maçların) dikey ortasına oturur.
 */
export function layoutBracket(model, dim = BRACKET_DIM) {
  const cardH = dim.headH + 2 * dim.rowH
  const step = cardH + dim.vGap
  const stepX = dim.cardW + dim.colGap
  const multi = model.sides.length > 1
  const isTerminal = (col) => multi && col.stage === 'gf'

  const allEdges = model.sides.flatMap(s => s.edges)
  const kidsOf = new Map()
  for (const e of allEdges) {
    if (!kidsOf.has(e.to)) kidsOf.set(e.to, [])
    kidsOf.get(e.to).push(e.from)
  }

  const pos = new Map() // id → { x, y, m, side }
  const cards = []
  const headers = []
  const sections = []

  const placeColumn = (matches, x, cardsTop, side, stage) => {
    let desired = matches.map(m => {
      const kids = (kidsOf.get(String(m.id)) || []).map(id => pos.get(id)).filter(Boolean)
      if (!kids.length) return null
      return kids.reduce((a, k) => a + k.y + cardH / 2, 0) / kids.length - cardH / 2
    })
    const anchored = desired.map((d, i) => (d == null ? null : i)).filter(i => i != null)
    if (!anchored.length) {
      desired = matches.map((_, i) => cardsTop + i * step)
    } else {
      const first = anchored[0]
      const last = anchored[anchored.length - 1]
      desired = desired.map((d, i) => {
        if (d != null) return d
        if (i < first) return desired[first] - (first - i) * step
        if (i > last) return desired[last] + (i - last) * step
        const lo = anchored.filter(a => a < i).pop()
        const hi = anchored.find(a => a > i)
        return desired[lo] + (desired[hi] - desired[lo]) * (i - lo) / (hi - lo)
      })
    }
    let cursor = cardsTop
    matches.forEach((m, i) => {
      const y = Math.round(Math.max(desired[i], cursor))
      cursor = y + step
      const card = { m, x, y, side, stage }
      pos.set(String(m.id), card)
      cards.push(card)
    })
  }

  const nonTerminal = Math.max(1, ...model.sides.map(s => s.columns.filter(c => !isTerminal(c)).length))
  let top = 0
  let upperHeaderY = 0
  let upperCardsTop = 0
  const terminals = []
  for (const s of model.sides) {
    const headerY = top + (multi ? dim.secHead : 0)
    const cardsTop = headerY + dim.colHead
    if (s.side === 'upper') { upperHeaderY = headerY; upperCardsTop = cardsTop }
    if (multi) sections.push({ side: s.side, label: SIDE_LABEL[s.side], y: top })
    let ci = 0
    for (const col of s.columns) {
      if (isTerminal(col)) { terminals.push({ col, side: s.side }); continue }
      const x = ci * stepX
      headers.push({ x, y: headerY, label: col.label, stage: col.stage })
      placeColumn(col.matches, x, cardsTop, s.side, col.stage)
      ci++
    }
    const bottom = Math.max(cardsTop, ...cards.filter(c => c.side === s.side).map(c => c.y + cardH))
    top = bottom + dim.blockGap
  }
  for (const t of terminals) {
    const x = nonTerminal * stepX
    headers.push({ x, y: upperHeaderY, label: t.col.label, stage: t.col.stage })
    placeColumn(t.col.matches, x, upperCardsTop, t.side, t.col.stage)
  }

  // Üçüncülük maçı: finalin altına, yoksa son sütunun altına
  let third = null
  if (model.third) {
    const fin = cards.find(c => c.stage === 'gf')
    const x = fin ? fin.x : Math.max(0, ...cards.map(c => c.x))
    const colBottom = Math.max(0, ...cards.filter(c => c.x === x).map(c => c.y + cardH))
    const y = Math.max(fin ? fin.y + cardH + dim.colHead + dim.vGap : 0, colBottom + dim.colHead + dim.vGap)
    third = { m: model.third, x, y, labelY: y - dim.colHead + 6 }
    pos.set(String(model.third.id), { ...third, side: 'upper', stage: 'third' })
  }

  const edges = []
  for (const e of allEdges) {
    const c = pos.get(e.from)
    const p = pos.get(e.to)
    if (!c || !p) continue
    const fx = c.x + dim.cardW
    const fy = c.y + dim.headH + dim.rowH
    const tx = p.x
    const ty = p.y + dim.headH + (e.slot === 'a' ? dim.rowH / 2 : e.slot === 'b' ? dim.rowH * 1.5 : dim.rowH)
    // Sütun atlayan bağlantı (hükmen geçilen/eksik maç): yatay kol aradaki
    // sütunlarda kartın üstünden geçmesin; çocuğun hizası doluysa dirsek çocuğun
    // hemen sağında kurulur ve kol hedef hizasından gider.
    // İki hiza da doluysa çizgi bir kartın içinden geçiyormuş gibi okunur; çizilmez.
    const blocked = (y) => cards.some(k => k.x > c.x && k.x < p.x && y > k.y - 2 && y < k.y + cardH + 2)
    const atlar = p.x - c.x > stepX + 1
    if (atlar && blocked(fy) && blocked(ty)) continue
    const midX = atlar && blocked(fy)
      ? fx + dim.colGap / 2
      : tx - dim.colGap / 2
    const d = Math.abs(ty - fy) < 1 ? `M ${fx} ${fy} H ${tx}` : `M ${fx} ${fy} H ${midX} V ${ty} H ${tx}`
    edges.push({ key: `${e.from}>${e.to}`, d, verified: e.verified, team: winnerOf(c.m) })
  }

  const allCards = third ? [...cards, third] : cards
  const width = Math.max(dim.cardW, ...allCards.map(c => c.x + dim.cardW))
  const height = Math.max(cardH, ...allCards.map(c => c.y + cardH))
  return { cards, third, edges, headers, sections, width, height, cardH }
}
