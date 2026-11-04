-- teams.game_id geriye dönük doldurma (UX P1-13, 4 Kasım 2026).
--
-- ETL yeni takımı game_id'siz yazıyordu; takımların çoğunda alan boş. Arama ve takım
-- sayfası aynı adlı takımları (Eternal Fire CS2 / VALORANT) oyunla ayırır.
-- PandaScore takım kimliği oyuna özel → takımın oyunu = maçlarının oyunu. Birden çok
-- oyun görünürse (eski birleştirilmiş oyun satırları) en çok maçı olan seçilir.
-- Yalnız boş alanı doldurur; tekrar çalıştırılabilir. ETL artık kendisi yazıyor
-- (sync_matches.py _get_or_create_team).

with oyunlar as (
  select takim_id, game_id, count(*) as n
  from (
    select team_a_id as takim_id, game_id from matches where team_a_id is not null and game_id is not null
    union all
    select team_b_id, game_id from matches where team_b_id is not null and game_id is not null
  ) x
  group by takim_id, game_id
),
secim as (
  select distinct on (takim_id) takim_id, game_id
  from oyunlar
  order by takim_id, n desc, game_id
),
-- teams_name_game_unique (name, game_id): aynı oyunda aynı adlı takım zaten varsa ya da
-- iki boş takım aynı ada + oyuna düşerse yalnız ilki (küçük id) dolar; kalanlar boş kalır
-- (arayüz oyunu maçlardan türetir).
aday as (
  select s.takim_id, s.game_id,
         row_number() over (partition by t.name, s.game_id order by t.id) as sira
  from secim s
  join teams t on t.id = s.takim_id and t.game_id is null
  where not exists (
    select 1 from teams d where d.name = t.name and d.game_id = s.game_id
  )
)
update teams t
set game_id = a.game_id
from aday a
where t.id = a.takim_id
  and a.sira = 1
  and t.game_id is null;
