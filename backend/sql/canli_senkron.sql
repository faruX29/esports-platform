-- ─────────────────────────────────────────────────────────────────────────
-- Veritabanı içi canlı maç senkronu (pg_cron + pg_net)
-- 30 Eylül 2026
--
-- NEDEN: "Sync Live Matches (5-min)" iş akışı adının aksine 3-6 SAATTE BİR
-- koşuyor. GitHub ücretsiz planda kısa aralıklı cron'ları eliyor (30 Eylül:
-- 07:24'ten sonra hiç koşmadı, Vitality-LOUD maçı 2 saat "başlamadı" göründü).
-- Canlı skor vaadimiz fiilen çalışmıyordu.
--
-- ÇÖZÜM: Postgres'in kendi zamanlayıcısı. Vercel CPU kotası harcanmaz,
-- GitHub Actions dakikası yemez, gerçekten dakikada bir koşar.
--
-- KAPSAM: yalnız DELTA — var olan maçın durumu, skoru, kazananı, saati,
-- raw_data'sı. /running'den düşen (biten) maçın son hâlini de kendi
-- kaydından alır (29 Ekim). Yeni maç/takım oluşturmaz; onlar Python ETL'in
-- işi. Takımları satırdakiyle eşleşmeyen maça DOKUNMAZ (30 Eylül skor
-- karışması dersi).
--
-- Uygulama: bu dosya bir kez çalıştırılır. Tekrar çalıştırmak güvenlidir.
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE SCHEMA IF NOT EXISTS canli;
REVOKE ALL ON SCHEMA canli FROM public;           -- PostgREST'e açılmaz

-- ── Açık istekler ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS canli.istek (
    id          bigserial PRIMARY KEY,
    oyun        text        NOT NULL,
    request_id  bigint      NOT NULL,
    islendi     boolean     NOT NULL DEFAULT false,
    guncellenen integer,                      -- işlenince: kaç maç güncellendi
    olusma      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS istek_bekleyen ON canli.istek (olusma) WHERE NOT islendi;
-- Dolu ise istek tek maçın kendi kaydıdır (/matches/{id}), boşsa oyunun /running'i.
ALTER TABLE canli.istek ADD COLUMN IF NOT EXISTS mac_id bigint;
CREATE INDEX IF NOT EXISTS istek_mac ON canli.istek (mac_id, olusma) WHERE mac_id IS NOT NULL;

-- ── Token (Vault) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION canli.anahtar() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vault, public AS $$
    SELECT decrypted_secret FROM vault.decrypted_secrets
    WHERE name = 'pandascore_token' LIMIT 1;
$$;

-- ── 1) İstek: yalnız canlı maç penceresi olan oyunlar için ───────────────
-- Pencere: şu an oynanan ya da son 2 saatte başlamış/5 dakika içinde
-- başlayacak maçı olan oyun. Maç yoksa hiç istek atılmaz (kota korunur).
-- Maç başlayınca durumu 'running' olur ve bitene kadar pencerede kalır.
-- Kota: PandaScore saatte 1000 istek. En kötü hâl 3 oyun x 60 = 180/saat.
CREATE OR REPLACE FUNCTION canli.iste() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
DECLARE
    tok   text := canli.anahtar();
    slug  text;
    rid   bigint;
    mid   bigint;
    sayi  integer := 0;
