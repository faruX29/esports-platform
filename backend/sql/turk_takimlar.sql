-- Türk takımı: TEK KAYNAK (radar vurgusu, haber kapsamı, /turk-takimlari)
--
-- Önceden üç ayrı tanım vardı: radarın ad listesi (parça eşleşme → Partizan Sangal,
-- Danimarkalı BBL, Copenhagen Wolves da "Türk"), middleware'in country_code='TR'
-- kuralı ve hiçbir şey (haber üretimi). country_code tek başına da yetmiyor:
-- Aurora Gaming RU kayıtlı ama kadrosu Türk.
--
-- Kural: hariç değilse ve (country_code='TR' VEYA elle dahil VEYA güncel kadroda
-- en az 3 TR uyruklu oyuncu). Uyruk 24 Eki'den beri kadro senkronunda yazılıyor.
-- Tekrar çalıştırılabilir.

CREATE TABLE IF NOT EXISTS public.turk_takim_istisna (
    team_id    bigint      PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
    dahil      boolean     NOT NULL,          -- true: Türk say · false: Türk sayma
    aciklama   text,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.turk_takim_istisna ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS turk_takim_istisna_oku ON public.turk_takim_istisna;
CREATE POLICY turk_takim_istisna_oku ON public.turk_takim_istisna FOR SELECT USING (true);

CREATE OR REPLACE VIEW public.turk_takimlar WITH (security_invoker = true) AS
WITH tr_oyuncu AS (
    SELECT team_pandascore_id AS team_id, COUNT(*) AS adet
    FROM public.players
    WHERE nationality = 'TR' AND team_pandascore_id IS NOT NULL
    GROUP BY team_pandascore_id
)
SELECT t.id AS team_id,
       CASE WHEN i.dahil          THEN 'elle'
            WHEN t.country_code = 'TR' THEN 'ulke'
            ELSE 'kadro' END AS neden,
       COALESCE(o.adet, 0) AS tr_oyuncu
FROM public.teams t
LEFT JOIN public.turk_takim_istisna i ON i.team_id = t.id
LEFT JOIN tr_oyuncu o ON o.team_id = t.id
WHERE COALESCE(i.dahil, true)
  AND (i.dahil OR t.country_code = 'TR' OR COALESCE(o.adet, 0) >= 3);

GRANT SELECT ON public.turk_takimlar TO anon, authenticated;
GRANT SELECT ON public.turk_takim_istisna TO anon, authenticated;
