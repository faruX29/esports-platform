-- ─────────────────────────────────────────────────────────────────────────
-- Hesap silme: kullanıcı silinince bağlı satırların davranışı
-- 27 Ekim 2026 (denetim Faz 6)
--
-- Silme Edge Function `delete-account` ile yapılır (auth.admin.deleteUser).
-- auth.users satırı silinince:
--   • profiles, follows, news_likes, news_comment_votes, push_tokens,
--     bildirim_tercihleri → CASCADE (kişisel veri, silinir)
--   • match_mvp_votes, match_community_votes → CASCADE. Önceden ON DELETE
--     kuralı yoktu: oy vermiş kullanıcı silinemezdi (FK hatası).
--   • news_comments → SET NULL. Yorum metni kalır, yazar bağı kopar; arayüz
--     "Silinmiş hesap" gösterir. CASCADE olsaydı yorum silinir, altındaki
--     yanıtlar da (parent_id CASCADE) başkalarının yazdığı olsa bile giderdi.
--
-- Tekrar çalıştırmak güvenlidir.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.news_comments DROP CONSTRAINT IF EXISTS news_comments_user_id_fkey;
ALTER TABLE public.news_comments
    ADD CONSTRAINT news_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.match_mvp_votes DROP CONSTRAINT IF EXISTS match_mvp_votes_user_id_fkey;
ALTER TABLE public.match_mvp_votes
    ADD CONSTRAINT match_mvp_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.match_community_votes DROP CONSTRAINT IF EXISTS match_community_votes_user_id_fkey;
ALTER TABLE public.match_community_votes
    ADD CONSTRAINT match_community_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Yazarı silinmiş yorum düzenlenemez/silinemez (politikalar auth.uid() = user_id
-- ister, NULL hiçbir kullanıcıya eşit değil). Yeni yorum NULL yazarla açılamaz:
CREATE OR REPLACE FUNCTION public.news_comments_yazar_zorunlu() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'yorum yazarı zorunlu' USING ERRCODE = '23502';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.news_comments_yazar_zorunlu() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_news_comments_yazar_zorunlu ON public.news_comments;
CREATE TRIGGER trg_news_comments_yazar_zorunlu
    BEFORE INSERT ON public.news_comments
    FOR EACH ROW EXECUTE FUNCTION public.news_comments_yazar_zorunlu();

-- ── Kalıntı denetimi ────────────────────────────────────────────────────
-- Silinen kullanıcıdan iz kalmış mı: auth.users'ta olmayan user_id'li satır.
-- Hepsi 0 olmalı (news_comments hariç: orada user_id NULL'a çekilir).
-- Sağlık raporu (isletim/saglik.py) aynı sorguyu her sabah çalıştırır.
CREATE OR REPLACE FUNCTION public.hesap_kalinti_sayisi() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
    SELECT (SELECT count(*) FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id))
         + (SELECT count(*) FROM public.follows f WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = f.user_id))
         + (SELECT count(*) FROM public.news_likes l WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.user_id))
         + (SELECT count(*) FROM public.news_comments c WHERE c.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id))
         + (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'avatars'
              AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = (storage.foldername(o.name))[1]));
$$;
REVOKE ALL ON FUNCTION public.hesap_kalinti_sayisi() FROM public, anon, authenticated;