BEGIN
    IF tok IS NULL THEN
        RAISE EXCEPTION 'pandascore_token Vault''ta yok';
    END IF;

    FOR slug IN
        SELECT DISTINCT g.slug
        FROM matches m
        JOIN games g ON g.id = m.game_id
        WHERE m.status = 'running'
           OR (m.status = 'not_started'
               AND m.scheduled_at BETWEEN now() - interval '2 hours'
                                      AND now() + interval '5 minutes')
    LOOP
        SELECT net.http_get(
            url     := 'https://api.pandascore.co/' || slug || '/matches/running',
            params  := jsonb_build_object('per_page', '50'),
            headers := jsonb_build_object('Authorization', 'Bearer ' || tok,
                                          'Accept', 'application/json'),
            timeout_milliseconds := 8000
        ) INTO rid;
        INSERT INTO canli.istek (oyun, request_id) VALUES (slug, rid);
        sayi := sayi + 1;
    END LOOP;

    -- Takılı "canlı" maç: DB'de running ama oyununun son /running yanıtında
    -- yok. Maç bitince /running'den düşer, yukarıdaki istek onu bir daha
    -- görmez; sync-live.yml (fiilen 2-6 saatte bir) gelene kadar 'running'
    -- kalırdı (29 Ekim: PGL Bucharest çeyrek finalleri). Bitiş skoru maçın
    -- kendi kaydından alınır. Kota: turda en çok 5, aynı maç 10 dakikada bir.
    FOR mid, slug IN
        WITH son AS (
            SELECT DISTINCT ON (i.oyun) i.oyun, r.content::jsonb AS icerik
            FROM canli.istek i
            JOIN net._http_response r ON r.id = i.request_id
            WHERE i.mac_id IS NULL AND r.status_code = 200
              AND i.olusma > now() - interval '5 minutes'
            ORDER BY i.oyun, i.id DESC
        )
        SELECT m.id, g.slug
        FROM matches m
        JOIN games g ON g.id = m.game_id
        JOIN son s ON s.oyun = g.slug
        WHERE m.status = 'running'
          AND jsonb_typeof(s.icerik) = 'array'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.icerik) j
                          WHERE (j->>'id')::bigint = m.id)
          AND NOT EXISTS (SELECT 1 FROM canli.istek t
                          WHERE t.mac_id = m.id
                            AND t.olusma > now() - interval '10 minutes')
        ORDER BY m.scheduled_at
        LIMIT 5
    LOOP
        SELECT net.http_get(
            url     := 'https://api.pandascore.co/matches/' || mid,
            headers := jsonb_build_object('Authorization', 'Bearer ' || tok,
                                          'Accept', 'application/json'),
            timeout_milliseconds := 8000
        ) INTO rid;
        INSERT INTO canli.istek (oyun, request_id, mac_id) VALUES (slug, rid, mid);
        sayi := sayi + 1;
    END LOOP;
    RETURN sayi;
END;
$$;

-- ── 2) İşleme: gelen yanıtları maçlara yaz ───────────────────────────────
CREATE OR REPLACE FUNCTION canli.isle() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
DECLARE
    k       record;
    toplam  integer := 0;
    adet    integer;
