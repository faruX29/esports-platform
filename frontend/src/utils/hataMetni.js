/**
 * Kullanıcıya gösterilecek hata metni.
 *
 * Neden: Supabase/ağ hatasının ham metni ("canceling statement due to statement
 * timeout", "JWT expired", "relation ... does not exist") ekrana basılıyordu.
 * Ekrana yalnız kendi yazdığımız Türkçe metin çıkar: bunu `KullaniciHatasi` ile
 * fırlatırız; geri kalan her hata için sayfanın Türkçe yedek metni gösterilir,
 * ham metin konsola gider.
 */
export class KullaniciHatasi extends Error {}

export function hataMetni(err, yedek) {
  return err instanceof KullaniciHatasi && err.message ? err.message : yedek
}
