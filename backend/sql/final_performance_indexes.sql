-- Final performance indexes for v1.5 hardening sprint
-- Apply in Supabase SQL editor (CONCURRENTLY must run outside explicit transaction blocks).

-- 1) H2H query accelerator: team_a_id/team_b_id + recent finished ordering
create index concurrently if not exists idx_matches_finished_h2h_a_b_sched
on public.matches (team_a_id, team_b_id, scheduled_at desc)
where status = 'finished';

-- 2) H2H reverse-direction accelerator: team_b_id/team_a_id + recent finished ordering
create index concurrently if not exists idx_matches_finished_h2h_b_a_sched
on public.matches (team_b_id, team_a_id, scheduled_at desc)
where status = 'finished';

-- 3) Community vote uniqueness per user per match
create unique index concurrently if not exists uq_match_community_votes_match_voter
on public.match_community_votes (match_id, voter_id);

-- 4) Community vote aggregation helper for side splits
create index concurrently if not exists idx_match_community_votes_match_side
on public.match_community_votes (match_id, team_side);

-- 5) Match stats join/filter accelerator
create index concurrently if not exists idx_match_stats_match_id
on public.match_stats (match_id);