BEGIN
    FOR k IN
        SELECT i.id, r.status_code, r.content
        FROM canli.istek i
        JOIN net._http_response r ON r.id = i.request_id
        WHERE NOT i.islendi
        ORDER BY i.id
    LOOP
        adet := 0;
        -- /running dizi, /matches/{id} tek nesne döner; ikisi aynı yoldan yazılır
        IF k.status_code = 200 AND jsonb_typeof(k.content::jsonb) IN ('array', 'object') THEN
            WITH gelen AS (
                SELECT (j->>'id')::bigint                AS mid,
                       j->>'status'                      AS durum,
                       nullif(j->>'winner_id','')::bigint AS kazanan,
                       COALESCE(nullif(j->>'scheduled_at',''),
                                nullif(j->>'begin_at',''))::timestamptz AS saat,
                       j                                 AS ham
                FROM jsonb_array_elements(
                         CASE jsonb_typeof(k.content::jsonb)
                             WHEN 'object' THEN jsonb_build_array(k.content::jsonb)
                             ELSE k.content::jsonb END) j
                WHERE j ? 'results'
            ), yazim AS (
                UPDATE matches m SET
                    status       = gelen.durum,
                    winner_id    = COALESCE(gelen.kazanan, m.winner_id),
                    -- maç saati öne/arkaya alınabiliyor (29 Ekim QF4: 17:00 → 15:20)
                    scheduled_at = COALESCE(gelen.saat, m.scheduled_at),
                    team_a_score = (SELECT (x->>'score')::int
                                    FROM jsonb_array_elements(gelen.ham->'results') x
                                    WHERE (x->>'team_id')::bigint = m.team_a_id),
                    team_b_score = (SELECT (x->>'score')::int
                                    FROM jsonb_array_elements(gelen.ham->'results') x
                                    WHERE (x->>'team_id')::bigint = m.team_b_id),
                    raw_data       = gelen.ham,
                    last_synced_at = now(),
                    updated_at     = now()
                FROM gelen
                WHERE m.id = gelen.mid
                  -- ⚠️ Takımlar satırdakiyle eşleşmiyorsa DOKUNMA: skoru ters
                  -- yazma riski var (30 Eylül onarımı). Python ETL düzeltir.
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements(gelen.ham->'results') x
                              WHERE (x->>'team_id')::bigint = m.team_a_id)
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements(gelen.ham->'results') x
                              WHERE (x->>'team_id')::bigint = m.team_b_id)
                  AND (m.status IS DISTINCT FROM gelen.durum
                       OR m.raw_data->'results' IS DISTINCT FROM gelen.ham->'results')
                RETURNING 1
            )
            SELECT count(*) INTO adet FROM yazim;
        END IF;

        UPDATE canli.istek SET islendi = true, guncellenen = adet WHERE id = k.id;
        toplam := toplam + adet;
    END LOOP;

    -- yanıtı hiç gelmeyen istekleri kapat (pg_net yanıtları 6 saat sonra siler)
    UPDATE canli.istek SET islendi = true
    WHERE NOT islendi AND olusma < now() - interval '10 minutes';

    DELETE FROM canli.istek WHERE olusma < now() - interval '2 days';
    RETURN toplam;
END;
$$;

-- ── 3) Tik: önce önceki turun yanıtlarını yaz, sonra yeni istek at ────────
CREATE OR REPLACE FUNCTION canli.tik() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE yazilan integer; istek integer; gec integer;
BEGIN
    -- önce geçen turdan sarkan yanıtlar
    yazilan := canli.isle();
    istek   := canli.iste();
    IF istek > 0 THEN
        PERFORM pg_sleep(4);        -- pg_net yanıtı genelde <1 sn'de gelir
        gec := canli.isle();        -- aynı turda yaz: gecikme ~5 sn
        yazilan := yazilan + gec;
    END IF;
    RETURN format('%s maç güncellendi, %s istek atıldı', yazilan, istek);
END;
$$;

REVOKE ALL ON FUNCTION canli.iste(), canli.isle(), canli.tik(), canli.anahtar() FROM public;

-- ─────────────────────────────────────────────────────────────────────────
-- ELLE YAPILACAK İKİ ADIM (Supabase → SQL Editor)
--
-- Claude token yazamıyor (sır deposu izni), o yüzden bu iki satır kurucuda.
--
-- 1) PandaScore anahtarını Vault'a koy — <TOKEN> yerine gerçek anahtar:
--      select vault.create_secret('<TOKEN>', 'pandascore_token',
--                                 'canli.iste() kullanir');
--    (zaten varsa: select vault.update_secret(id, '<TOKEN>')
--                    from vault.secrets where name='pandascore_token';)
--
-- 2) Dakikada bir koştur:
--      select cron.schedule('canli-senkron', '* * * * *', $CRON$select canli.tik()$CRON$);
--
-- DOĞRULAMA (birkaç dakika sonra):
--      select start_time, status, return_message from cron.job_run_details
--       where jobid = (select jobid from cron.job where jobname = 'canli-senkron')
--       order by start_time desc limit 10;
--
-- DURDURMA:  select cron.unschedule('canli-senkron');
-- ─────────────────────────────────────────────────────────────────────────
