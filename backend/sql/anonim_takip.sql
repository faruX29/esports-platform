-- ─────────────────────────────────────────────────────────────────────────
-- Anonim oturumla sunucuda takip
-- 27 Ekim 2026 (denetim Faz 6, kurucu kararı: web de sunucuya geçer)
--
-- Kayıtsız ziyaretçi İLK TAKİPTE Supabase anonim oturumu açar (Turnstile ile);
-- takipleri `follows`'a kendi anonim user_id'siyle yazılır. Sayfa yükünde
-- oturum açılmaz → botlar ve yalnız gezen ziyaretçi kullanıcı üretmez.
--
-- Anonim kullanıcı Postgres'te `authenticated` rolüyle gelir; JWT'de
-- is_anonymous = true. Mevcut politikalar yalnız auth.uid() = user_id
-- baktığı için anonim kullanıcı yorum yazabilir, beğenebilir, avatar
-- yükleyebilirdi. Aşağıdaki KISITLAYICI (restrictive) politikalar bunu
-- keser: izin veren politikalarla VE'lenir, yalnız `follows` serbest kalır.
--
-- Önkoşul (panel): Authentication → Sign In / Providers → "Allow anonymous
-- sign-ins" açık. Kapalıysa istemci eski davranışa (sessionStorage) düşer.
--
-- Tekrar çalıştırmak güvenlidir.
-- ─────────────────────────────────────────────────────────────────────────

-- Kayıtlı (anonim olmayan) oturum mu. JWT yoksa (anon rolü) false.
CREATE OR REPLACE FUNCTION public.kayitli_oturum() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT auth.uid() IS NOT NULL
       AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false;
$$;

-- ── Anonim kullanıcıya kapalı yazmalar ──────────────────────────────────
DO $$
DECLARE
    t   text;
    k   text;
BEGIN
    FOREACH t IN ARRAY ARRAY['news_comments', 'news_likes', 'news_comment_votes',
                             'match_community_votes', 'match_mvp_votes', 'profiles',
                             'user_favorites']
    LOOP
        FOREACH k IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_kayitli_' || k, t);
            IF k = 'insert' THEN
                EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
                                WITH CHECK (public.kayitli_oturum())', t || '_kayitli_' || k, t);
            ELSIF k = 'update' THEN
                EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
                                USING (public.kayitli_oturum()) WITH CHECK (public.kayitli_oturum())', t || '_kayitli_' || k, t);
            ELSE
                EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
                                USING (public.kayitli_oturum())', t || '_kayitli_' || k, t);
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- Avatar yükleme/değiştirme/silme de yalnız kayıtlı oturuma.
DROP POLICY IF EXISTS avatars_kayitli_insert ON storage.objects;
CREATE POLICY avatars_kayitli_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (bucket_id <> 'avatars' OR public.kayitli_oturum());
DROP POLICY IF EXISTS avatars_kayitli_update ON storage.objects;
CREATE POLICY avatars_kayitli_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (bucket_id <> 'avatars' OR public.kayitli_oturum());

-- ── Takip sınırları ─────────────────────────────────────────────────────
-- Anonim oturum Turnstile arkasında ama yine de kullanıcı başına üst sınır:
-- tek oturumdan binlerce satır yazılmasın. Gerçek kullanım onlarla ölçülür.
CREATE OR REPLACE FUNCTION public.follows_sinir() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF length(NEW.target_id) > 64 THEN
        RAISE EXCEPTION 'takip hedefi geçersiz' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.follows WHERE user_id = NEW.user_id) >= 300 THEN
        RAISE EXCEPTION 'takip sınırı (300) aşıldı' USING ERRCODE = '54000';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.follows_sinir() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_follows_sinir ON public.follows;
CREATE TRIGGER trg_follows_sinir BEFORE INSERT ON public.follows
    FOR EACH ROW EXECUTE FUNCTION public.follows_sinir();

-- ── 30 gün işlemsiz anonim kullanıcıları sil ────────────────────────────
-- İşlem = oturum tazelemesi (açık sekme saatte bir token yeniler). Silinince
-- follows/push_tokens CASCADE ile gider. Kayıt olan ziyaretçinin takipleri
-- istemcide yeni hesaba devredilir; eski anonim kayıt burada temizlenir.
CREATE OR REPLACE FUNCTION public.anonim_temizle() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
    silinen integer;
BEGIN
    DELETE FROM auth.users u
    WHERE u.is_anonymous
      AND u.created_at < now() - interval '30 days'
      AND NOT EXISTS (
          SELECT 1 FROM auth.sessions s
          WHERE s.user_id = u.id
            AND greatest(s.created_at, s.updated_at, s.refreshed_at::timestamptz) > now() - interval '30 days'
      );
    GET DIAGNOSTICS silinen = ROW_COUNT;
    RETURN silinen;
END $$;
REVOKE ALL ON FUNCTION public.anonim_temizle() FROM public, anon, authenticated;

SELECT cron.unschedule('anonim-temizle') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'anonim-temizle');
SELECT cron.schedule('anonim-temizle', '41 3 * * *', $CRON$select public.anonim_temizle()$CRON$);
