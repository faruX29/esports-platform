-- ─────────────────────────────────────────────────────────────────────────
-- Push bildirim altyapısı (mobil uygulama için)
-- 27 Ekim 2026 (denetim Faz 6)
--
-- Akış:
--   1) Uygulama FCM token'ını `push_token_kaydet` RPC'siyle yazar (yalnız
--      kayıtlı hesap; kurucu kararı: push yalnız hesaplıya).
--   2) Kuyruğa satır üç yerden düşer:
--        • matches tetikleyicisi: not_started → running  = "başladı"
--                                 running/not_started → finished = "bitti"
--          Tetikleyici her yazıcıyı yakalar (pg_cron canli-senkron, GitHub
--          ETL, orphan düzeltmesi); yalnız canli-senkron'a bağlamak eksik kalırdı.
--        • pg_cron `bildirim-yakinda`: 15 dk içinde başlayacak maçlar.
--      Alıcı: maçtaki takımı takip eden ya da "Türk takımları" tercihini açan,
--      en az bir push token'ı olan kayıtlı kullanıcı. Aynı (kullanıcı, maç,
--      tür) için tek satır (UNIQUE) → durum gidip gelse de çift bildirim yok.
--   3) pg_cron `bildirim-gonder`: bekleyen satır varsa Edge Function
--      `send-push`'u pg_net ile çağırır; o FCM HTTP v1 ile gönderir.
--
-- GÜVENLİK: Bildirim kodu hata verirse maç güncellemesi BOZULMAZ
-- (tetikleyici hatayı yutup WARNING basar). Canlı skor her şeyden önce gelir.
--
-- Önkoşul (Vault): `push_cron_secret` = Edge Function secret PUSH_CRON_SECRET.
-- Tekrar çalıştırmak güvenlidir.
-- ─────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS bildirim;
REVOKE ALL ON SCHEMA bildirim FROM public;           -- PostgREST'e açılmaz

-- ── Cihaz token'ları ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_tokens (
    id          bigserial   PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token       text        NOT NULL UNIQUE CHECK (length(token) BETWEEN 20 AND 4096),
    platform    text        NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    last_seen   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user ON public.push_tokens (user_id);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tokens FROM anon, authenticated;
GRANT SELECT, DELETE ON public.push_tokens TO authenticated;

