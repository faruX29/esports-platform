-- ── Profil ve beğeni verisini herkese açık okumadan çıkar ───────────────────
-- Supabase SQL Editor'da çalıştır. Tekrar çalıştırılabilir.
--
-- 1) email_for_login artık şifre ister: kullanıcı adı + doğru şifre → e-posta,
--    başka her durumda NULL. Kendi deneme sınırı var (login_rpc_attempts).
-- 2) profiles tablosu yalnız sahibine açık; herkese açık okuma profiles_public
--    görünümünden (kullanıcı adı, avatar, rozet; ad soyad ve tarih yok).
-- 3) Kayıtta kullanıcı adı müsaitliği username_available() ile (yalnız boolean).
-- 4) news_likes yalnız sahibine açık; sayılar news_like_counts görünümünden.
--
-- Görünümler sahibinin (postgres) yetkisiyle okur (security_invoker = false):
-- RLS'i bilerek aşar, bu yüzden sütun listesi dar tutulur ve anon/authenticated
-- yalnız SELECT alır (varsayılan yetkiler basit görünümü yazılabilir bırakır).

-- ── 1) Şifre doğrulamalı kullanıcı adı → e-posta ────────────────────────────

create table if not exists public.login_rpc_attempts (
  id             bigint generated always as identity primary key,
  username_lower text        not null,
  ip             text,
  success        boolean     not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists login_rpc_attempts_user_idx on public.login_rpc_attempts (username_lower, created_at);
create index if not exists login_rpc_attempts_ip_idx   on public.login_rpc_attempts (ip, created_at);

-- RLS açık, politika yok: yalnız SECURITY DEFINER fonksiyon yazar/okur.
alter table public.login_rpc_attempts enable row level security;
revoke all on table public.login_rpc_attempts from anon, authenticated;

drop function if exists public.email_for_login(text);

create or replace function public.email_for_login(identifier text, password text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  ident   text := lower(trim(coalesce(identifier, '')));
  headers json;
  v_ip    text;
  v_email text;
  v_hash  text;
  v_ok    boolean := false;
begin
  -- E-posta ya da boş şifre: istemci bu RPC'yi zaten çağırmaz.
  if length(ident) = 0 or position('@' in ident) > 0 or coalesce(password, '') = '' then
    return null;
  end if;

  begin
    headers := current_setting('request.headers', true)::json;
  exception when others then
    headers := null;
  end;
  v_ip := nullif(trim(split_part(coalesce(headers->>'x-forwarded-for', headers->>'cf-connecting-ip', ''), ',', 1)), '');

  -- Deneme sınırı: kullanıcı adı başına 15 dk'da 5, IP başına 15 dk'da 20 hatalı.
  -- Aşımda da NULL (ayrım yok); sınırdaki istek kaydedilmez, pencere kayar.
  if (select count(*) from public.login_rpc_attempts
      where username_lower = ident and not success
        and created_at > now() - interval '15 minutes') >= 5 then
    return null;
  end if;
  if v_ip is not null and (select count(*) from public.login_rpc_attempts
      where ip = v_ip and not success
        and created_at > now() - interval '15 minutes') >= 20 then
    return null;
  end if;

  select u.email, u.encrypted_password into v_email, v_hash
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = ident
  limit 1;

  -- Google ile açılmış hesapta şifre yok → NULL (beklenen).
  if coalesce(v_hash, '') <> '' then
    begin
      v_ok := extensions.crypt(password, v_hash) = v_hash;
    exception when others then
      v_ok := false;
    end;
  end if;

  insert into public.login_rpc_attempts (username_lower, ip, success) values (ident, v_ip, v_ok);

  if v_ok then
    return lower(v_email);
  end if;
  return null;
end;
$$;

revoke all on function public.email_for_login(text, text) from public;
grant execute on function public.email_for_login(text, text) to anon, authenticated;

-- 1 günden eski deneme satırlarını her gece sil (aynı adla yeniden çağrı işi günceller).
select cron.schedule(
  'login-deneme-temizle',
  '17 3 * * *',
  $CRON$delete from public.login_rpc_attempts where created_at < now() - interval '1 day'$CRON$
);

-- ── 2) profiles: tablo sahibine, herkese açık alanlar görünüme ──────────────

drop policy if exists profiles_select_public on public.profiles;
-- profiles_select_own (auth.uid() = id) kalır.

create or replace view public.profiles_public
with (security_invoker = false) as
select id, username, avatar_url, favorite_team_id, show_team_badge, scout_score
from public.profiles;

revoke all on public.profiles_public from public, anon, authenticated;
grant select on public.profiles_public to anon, authenticated;

-- ── 3) Kullanıcı adı müsait mi (büyük/küçük harf duyarsız) ──────────────────

create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select length(trim(coalesce(name, ''))) > 0
     and not exists (
       select 1 from public.profiles p
       where lower(p.username) = lower(trim(name))
     );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ── 4) news_likes: satırlar sahibine, sayılar görünüme ──────────────────────

drop policy if exists news_likes_read_all on public.news_likes;
drop policy if exists news_likes_select_own on public.news_likes;
create policy news_likes_select_own on public.news_likes
  for select using (auth.uid() = user_id);

create or replace view public.news_like_counts
with (security_invoker = false) as
select news_id, count(*)::int as cnt
from public.news_likes
group by news_id;

revoke all on public.news_like_counts from public, anon, authenticated;
grant select on public.news_like_counts to anon, authenticated;

-- ── DOĞRULAMA (anon anahtarla REST) ─────────────────────────────────────────
--   GET  /rest/v1/profiles?select=*                    → []
--   GET  /rest/v1/profiles_public?select=*             → yalnız 6 sütun
--   PATCH /rest/v1/profiles_public?id=eq.<uuid>        → 42501 (yazma kapalı)
--   POST /rest/v1/rpc/email_for_login {"identifier":"x"}                 → 404 (eski imza yok)
--   POST /rest/v1/rpc/email_for_login {"identifier":"x","password":"y"}  → null
--   GET  /rest/v1/news_likes?select=user_id            → []
--   GET  /rest/v1/news_like_counts?select=*            → sayılar
