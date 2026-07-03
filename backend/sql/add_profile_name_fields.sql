-- Espor isim formatı: Ad "Gamertag" Soyad (Gemini kararı [[auth-onboarding]]).
-- gamertag = mevcut profiles.username; first_name/last_name ayrı alanlar.
-- getEsportsName(profile) → first_name "username" last_name (fallback'li).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;
