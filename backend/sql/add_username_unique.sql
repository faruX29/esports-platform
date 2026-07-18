-- Kullanıcı adı benzersizliği (büyük/küçük harf duyarsız).
-- Uygulama katmanı ön-kontrol yapıyor (AuthContext.signUp) ama nihai garanti burada:
-- lower(username) üzerinde UNIQUE index → "ayşe" ve "Ayşe" aynı sayılır, ikinci kayıt reddedilir.
--
-- ⚠️ Önce mevcut mükerrerleri kontrol et; varsa index oluşturmaz. Bu sorgu boş dönmeli:
--
--   SELECT lower(username) AS u, count(*)
--   FROM public.profiles
--   WHERE username IS NOT NULL AND btrim(username) <> ''
--   GROUP BY lower(username)
--   HAVING count(*) > 1
--   ORDER BY count(*) DESC;
--
-- Mükerrer çıkarsa, eski/az-aktif hesapların username'ini elle değiştir, sonra bunu çalıştır.

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_uniq
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL AND btrim(username) <> '';
