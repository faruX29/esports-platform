-- ── Tarayıcı hata kaydı (client_errors) ────────────────────────────────────
-- Supabase SQL Editor'da çalıştır. Tekrar çalıştırılabilir.
--
-- İstemci (frontend/src/utils/hataBildir.js) render hatası, yakalanmamış hata,
-- reddedilen promise ve CSP ihlalini client_error_kaydet() ile yazar.
-- Kimlik tutulmaz: kullanıcı id'si, IP, sorgu dizesi ve URL parçası (#) yok;
-- yalnız sayfa yolu, hata metni, yığın, tarayıcı bilgisi ve sürüm.
-- Tabloya doğrudan erişim yok (RLS açık, politika yok); okuma servis rolüyle
-- (günlük sağlık e-postası, backend/etl/saglik_raporu.py). 30 gün sonra silinir.

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  tur         text        not null check (tur in ('render', 'hata', 'promise', 'csp')),
  mesaj       text        not null,
  yigin       text,
  yol         text,
  tarayici    text,
  surum       text
);

create index if not exists client_errors_created_idx on public.client_errors (created_at);

alter table public.client_errors enable row level security;
revoke all on table public.client_errors from public, anon, authenticated;

-- Alanlar sessizce kırpılır (reddetmek hata bilgisini kaybettirir). Toplam sınır:
-- son 1 saatte 300 satırdan sonrası yazılmaz; istemci zaten oturum başına 5 gönderir,
-- sınır yalnız toplu doldurmayı durdurur.
create or replace function public.client_error_kaydet(
  p_tur      text,
  p_mesaj    text,
  p_yigin    text default null,
  p_yol      text default null,
  p_tarayici text default null,
  p_surum    text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_tur is null or p_tur not in ('render', 'hata', 'promise', 'csp')
     or coalesce(btrim(p_mesaj), '') = '' then
    return;
  end if;

  if (select count(*) from public.client_errors
      where created_at > now() - interval '1 hour') >= 300 then
    return;
  end if;

  insert into public.client_errors (tur, mesaj, yigin, yol, tarayici, surum)
  values (
    p_tur,
    left(p_mesaj, 500),
    left(p_yigin, 4000),
    -- Sorgu dizesi ve # parçası atılır (OAuth dönüşünde # içinde token olur).
    left(split_part(split_part(p_yol, '?', 1), '#', 1), 300),
    left(p_tarayici, 300),
    left(p_surum, 40)
  );
end;
$$;

revoke all on function public.client_error_kaydet(text, text, text, text, text, text) from public;
grant execute on function public.client_error_kaydet(text, text, text, text, text, text) to anon, authenticated;

-- 30 günden eski satırları her gece sil (aynı adla yeniden çağrı işi günceller).
select cron.schedule(
  'hata-kaydi-temizle',
  '23 3 * * *',
  $CRON$delete from public.client_errors where created_at < now() - interval '30 days'$CRON$
);

-- ── DOĞRULAMA (anon anahtarla REST) ─────────────────────────────────────────
--   GET  /rest/v1/client_errors?select=*                         → 42501 (okuma kapalı)
--   POST /rest/v1/client_errors {"id":null}                      → 42501 (yazma kapalı)
--   POST /rest/v1/rpc/client_error_kaydet {"p_tur":"x","p_mesaj":"y"} → 204, satır yazılmaz
--   POST /rest/v1/rpc/client_error_kaydet {"p_tur":"hata","p_mesaj":"deneme","p_yol":"/a?t=1#k"}
--        → 204, satırda yol = '/a'
