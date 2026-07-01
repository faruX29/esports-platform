-- Migration: news_comments.parent_id — forum thread/yanıt desteği
-- Self-referencing FK; parent silinince yanıtlar da silinir (CASCADE). Idempotent.

ALTER TABLE public.news_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid
  REFERENCES public.news_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_news_comments_parent
  ON public.news_comments(parent_id)
  WHERE parent_id IS NOT NULL;
