-- get_scout_players: Scout karşılaştırma aracının tek veri kaynağı (VALORANT).
--
-- NEDEN: ScoutEnginePage eskiden player_match_stats'ten `limit(1000)` çekip
-- tarayıcıda topluyordu. 2026-09-13'te tabloda 7.377 satır vardı → oyuncuların
-- "son N maç" rakamları sessizce eksik çıkıyordu. Toplama burada, tam veriyle.
--
-- VERİ GERÇEKLERİ (13 Eyl'de ölçüldü — arayüzde bunun ötesini İDDİA ETME):
--   * player_match_stats oyuncu+maç başına TEK satır → kill/ölüm/asist MAÇ toplamı.
--   * stats->'maps' her harita için {map, agent, acs} taşır → ajan ve harita
--     havuzu HARİTA bazında gerçek. acs harita başına çoğunlukla null.
--   * stats->'acs_avg' 7.377 satırın yalnız 1.221'inde var → acs_n ile birlikte
--     döner, arayüz az örneklemde göstermez.
--   * headshots / hs_percentage tamamen null, impact_score tamamen 0 → DÖNDÜRÜLMEZ.
--
-- takım: players.team_pandascore_id (transfer tetikleyicisiyle güncel tutulur),
-- yoksa oyuncunun son maçındaki takım.
--
-- KURULUM: Supabase → SQL Editor'de bir kez çalıştır.

create or replace function public.get_scout_players(p_min_matches int default 3)
returns json
language sql
stable
as $$
  with base as (
    select pms.player_id, pms.match_id, pms.kills, pms.deaths, pms.assists,
           pms.is_win, pms.played_at, pms.team_id,
           (pms.stats->>'acs_avg')::numeric as acs,
           case when jsonb_typeof(pms.stats->'maps') = 'array'
                then pms.stats->'maps' else '[]'::jsonb end as maps,
           row_number() over (partition by pms.player_id
                              order by pms.played_at desc nulls last) as rn
    from public.player_match_stats pms
    join public.matches m on m.id = pms.match_id
    join public.games g on g.id = m.game_id
    where g.slug = 'valorant'
      and pms.kills is not null
      and pms.deaths is not null
  ),
  agg as (
    select player_id,
           count(distinct match_id)                     as matches,
           sum(kills)                                   as kills,
           sum(deaths)                                  as deaths,
           sum(coalesce(assists, 0))                    as assists,
           count(*) filter (where is_win)               as wins,
           count(*) filter (where is_win is not null)   as decided,
           round(avg(acs))                              as acs_avg,
           count(acs)                                   as acs_n,
           sum(kills)  filter (where rn <= 5)           as r5_kills,
           sum(deaths) filter (where rn <= 5)           as r5_deaths,
           max(played_at)                               as last_played,
           (array_agg(team_id order by played_at desc nulls last))[1] as last_team_id
    from base
    group by player_id
    having count(distinct match_id) >= p_min_matches
  ),
  agent_counts as (
    select player_id, json_object_agg(agent, n order by n desc) as agents, sum(n) as maps_played
    from (
      select b.player_id, e->>'agent' as agent, count(*) as n
      from base b, jsonb_array_elements(b.maps) e
      where e->>'agent' is not null
      group by 1, 2
    ) x
    group by player_id
  ),
  map_counts as (
    select player_id, json_object_agg(map, n order by n desc) as maps
    from (
      select b.player_id, e->>'map' as map, count(*) as n
      from base b, jsonb_array_elements(b.maps) e
      where coalesce(e->>'map', '') not in ('', 'Unknown', 'unknown')
      group by 1, 2
    ) x
    group by player_id
  )
  select coalesce(json_agg(json_build_object(
           'id',          p.id,
           'nickname',    p.nickname,
           'real_name',   p.real_name,
           'image_url',   p.image_url,
           'nationality', p.nationality,
           'team_id',     t.id,
           'team_name',   t.name,
           'team_logo',   t.logo_url,
           'matches',     a.matches,
           'kills',       a.kills,
           'deaths',      a.deaths,
           'assists',     a.assists,
           'wins',        a.wins,
           'decided',     a.decided,
           'acs_avg',     a.acs_avg,
           'acs_n',       a.acs_n,
           'r5_kills',    a.r5_kills,
           'r5_deaths',   a.r5_deaths,
           'last_played', a.last_played,
           'maps_played', coalesce(ac.maps_played, 0),
           'agents',      ac.agents,
           'maps',        mc.maps
         ) order by a.matches desc), '[]'::json)
  from agg a
  join public.players p on p.id = a.player_id
  left join public.teams t on t.id = coalesce(p.team_pandascore_id, a.last_team_id)
  left join agent_counts ac on ac.player_id = a.player_id
  left join map_counts mc on mc.player_id = a.player_id
  where p.nickname is not null;
$$;

grant execute on function public.get_scout_players(int) to anon, authenticated;
