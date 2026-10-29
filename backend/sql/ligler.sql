-- Kalıcı lig sayfaları: /lig/<slug> (ör. /lig/worlds, /lig/vct-emea)
--
-- Sorun: turnuva sayfaları yıl + aşama başına ayrı ("Worlds 2025 · Playoffs"); "worlds
-- fikstür" araması geçen yılın aşamasına gidiyordu. Lig sayfası adresi hiç değişmez ve
-- ligin EN GÜNCEL etkinliğinin tüm aşamalarını (Play-In / Group / Playoffs) tek sayfada
-- gösterir. Etkinlik değişince (Worlds 2026 → 2027) sayfa kendiliğinden yenisine geçer.
--
-- PandaScore hiyerarşisi League → Serie → Tournament. Bizde lig kimliği saklanmıyor;
-- tournaments.league_name (league.name) + event_name (serie.full_name) metni var.
-- VCT tek "league" altında Americas/EMEA/Masters/Champions/Game Changers'ı topluyor →
-- lig = (oyun, league_name, event_name deseni). Tanımlar bu tabloda; SPA, bot HTML
-- (middleware) ve sitemap aynı RPC'leri okur, eşleme tek yerde kalır.
-- Tekrar çalıştırılabilir.

-- 1) Eksik lig/etkinlik adlarını maçın ham verisinden doldur ------------------------
-- Ağustos 2026 ortasına kadar senkronun bir yolu bu iki kolonu boş yazıyordu (yalnız
-- B/C/D turnuvalar; S/A'nın hepsi dolu). Boş kalanlarda TCL ve VCL Türkiye gibi Türk
-- ligleri de var. Yalnız NULL olan doldurulur; dolu değere dokunulmaz.
WITH kaynak AS (
    SELECT DISTINCT ON (m.tournament_id)
           m.tournament_id,
           NULLIF(m.raw_data->'league'->>'name', '')     AS lig,
           NULLIF(m.raw_data->'serie'->>'full_name', '') AS etkinlik
    FROM public.matches m
    WHERE m.raw_data ? 'league' AND m.tournament_id IS NOT NULL
    ORDER BY m.tournament_id, m.updated_at DESC NULLS LAST
)
UPDATE public.tournaments t
SET league_name = COALESCE(t.league_name, k.lig),
    event_name  = COALESCE(t.event_name, k.etkinlik)
FROM kaynak k
WHERE k.tournament_id = t.id
  AND ((t.league_name IS NULL AND k.lig IS NOT NULL)
    OR (t.event_name IS NULL AND k.etkinlik IS NOT NULL));

-- 2) Lig tanımları ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ligler (
    slug           text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    ad             text NOT NULL,              -- sayfa başlığı: "<ad> <yıl> Fikstür, ..."
    oyun           text NOT NULL,              -- games.slug: lol | valorant | csgo
    league_name    text NOT NULL,              -- tournaments.league_name ile TAM eşleşme
    etkinlik_desen text,                       -- event_name ~* desen (NULL = hepsi)
    haric_desen    text,                       -- event_name !~* desen (elemeler vb.)
    sira           int  NOT NULL DEFAULT 100,  -- listelerde sıra; bir turnuva iki lige uyarsa küçük olan
    aktif          boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ligler ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ligler_oku ON public.ligler;
CREATE POLICY ligler_oku ON public.ligler FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ligler FROM anon, authenticated;
GRANT SELECT ON public.ligler TO anon, authenticated;

-- İlk tur: S/A ligler + Türk takımlarının oynadığı ligler (TCL, VCL Türkiye/EMEA,
-- EMEA Masters, TESFED). Desenler 29 Ekim 2026'daki etkinlik adlarına göre.
INSERT INTO public.ligler (slug, ad, oyun, league_name, etkinlik_desen, haric_desen, sira) VALUES
    ('worlds',          'Worlds',              'lol',      'Worlds',                  NULL, NULL, 10),
    ('msi',             'MSI',                 'lol',      'Mid-Season Invitational', NULL, NULL, 11),
    ('first-stand',     'First Stand',         'lol',      'First Stand',             NULL, NULL, 12),
    ('lck',             'LCK',                 'lol',      'LCK',                     NULL, 'qualifier|promotion', 13),
    ('lpl',             'LPL',                 'lol',      'LPL',                     NULL, 'qualifier|promotion|regional finals', 14),
    ('lec',             'LEC',                 'lol',      'LEC',                     NULL, 'qualifier|promotion', 15),
    ('lcs',             'LCS',                 'lol',      'LCS',                     NULL, 'qualifier|promotion', 16),
    ('cblol',           'CBLOL',               'lol',      'CBLOL',                   NULL, 'qualifier|promotion', 17),
    ('lcp',             'LCP',                 'lol',      'LCP',                     NULL, 'qualifier|promotion', 18),
    ('tcl',             'TCL',                 'lol',      'TCL',                     NULL, 'qualifier|promotion', 5),
    ('emea-masters',    'EMEA Masters',        'lol',      'EMEA Masters',            NULL, 'qualifier', 19),
    ('vct-champions',   'VCT Champions',       'valorant', 'VCT', '^champions \d{4}', NULL, 20),
    ('vct-masters',     'VCT Masters',         'valorant', 'VCT', '^masters ',        NULL, 21),
    ('vct-emea',        'VCT EMEA',            'valorant', 'VCT', '^emea (kickoff|stage)',     NULL, 22),
    ('vct-americas',    'VCT Americas',        'valorant', 'VCT', '^americas (kickoff|stage)', NULL, 23),
    ('vct-pacific',     'VCT Pacific',         'valorant', 'VCT', '^pacific (kickoff|stage)',  NULL, 24),
    ('vct-china',       'VCT China',           'valorant', 'VCT', '^china (kickoff|stage)',    NULL, 25),
    ('vcl-turkiye',     'VCL Türkiye Birlik',  'valorant', 'VCL', '^t(ü|u)rkiye',              'qualifier', 6),
    ('vcl-emea',        'VCL EMEA',            'valorant', 'VCL', '^emea: (kickoff|stage)',    NULL, 26),
    ('iem',             'IEM',                 'csgo',     'IEM',                     NULL, 'qualifier', 30),
    ('esl-pro-league',  'ESL Pro League',      'csgo',     'ESL Pro League',          NULL, 'qualifier|conference', 31),
    ('blast-open',      'BLAST Open',          'csgo',     'BLAST Open',              NULL, 'qualifier', 32),
    ('pgl',             'PGL',                 'csgo',     'PGL',                     NULL, 'qualifier', 33),
    ('pgl-masters',     'PGL Masters',         'csgo',     'PGL Masters',             NULL, 'qualifier', 34),
    ('starseries',      'StarLadder StarSeries', 'csgo',   'StarLadder StarSeries',   NULL, 'qualifier', 35),
    ('thunderpick',     'Thunderpick World Championship', 'csgo', 'Thunderpick World Championship', '^\d{4}$', NULL, 36),
    ('tesfed',          'TESFED League',         'csgo',     'TESFED League',           NULL, 'qualifier', 7)
ON CONFLICT (slug) DO UPDATE SET
    ad = EXCLUDED.ad, oyun = EXCLUDED.oyun, league_name = EXCLUDED.league_name,
    etkinlik_desen = EXCLUDED.etkinlik_desen, haric_desen = EXCLUDED.haric_desen, sira = EXCLUDED.sira;

CREATE INDEX IF NOT EXISTS tournaments_league_name_idx ON public.tournaments (league_name);

-- 3) Eşleme kuralı (tek yer) ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lig_eslesir(l public.ligler, p_oyun text, p_lig text, p_etkinlik text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT l.aktif
       AND l.oyun = p_oyun
       AND l.league_name = p_lig
       AND (l.etkinlik_desen IS NULL OR COALESCE(p_etkinlik, '') ~* l.etkinlik_desen)
       AND (l.haric_desen    IS NULL OR COALESCE(p_etkinlik, '') !~* l.haric_desen)
$$;

-- 4) Lig sayfası: güncel etkinlik + aşamaları + önceki etkinlikler --------------------
-- Güncel etkinlik: başlamış (ya da 7 gün içinde başlayacak) etkinliklerin en yenisi;
-- hiçbiri yoksa ilk başlayacak olan. Böylece yeni sezon tanımlanır tanımlanmaz değil,
-- başlamasına bir hafta kala sayfa ona geçer.
CREATE OR REPLACE FUNCTION public.lig_sayfasi(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
    WITH l AS (
        SELECT * FROM ligler WHERE slug = p_slug AND aktif
    ),
    t AS (
        SELECT tr.*, COALESCE(tr.begin_at, tr.start_date) AS bas, COALESCE(tr.end_at, tr.end_date) AS son
        FROM l
        JOIN games g ON g.slug = l.oyun
        JOIN tournaments tr ON tr.game_id = g.id AND tr.league_name = l.league_name
        WHERE lig_eslesir(l, g.slug, tr.league_name, tr.event_name)
    ),
    e AS (
        SELECT event_name, MIN(bas) AS bas, MAX(son) AS son,
               (ARRAY_AGG(id ORDER BY bas NULLS LAST, id))[1] AS ilk_turnuva
        FROM t GROUP BY event_name
    ),
    sec AS (
        SELECT * FROM e
        ORDER BY (bas <= now() + interval '7 days') DESC NULLS LAST,
                 CASE WHEN bas <= now() + interval '7 days' THEN bas END DESC NULLS LAST,
                 bas ASC NULLS LAST
        LIMIT 1
    )
    SELECT jsonb_build_object(
        'slug', l.slug,
        'ad', l.ad,
        'oyun', l.oyun,
        'league_name', l.league_name,
        'etkinlik', s.event_name,
        'yil', COALESCE(substring(s.event_name FROM '(\d{4})\D*$'), to_char(s.bas, 'YYYY')),
        'baslangic', s.bas,
        'bitis', s.son,
        'turnuvalar', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', t.id, 'name', t.name, 'tier', t.tier, 'region', t.region,
                       'begin_at', t.bas, 'end_at', t.son,
                       'league_name', t.league_name, 'event_name', t.event_name,
                       'display_name', t.display_name)
                   ORDER BY t.bas NULLS LAST, t.name)
            FROM t WHERE t.event_name IS NOT DISTINCT FROM s.event_name
        ), '[]'::jsonb),
        'gecmis', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('etkinlik', x.event_name, 'baslangic', x.bas, 'turnuva_id', x.ilk_turnuva)
                   ORDER BY x.bas DESC NULLS LAST)
            FROM (SELECT * FROM e WHERE e.event_name IS DISTINCT FROM s.event_name
                  ORDER BY bas DESC NULLS LAST LIMIT 12) x
        ), '[]'::jsonb)
    )
    FROM l LEFT JOIN sec s ON true
