-- Turnuva sayfasının etkinlik aşaması şeridi: aynı serie_id'yi paylaşan kardeş
-- turnuvalar (TournamentPage.jsx: matches?serie_id=eq.<id>&tournament_id=not.is.null).
-- İndeks yokken sorgu tüm tabloyu tarıyordu; soğuk önbellekte anon'un 3 sn
-- statement_timeout'unu aşıp 500 dönüyor, şerit sessizce kayboluyordu.
-- tournament_id ikinci sütun: sorgu yalnız onu okuyor (görünürlük haritası
-- güncelse yalnız-indeks taraması).
--
-- CONCURRENTLY: işlem bloğu dışında koşturun (psql / autocommit); pg_cron
-- dakikada bir matches'a yazdığı için tabloyu kilitlemez.
-- Geri alma: drop index concurrently if exists public.idx_matches_serie;

create index concurrently if not exists idx_matches_serie
  on public.matches (serie_id, tournament_id)
  where serie_id is not null;
