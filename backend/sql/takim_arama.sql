-- Takım araması ve popüler takımlar (6 Kas)
--
-- Sorun: arama `name/acronym ilike '%q%'` + sırasız `limit` idi. "eternal" yazınca
-- 5 sonucun içinde iki ana Eternal Fire yoktu (Eternal 21, eternal premium…).
-- Kişiselleştir'in "Popüler Takımlar"ı da ad parçasıyla sırasız çekiliyordu:
-- ex-FUT Academy, ex-Sangal ALTERS, cobblemon ("bbl" içeriyor) geliyor, Eternal Fire CS2 gelmiyordu.
--
-- Önem puanı: son 120 günün biten maçları, turnuva seviyesine göre ağırlıklı
-- (S=8, A=4, B=2, C=1, D/boş=0,5). Hem seviyeyi hem aktifliği tek sayıda toplar;
-- VALORANT sezon arasında bile ana takımlar küçük kulüplerin önünde kalır.
-- Tekrar çalıştırılabilir.

-- Türkçe harfleri düzleştir + küçük harf: "Beşiktaş" ~ "besiktas", "FENERBAHÇE" ~ "fenerbahce".
-- lower()'dan önce çevrilir (lower('İ') birleşik nokta bırakır).
-- BİLEREK `SET search_path` YOK: o ayar fonksiyonun satır içine açılmasını engelliyor,
-- aramada her takım için ayrı çağrı 6 ms'lik taramayı 35 ms yapıyordu. Gövde yalnız
-- pg_catalog fonksiyonu kullanır (şema adıyla), arama yolundan etkilenmez.
CREATE OR REPLACE FUNCTION public.arama_duz(metin text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT pg_catalog.lower(pg_catalog.translate(pg_catalog.btrim(metin),
         'çğıöşüÇĞİÖŞÜâîûÂÎÛ', 'cgiosuCGIOSUaiuAIU'))
$$;

-- Verilen takımların önem puanı ve son biten maçı (son 120 gün). Takım başına indeks
-- araması (team_a: idx_matches_finished_h2h_a_b_sched, team_b: ..._b_a_sched); 120 günün
-- tüm maçlarını taramak arama başına ~80 ms tutuyordu.
CREATE OR REPLACE FUNCTION public.takim_puanlari(p_ids bigint[])
RETURNS TABLE (team_id bigint, puan numeric, son_mac timestamptz)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH mac AS (
    SELECT m.team_a_id AS team_id, m.tournament_id, m.scheduled_at
    FROM public.matches m
    WHERE m.team_a_id = ANY (p_ids) AND m.status = 'finished'
      AND m.scheduled_at > now() - interval '120 days'
    UNION ALL
    SELECT m.team_b_id, m.tournament_id, m.scheduled_at
    FROM public.matches m
    WHERE m.team_b_id = ANY (p_ids) AND m.status = 'finished'
      AND m.scheduled_at > now() - interval '120 days'
  )
  SELECT mac.team_id,
         sum(CASE upper(tr.tier) WHEN 'S' THEN 8 WHEN 'A' THEN 4 WHEN 'B' THEN 2 WHEN 'C' THEN 1 ELSE 0.5 END),
         max(mac.scheduled_at)
  FROM mac
  LEFT JOIN public.tournaments tr ON tr.id = mac.tournament_id
  GROUP BY mac.team_id
$$;

-- Arama önerisi. Sıra: eşleşme sınıfı (tam ad/kısaltma > ad/kısaltma ön eki >
-- kelime başı > içinde geçer) → "ex-" adlı (dağılmış) takımlar sona → Türk takımı
-- (turk_takimlar) → önem puanı → son maç → kısa ad.
-- "eternal" → Eternal Fire CS2, Eternal Fire VAL başta; "ga" → Galatasaray.
CREATE OR REPLACE FUNCTION public.takim_ara(q text, adet int DEFAULT 8)
RETURNS TABLE (id bigint, name text, acronym text, logo_url text, game_id int,
               location text, country_code text, game jsonb)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH girdi AS (
    SELECT public.arama_duz(q) AS ham
  ), desen AS (
    -- LIKE joker karakterleri kaçırılır: "a_b" ya da "100%" düz metin aransın
    SELECT ham, replace(replace(replace(ham, '\', '\\'), '%', '\%'), '_', '\_') AS k
    FROM girdi
  ), aday AS (
    SELECT t.id, t.name, t.acronym, t.logo_url, t.game_id, t.location, t.country_code,
           public.arama_duz(t.name) AS ad_duz, public.arama_duz(t.acronym) AS kisa_duz, d.ham, d.k
    FROM public.teams t, desen d
    WHERE length(d.ham) >= 2
      AND (public.arama_duz(t.name) LIKE '%' || d.k || '%'
           OR public.arama_duz(t.acronym) LIKE '%' || d.k || '%')
  ), sinifli AS (
    SELECT a.*,
           CASE WHEN a.ad_duz = a.ham OR a.kisa_duz = a.ham THEN 0
                WHEN a.ad_duz LIKE a.k || '%' OR a.kisa_duz LIKE a.k || '%' THEN 1
                WHEN a.ad_duz ~ ('(^|[^a-z0-9])' || regexp_replace(a.ham, '([^a-z0-9 ])', '\\\1', 'g')) THEN 2
                ELSE 3 END AS sinif,
           (a.ad_duz ~ '^ex-') AS eski
    FROM aday a
  )
  SELECT s.id, s.name, s.acronym, s.logo_url, s.game_id, s.location, s.country_code,
         CASE WHEN g.id IS NULL THEN NULL
              ELSE jsonb_build_object('id', g.id, 'name', g.name, 'slug', g.slug) END
  FROM sinifli s
  LEFT JOIN public.takim_puanlari(ARRAY(SELECT id FROM sinifli)) p ON p.team_id = s.id
  LEFT JOIN public.games g ON g.id = s.game_id
  LEFT JOIN (SELECT DISTINCT tt.team_id FROM public.turk_takimlar tt
             WHERE tt.team_id IN (SELECT id FROM sinifli)) tr ON tr.team_id = s.id
  ORDER BY s.sinif, s.eski, (tr.team_id IS NULL), p.puan DESC NULLS LAST,
           p.son_mac DESC NULLS LAST, length(s.name), s.name, s.id
  LIMIT least(greatest(coalesce(adet, 8), 1), 30)
$$;

-- Kişiselleştir "Popüler Takımlar": en fazla 8 Türk takımı (turk_takimlar; "ex-" adlı
-- çıkar) — önce elle seçilmiş büyükler (sezon arasında da kalır), kalan yer 60 gün
-- içinde maçı olanlardan puana göre; sonra elle seçilmiş dünya takımları.
-- Listeyi değiştirmek: aşağıdaki iki VALUES.
CREATE OR REPLACE FUNCTION public.populer_takimlar()
RETURNS TABLE (id bigint, name text, acronym text, logo_url text, game_id int,
               location text, country_code text, game jsonb)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH elle_turk(team_id, sira) AS (
    VALUES
      (129413::bigint, 1), -- Eternal Fire (CS2)
      (131505, 2),         -- Aurora Gaming (CS2; kadrosu Türk)
      (128578, 3),         -- FUT Esports (VALORANT)
      (129662, 4),         -- Eternal Fire (VALORANT)
      (136955, 5),         -- FUT Esports (CS2)
      (128577, 6)          -- BBL Esports (VALORANT)
  ), elle(team_id, sira) AS (
    VALUES
      (3455::bigint, 1),   -- Vitality (CS2)
      (3216, 2),           -- Natus Vincere (CS2)
      (3212, 3),           -- FaZe (CS2)
      (124530, 4),         -- FURIA (CS2)
      (3210, 5),           -- G2 (CS2)
      (128537, 6),         -- Fnatic (VALORANT)
      (128472, 7),         -- Sentinels (VALORANT)
      (128622, 8),         -- Team Heretics (VALORANT)
      (128917, 9),         -- Paper Rex (VALORANT)
      (126061, 10),        -- T1 (LoL)
      (88, 11),            -- G2 Esports (LoL)
      (394, 12)            -- Fnatic (LoL)
  ), turk AS (
    SELECT tt.team_id,
           row_number() OVER (ORDER BY et.sira NULLS LAST, p.puan DESC NULLS LAST,
                                       p.son_mac DESC NULLS LAST, tt.team_id) AS sira
    FROM public.turk_takimlar tt
    JOIN public.teams t ON t.id = tt.team_id
    LEFT JOIN elle_turk et ON et.team_id = tt.team_id
    LEFT JOIN public.takim_puanlari(ARRAY(SELECT team_id FROM public.turk_takimlar)) p ON p.team_id = tt.team_id
    WHERE public.arama_duz(t.name) !~ '^ex-'
      AND (et.sira IS NOT NULL OR p.son_mac > now() - interval '60 days')
    ORDER BY 2
    LIMIT 8
  ), liste AS (
    SELECT team_id, 0 AS grup, sira FROM turk
    UNION ALL
    SELECT e.team_id, 1, e.sira FROM elle e
    WHERE NOT EXISTS (SELECT 1 FROM turk WHERE turk.team_id = e.team_id)
  )
  SELECT t.id, t.name, t.acronym, t.logo_url, t.game_id, t.location, t.country_code,
         CASE WHEN g.id IS NULL THEN NULL
              ELSE jsonb_build_object('id', g.id, 'name', g.name, 'slug', g.slug) END
  FROM liste l
  JOIN public.teams t ON t.id = l.team_id
  LEFT JOIN public.games g ON g.id = t.game_id
  ORDER BY l.grup, l.sira, t.id
$$;

-- Hepsi SECURITY INVOKER: çağıranın yetkisiyle yalnız herkese açık takım/maç verisini okur.
-- takim_ara/populer_takimlar yardımcıları çağırdığı için onlar da anon'a açık olmalı.
GRANT EXECUTE ON FUNCTION public.arama_duz(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.takim_puanlari(bigint[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.takim_ara(text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.populer_takimlar() TO anon, authenticated;
