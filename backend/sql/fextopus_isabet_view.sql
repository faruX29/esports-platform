-- Fextopus güven katmanı isabet matrisi (Gemini kararı #65)
--
-- /stats sayfası bu görünümü okur. Sayılar sayfaya ELLE YAZILMAZ; her
-- istekte canlı veriden hesaplanır. Gerekçe: 17 Eylül B2B demosunda
-- "%75 isabetliyiz" demek zayıf bir iddia; "işte 36.565 maçlık dağılım,
-- kendiniz bakın" demek doğrulanabilir.
--
-- Katmanlar model olasılığına göre:
--   zirve  >= %70    yuksek >= %65    orta %55-64    dusuk < %55
-- Dönemler: tum / 90g / 30g  (model bozuluyor mu, karşılaştırılabilsin)

CREATE OR REPLACE VIEW public.fextopus_isabet AS
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
  FROM matches m
  WHERE m.winner_id IS NOT NULL
    AND m.prediction_team_a IS NOT NULL
    AND m.prediction_team_b IS NOT NULL
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

-- Görünüm yalnızca toplulaştırılmış sayı döndürür; kişisel veri yok.
GRANT SELECT ON public.fextopus_isabet TO anon, authenticated;
