-- ─────────────────────────────────────────────────────────────────────────
-- Maç değişimlerini Realtime Broadcast ile yayınla (postgres_changes yerine)
-- 27 Ekim 2026 — denetim Faz 4
--
-- NEDEN: matches tablosu supabase_realtime yayınındaydı (REPLICA IDENTITY FULL).
-- Her satır UPDATE'i (ETL'in skor/durum değiştirmeyen yazımları dahil) her açık
-- kanala eski + yeni TÜM satırı (raw_data JSON'u dahil, ~4 KB) gönderiyordu; ana
-- sayfada aynı istemci 2 kanal açtığı için mesaj ikiye katlanıyordu. Ayrıca RLS
-- açık tabloda payload.old yalnız birincil anahtarı taşıdığı için istemci "durum
-- değişti mi"yi hiç bilemiyordu (skor her değiştiğinde "Maç başladı" bildirimi).
--
-- ÇÖZÜM: ifade düzeyinde tetikleyici. Bir UPDATE/INSERT ifadesinde durum, skor,
-- kazanan, saat ya da takım gerçekten değişen maçlar TEK mesajda, yalnız gereken
-- sütunlarla ve eski değerleriyle ('eski') herkese açık 'maclar' konusuna gider.
-- canli-senkron dakikada bir koşuyorsa en fazla dakikada bir mesaj.
--
-- GÜVENLİK: yayın hatası maç yazımını ASLA bozmaz (EXCEPTION → WARNING).
-- İçerik zaten herkese açık okunan matches sütunları; kişisel veri yok.
--
-- Uygulama sırası:
--   1) Bu dosya (tetikleyici). Eski postgres_changes aboneliği de çalışmaya devam eder.
--   2) Frontend deploy (istemci 'maclar' Broadcast kanalını dinler).
--   3) Eski sekmeler yenilendikten sonra (bir gün yeter) dosyanın sonundaki ADIM 3.
-- Tekrar çalıştırmak güvenlidir.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.maclar_yayin_tetik() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    degisen jsonb;
    adet    integer;
    i       integer;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT jsonb_agg(jsonb_build_object(
                   'id', y.id, 'game_id', y.game_id, 'status', y.status,
                   'scheduled_at', y.scheduled_at,
                   'team_a_id', y.team_a_id, 'team_b_id', y.team_b_id,
                   'team_a_score', y.team_a_score, 'team_b_score', y.team_b_score,
                   'winner_id', y.winner_id,
                   'eski', jsonb_build_object(
                       'status', e.status,
                       'team_a_score', e.team_a_score, 'team_b_score', e.team_b_score,
                       'winner_id', e.winner_id)))
          INTO degisen
          FROM yeni_satirlar y
          JOIN eski_satirlar e ON e.id = y.id
         WHERE (y.status, y.team_a_score, y.team_b_score, y.winner_id,
                y.scheduled_at, y.team_a_id, y.team_b_id)
               IS DISTINCT FROM
               (e.status, e.team_a_score, e.team_b_score, e.winner_id,
                e.scheduled_at, e.team_a_id, e.team_b_id);
    ELSE
        SELECT jsonb_agg(jsonb_build_object(
                   'id', y.id, 'game_id', y.game_id, 'status', y.status,
                   'scheduled_at', y.scheduled_at,
                   'team_a_id', y.team_a_id, 'team_b_id', y.team_b_id,
                   'team_a_score', y.team_a_score, 'team_b_score', y.team_b_score,
                   'winner_id', y.winner_id,
                   'eski', NULL))
          INTO degisen
          FROM yeni_satirlar y;
    END IF;

    IF degisen IS NULL THEN
        RETURN NULL;
    END IF;

    -- Toplu ETL yazımında mesaj boyutu sınırını aşmamak için 100'lük parçalar.
    adet := jsonb_array_length(degisen);
    FOR i IN 0 .. (adet - 1) / 100 LOOP
        PERFORM realtime.send(
            jsonb_build_object(
                'tur', lower(TG_OP),
                'maclar', (SELECT jsonb_agg(x ORDER BY n)
                             FROM jsonb_array_elements(degisen) WITH ORDINALITY t(x, n)
                            WHERE n > i * 100 AND n <= (i + 1) * 100)),
            'degisim',      -- olay adı (istemci: broadcast event)
            'maclar',       -- konu (istemci: supabase.channel('maclar'))
            false);         -- herkese açık kanal
    END LOOP;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'maclar_yayin_tetik: %', SQLERRM;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.maclar_yayin_tetik() FROM public, anon, authenticated;

-- Geçiş tablosu kullanan tetikleyici tek olay alabilir → INSERT ve UPDATE ayrı.
DROP TRIGGER IF EXISTS maclar_yayin_guncelleme ON public.matches;
CREATE TRIGGER maclar_yayin_guncelleme
    AFTER UPDATE ON public.matches
    REFERENCING OLD TABLE AS eski_satirlar NEW TABLE AS yeni_satirlar
    FOR EACH STATEMENT EXECUTE FUNCTION public.maclar_yayin_tetik();

DROP TRIGGER IF EXISTS maclar_yayin_ekleme ON public.matches;
CREATE TRIGGER maclar_yayin_ekleme
    AFTER INSERT ON public.matches
    REFERENCING NEW TABLE AS yeni_satirlar
    FOR EACH STATEMENT EXECUTE FUNCTION public.maclar_yayin_tetik();

-- ─────────────────────────────────────────────────────────────────────────
-- DOĞRULAMA
--   select inserted_at, topic, event, payload->>'tur', jsonb_array_length(payload->'maclar')
--     from realtime.messages where topic = 'maclar' order by inserted_at desc limit 20;
--   (realtime.messages Supabase tarafından birkaç günde bir temizlenir.)
--
-- ADIM 3 — frontend yayında ve eski sekmeler kapandıktan sonra (elle):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.matches;
--   ALTER TABLE public.matches REPLICA IDENTITY DEFAULT;   -- WAL'a tüm satırı yazmayı bırak
--
-- GERİ ALMA:
--   DROP TRIGGER IF EXISTS maclar_yayin_guncelleme ON public.matches;
--   DROP TRIGGER IF EXISTS maclar_yayin_ekleme ON public.matches;
--   (eski yol: ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
--              ALTER TABLE public.matches REPLICA IDENTITY FULL;)
-- ─────────────────────────────────────────────────────────────────────────
