-- Migration: add number_of_games column to matches + backfill from raw_data
-- Run in Supabase SQL Editor (idempotent — safe to re-run)

-- 1. Add column
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS number_of_games smallint;

-- 2. Backfill from raw_data (PandaScore stores it as top-level field)
UPDATE public.matches
SET    number_of_games = (raw_data->>'number_of_games')::smallint
WHERE  number_of_games IS NULL
  AND  raw_data->>'number_of_games' IS NOT NULL
  AND  (raw_data->>'number_of_games') ~ '^\d+$';

-- 3. Diagnostic: count coverage
SELECT
    number_of_games,
    COUNT(*) AS match_count
FROM public.matches
WHERE number_of_games IS NOT NULL
GROUP BY number_of_games
ORDER BY number_of_games;
