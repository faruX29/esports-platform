-- Migration: news_articles table for LLM-generated match news
-- Safe to re-run (all statements are idempotent).

-- 1. Table
CREATE TABLE IF NOT EXISTS public.news_articles (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        bigint      UNIQUE,                         -- one article per match
    title           text        NOT NULL,
    summary         text,
    content         text,
    variant         text,                                       -- 'upset' | 'stomp' | 'close'
    game_slug       text,                                       -- 'valorant' | 'csgo' | 'lol'
    tier            text,                                       -- 'S' | 'A' | 'B' | 'C'
    tournament_name text,
    tournament_id   bigint,
    team_a_name     text,
    team_b_name     text,
    team_a_logo     text,
    team_b_logo     text,
    hero_score      text,                                       -- "Team A 2 - 1 Team B"
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_news_articles_created_at
    ON public.news_articles (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_articles_game_slug
    ON public.news_articles (game_slug)
    WHERE game_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_news_articles_tournament_id
    ON public.news_articles (tournament_id)
    WHERE tournament_id IS NOT NULL;

-- 3. RLS — allow authenticated users to read, service-role to write
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "news_articles_read_all"
    ON public.news_articles FOR SELECT
    USING (true);

-- 4. Diagnostic: row count after migration
SELECT COUNT(*) AS existing_articles FROM public.news_articles;
