-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ roster_changes migration                                                │
-- │ Run once in Supabase SQL Editor (idempotent — safe to re-run).         │
-- └─────────────────────────────────────────────────────────────────────────┘

-- 1. Event log table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roster_changes (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id        bigint      NOT NULL REFERENCES public.players(id),
    source_team_id   bigint      REFERENCES public.teams(id),   -- NULL = free agent arrival
    target_team_id   bigint      REFERENCES public.teams(id),   -- NULL = released to FA
    transfer_date    date        NOT NULL,
    transfer_type    text        NOT NULL DEFAULT 'permanent'
                     CHECK (transfer_type IN ('permanent', 'loan', 'trial', 'release')),
    data_source      text        NOT NULL DEFAULT 'liquipedia', -- audit trail
    raw_payload      jsonb,                                     -- scraper raw output
    idempotency_hash text        NOT NULL,                      -- SHA-256 dedup key
    news_generated   boolean     NOT NULL DEFAULT false,        -- consumed by news engine?
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_roster_changes_hash UNIQUE (idempotency_hash)
);

-- 2. Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_roster_changes_player
    ON public.roster_changes (player_id);

CREATE INDEX IF NOT EXISTS idx_roster_changes_date
    ON public.roster_changes (transfer_date DESC);

-- Partial index: news engine scans only unprocessed rows — very cheap poll
CREATE INDEX IF NOT EXISTS idx_roster_changes_news_pending
    ON public.roster_changes (created_at DESC)
    WHERE news_generated = false;

-- 3. Thin trigger function ────────────────────────────────────────────────────
-- Rule: only updates players.team_id. No business logic, no side effects.
-- loan + release left to application layer to avoid trigger complexity.
CREATE OR REPLACE FUNCTION public.sync_player_team_on_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.transfer_type IN ('permanent', 'trial')
       AND NEW.target_team_id IS NOT NULL
    THEN
        UPDATE public.players
           SET team_id = NEW.target_team_id
         WHERE id = NEW.player_id;
    END IF;
    RETURN NEW;
END;
$$;

-- 4. Trigger (DROP + CREATE makes re-runs idempotent) ─────────────────────────
DROP TRIGGER IF EXISTS trg_roster_change_sync ON public.roster_changes;

CREATE TRIGGER trg_roster_change_sync
    AFTER INSERT ON public.roster_changes
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_player_team_on_transfer();

-- 5. Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.roster_changes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE tablename  = 'roster_changes'
           AND policyname = 'roster_changes_read_all'
    ) THEN
        EXECUTE 'CREATE POLICY roster_changes_read_all
                 ON public.roster_changes
                 FOR SELECT
                 USING (true)';
    END IF;
END
$$;
