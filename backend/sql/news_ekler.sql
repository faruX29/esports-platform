-- news_articles.ekler: habere bağlı yapılandırılmış veri (24 Eki)
--
-- Transfer haberinde takım/oyuncu ID'si ve veri kaynağı yoktu → detay sayfasında
-- hiç bağlantı çıkmıyordu, atıf da hep "Liquipedia" diyordu (22 Eyl'den beri
-- transfer PandaScore kadro farkından geliyor). Haftalık özetler de maç listesini
-- burada taşıyacak.
--
-- Transfer: {"oyuncu_id": uuid, "eski_takim_id": bigint|null,
--            "yeni_takim_id": bigint|null, "kaynak": "<roster_changes.data_source>"}
-- Tekrar çalıştırılabilir.

ALTER TABLE public.news_articles ADD COLUMN IF NOT EXISTS ekler jsonb;

-- Eski transfer haberlerini roster_changes ile eşle: oyuncu adı (hero_score) +
-- eski/yeni takım adı haberdeki gibi; birden çok aday varsa haberden önceki en yakın.
WITH aday AS (
    SELECT DISTINCT ON (na.id)
           na.id AS news_id,
           jsonb_build_object(
               'oyuncu_id',     rc.player_id,
               'eski_takim_id', rc.source_team_id,
               'yeni_takim_id', rc.target_team_id,
               'kaynak',        rc.data_source
           ) AS ekler
    FROM public.news_articles na
    JOIN public.players p        ON p.nickname = na.hero_score
    JOIN public.roster_changes rc ON rc.player_id = p.id
    LEFT JOIN public.teams st    ON st.id = rc.source_team_id
    LEFT JOIN public.teams tt    ON tt.id = rc.target_team_id
    WHERE na.content_type = 'transfer'
      AND na.ekler IS NULL
      AND COALESCE(st.name, rc.raw_payload->>'old_team', 'Serbest') = na.team_a_name
      AND COALESCE(tt.name, rc.raw_payload->>'new_team', 'Serbest') = na.team_b_name
      AND rc.transfer_date <= (na.created_at AT TIME ZONE 'UTC')::date + 1
    ORDER BY na.id, rc.transfer_date DESC
)
UPDATE public.news_articles na
SET ekler = aday.ekler
FROM aday
WHERE na.id = aday.news_id;
