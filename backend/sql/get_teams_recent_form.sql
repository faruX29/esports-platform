-- get_teams_recent_form: her takım için SON 5 biten maçın W/L formunu döndürür.
--
-- NEDEN: Dashboard formu eskiden global `matches ... limit(300)` ile kuruluyordu →
-- ana sayfadaki ~60 takım için 300 maç yetmiyor, az-oynayan takımların maçları
-- kaçıyordu → o takımlar 1 pill gösteriyor ya da yanlış/eksik form (TeamPage'deki
-- gerçek form ile çelişki). Bu RPC window function ile takım BAŞINA son-5'i garanti
-- eder (winner_id-öncelikli, TeamPage matchOutcome ile tutarlı). En yeni sonuç başta.
--
-- KURULUM: Supabase → SQL Editor'de bir kez çalıştır.

create or replace function get_teams_recent_form(p_team_ids bigint[])
returns table(team_id bigint, form text)
language sql
stable
as $$
  with tm as (
    select t.tid as team_id, m.scheduled_at, m.winner_id
    from matches m
    cross join lateral (values (m.team_a_id), (m.team_b_id)) as t(tid)
    where t.tid = any(p_team_ids)
      and m.status = 'finished'
      and m.winner_id is not null
  ),
  ranked as (
    select team_id,
           case when winner_id = team_id then 'W' else 'L' end as res,
           row_number() over (partition by team_id order by scheduled_at desc nulls last) as rn
    from tm
  )
  select team_id, string_agg(res, '' order by rn) as form
  from ranked
  where rn <= 5
  group by team_id;
$$;

-- Supabase anon/authenticated rolleri çağırabilsin (frontend RPC).
grant execute on function get_teams_recent_form(bigint[]) to anon, authenticated;
