-- matches için otomatik bakım (autovacuum) eşiği.
--
-- Canlı senkron tabloyu dakikada bir günceller; her güncelleme sayfanın görünürlük haritası
-- bitini siler. Varsayılan eşikte (ölü satır > %20 + 50 ≈ 8.200) autovacuum günlerce koşmuyor,
-- harita boşalıyor ve "Geçmiş" sekmesinin count(*)'u index-only scan yerine heap okuyor
-- (4 Kas: 19.804 heap okuması, soğukken ~3 sn; VACUUM sonrası 7,6 ms).
-- Eşik ~%2 + 500 (≈ 1.300 ölü satır): tablo küçük (~5.700 sayfa), bakım birkaç saniye sürer.
--
-- Tekrar çalıştırılabilir. Geri almak için:
--   ALTER TABLE public.matches RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);

ALTER TABLE public.matches SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold    = 500
);

-- Doğrulama:
--   select reloptions from pg_class where oid = 'public.matches'::regclass;
--   select n_dead_tup, last_autovacuum from pg_stat_user_tables where relname = 'matches';
