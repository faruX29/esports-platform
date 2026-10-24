/**
 * Türk takımı: TEK KAYNAK = `turk_takimlar` görünümü (backend/sql/turk_takimlar.sql).
 *
 * Önceden burada bir ad listesi vardı ve parça eşleşme yapıyordu ("BBL" Danimarkalı
 * BBL'yi, "Sangal" Partizan Sangal'ı yakalıyordu); Aurora gibi RU kayıtlı Türk
 * kadroları da hiç yakalanmıyordu. Radar, haber üretimi ve video görünümü zaten
 * kullanıyor; frontend de aynısını okur.
 *
 * Liste küçük (yüz takımın altında) → bir kez çekilir, tarayıcıda 12 saat tutulur.
 * Yüklenene kadar her takım "Türk değil" sayılır; yüklenince `useTurkTakimlar`
 * kullanan bileşenler yeniden çizilir.
 */
import { useSyncExternalStore } from 'react'
import { supabase } from '../supabaseClient'

const ONBELLEK_ANAHTARI = 'fext_turk_takimlar_v1'
const ONBELLEK_SURESI = 12 * 60 * 60 * 1000

let durum = { surum: 0, takimlar: [], idler: new Set(), adlar: new Set() }
let yukleme = null
const dinleyiciler = new Set()

function adAnahtari(ad) {
  return String(ad || '').trim().toLocaleLowerCase('tr-TR')
}

function kur(takimlar) {
  durum = {
    surum: durum.surum + 1,
    takimlar,
    idler: new Set(takimlar.map(t => Number(t.id))),
    adlar: new Set(takimlar.map(t => adAnahtari(t.name)).filter(Boolean)),
  }
  dinleyiciler.forEach(fn => fn())
}

function onbellektenOku() {
  try {
    const ham = localStorage.getItem(ONBELLEK_ANAHTARI)
    if (!ham) return null
    const { zaman, takimlar } = JSON.parse(ham)
    if (!Array.isArray(takimlar) || Date.now() - zaman > ONBELLEK_SURESI) return null
    return takimlar
  } catch {
    return null
  }
}

function onbellegeYaz(takimlar) {
  try {
    localStorage.setItem(ONBELLEK_ANAHTARI, JSON.stringify({ zaman: Date.now(), takimlar }))
  } catch {
    // gizli pencere / dolu depo: önbelleksiz devam
  }
}

/** Listeyi bir kez yükler (tekrar çağrı aynı sözü döner). Hata olursa boş liste kalır. */
export function turkTakimlariYukle() {
  if (yukleme) return yukleme
  const onbellek = onbellektenOku()
  if (onbellek) {
    kur(onbellek)
    yukleme = Promise.resolve(durum.takimlar)
    return yukleme
  }
  yukleme = (async () => {
    const { data: tr, error } = await supabase.from('turk_takimlar').select('team_id')
    if (error) throw error
    const idler = (tr || []).map(r => r.team_id)
    if (!idler.length) return []
    const { data: takimlar, error: tErr } = await supabase
      .from('teams')
      .select('id,name,acronym,logo_url,game:games(slug,name)')
      .in('id', idler)
    if (tErr) throw tErr
    return takimlar || []
  })()
    .then(takimlar => {
      kur(takimlar)
      onbellegeYaz(takimlar)
      return takimlar
    })
    .catch(err => {
      console.warn('turk_takimlar okunamadı:', err?.message || err)
      yukleme = null  // sonraki çağrı yeniden denesin
      return []
    })
  return yukleme
}

/**
 * Takım Türk mü? Nesne (`{ id, name }`) verilirse id'ye bakar; id yoksa ya da yalnız
 * ad verilirse TAM ad eşleşmesi (büyük/küçük harf duyarsız), parça eşleşme yok.
 */
export function isTurkishTeam(takim) {
  if (!takim) return false
  if (typeof takim === 'object') {
    const id = Number(takim.id)
    if (Number.isFinite(id) && takim.id != null) return durum.idler.has(id)
    return durum.adlar.has(adAnahtari(takim.name))
  }
  return durum.adlar.has(adAnahtari(takim))
}

/**
 * Türk takımı haberleri (news_articles): satırda takım ID'si yok, ad var; haber
 * üretimi adı teams.name'den aynen yazdığı için TAM ad eşleşmesi güvenli.
 * "Türk Espor Haftası" özeti de dahil. Hata fırlatır (çağıran loglar).
 */
export async function turkHaberleriniGetir({ limit = 30, gun = 60 } = {}) {
  const takimlar = await turkTakimlariYukle()
  // PostgREST in.(...) listesinde virgül/parantez içeren ad tırnakla korunur
  const adlar = [...new Set(takimlar.map(t => t.name).filter(Boolean))]
    .map(ad => `"${ad.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
  const kosullar = ['variant.eq.turk_haftasi']
  if (adlar) kosullar.push(`team_a_name.in.(${adlar})`, `team_b_name.in.(${adlar})`)
  const { data, error } = await supabase
    .from('news_articles')
    .select('*')
    .or(kosullar.join(','))
    .gte('created_at', new Date(Date.now() - gun * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

function abone(fn) {
  dinleyiciler.add(fn)
  turkTakimlariYukle()
  return () => dinleyiciler.delete(fn)
}

const surumuAl = () => durum.surum

/**
 * Liste yüklenince bileşeni yeniden çizdirir. `isTurkishTeam` çağıran her bileşen
 * (memo'lu satırlar dahil) bunu çağırmalı. Dönen değer: tüm Türk takımları.
 */
export function useTurkTakimlar() {
  useSyncExternalStore(abone, surumuAl, surumuAl)
  return durum.takimlar
}
