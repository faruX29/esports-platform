-- Migration: scout_waitlist — B2B Scout Engine bekleme listesi
-- Safe to re-run (idempotent).

-- 1. Table
CREATE TABLE IF NOT EXISTS public.scout_waitlist (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email        text        NOT NULL UNIQUE,
    organization text,
    role         text        DEFAULT 'agency',   -- agency | team | scout | other
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scout_waitlist_created_at
    ON public.scout_waitlist (created_at DESC);

-- 2. RLS
-- Herkes (anon) KAYIT olabilir, ama kimse listeyi OKUYAMAZ (e-postalar gizli;
-- sadece service_role erişir). SELECT politikası bilinçli olarak YOK.
ALTER TABLE public.scout_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scout_waitlist_insert_anon" ON public.scout_waitlist;
CREATE POLICY "scout_waitlist_insert_anon"
    ON public.scout_waitlist FOR INSERT
    WITH CHECK (true);

-- 3. Diagnostic
SELECT COUNT(*) AS waitlist_count FROM public.scout_waitlist;
