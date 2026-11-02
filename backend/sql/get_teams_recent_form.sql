-- get_teams_recent_form: her takım için SON 5 biten maçın W/L formunu döndürür.
--
-- NEDEN: Dashboard formu eskiden global `matches ... limit(300)` ile kuruluyordu →
-- ana sayfadaki ~60 takım için 300 maç yetmiyor, az-oynayan takımların maçları
-- kaçıyordu → o takımlar 1 pill gösteriyor ya da yanlış/eksik form (TeamPage'deki
-- gerçek form ile çelişki). Bu RPC takım BAŞINA son-5'i garanti eder
-- (winner_id-öncelikli, TeamPage matchOutcome ile tutarlı). En yeni sonuç başta.
--
-- HIZ (2 Kasım 2026): ilk sürüm tüm biten maçları (40 bin satır) tarayıp pencere
-- fonksiyonuyla sıralıyordu: get_home_feed'in %90'ı (sıcak 750 ms, önbellek soğukken
-- ~2,7 sn). Şimdi takım başına iki indeks araması (A tarafı + B tarafı, her biri 5 satır).
-- Aynı saatteki maçlar id ile sıralanır (eskiden sıra belirsizdi).
--
-- KURULUM: Supabase → SQL Editor'de bir kez çalıştır.

create index if not exists idx_matches_finished_form_a
  on matches (team_a_id, scheduled_at desc nulls last, id desc)
  where status = 'finished' and winner_id is not null;
create index if not exists idx_matches_finished_form_b
  on matches (team_b_id, scheduled_at desc nulls last, id desc)
  where status = 'finished' and winner_id is not null;

create or replace function get_teams_recent_form(p_team_ids bigint[])
returns table(team_id bigint, form text)
language sql
stable
set search_path = public
as $$
  select t.tid as team_id,
         string_agg(case when s.winner_id = t.tid then 'W' else 'L' end, ''
                    order by s.scheduled_at desc nulls last, s.id desc) as form
  from unnest(p_team_ids) as t(tid)
  cross join lateral (
    select u.id, u.scheduled_at, u.winner_id
    from (
      (select m.id, m.scheduled_at, m.winner_id from matches m
        where m.team_a_id = t.tid and m.status = 'finished' and m.winner_id is not null
        order by m.scheduled_at desc nulls last, m.id desc limit 5)
      union all
      (select m.id, m.scheduled_at, m.winner_id from matches m
        where m.team_b_id = t.tid and m.status = 'finished' and m.winner_id is not null
        order by m.scheduled_at desc nulls last, m.id desc limit 5)
    ) u
    order by u.scheduled_at desc nulls last, u.id desc
    limit 5
  ) s
  group by t.tid;
$$;

-- Supabase anon/authenticated rolleri çağırabilsin (frontend RPC).
grant execute on function get_teams_recent_form(bigint[]) to anon, authenticated;
