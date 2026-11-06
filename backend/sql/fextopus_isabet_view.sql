-- Fextopus güven katmanı isabet matrisi (Gemini kararı #65)
--
-- /stats sayfası fextopus_isabet görünümünü okur. Sayılar sayfaya ELLE YAZILMAZ;
-- canlı veriden hesaplanır. Gerekçe: 17 Eylül B2B demosunda "%75 isabetliyiz"
-- demek zayıf bir iddia; "işte 36.565 maçlık dağılım, kendiniz bakın" demek doğrulanabilir.
--
-- Katmanlar model olasılığına göre:
--   zirve  >= %70    yuksek >= %65    orta %55-64    dusuk < %55
-- Dönemler: tum / 90g / 30g  (model bozuluyor mu, karşılaştırılabilsin)
-- Filtre: yalnız biten maç, 50/50 tahmin hariç (4 Kasım'a kadar eşit tahminler "Az
-- emin"de yanlış sayılıyordu, iptal maçlar da giriyordu). get_prediction_accuracy(0)
-- de bu özetten okur (create_prediction_accuracy_rpc.sql) → rozet ve /stats aynı sayı.
--
-- 6 Kasım: hesap materialized view'a taşındı, pg_cron 10 dakikada bir tazeler.
-- Eskiden her istek matches'ı tam tarıyordu (~45 MB); önbellek soğukken anon'un 3 sn
-- statement_timeout'unu aşıp 500 dönüyordu (ana sayfa rozeti, maç sayfasının LCP'si).
-- Index-only scan denendi, yetmedi: matches sürekli güncellendiği için görünürlük
-- haritası birkaç günde bozuluyor, ~2.700 heap okuması kalıyordu.
--
-- ⚠️ Tanımı değiştirmek: CREATE MATERIALIZED VIEW'ın OR REPLACE'i yok →
--   DROP MATERIALIZED VIEW public.fextopus_isabet_ozet CASCADE;  (görünümü de düşürür)
--   sonra bu dosyanın tamamını yeniden çalıştır.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.fextopus_isabet_ozet AS
WITH temel AS (
  SELECT
    CASE
      WHEN m.scheduled_at > NOW() - INTERVAL '30 days' THEN '30g'
      WHEN m.scheduled_at > NOW() - INTERVAL '90 days' THEN '90g'
      ELSE 'eski'
    END AS pencere,
    GREATEST(m.prediction_team_a, m.prediction_team_b) AS guven,
    ((m.prediction_team_a > m.prediction_team_b AND m.winner_id = m.team_a_id)
     OR (m.prediction_team_b > m.prediction_team_a AND m.winner_id = m.team_b_id)) AS dogru
  FROM public.matches m
  WHERE m.status = 'finished'
    AND m.winner_id IS NOT NULL
    AND m.prediction_team_a IS NOT NULL
    AND m.prediction_team_b IS NOT NULL
    AND m.prediction_team_a <> m.prediction_team_b
    AND m.team_a_id IS NOT NULL
    AND m.team_b_id IS NOT NULL
), etiketli AS (
  SELECT
    CASE WHEN guven >= 0.70 THEN 'zirve'
         WHEN guven >= 0.65 THEN 'yuksek'
         WHEN guven >= 0.55 THEN 'orta'
         ELSE 'dusuk' END AS katman,
    pencere, dogru
  FROM temel
), donemli AS (
  SELECT katman, 'tum'::text AS donem, dogru FROM etiketli
  UNION ALL
  SELECT katman, '90g', dogru FROM etiketli WHERE pencere IN ('30g','90g')
  UNION ALL
  SELECT katman, '30g', dogru FROM etiketli WHERE pencere = '30g'
)
SELECT
  donem,
  katman,
  COUNT(*)::int                      AS mac,
  COUNT(*) FILTER (WHERE dogru)::int AS dogru,
  ROUND(100.0 * COUNT(*) FILTER (WHERE dogru) / NULLIF(COUNT(*),0), 1)::numeric(5,1) AS isabet
FROM donemli
GROUP BY donem, katman;

-- REFRESH ... CONCURRENTLY tekil indeks ister (tazelenirken okuyan beklemez).
CREATE UNIQUE INDEX IF NOT EXISTS fextopus_isabet_ozet_anahtar
  ON public.fextopus_isabet_ozet (donem, katman);

-- Yalnız toplulaştırılmış sayı, kişisel veri yok. Supabase'in varsayılan geniş
-- yetkisini sıfırla, yalnız okuma ver (görünüm security_invoker → okuyan rol ister).
REVOKE ALL ON public.fextopus_isabet_ozet FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fextopus_isabet_ozet TO anon, authenticated;

-- /stats'ın okuduğu ad ve sütunlar aynı kalır.
CREATE OR REPLACE VIEW public.fextopus_isabet WITH (security_invoker = true) AS
SELECT donem, katman, mac, dogru, isabet
FROM public.fextopus_isabet_ozet;

GRANT SELECT ON public.fextopus_isabet TO anon, authenticated;

-- Tazeleme: 10 dakikada bir (aynı adla yeniden çalıştırmak işi günceller).
-- Sorun olursa: select * from cron.job_run_details where jobid =
--   (select jobid from cron.job where jobname = 'isabet-tazele') order by start_time desc limit 5;
SELECT cron.schedule(
  'isabet-tazele',
  '*/10 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.fextopus_isabet_ozet$$
);
