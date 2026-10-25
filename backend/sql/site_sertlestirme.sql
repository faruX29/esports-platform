-- Site sertleştirme (denetim Faz 2). Tekrar çalıştırılabilir.
--
-- 1) scout_waitlist: e-posta biçimi/uzunluk CHECK, büyük-küçük harfe duyarsız
--    benzersizlik, saatlik toplam kayıt sınırı (anon doğrudan REST'ten yazabildiği için).
-- 2) news_comment_votes yalnız sahibine açık; sayılar news_comment_vote_counts görünümünden.
-- 3) scout_score: eski (kendi yorumuna verilen oyu da sayan) tetikleyici kaldırılır;
--    kullanıcı kendi profilinde scout_score'u doğrudan yazamaz; puan oylardan yeniden hesaplanır.
-- 4) Okuma görünümleri: fextopus_isabet / turk_takimlar çağıranın yetkisiyle okur
--    (alttaki tablolar zaten herkese açık); anon/authenticated görünümlerde yalnız SELECT.
-- 5) Fonksiyonlarda sabit search_path.

-- ── 1) scout_waitlist ───────────────────────────────────────────────────────

create unique index if not exists scout_waitlist_email_lower_key
  on public.scout_waitlist (lower(email));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scout_waitlist_email_bicim'
                 and conrelid = 'public.scout_waitlist'::regclass) then
    alter table public.scout_waitlist add constraint scout_waitlist_email_bicim
      check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scout_waitlist_alan_sinir'
                 and conrelid = 'public.scout_waitlist'::regclass) then
    alter table public.scout_waitlist add constraint scout_waitlist_alan_sinir
      check (coalesce(length(organization), 0) <= 200
             and coalesce(role, 'other') in ('agency', 'team', 'scout', 'other'));
  end if;
end $$;

-- Toplam hız sınırı: son 1 saatte 20 kayıttan fazlası reddedilir. Gerçek kullanımda
-- bu sayıya yaklaşılmaz; sınır yalnız toplu doldurmayı durdurur. Sayım için tabloyu
-- okuması gerektiğinden SECURITY DEFINER (anon'un SELECT yetkisi yok).
create or replace function public.scout_waitlist_hiz_siniri()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.scout_waitlist
      where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'scout_waitlist: hız sınırı' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.scout_waitlist_hiz_siniri() from public, anon, authenticated;

drop trigger if exists trg_scout_waitlist_hiz_siniri on public.scout_waitlist;
create trigger trg_scout_waitlist_hiz_siniri
before insert on public.scout_waitlist
for each row execute function public.scout_waitlist_hiz_siniri();

-- ── 2) news_comment_votes ───────────────────────────────────────────────────
-- Kendi oyunu okuma/yazma ncv_own_manage (FOR ALL, auth.uid() = user_id) ile kalır.

-- Herkese açık okuma politikaları (adları farklı dosyalardan geldi) ada bakılmadan kaldırılır.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'news_comment_votes'
             and cmd = 'SELECT' and policyname <> 'ncv_own_manage'
  loop
    execute format('drop policy %I on public.news_comment_votes', p.policyname);
  end loop;
end $$;

create or replace view public.news_comment_vote_counts
with (security_invoker = false) as
select comment_id,
       count(*) filter (where vote_type = 1)::int  as up,
       count(*) filter (where vote_type = -1)::int as down
from public.news_comment_votes
group by comment_id;

revoke all on public.news_comment_vote_counts from public, anon, authenticated;
grant select on public.news_comment_vote_counts to anon, authenticated;

-- ── 3) scout_score ──────────────────────────────────────────────────────────
-- Puanı apply_scout_score_from_vote (profiles_scout_score.sql) yönetir.

drop trigger if exists tr_update_scout_score on public.news_comment_votes;
drop function if exists public.apply_scout_score();

