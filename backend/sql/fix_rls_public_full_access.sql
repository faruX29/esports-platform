-- ============================================================================
-- GÜVENLİK FIX (CRITICAL) — "Public Full Access" (ALL/anon/true) RLS'i eziyordu.
-- Fable güvenlik denetimi bulgusu. Anon key ile herkes tüm tabloları
-- silebiliyor/değiştirebiliyordu. Bu migration:
--   1) Tehlikeli permissive politikaları DÜŞÜRÜR (Public Full Access + benzerleri)
--   2) Katalog tablolarında public SELECT KORUNUR (site anon ziyaretçilere açık kalır)
--   3) Kullanıcı-verisi tablolarında sahiplik (auth.uid()) zorunlu kılınır
--   4) Eksik SELECT (like sayısı) / DELETE (kendi yorumunu sil) politikaları eklenir
-- NOT: Backend ETL postgres/owner rolüyle bağlanır → RLS'i baypas eder, bozulmaz.
-- ============================================================================

-- ── 1) "Public Full Access" (ALL/anon/true) — 15 tablodan kaldır ─────────────
DROP POLICY IF EXISTS "Public Full Access" ON public.follows;
DROP POLICY IF EXISTS "Public Full Access" ON public.games;
DROP POLICY IF EXISTS "Public Full Access" ON public.match_community_votes;
DROP POLICY IF EXISTS "Public Full Access" ON public.match_mvp_votes;
DROP POLICY IF EXISTS "Public Full Access" ON public.match_stats;
DROP POLICY IF EXISTS "Public Full Access" ON public.matches;
DROP POLICY IF EXISTS "Public Full Access" ON public.news_comment_votes;
DROP POLICY IF EXISTS "Public Full Access" ON public.news_comments;
DROP POLICY IF EXISTS "Public Full Access" ON public.news_likes;
DROP POLICY IF EXISTS "Public Full Access" ON public.player_match_stats;
DROP POLICY IF EXISTS "Public Full Access" ON public.players;
DROP POLICY IF EXISTS "Public Full Access" ON public.profiles;
DROP POLICY IF EXISTS "Public Full Access" ON public.teams;
DROP POLICY IF EXISTS "Public Full Access" ON public.tournaments;
DROP POLICY IF EXISTS "Public Full Access" ON public.user_favorites;

-- ── 2) Diğer tehlikeli permissive politikalar ───────────────────────────────
-- Sahipsiz INSERT (CHECK=true) → herkes başkasının user_id'siyle yazabiliyordu
DROP POLICY IF EXISTS "Herkes yorum yapabilir" ON public.news_comments;
DROP POLICY IF EXISTS "Herkes oy verebilir" ON public.news_comment_votes;
-- Sahipsiz ALL (true) — user_favorites'te doğru olanı ('Users can only manage...') var
DROP POLICY IF EXISTS "anyone can manage their favorites" ON public.user_favorites;

-- ── 3) Eksik politikaları ekle (fonksiyonellik korunsun) ────────────────────
-- news_likes: beğeni SAYISI için public SELECT şart (yoksa herkes sadece kendi
-- beğenisini görür, sayaç bozulur). Yazma zaten sahiplik-bazlı kalır.
DROP POLICY IF EXISTS news_likes_read_all ON public.news_likes;
CREATE POLICY news_likes_read_all ON public.news_likes
  FOR SELECT TO public USING (true);

-- news_comments: kullanıcı KENDİ yorumunu silebilsin (uygulamada sil butonu var).
-- (INSERT own + SELECT public zaten mevcut; sadece DELETE own eksikti.)
DROP POLICY IF EXISTS news_comments_delete_own ON public.news_comments;
CREATE POLICY news_comments_delete_own ON public.news_comments
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
