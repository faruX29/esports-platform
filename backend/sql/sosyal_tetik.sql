-- Sosyal video işlerini tam saatinde başlatır: pg_cron → GitHub workflow_dispatch.
--
-- NEDEN (3 Kasım 2026): GitHub zamanlanmış koşuları her gün saatlerce gecikiyor. 19:00'a
-- kurulu radar 22 Ekim–2 Kasım arası 21:40 ile 02:21 TSİ arasında başladı; 08:00'e kurulu
-- sağlık raporu 13:12–16:06'da. Elle/API ile başlatılan (workflow_dispatch) koşu beklemez.
-- İş akışlarındaki schedule yedek olarak kalır; son 12 saatte dispatch koşusu varsa atlar.
--
--   radar-tetik  19:00 TSİ  social-radar.yml  gun = yarın (açıkça; gecikme günü kaydıramaz)
--   kadro-tetik  09:00 TSİ  social-kadro.yml  Türk takımı kadro videosu, varsa
--
-- KURULUM (bir kez):
--   1) GitHub → Settings → Developer settings → Fine-grained tokens: yalnız bu repo,
--      Repository permissions → Actions: Read and write. En fazla 1 yıl geçerli → bitiş
--      tarihini notlara yaz, dolmadan yenile.
--   2) Supabase SQL Editor:
--        select vault.create_secret('<TOKEN>', 'github_dispatch_token', 'GitHub workflow_dispatch');
--      (yenilerken: select vault.update_secret(id, '<TOKEN>') from vault.secrets
--                   where name = 'github_dispatch_token';)
--   3) Bu dosyayı çalıştır. Deneme: select public.github_is_tetikle('social-kadro.yml');
--      sonra select status_code, content from net._http_response order by id desc limit 1;
--      → 204 beklenir.

create or replace function public.github_is_tetikle(p_is text, p_girdiler jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    tok text;
begin
    select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1;
    if tok is null then
        raise exception 'github_dispatch_token Vault''ta yok';
    end if;

    return net.http_post(
        url     := 'https://api.github.com/repos/faruX29/esports-platform/actions/workflows/' || p_is || '/dispatches',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || tok,
            'Accept', 'application/vnd.github+json',
            'X-GitHub-Api-Version', '2022-11-28',
            'User-Agent', 'fext-pg-cron',
            'Content-Type', 'application/json'),
        body    := jsonb_build_object('ref', 'main', 'inputs', p_girdiler),
        timeout_milliseconds := 10000
    );
end $$;
revoke all on function public.github_is_tetikle(text, jsonb) from public, anon, authenticated;

-- pg_cron saatleri UTC.
select cron.unschedule(jobname) from cron.job where jobname in ('radar-tetik', 'kadro-tetik');
select cron.schedule('radar-tetik', '0 16 * * *', $CRON$
    select public.github_is_tetikle('social-radar.yml', jsonb_build_object(
        'gun', to_char((now() at time zone 'Europe/Istanbul')::date + 1, 'YYYY-MM-DD')))
$CRON$);
select cron.schedule('kadro-tetik', '0 6 * * *', $CRON$
    select public.github_is_tetikle('social-kadro.yml')
$CRON$);
