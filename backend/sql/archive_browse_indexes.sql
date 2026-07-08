-- 33k arşiv "Past Results" browse + arama hızlandırma index'leri
-- Ölçüm (EXPLAIN ANALYZE, sıcak cache) index ÖNCESİ:
--   * Tek-oyun Past browse (game_id=8, 14.5k maç): ~48ms (14.5k satır top-N sort)
--   * Teams ILIKE '%x%' (arama id çözümü): ~47ms (2581 satır seq scan)
--   * ALL-games Past browse: ~15ms / deep page (offset 5000): ~23ms
-- CONCURRENTLY: tablo kilidi almaz, canlıda güvenli. Explicit transaction DIŞINDA çalıştır.

-- 1) Tek-oyun Past browse + count: (game_id, scheduled_at DESC, id DESC) — status='finished' partial.
--    ORDER BY scheduled_at DESC, id DESC ile birebir eşleşir → sort tamamen kalkar, LIMIT 50 erken durur.
--    'date-asc' yönü için index geriye taranır (aynı index her iki yöne hizmet eder).
create index concurrently if not exists idx_matches_finished_game_sched
on public.matches (game_id, scheduled_at desc, id desc)
where status = 'finished';

-- 2) ALL-games Past browse + deep page: (scheduled_at DESC, id DESC) — status='finished' partial.
--    32k seq scan + sort yerine düz index range scan.
create index concurrently if not exists idx_matches_finished_sched
on public.matches (scheduled_at desc, id desc)
where status = 'finished';

-- 3) Arama: takım/turnuva adı ILIKE '%q%' → trigram GIN (leading-wildcard ILIKE'ı hızlandırır).
create extension if not exists pg_trgm;

create index concurrently if not exists idx_teams_name_trgm
on public.teams using gin (name gin_trgm_ops);

create index concurrently if not exists idx_tournaments_name_trgm
on public.tournaments using gin (name gin_trgm_ops);
