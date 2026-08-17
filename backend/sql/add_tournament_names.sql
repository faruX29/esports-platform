-- Turnuva tam-ad alanları.
--
-- SORUN: tournaments.name PandaScore'da sık sık AŞAMA'yı tutuyor ("Play-In",
-- "Playoffs", "Group A"), tam etkinlik adını değil. Tam ad league+serie'de:
--   league.name       → "VCT"                    (league_name)
--   serie.full_name   → "Americas Stage 2 2026"  (event_name)
-- Bunları saklayıp compose ederiz: "VCT Americas Stage 2 2026 · Playoffs".
--
-- display_name: opsiyonel MANUEL override — doluysa her şeyi ezer, ETL DOKUNMAZ
-- (COALESCE ile korunur). Tek-tük garip vakalar için.

alter table tournaments add column if not exists league_name text;
alter table tournaments add column if not exists event_name  text;
alter table tournaments add column if not exists display_name text;
