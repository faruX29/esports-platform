-- ── Kullanıcı adı VEYA e-posta ile giriş ────────────────────────────────────
-- Supabase şifreli giriş yalnızca e-posta kabul eder. Kullanıcı adıyla giriş için
-- verilen tanımlayıcıyı önce e-postaya çeviririz.
--
-- Davranış:
--   • '@' içeriyorsa → e-posta kabul edilir, küçük harfe indirilip aynen döner.
--   • İçermiyorsa   → profiles.username (küçük/büyük harf duyarsız) eşleşen
--                     kullanıcının auth.users'daki e-postası döner.
--   • Eşleşme yoksa → NULL döner (istemci geçersiz kimlikle deneyip "hatalı" der).
--
-- SECURITY DEFINER: auth.users'ı okuyabilmek için RLS'i baypas eder; fonksiyon
-- sahibi (postgres) yetkisiyle çalışır. anon + authenticated execute alır.
--
-- ⚠️ MAHREMİYET NOTU: Bu fonksiyon, bir kullanıcı adının hangi e-postaya bağlı
-- olduğunu döndürür → teoride kullanıcı-adı → e-posta numaralandırması (enumeration)
-- mümkün. MVP için kabul edilebilir (birçok tüketici uygulaması kullanıcı-adı girişine
-- izin verir). Sıfır-sızıntı gerekirse ileride girişi bir Edge Function'a taşıyıp
-- e-postayı istemciye hiç göndermeden sunucuda çözebiliriz. [[security-audit]]

create or replace function public.email_for_login(identifier text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  result text;
  ident  text := trim(coalesce(identifier, ''));
begin
  if length(ident) = 0 then
    return null;
  end if;

  -- E-posta gibi görünüyorsa aynen (küçük harf) döndür
  if position('@' in ident) > 0 then
    return lower(ident);
  end if;

  -- Kullanıcı adından e-postayı bul (harf duyarsız)
  select u.email into result
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(ident)
  limit 1;

  return result;
end;
$$;

grant execute on function public.email_for_login(text) to anon, authenticated;