$$;

-- 5) Turnuva → lig (turnuva sayfasındaki "Güncel: <Lig> <yıl> →" bağlantısı) ----------
CREATE OR REPLACE FUNCTION public.turnuva_ligi(p_tid bigint)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'slug', l.slug, 'ad', l.ad,
        'yil', ls->>'yil', 'etkinlik', ls->>'etkinlik',
        'guncel', (ls->>'etkinlik') IS NOT DISTINCT FROM tr.event_name)
    FROM tournaments tr
    JOIN games g ON g.id = tr.game_id
    JOIN ligler l ON lig_eslesir(l, g.slug, tr.league_name, tr.event_name)
    CROSS JOIN LATERAL lig_sayfasi(l.slug) ls
    WHERE tr.id = p_tid
    ORDER BY l.sira
    LIMIT 1
$$;

-- 6) Lig listesi (sitemap, /tournaments şeridi, bot HTML) -----------------------------
CREATE OR REPLACE FUNCTION public.lig_listesi()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg((ls - 'turnuvalar' - 'gecmis') ORDER BY l.sira, l.slug), '[]'::jsonb)
    FROM ligler l
    CROSS JOIN LATERAL lig_sayfasi(l.slug) ls
    WHERE l.aktif AND ls->>'etkinlik' IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION public.lig_eslesir(public.ligler, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lig_sayfasi(text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.turnuva_ligi(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lig_listesi()      TO anon, authenticated;