-- İstemci rolleri (anon/authenticated) scout_score'u değiştiremez. Oy tetikleyicisi
-- SECURITY DEFINER olduğundan sahibinin rolüyle koşar ve bu korumaya takılmaz.
create or replace function public.profiles_scout_score_koru()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.scout_score := 0;
    else
      new.scout_score := old.scout_score;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_scout_score_koru on public.profiles;
create trigger trg_profiles_scout_score_koru
before insert or update on public.profiles
for each row execute function public.profiles_scout_score_koru();

-- Oylardan yeniden hesapla (kendi yorumuna verilen oy sayılmaz).
with hesap as (
  select p.id,
         coalesce((select sum(v.vote_type)::int
                   from public.news_comment_votes v
                   join public.news_comments n on n.id = v.comment_id
                   where n.user_id = p.id and v.user_id <> n.user_id), 0) as puan
  from public.profiles p
)
update public.profiles p
set scout_score = h.puan
from hesap h
where h.id = p.id
  and coalesce(p.scout_score, 0) <> h.puan;

-- ── 4) Okuma görünümleri ────────────────────────────────────────────────────

alter view public.fextopus_isabet set (security_invoker = true);
alter view public.turk_takimlar  set (security_invoker = true);

revoke insert, update, delete, truncate, references, trigger
  on public.fextopus_isabet, public.turk_takimlar, public.past_matches,
     public.upcoming_matches, public.ai_accuracy_stats
  from anon, authenticated;

-- ── 5) Sabit search_path ────────────────────────────────────────────────────

alter function public.apply_scout_score_from_vote()           set search_path = public;
alter function public.sync_player_team_on_transfer()          set search_path = public;
alter function public.get_prediction_accuracy(integer)        set search_path = public;
alter function public.get_scout_players(integer)              set search_path = public;
alter function public.get_teams_recent_form(bigint[])         set search_path = public;
alter function public.set_updated_at()                        set search_path = public;

-- ── 6) Tetikleyici fonksiyonlarını RPC'den kapat ────────────────────────────
-- Tetikleyici çalışırken EXECUTE yetkisi aranmaz; yalnız dışarıdan çağrı kapanır.
-- email_for_login / username_available anon'a BİLEREK açık (giriş ve kayıt).

revoke execute on function public.apply_scout_score_from_vote()  from public, anon, authenticated;
revoke execute on function public.sync_player_team_on_transfer() from public, anon, authenticated;

-- ── 7) avatars kovası listelenemesin ────────────────────────────────────────
-- Kova public: görsel URL'si SELECT politikası olmadan da açılır. Geniş SELECT
-- yalnız listelemeye yarıyordu (klasör adları kullanıcı id'si). Sahibi kendi
-- klasörünü okuyabilir (upload upsert bunu ister).

drop policy if exists avatars_public_read on storage.objects;
drop policy if exists avatars_owner_select on storage.objects;
create policy avatars_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

-- ── 8) scout_waitlist ekleme politikası ─────────────────────────────────────
-- Herkes ekleyebilir (form anon); sınırı CHECK + hız tetikleyicisi koyar.
-- `true` yerine açık koşul: Advisor'ın "always true" uyarısı niyeti yansıtmıyordu.

drop policy if exists scout_waitlist_insert_anon on public.scout_waitlist;
create policy scout_waitlist_insert_anon on public.scout_waitlist
  for insert to anon, authenticated
  with check (email is not null);

-- ── DOĞRULAMA (anon anahtarla REST) ─────────────────────────────────────────
--   GET  /rest/v1/news_comment_votes?select=user_id        → []
--   GET  /rest/v1/news_comment_vote_counts?select=*        → sayılar
--   POST /rest/v1/scout_waitlist {"email":"x"}             → 23514 (CHECK)
--   GET  /rest/v1/turk_takimlar?select=team_id&limit=1     → satır (invoker ile de okunur)
--   GET  /rest/v1/fextopus_isabet?select=*&limit=1         → satır
--   Giriş yapmış kullanıcıyla PATCH profiles {"scout_score":999} → 200 ama değer değişmez
