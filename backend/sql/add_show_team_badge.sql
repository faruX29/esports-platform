-- Kullanıcı tercihi: forum yorumlarında favori takım logosu rozeti gösterilsin mi?
-- Varsayılan true (göster); gizlemek isteyen ProfileSettings'ten kapatabilir.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_team_badge boolean NOT NULL DEFAULT true;
