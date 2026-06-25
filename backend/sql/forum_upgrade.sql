-- Forum Upgrade Migration
-- Supabase SQL Editor'da çalıştır.
-- Güvenli: tüm komutlar IF NOT EXISTS / idempotent.

-- ─── BUG-1: profiles herkese okunabilir (username, avatar_url, scout_score public veri) ────────
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
    and policyname = 'profiles_select_public'
  ) then
    create policy profiles_select_public on public.profiles
      for select using (true);
  end if;
end $$;

-- ─── BUG-2: news_comment_votes tablosu eksik ─────────────────────────────────────────────────
create table if not exists public.news_comment_votes (
  comment_id bigint  not null references public.news_comments(id) on delete cascade,
  user_id    uuid    not null references auth.users(id) on delete cascade,
  vote_type  integer not null check (vote_type in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists ncv_comment_idx on public.news_comment_votes(comment_id);

alter table public.news_comment_votes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'news_comment_votes'
    and policyname = 'ncv_read_all'
  ) then
    create policy ncv_read_all on public.news_comment_votes
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'news_comment_votes'
    and policyname = 'ncv_own_manage'
  ) then
    create policy ncv_own_manage on public.news_comment_votes
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- ─── BUG-3: news_comments kolon adı senkronizasyonu ─────────────────────────────────────────
-- Frontend COMMENT_CONTENT_COLUMN = 'content' kullanıyor.
-- Eğer tablonuzda kolon hâlâ 'comment_text' adıyla duruyorsa aşağıdaki satırı uncomment edin:
-- alter table public.news_comments rename column comment_text to content;
--
-- Eğer zaten 'content' adıyla varsa (frontend çalışıyorsa bu durumdur) bu satır gerekmez.
