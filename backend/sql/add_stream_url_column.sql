-- Migration: add stream_url column to matches + backfill from raw_data.streams_list
-- Run in Supabase SQL Editor (idempotent — safe to re-run)

-- 1. Add column
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS stream_url text;

-- 2. Backfill: prefer official=true, then main=true, then first entry
UPDATE public.matches
SET stream_url = (
  SELECT COALESCE(
    -- official stream first
    (SELECT s->>'raw_url'
     FROM jsonb_array_elements(raw_data->'streams_list') AS s
     WHERE (s->>'official')::boolean = true
       AND s->>'raw_url' IS NOT NULL
       AND s->>'raw_url' != ''
     LIMIT 1),
    -- main stream fallback
    (SELECT s->>'raw_url'
     FROM jsonb_array_elements(raw_data->'streams_list') AS s
     WHERE (s->>'main')::boolean = true
       AND s->>'raw_url' IS NOT NULL
       AND s->>'raw_url' != ''
     LIMIT 1),
    -- any stream fallback
    (SELECT s->>'raw_url'
     FROM jsonb_array_elements(raw_data->'streams_list') AS s
     WHERE s->>'raw_url' IS NOT NULL
       AND s->>'raw_url' != ''
     LIMIT 1)
  )
)
WHERE stream_url IS NULL
  AND raw_data->'streams_list' IS NOT NULL
  AND jsonb_array_length(raw_data->'streams_list') > 0;

-- 3. Diagnostic: how many matches have stream URLs
SELECT
  status,
  COUNT(*) FILTER (WHERE stream_url IS NOT NULL) AS with_stream,
  COUNT(*)                                        AS total
FROM public.matches
GROUP BY status
ORDER BY status;
