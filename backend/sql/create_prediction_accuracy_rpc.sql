-- RPC: AI tahmin doğruluğu (trust signal) — frontend supabase.rpc ile çağırır.
-- 9000+ satırı client'a çekmek yerine tek sorguda hesaplar.
--
-- DÜRÜST metrik: gerçek tahmin yapılmayan maçlar (prediction_team_a = _b, yani
-- 50/50) HARİÇ. "confident" = favori olasılığı >= 0.65 (kalibre alt-küme, ~%72).
--
-- days_back: 0 veya negatif → tüm zamanlar; >0 → son N gün.

CREATE OR REPLACE FUNCTION public.get_prediction_accuracy(days_back int DEFAULT 0)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'total',             COUNT(*),
    'correct',           COUNT(*) FILTER (WHERE correct),
    'accuracy_pct',      ROUND(100.0 * COUNT(*) FILTER (WHERE correct)
                               / NULLIF(COUNT(*), 0), 1),
    'confident_total',   COUNT(*) FILTER (WHERE fav_prob >= 0.65),
    'confident_correct', COUNT(*) FILTER (WHERE correct AND fav_prob >= 0.65),
    'confident_pct',     ROUND(100.0 * COUNT(*) FILTER (WHERE correct AND fav_prob >= 0.65)
                               / NULLIF(COUNT(*) FILTER (WHERE fav_prob >= 0.65), 0), 1)
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
      AND (days_back <= 0 OR scheduled_at > NOW() - (days_back * INTERVAL '1 day'))
  ) x;
$$;

-- Frontend (anon) + giriş yapmış kullanıcılar çağırabilsin
GRANT EXECUTE ON FUNCTION public.get_prediction_accuracy(int) TO anon, authenticated;
