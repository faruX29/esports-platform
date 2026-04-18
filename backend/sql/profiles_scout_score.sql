-- Scout reputation foundation
-- 1) Ensure profiles has scout_score.
-- 2) Keep score in sync with news_comment_votes through triggers.

alter table if exists public.profiles
  add column if not exists scout_score integer not null default 0;

update public.profiles
set scout_score = 0
where scout_score is null;

create or replace function public.apply_scout_score_from_vote()
returns trigger
language plpgsql
security definer
as $$
declare
  author_id uuid;
  delta integer := 0;
begin
  if tg_op = 'INSERT' then
    select user_id into author_id
    from public.news_comments
    where id = new.comment_id;

    if author_id is null or author_id = new.user_id then
      return new;
    end if;

    delta := coalesce(new.vote_type, 0);
  elsif tg_op = 'UPDATE' then
    select user_id into author_id
    from public.news_comments
    where id = new.comment_id;

    if author_id is null or author_id = new.user_id then
      return new;
    end if;

    delta := coalesce(new.vote_type, 0) - coalesce(old.vote_type, 0);
  elsif tg_op = 'DELETE' then
    select user_id into author_id
    from public.news_comments
    where id = old.comment_id;

    if author_id is null or author_id = old.user_id then
      return old;
    end if;

    delta := -coalesce(old.vote_type, 0);
  end if;

  if delta <> 0 then
    update public.profiles
    set scout_score = coalesce(scout_score, 0) + delta
    where id = author_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_scout_score_vote_insert on public.news_comment_votes;
create trigger trg_scout_score_vote_insert
after insert on public.news_comment_votes
for each row
execute function public.apply_scout_score_from_vote();

drop trigger if exists trg_scout_score_vote_update on public.news_comment_votes;
create trigger trg_scout_score_vote_update
after update of vote_type on public.news_comment_votes
for each row
execute function public.apply_scout_score_from_vote();

drop trigger if exists trg_scout_score_vote_delete on public.news_comment_votes;
create trigger trg_scout_score_vote_delete
after delete on public.news_comment_votes
for each row
execute function public.apply_scout_score_from_vote();
