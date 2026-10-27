-- ─────────────────────────────────────────────────────────────────────────
-- Ana sayfa verisi tek istekte: get_home_feed()
-- 27 Ekim 2026 — denetim Faz 4
--
-- NEDEN: ana sayfa (Dashboard.jsx) açılışta 3 kademeli şelaleyle ~11 istek atıyor,
-- sonra dört ayrı zamanlayıcıyla dakikada ~9 istek daha. Aynı veri iki kez
-- çekiliyordu (canlı/yaklaşan hem liste hem şerit için, biten maçlar hem şerit hem
-- isabet için). LCP öğesi (aktif turnuva kartı) turnuva → maç → takım şelalesini
-- bekliyordu.
--
-- ÇIKTI (alan adları PostgREST gömmesiyle AYNI; istemci değişmeden okur):
--   canli     running, scheduled_at artan, en fazla 18
--   yaklasan  not_started/upcoming, [şimdi-6 sa, şimdi+7 gün], artan, en fazla 30
--   biten     finished, scheduled_at azalan, en fazla 100 (şerit, son sonuçlar, isabet)
--   turnuvalar  süren S/A turnuvalar (en fazla 50) + her birinden en fazla 7 takım
--   form      canli+yaklasan takımlarının son 5 sonucu (get_teams_recent_form)
-- Oyun ve seviye filtresi istemcide (filtre değişince yeniden istek gerekmez).
--
-- Yetki: SECURITY INVOKER — RLS anon'un zaten okuyabildiğini okur. Tekrar çalıştırılabilir.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_home_feed()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH
canli AS (
    SELECT m.* FROM matches m
     WHERE m.status = 'running'
     ORDER BY m.scheduled_at
     LIMIT 18
),
yaklasan AS (
    SELECT m.* FROM matches m
     WHERE m.status IN ('not_started', 'upcoming')
       AND m.scheduled_at >= now() - interval '6 hours'
       AND m.scheduled_at <= now() + interval '7 days'
     ORDER BY m.scheduled_at
     LIMIT 30
),
biten AS (
    SELECT m.* FROM matches m
     WHERE m.status = 'finished'
     ORDER BY m.scheduled_at DESC, m.id DESC
     LIMIT 100
),
secilen AS (
    SELECT 'canli' AS bolum, row_number() OVER (ORDER BY scheduled_at) AS sira, c.* FROM canli c
    UNION ALL
    SELECT 'yaklasan', row_number() OVER (ORDER BY scheduled_at), y.* FROM yaklasan y
    UNION ALL
    SELECT 'biten', row_number() OVER (ORDER BY scheduled_at DESC, id DESC), b.* FROM biten b
),
satir AS (
    SELECT s.bolum, s.sira, jsonb_build_object(
               'id', s.id, 'status', s.status, 'scheduled_at', s.scheduled_at,
               'team_a_id', s.team_a_id, 'team_b_id', s.team_b_id, 'winner_id', s.winner_id,
               'team_a_score', s.team_a_score, 'team_b_score', s.team_b_score,
               'number_of_games', s.number_of_games, 'stream_url', s.stream_url,
               'tournament_id', s.tournament_id,
               'prediction_team_a', s.prediction_team_a, 'prediction_team_b', s.prediction_team_b,
               'prediction_confidence', s.prediction_confidence,
               'team_a', CASE WHEN ta.id IS NULL THEN NULL ELSE
                         jsonb_build_object('id', ta.id, 'name', ta.name, 'logo_url', ta.logo_url) END,
               'team_b', CASE WHEN tb.id IS NULL THEN NULL ELSE
                         jsonb_build_object('id', tb.id, 'name', tb.name, 'logo_url', tb.logo_url) END,
               'tournament', CASE WHEN tr.id IS NULL THEN NULL ELSE
                         jsonb_build_object('id', tr.id, 'name', tr.name, 'tier', tr.tier,
                                            'league_name', tr.league_name, 'event_name', tr.event_name,
                                            'display_name', tr.display_name, 'region', tr.region) END,
               'game', CASE WHEN g.id IS NULL THEN NULL ELSE
                         jsonb_build_object('id', g.id, 'name', g.name, 'slug', g.slug) END
           ) AS j
      FROM secilen s
      LEFT JOIN teams ta       ON ta.id = s.team_a_id
      LEFT JOIN teams tb       ON tb.id = s.team_b_id
      LEFT JOIN tournaments tr ON tr.id = s.tournament_id
      LEFT JOIN games g        ON g.id = s.game_id
),
aktif AS (
    SELECT t.* FROM tournaments t
     WHERE t.begin_at <= now() AND t.end_at >= now()
       AND upper(t.tier) IN ('S', 'A')
     ORDER BY t.begin_at DESC
     LIMIT 50
),
turnuva AS (
    SELECT a.begin_at, a.id, jsonb_build_object(
               'id', a.id, 'name', a.name, 'tier', a.tier, 'begin_at', a.begin_at, 'end_at', a.end_at,
               'region', a.region, 'league_name', a.league_name, 'event_name', a.event_name,
               'display_name', a.display_name,
               'game', (SELECT jsonb_build_object('id', g.id, 'name', g.name, 'slug', g.slug)
                          FROM games g WHERE g.id = a.game_id),
               'teams', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object('id', tk.id, 'name', tk.name, 'logo_url', tk.logo_url))
                     FROM (SELECT DISTINCT ON (tk.id) tk.id, tk.name, tk.logo_url
                             FROM matches m
                             CROSS JOIN LATERAL (VALUES (m.team_a_id), (m.team_b_id)) v(tid)
                             JOIN teams tk ON tk.id = v.tid
                            WHERE m.tournament_id = a.id
                            ORDER BY tk.id
                            LIMIT 7) tk), '[]'::jsonb)
           ) AS j
      FROM aktif a
),
form_takimlari AS (
    SELECT array_agg(DISTINCT x) AS ids
      FROM (SELECT team_a_id AS x FROM canli UNION ALL SELECT team_b_id FROM canli
            UNION ALL SELECT team_a_id FROM yaklasan UNION ALL SELECT team_b_id FROM yaklasan) u
     WHERE x IS NOT NULL
)
SELECT jsonb_build_object(
    'olusturma', now(),
    'canli',      COALESCE((SELECT jsonb_agg(j ORDER BY sira) FROM satir WHERE bolum = 'canli'), '[]'::jsonb),
    'yaklasan',   COALESCE((SELECT jsonb_agg(j ORDER BY sira) FROM satir WHERE bolum = 'yaklasan'), '[]'::jsonb),
    'biten',      COALESCE((SELECT jsonb_agg(j ORDER BY sira) FROM satir WHERE bolum = 'biten'), '[]'::jsonb),
    'turnuvalar', COALESCE((SELECT jsonb_agg(j ORDER BY begin_at DESC, id) FROM turnuva), '[]'::jsonb),
    'form',       COALESCE((SELECT jsonb_agg(jsonb_build_object('team_id', f.team_id, 'form', f.form))
                              FROM form_takimlari ft,
                                   LATERAL get_teams_recent_form(COALESCE(ft.ids, '{}'::bigint[])) f), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.get_home_feed() FROM public;
GRANT EXECUTE ON FUNCTION public.get_home_feed() TO anon, authenticated;

-- DOĞRULAMA:
--   select jsonb_array_length(f->'canli'), jsonb_array_length(f->'yaklasan'),
--          jsonb_array_length(f->'biten'), jsonb_array_length(f->'turnuvalar'),
--          jsonb_array_length(f->'form'), pg_size_pretty(pg_column_size(f)::bigint)
--     from get_home_feed() f;
