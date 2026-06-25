-- Migration: Enable full Supabase Realtime for matches table
-- Run in Supabase SQL Editor (idempotent — safe to re-run)

-- 1. REPLICA IDENTITY FULL: payload.old gets ALL columns on UPDATE, not just PK.
--    Without this, old.team_a_score / old.status are NULL → change detection breaks.
ALTER TABLE public.matches REPLICA IDENTITY FULL;

-- 2. Add matches to the realtime publication (safe if already present).
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;

-- 3. Verify
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'matches';
