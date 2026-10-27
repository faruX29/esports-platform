import { useEffect, useRef, useState } from 'react'
import { isMatchesChannelConnected, subscribeToMatchesChannelStatus } from '../supabaseClient'

/**
 * Periyodik yenileme: sekme gizliyken DURUR, görünür olunca veri bayatsa hemen yeniler.
 *
 * NEDEN: ana sayfadaki dört setInterval arka plandaki sekmede bile dakikada ~9
 * Supabase isteği atıyordu; açık bırakılan her sekme sonsuza dek yük demekti.
 * İlk yükleme çağıranın işi; bu kanca yalnız sonraki yenilemeleri zamanlar.
 */
export function useYenileme(yenile, aralikMs, etkin = true) {
  const yenileRef = useRef(yenile)
  useEffect(() => { yenileRef.current = yenile })

  useEffect(() => {
    if (!etkin || !aralikMs || typeof document === 'undefined') return undefined
    let sonCalisma = Date.now()
    let zamanlayici = null

    const calistir = () => {
      sonCalisma = Date.now()
      yenileRef.current?.()
    }
    const kur = () => {
      clearInterval(zamanlayici)
      zamanlayici = setInterval(() => { if (!document.hidden) calistir() }, aralikMs)
    }
    const gorunurlukDegisti = () => {
      if (document.hidden) return
      if (Date.now() - sonCalisma >= aralikMs) {
        calistir()
        kur()  // bir sonraki tik tam aralık sonra
      }
    }

    kur()
    document.addEventListener('visibilitychange', gorunurlukDegisti)
    return () => {
      clearInterval(zamanlayici)
      document.removeEventListener('visibilitychange', gorunurlukDegisti)
    }
  }, [aralikMs, etkin])
}

/** Canlı maç kanalı (supabaseClient 'maclar' Broadcast) şu an bağlı mı? */
export function useCanliBaglanti() {
  const [bagli, setBagli] = useState(isMatchesChannelConnected)
  useEffect(() => subscribeToMatchesChannelStatus(setBagli), [])
  return bagli
}
