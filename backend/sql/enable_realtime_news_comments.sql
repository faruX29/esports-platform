-- Migration: news_comments için Supabase Realtime
-- Forum yorumları/yanıtları reload'suz görünsün (postgres_changes INSERT/DELETE).
-- Publication'a eklenmezse subscribeToNewsComments hiçbir event almaz.

ALTER PUBLICATION supabase_realtime ADD TABLE public.news_comments;

-- DELETE payload'ının eski satırı (news_id, parent_id) içermesi için gerekli
ALTER TABLE public.news_comments REPLICA IDENTITY FULL;
