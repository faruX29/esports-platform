import { supabase } from '../supabaseClient'

// Ana sayfa verisi tek istekte: get_home_feed RPC (backend/sql/ana_sayfa_akisi.sql).
// Çıktı: { canli, yaklasan, biten, turnuvalar, form } — maç satırları PostgREST
// gömmesiyle aynı biçimde (team_a/team_b/tournament/game).
//
// Ön yükleme: uygulama "/" ile açılırsa App bu isteği Dashboard parçası inerken
// başlatır; Dashboard ilk açılışta aynı sözü (promise) kullanır → veri isteği JS
// indirmesini beklemez.

const ON_YUKLEME_OMRU_MS = 20_000
let onYukleme = null  // { zaman, soz }
let rpcYokBilindi = false  // bir kez PGRST202 aldıysak oturum boyunca doğrudan eski yol

const MAC_ALANLARI = `
  id, status, scheduled_at, tournament_id,
  team_a_id, team_b_id, winner_id, team_a_score, team_b_score,
  number_of_games, stream_url,
  prediction_team_a, prediction_team_b, prediction_confidence,
  team_a:teams!matches_team_a_id_fkey(id,name,logo_url),
  team_b:teams!matches_team_b_id_fkey(id,name,logo_url),
  tournament:tournaments(id,name,tier,league_name,event_name,display_name,region),
  game:games(id,name,slug)
`

function rpcYok(error) {
  // PGRST202: fonksiyon şemada yok (SQL henüz uygulanmamış)
  return error?.code === 'PGRST202' || /get_home_feed/.test(String(error?.message || ''))
}

// RPC uygulanmamışsa ya da kaldırılırsa sayfa kırılmasın: aynı veriyi eski
// tekil sorgularla kur (5-6 istek). Çıktı biçimi RPC ile aynı.
async function eskiYoldanGetir() {
  const simdi = Date.now()
  const altSinir = new Date(simdi - 6 * 60 * 60 * 1000).toISOString()
  const ustSinir = new Date(simdi + 7 * 24 * 60 * 60 * 1000).toISOString()
  const simdiIso = new Date(simdi).toISOString()

  const [canli, yaklasan, biten, turnuva] = await Promise.all([
    supabase.from('matches').select(MAC_ALANLARI).eq('status', 'running')
      .order('scheduled_at', { ascending: true }).limit(18),
    supabase.from('matches').select(MAC_ALANLARI).in('status', ['not_started', 'upcoming'])
      .gte('scheduled_at', altSinir).lte('scheduled_at', ustSinir)
      .order('scheduled_at', { ascending: true }).limit(30),
    supabase.from('matches').select(MAC_ALANLARI).eq('status', 'finished')
      .order('scheduled_at', { ascending: false }).order('id', { ascending: false }).limit(100),
    supabase.from('tournaments')
      .select('id,name,tier,begin_at,end_at,region,league_name,event_name,display_name,game:games(id,name,slug)')
      .lte('begin_at', simdiIso).gte('end_at', simdiIso).in('tier', ['S', 'A', 's', 'a'])
      .order('begin_at', { ascending: false }).limit(50),
  ])
  for (const r of [canli, yaklasan, biten]) if (r.error) throw r.error

  const turnuvalar = turnuva.data || []
  const takimlar = new Map()
  if (turnuvalar.length) {
    const { data } = await supabase.from('matches')
      .select('tournament_id,team_a:teams!matches_team_a_id_fkey(id,name,logo_url),team_b:teams!matches_team_b_id_fkey(id,name,logo_url)')
      .in('tournament_id', turnuvalar.map(t => t.id)).limit(800)
    for (const m of data || []) {
      if (!takimlar.has(m.tournament_id)) takimlar.set(m.tournament_id, new Map())
      for (const t of [m.team_a, m.team_b]) if (t?.id) takimlar.get(m.tournament_id).set(t.id, t)
    }
  }

  const formIdleri = [...new Set([...(canli.data || []), ...(yaklasan.data || [])]
    .flatMap(m => [m.team_a_id, m.team_b_id]).filter(Boolean))]
  const form = formIdleri.length
    ? (await supabase.rpc('get_teams_recent_form', { p_team_ids: formIdleri })).data || []
    : []

  return {
    canli: canli.data || [],
    yaklasan: yaklasan.data || [],
    biten: biten.data || [],
    turnuvalar: turnuvalar.map(t => ({ ...t, teams: [...(takimlar.get(t.id)?.values() || [])].slice(0, 7) })),
    form,
  }
}

async function cek() {
  if (rpcYokBilindi) return eskiYoldanGetir()
  const { data, error } = await supabase.rpc('get_home_feed')
  if (error) {
    if (rpcYok(error)) {
      rpcYokBilindi = true
      console.warn('get_home_feed yok; ana sayfa eski sorgularla yükleniyor (backend/sql/ana_sayfa_akisi.sql uygulanmalı)')
      return eskiYoldanGetir()
    }
    throw error
  }
  return data
}

export function anaSayfaAkisiniOnYukle() {
  const soz = cek()
  soz.catch(() => {})  // hata Dashboard'da yeniden denenir; burada yakalanmamış söz kalmasın
  onYukleme = { zaman: Date.now(), soz }
}

export function anaSayfaAkisiniGetir() {
  if (onYukleme && Date.now() - onYukleme.zaman < ON_YUKLEME_OMRU_MS) {
    const { soz } = onYukleme
    onYukleme = null
    return soz
  }
  onYukleme = null
  return cek()
}
