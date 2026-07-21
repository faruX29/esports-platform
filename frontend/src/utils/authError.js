/**
 * Supabase Auth / ağ hatalarını kullanıcı-dostu Türkçe mesaja çevirir.
 *
 * Neden: Supabase 500 döndüğünde gövde çoğu zaman boş (`{}`) veya İngilizce ham
 * metin oluyor; bunu doğrudan ekrana basınca kullanıcı "{}" gibi anlamsız bir
 * şey görüyor. Bu yardımcı; boş gövde, İngilizce mesaj ve HTTP durum kodunu
 * ayıklayıp net bir Türkçe karşılık verir. Auth sayfalarının hepsi bunu kullanır.
 */
export function authErrorMessage(err, fallback = 'İşlem başarısız. Lütfen tekrar dene.') {
  const raw = String(
    err?.message ?? err?.error_description ?? err?.msg ?? err?.error ?? ''
  ).trim()
  const status = Number(err?.status ?? err?.statusCode ?? err?.code) || 0
  const low = raw.toLowerCase()

  // Boş / anlamsız gövde: "{}", "[object Object]", "null", "undefined"
  const empty = !raw || /^(\{\s*\}|\[object object\]|null|undefined)$/i.test(raw)

  // — Bilinen durumlar (öncelik sırası önemli) —
  if (low.includes('already registered') || low.includes('already been registered') || low.includes('user already'))
    return 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.'

  if (low.includes('invalid login') || low.includes('invalid credentials') || (low.includes('invalid') && low.includes('password')))
    return 'E-posta veya şifre hatalı.'

  if (low.includes('email not confirmed') || low.includes('not confirmed'))
    return 'E-postan henüz doğrulanmamış. Gelen kutundaki doğrulama bağlantısına tıkla.'

  if (low.includes('captcha'))
    return 'Doğrulama başarısız. "Gerçek kişi olduğunuzu doğrulayın" kutusunu tamamlayıp tekrar dene.'

  if (status === 429 || low.includes('rate limit') || low.includes('too many') || low.includes('for security purposes'))
    return 'Çok fazla deneme yapıldı. Bir süre bekleyip tekrar dene.'

  if ((low.includes('email') && (low.includes('sending') || low.includes('send'))) || low.includes('smtp'))
    return 'Doğrulama e-postası gönderilemedi. Birazdan tekrar dene ya da farklı bir e-posta kullan.'

  if (low.includes('password') && (low.includes('different') || low.includes('should be different') || low.includes('same as')))
    return 'Yeni şifren eskisinden farklı olmalı.'

  if (low.includes('password') && (low.includes('at least') || low.includes('weak') || low.includes('6 characters') || low.includes('too short')))
    return 'Şifre en az 6 karakter olmalı.'

  if (low.includes('invalid') && low.includes('email'))
    return 'Geçerli bir e-posta adresi gir.'

  if (low.includes('database error') || low.includes('unexpected_failure') || low.includes('saving new user'))
    return 'Sunucu tarafında bir sorun oluştu. Birkaç dakika sonra tekrar dener misin?'

  if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('network request'))
    return 'İnternet bağlantına ulaşılamadı. Bağlantını kontrol edip tekrar dene.'

  // Sunucu hatası veya boş gövde → jenerik ama net mesaj (asla "{}" gösterme)
  if (status >= 500 || empty)
    return 'Sunucuya ulaşırken bir hata oluştu. Birazdan tekrar dener misin?'

  // Elde anlamlı bir metin varsa onu göster, yoksa fallback
  return raw || fallback
}
