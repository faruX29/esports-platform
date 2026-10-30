-- PandaScore görsellerinin yedeği (Supabase Storage `gorsel-yedek`).
--
-- Neden: bazı Türkiye hatlarındaki "Güvenli İnternet" (aile/çocuk profili) filtresi
-- `*.pandascore.co` adına giden TLS bağlantısını kesiyor; o hatlarda takım logoları
-- hiç yüklenmiyor. Site önce PandaScore'u dener, açılmazsa bu yedeğe düşer
-- (frontend/src/utils/gorsel.js `yedekGorsel`). Yedeği yalnız açamayanlar indirir.
--
-- Yol: PandaScore yolunun `/images/` sonrası, dosya adı `thumb_` ile:
--   https://cdn-api.pandascore.co/images/team/image/123/logo.png
--   → <SUPABASE_URL>/storage/v1/object/public/gorsel-yedek/team/image/123/thumb_logo.png
-- PandaScore logoyu değiştirirse `logo_url` değişir → yeni yol, yeniden kopyalanır.
--
-- Akış: pg_cron `gorsel-yedek` (10 dk'da bir) → bekleyen kaynak varsa Edge Function
-- `gorsel-yedek`'i çağırır (supabase/functions/gorsel-yedek). Kimlik: x-cron-secret
-- (Vault `push_cron_secret` = Edge secret PUSH_CRON_SECRET; send-push ile ortak).
-- Tekrar çalıştırılabilir.

-- ── 1) Public bucket (yazma yalnız service_role) ────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gorsel-yedek', 'gorsel-yedek', true, 1048576,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 2) Hangi kaynak kopyalandı ──────────────────────────────────────────
create table if not exists public.gorsel_yedek (
    kaynak     text primary key,               -- PandaScore URL'si (teams.logo_url)
    yuklendi   timestamptz,                    -- başarılı kopya zamanı
    hata       text,                           -- son hata (başarıda NULL)
    deneme     integer not null default 0,     -- art arda başarısız deneme
    guncellendi timestamptz not null default now()
);
alter table public.gorsel_yedek enable row level security;   -- politika yok: yalnız service_role
revoke all on public.gorsel_yedek from anon, authenticated;

-- ── 3) Bekleyenler: önce Türk takımları, sonra son maçı yakın olanlar ─────
-- Başarısız kaynak 3 denemeye kadar 6 saatte bir yeniden denenir, sonra bırakılır
-- (logo_url değişirse yeni kaynak olarak baştan girer).
create or replace function public.gorsel_yedek_bekleyen(p_limit integer default 120)
returns table (kaynak text)
language sql stable
set search_path = public
as $$
    with takim as (
        select t.id, t.logo_url
        from teams t
        where t.logo_url like 'https://cdn-api.pandascore.co/images/team/%'
    ),
    son_mac as (
        select x.takim_id, max(m.begin_at) as son
        from matches m
        cross join lateral (values (m.team_a_id), (m.team_b_id)) as x(takim_id)
        where m.begin_at > now() - interval '365 days'
        group by x.takim_id
    )
    select k.logo_url
    from takim k
    left join gorsel_yedek g on g.kaynak = k.logo_url
    left join son_mac s on s.takim_id = k.id
    where g.kaynak is null
       or (g.yuklendi is null and g.deneme < 3 and g.guncellendi < now() - interval '6 hours')
    group by k.logo_url
    order by bool_or(exists (select 1 from turk_takimlar tt where tt.team_id = k.id)) desc,
             max(s.son) desc nulls last
    limit p_limit
$$;
revoke all on function public.gorsel_yedek_bekleyen(integer) from public, anon, authenticated;

create or replace function public.gorsel_yedek_sonuc(p_kaynak text, p_hata text)
returns void
language sql
set search_path = public
as $$
    insert into gorsel_yedek as g (kaynak, yuklendi, hata, deneme, guncellendi)
    values (p_kaynak,
            case when p_hata is null then now() end,
            p_hata,
            case when p_hata is null then 0 else 1 end,
            now())
    on conflict (kaynak) do update
       set yuklendi    = case when excluded.hata is null then now() else g.yuklendi end,
           hata        = excluded.hata,
           deneme      = case when excluded.hata is null then 0 else g.deneme + 1 end,
           guncellendi = now()
$$;
revoke all on function public.gorsel_yedek_sonuc(text, text) from public, anon, authenticated;

-- ── 4) Tetik: bekleyen yoksa istek atılmaz ──────────────────────────────
create or replace function public.gorsel_yedek_tetik()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    sir text;
begin
    if not exists (select 1 from gorsel_yedek_bekleyen(1)) then
        return null;
    end if;

    select decrypted_secret into sir from vault.decrypted_secrets where name = 'push_cron_secret' limit 1;
    if sir is null then
        raise exception 'push_cron_secret Vault''ta yok';
    end if;

    return net.http_post(
        url     := 'https://owepdnaivhrpadapbtxb.supabase.co/functions/v1/gorsel-yedek',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', sir),
        body    := '{}'::jsonb,
        timeout_milliseconds := 120000
    );
end $$;
revoke all on function public.gorsel_yedek_tetik() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'gorsel-yedek';
select cron.schedule('gorsel-yedek', '*/10 * * * *', $CRON$select public.gorsel_yedek_tetik()$CRON$);
