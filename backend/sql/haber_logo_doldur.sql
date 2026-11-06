-- Transfer haberi ve turnuva özetinde kapak logoları (5 Kas kullanıcı raporu, adım 8).
-- ETL bu iki türde team_a_logo/team_b_logo yazmıyordu → kapakta ve paylaşım kartında
-- logo yerine baş harf ("TH", "FU") çıkıyordu. ETL artık yazıyor (news_generator.py);
-- bu dosya eski satırları doldurur. Tekrar çalıştırılabilir: yalnız boş alanı doldurur.
-- Geri alma: yedekteki id'lerin logolarını NULL'a çek.

-- Transfer: takım ID'leri ekler'de (eski_takim_id, yeni_takim_id)
UPDATE news_articles n SET
  team_a_logo = COALESCE(n.team_a_logo,
    (SELECT t.logo_url FROM teams t WHERE t.id = (n.ekler->>'eski_takim_id')::bigint)),
  team_b_logo = COALESCE(n.team_b_logo,
    (SELECT t.logo_url FROM teams t WHERE t.id = (n.ekler->>'yeni_takim_id')::bigint))
WHERE n.content_type = 'transfer'
  AND (n.team_a_logo IS NULL OR n.team_b_logo IS NULL);

-- Turnuva özeti: satırda yalnız ad var (şampiyon/lider, finalist/ikinci). Turnuvanın
-- maçlarındaki takımlardan ada göre; aynı adda iki takım varsa (belirsiz) doldurulmaz.
UPDATE news_articles n SET
  team_a_logo = COALESCE(n.team_a_logo,
    (SELECT MIN(te.logo_url) FROM matches m JOIN teams te ON te.id IN (m.team_a_id, m.team_b_id)
      WHERE m.tournament_id = n.tournament_id AND te.name = n.team_a_name
      HAVING COUNT(DISTINCT te.id) = 1)),
  team_b_logo = COALESCE(n.team_b_logo,
    (SELECT MIN(te.logo_url) FROM matches m JOIN teams te ON te.id IN (m.team_a_id, m.team_b_id)
      WHERE m.tournament_id = n.tournament_id AND te.name = n.team_b_name
      HAVING COUNT(DISTINCT te.id) = 1))
WHERE n.content_type = 'tournament'
  AND (n.team_a_logo IS NULL OR n.team_b_logo IS NULL);
