import { Capacitor } from '@capacitor/core'

/**
 * Uygulama (Capacitor) mı, web mi — tek kaynak.
 *
 * Uygulamada sayfa https://app.fextesports.com'dan (capacitor.config.json
 * `server.hostname`) yerel dosyalarla açılır; bu adres dışarıda yoktur.
 * Paylaşılan ya da e-postayla giden her link SITE_ORIGIN'i kullanmalı,
 * `window.location.origin`'i değil.
 */
export const UYGULAMA = Capacitor.isNativePlatform()

/** 'web' | 'android' | 'ios' */
export const PLATFORM = Capacitor.getPlatform()

export const SITE_ORIGIN = 'https://fextesports.com'

/** Dışarıya verilecek linklerin kökü: web'de bulunulan adres (önizleme dahil), uygulamada site. */
export function disariKok() {
  if (UYGULAMA || typeof window === 'undefined') return SITE_ORIGIN
  return window.location.origin
}