DROP POLICY IF EXISTS push_tokens_select_own ON public.push_tokens;
CREATE POLICY push_tokens_select_own ON public.push_tokens FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
DROP POLICY IF EXISTS push_tokens_delete_own ON public.push_tokens;
CREATE POLICY push_tokens_delete_own ON public.push_tokens FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- Yazma yalnız RPC'den: aynı cihaz başka hesaba geçince (çıkış → başka
-- hesapla giriş) token yeni sahibine taşınmalı; RLS bunu istemciye izin
-- vermeden yapamaz. Kullanıcı başına en çok 10 cihaz (en eskisi düşer).
CREATE OR REPLACE FUNCTION public.push_token_kaydet(p_token text, p_platform text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    uid uuid := auth.uid();
BEGIN
    IF NOT public.kayitli_oturum() THEN
        RAISE EXCEPTION 'push için kayıtlı hesap gerekir' USING ERRCODE = '42501';
    END IF;
    IF p_platform NOT IN ('android', 'ios', 'web') OR length(coalesce(p_token, '')) NOT BETWEEN 20 AND 4096 THEN
        RAISE EXCEPTION 'geçersiz token ya da platform' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.push_tokens (user_id, token, platform)
    VALUES (uid, p_token, p_platform)
    ON CONFLICT (token) DO UPDATE
        SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen = now();

    DELETE FROM public.push_tokens
    WHERE user_id = uid
      AND id NOT IN (SELECT id FROM public.push_tokens WHERE user_id = uid ORDER BY last_seen DESC LIMIT 10);
END $$;
REVOKE ALL ON FUNCTION public.push_token_kaydet(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.push_token_kaydet(text, text) TO authenticated;

-- ── Tercihler ────────────────────────────────────────────────────────────
-- Satır yoksa varsayılanlar geçerli (takip edilen takımın üç bildirimi açık,
-- Türk takımları kapalı). Arayüz Faz 7'de (uygulama ayarları).
CREATE TABLE IF NOT EXISTS public.bildirim_tercihleri (
    user_id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    yakinda         boolean     NOT NULL DEFAULT true,
    basladi         boolean     NOT NULL DEFAULT true,
    bitti           boolean     NOT NULL DEFAULT true,
    turk_takimlari  boolean     NOT NULL DEFAULT false,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bildirim_tercihleri ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bildirim_tercihleri FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bildirim_tercihleri TO authenticated;

DROP POLICY IF EXISTS bildirim_tercihleri_own ON public.bildirim_tercihleri;
CREATE POLICY bildirim_tercihleri_own ON public.bildirim_tercihleri FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND public.kayitli_oturum());

DROP TRIGGER IF EXISTS trg_bildirim_tercihleri_updated_at ON public.bildirim_tercihleri;
CREATE TRIGGER trg_bildirim_tercihleri_updated_at BEFORE UPDATE ON public.bildirim_tercihleri
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Kuyruk ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bildirim.kuyruk (
    id          bigserial   PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    match_id    bigint      NOT NULL,
    tur         text        NOT NULL CHECK (tur IN ('yakinda', 'basladi', 'bitti')),
    baslik      text        NOT NULL,
    govde       text        NOT NULL,
    veri        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    olusma      timestamptz NOT NULL DEFAULT now(),
    kilit       timestamptz,                -- send-push aldı, sonucu bekleniyor
    deneme      smallint    NOT NULL DEFAULT 0,
    gonderildi  timestamptz,
    son_hata    text,
    UNIQUE (user_id, match_id, tur)
);
CREATE INDEX IF NOT EXISTS kuyruk_bekleyen ON bildirim.kuyruk (id) WHERE gonderildi IS NULL;
ALTER TABLE bildirim.kuyruk ENABLE ROW LEVEL SECURITY;  -- politikasız: yalnız sahibi (postgres)

-- Bayat bildirim değersiz: 30 dk içinde gidemeyen satır bir daha denenmez.
-- 3 denemede gidemeyen de bırakılır (son_hata'da neden yazar).

-- ── Kuyruğa ekleme ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bildirim.kuyruga_ekle(p_mac_idleri bigint[], p_tur text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, bildirim AS $$
DECLARE
    eklenen integer;
BEGIN
    IF p_mac_idleri IS NULL OR cardinality(p_mac_idleri) = 0 THEN
        RETURN 0;
    END IF;

    WITH m AS (
        SELECT m.id, m.team_a_id, m.team_b_id, m.team_a_score, m.team_b_score,
               ta.name AS a_ad, tb.name AS b_ad,
               coalesce(nullif(t.display_name, ''),
                        nullif(concat_ws(' ', t.league_name, t.event_name), ''),
                        t.name, '') AS turnuva
        FROM public.matches m
        JOIN public.teams ta ON ta.id = m.team_a_id
        JOIN public.teams tb ON tb.id = m.team_b_id
        LEFT JOIN public.tournaments t ON t.id = m.tournament_id
        WHERE m.id = ANY (p_mac_idleri)
    ),
    alici AS (
        SELECT m.id AS match_id, f.user_id
        FROM m
        JOIN public.follows f
          ON f.target_type = 'team' AND f.target_id IN (m.team_a_id::text, m.team_b_id::text)
        UNION
        SELECT m.id, p.user_id
        FROM m
        JOIN public.bildirim_tercihleri p ON p.turk_takimlari
        WHERE EXISTS (SELECT 1 FROM public.turk_takimlar tt WHERE tt.team_id IN (m.team_a_id, m.team_b_id))
    )
    INSERT INTO bildirim.kuyruk (user_id, match_id, tur, baslik, govde, veri)
    SELECT a.user_id, m.id, p_tur,
           CASE p_tur
               WHEN 'yakinda' THEN m.a_ad || ' - ' || m.b_ad || ' 15 dakika sonra başlıyor'
               WHEN 'basladi' THEN m.a_ad || ' - ' || m.b_ad || ' başladı'
               ELSE m.a_ad || ' ' || coalesce(m.team_a_score, 0) || '-' || coalesce(m.team_b_score, 0) || ' ' || m.b_ad
           END,
           CASE p_tur
               WHEN 'bitti' THEN 'Maç bitti' || CASE WHEN m.turnuva <> '' THEN ' · ' || m.turnuva ELSE '' END
               ELSE coalesce(nullif(m.turnuva, ''), 'feXt')
           END,
           jsonb_build_object('url', '/match/' || m.id, 'match_id', m.id::text, 'tur', p_tur)
    FROM alici a
    JOIN m ON m.id = a.match_id
    JOIN auth.users u ON u.id = a.user_id AND NOT u.is_anonymous
    LEFT JOIN public.bildirim_tercihleri p ON p.user_id = a.user_id
    WHERE EXISTS (SELECT 1 FROM public.push_tokens pt WHERE pt.user_id = a.user_id)
      AND CASE p_tur
              WHEN 'yakinda' THEN coalesce(p.yakinda, true)
              WHEN 'basladi' THEN coalesce(p.basladi, true)
              ELSE coalesce(p.bitti, true)
          END
    ON CONFLICT (user_id, match_id, tur) DO NOTHING;

    GET DIAGNOSTICS eklenen = ROW_COUNT;
    RETURN eklenen;
END $$;
REVOKE ALL ON FUNCTION bildirim.kuyruga_ekle(bigint[], text) FROM public;

-- ── matches tetikleyicisi ────────────────────────────────────────────────
-- Zaman sınırları: eski maçın durumu sonradan düzeltilirse (orphan, geç
-- senkron) saatler önce biten maça "bitti" bildirimi gitmesin.
CREATE OR REPLACE FUNCTION bildirim.mac_durum_tetik() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, bildirim AS $$
BEGIN
    BEGIN
        PERFORM bildirim.kuyruga_ekle(ARRAY(
            SELECT n.id FROM yeni_satirlar n JOIN eski_satirlar o ON o.id = n.id
            WHERE o.status = 'not_started' AND n.status = 'running'
              AND coalesce(n.begin_at, n.scheduled_at) > now() - interval '3 hours'
        ), 'basladi');

        PERFORM bildirim.kuyruga_ekle(ARRAY(
            SELECT n.id FROM yeni_satirlar n JOIN eski_satirlar o ON o.id = n.id
            WHERE o.status IN ('running', 'not_started') AND n.status = 'finished'
              AND coalesce(n.begin_at, n.scheduled_at) > now() - interval '8 hours'
              AND coalesce(n.end_at, now()) > now() - interval '1 hour'
        ), 'bitti');
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'bildirim.mac_durum_tetik: % (%)', SQLERRM, SQLSTATE;
    END;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION bildirim.mac_durum_tetik() FROM public;

DROP TRIGGER IF EXISTS bildirim_mac_durum ON public.matches;
CREATE TRIGGER bildirim_mac_durum
    AFTER UPDATE ON public.matches
    REFERENCING OLD TABLE AS eski_satirlar NEW TABLE AS yeni_satirlar
    FOR EACH STATEMENT EXECUTE FUNCTION bildirim.mac_durum_tetik();

-- ── "15 dakika sonra" taraması (dakikada bir) ────────────────────────────
-- Pencere 5-16 dk: dakikalık cron bir koşuyu kaçırsa da maç yakalanır;
-- UNIQUE çift satırı engeller. 5 dk'dan az kalan yeni maça "15 dk" denmez.
CREATE OR REPLACE FUNCTION bildirim.yakinda_tara() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, bildirim AS $$
    SELECT bildirim.kuyruga_ekle(ARRAY(
        SELECT id FROM public.matches
        WHERE status = 'not_started'
          AND coalesce(begin_at, scheduled_at) BETWEEN now() + interval '5 minutes'
                                                    AND now() + interval '16 minutes'
    ), 'yakinda');
$$;
REVOKE ALL ON FUNCTION bildirim.yakinda_tara() FROM public;

-- ── Gönderim tetiği (dakikada bir) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION bildirim.gonder_tetik() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, bildirim, net AS $$
DECLARE
    sir text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM bildirim.kuyruk
        WHERE gonderildi IS NULL AND deneme < 3 AND olusma > now() - interval '30 minutes'
          AND (kilit IS NULL OR kilit < now() - interval '2 minutes')
    ) THEN
        RETURN NULL;                         -- iş yok, istek atılmaz
    END IF;

    SELECT decrypted_secret INTO sir FROM vault.decrypted_secrets WHERE name = 'push_cron_secret' LIMIT 1;
    IF sir IS NULL THEN
        RAISE EXCEPTION 'push_cron_secret Vault''ta yok';
    END IF;

    RETURN net.http_post(
        url     := 'https://owepdnaivhrpadapbtxb.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', sir),
        body    := '{}'::jsonb,
        timeout_milliseconds := 55000
    );
END $$;
REVOKE ALL ON FUNCTION bildirim.gonder_tetik() FROM public;

-- ── send-push'un kullandığı RPC'ler (yalnız service_role) ────────────────
-- Al: bekleyen satırları kilitler, her satıra kullanıcının token'larını ekler.
CREATE OR REPLACE FUNCTION public.push_kuyrugu_al(p_limit integer DEFAULT 200)
RETURNS TABLE (id bigint, baslik text, govde text, veri jsonb, tokenlar jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, bildirim AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    WITH sec AS (
        SELECT k.id FROM bildirim.kuyruk k
        WHERE k.gonderildi IS NULL AND k.deneme < 3 AND k.olusma > now() - interval '30 minutes'
          AND (k.kilit IS NULL OR k.kilit < now() - interval '2 minutes')
        ORDER BY k.id
        LIMIT least(greatest(p_limit, 1), 500)
        FOR UPDATE SKIP LOCKED
    ),
    alinan AS (
        UPDATE bildirim.kuyruk k SET deneme = k.deneme + 1, kilit = now()
        FROM sec WHERE k.id = sec.id
        RETURNING k.id, k.user_id, k.baslik, k.govde, k.veri
    )
    SELECT a.id, a.baslik, a.govde, a.veri,
           coalesce((SELECT jsonb_agg(jsonb_build_object('token', t.token, 'platform', t.platform))
                     FROM public.push_tokens t WHERE t.user_id = a.user_id), '[]'::jsonb)
    FROM alinan a;
END $$;
REVOKE ALL ON FUNCTION public.push_kuyrugu_al(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_kuyrugu_al(integer) TO service_role;

-- İşle: gönderilenleri kapatır, hatalıları tekrar denemeye açar, FCM'in
-- "kayıtlı değil" dediği token'ları siler.
CREATE OR REPLACE FUNCTION public.push_kuyrugu_isle(p_gonderilen bigint[], p_hatali jsonb, p_gecersiz_tokenlar text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, bildirim AS $$
BEGIN
    UPDATE bildirim.kuyruk SET gonderildi = now(), kilit = NULL
    WHERE id = ANY (coalesce(p_gonderilen, '{}'));

    UPDATE bildirim.kuyruk k SET kilit = NULL, son_hata = left(h.hata, 300)
    FROM jsonb_to_recordset(coalesce(p_hatali, '[]'::jsonb)) AS h(id bigint, hata text)
    WHERE k.id = h.id;

    DELETE FROM public.push_tokens WHERE token = ANY (coalesce(p_gecersiz_tokenlar, '{}'));
END $$;
REVOKE ALL ON FUNCTION public.push_kuyrugu_isle(bigint[], jsonb, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_kuyrugu_isle(bigint[], jsonb, text[]) TO service_role;

-- ── Temizlik ve sağlık ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bildirim.temizle() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = bildirim AS $$
DECLARE
    silinen integer;
BEGIN
    DELETE FROM bildirim.kuyruk WHERE olusma < now() - interval '7 days';
    GET DIAGNOSTICS silinen = ROW_COUNT;
    RETURN silinen;
END $$;
REVOKE ALL ON FUNCTION bildirim.temizle() FROM public;

-- Sağlık raporu için (isletim/saglik.py): son 24 saatte gidemeyen bildirim.
CREATE OR REPLACE FUNCTION bildirim.saglik() RETURNS TABLE (bekleyen bigint, basarisiz bigint, gonderilen bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = bildirim AS $$
    SELECT count(*) FILTER (WHERE gonderildi IS NULL AND deneme < 3 AND olusma < now() - interval '10 minutes'),
           count(*) FILTER (WHERE gonderildi IS NULL AND deneme >= 3),
           count(*) FILTER (WHERE gonderildi IS NOT NULL)
    FROM bildirim.kuyruk
    WHERE olusma > now() - interval '24 hours';
$$;
REVOKE ALL ON FUNCTION bildirim.saglik() FROM public;

-- ── Zamanlama ────────────────────────────────────────────────────────────
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN ('bildirim-yakinda', 'bildirim-gonder', 'bildirim-temizle');
SELECT cron.schedule('bildirim-yakinda', '* * * * *', $CRON$select bildirim.yakinda_tara()$CRON$);
SELECT cron.schedule('bildirim-gonder',  '* * * * *', $CRON$select bildirim.gonder_tetik()$CRON$);
SELECT cron.schedule('bildirim-temizle', '47 3 * * *', $CRON$select bildirim.temizle()$CRON$);
