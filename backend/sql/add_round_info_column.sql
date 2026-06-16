-- Migration: add round_info column to matches + backfill from raw_data
-- Run in Supabase SQL Editor (each statement is safe to re-run)

-- 1. Add column (no-op if already exists)
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS round_info text;

-- 2. Backfill from the match "name" field in raw_data.
--    PandaScore does NOT expose a dedicated round_info key; instead it embeds the
--    bracket stage label in the match name before the colon:
--    e.g. "Upper bracket final: PRV vs VIT" → round_info = "Upper bracket final"
--         "Mid bracket quarterfinal 2: VIT vs GX" → "Mid bracket quarterfinal 2"
UPDATE public.matches
SET    round_info = TRIM(SPLIT_PART(raw_data->>'name', ':', 1))
WHERE  round_info IS NULL
  AND  raw_data->>'name' IS NOT NULL
  AND  TRIM(SPLIT_PART(raw_data->>'name', ':', 1)) <> '';

-- 3. Index: accelerates tournament bracket queries filtered by round
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_tournament_round_info
ON public.matches (tournament_id, round_info)
WHERE round_info IS NOT NULL;

-- 4. Diagnostic: show distribution after backfill
SELECT
    round_info,
    COUNT(*) AS match_count
FROM public.matches
WHERE round_info IS NOT NULL
GROUP BY round_info
ORDER BY match_count DESC
LIMIT 30;
