-- RPC: AI tahmin doğruluğu (trust signal) — frontend supabase.rpc ile çağırır.
-- 9000+ satırı client'a çekmek yerine tek sorguda hesaplar.
--
-- DÜRÜST metrik: gerçek tahmin yapılmayan maçlar (prediction_team_a = _b, yani
-- 50/50) HARİÇ. "confident" = favori olasılığı >= 0.70; /stats'taki "Çok emin"
-- katmanıyla (fextopus_isabet 'zirve') aynı tanım ve aynı filtre. 4 Kasım'a kadar
-- 0.65'ti: rozet "%73", /stats "%75" diyordu, ikisi de "en güvendiği maçlarda".
--
-- days_back: 0 veya negatif → tüm zamanlar; >0 → son N gün.
--
-- 6 Kasım: tüm zamanlar (sitedeki tek kullanım) fextopus_isabet_ozet'ten okunur
-- (fextopus_isabet_view.sql; pg_cron 10 dk'da bir tazeler). Eskiden her çağrı matches'ı
-- tam tarıyordu; önbellek soğukken anon'un 3 sn sınırını aşıp 500 dönüyordu. Özetin
-- filtresi aynı, ek olarak takım/tahmin B boş satırları dışlar (6 Kas'ta fark 0 maç).
-- days_back > 0 hâlâ canlı hesaplanır.
-- ÖNCE fextopus_isabet_view.sql çalışmış olmalı.

CREATE OR REPLACE FUNCTION public.get_prediction_accuracy(days_back int DEFAULT 0)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN days_back <= 0 THEN (
    SELECT json_build_object(
      'total',             SUM(mac),
      'correct',           SUM(dogru),
      'accuracy_pct',      ROUND(100.0 * SUM(dogru) / NULLIF(SUM(mac), 0), 1),
      'confident_total',   COALESCE(SUM(mac) FILTER (WHERE katman = 'zirve'), 0),
      'confident_correct', COALESCE(SUM(dogru) FILTER (WHERE katman = 'zirve'), 0),
      'confident_pct',     ROUND(100.0 * SUM(dogru) FILTER (WHERE katman = 'zirve')
                                 / NULLIF(SUM(mac) FILTER (WHERE katman = 'zirve'), 0), 1)
    )
    FROM public.fextopus_isabet_ozet
    WHERE donem = 'tum'
  ) ELSE (
  SELECT json_build_object(
    'total',             COUNT(*),
    'correct',           COUNT(*) FILTER (WHERE correct),
    'accuracy_pct',      ROUND(100.0 * COUNT(*) FILTER (WHERE correct)
                               / NULLIF(COUNT(*), 0), 1),
    'confident_total',   COUNT(*) FILTER (WHERE fav_prob >= 0.70),
    'confident_correct', COUNT(*) FILTER (WHERE correct AND fav_prob >= 0.70),
    'confident_pct',     ROUND(100.0 * COUNT(*) FILTER (WHERE correct AND fav_prob >= 0.70)
                               / NULLIF(COUNT(*) FILTER (WHERE fav_prob >= 0.70), 0), 1)
  )
  FROM (
    SELECT
      GREATEST(prediction_team_a, prediction_team_b) AS fav_prob,
      (
        (prediction_team_a > prediction_team_b AND winner_id = team_a_id) OR
        (prediction_team_b > prediction_team_a AND winner_id = team_b_id)
      ) AS correct
    FROM public.matches
    WHERE status = 'finished'
      AND winner_id IS NOT NULL
      AND prediction_team_a IS NOT NULL
      AND prediction_team_a <> prediction_team_b
      AND scheduled_at > NOW() - (days_back * INTERVAL '1 day')
  ) x
  ) END;
$$;

-- Frontend (anon) + giriş yapmış kullanıcılar çağırabilsin
GRANT EXECUTE ON FUNCTION public.get_prediction_accuracy(int) TO anon, authenticated;
