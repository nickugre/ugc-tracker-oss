-- Scheduler for the hosted project. Not a migration: the URL and the secret differ per environment.
--
-- Easiest:  pnpm cron:install   (fills in APP_URL and CRON_SECRET from .env.hosted and runs this file)
-- By hand:  replace the two placeholders below and run the file in the Supabase SQL editor.
-- Safe to run again: secrets and schedules are updated in place.
--
-- Supabase Cron (pg_cron) calls the app's job endpoints through pg_net. The endpoints answer
-- immediately and run the job in the background; results show up in Settings → Scheduled jobs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. The app URL and the CRON_SECRET (same value as the Vercel env var) live in Vault.
do $$
declare
  app_url constant text := 'https://YOUR-APP.vercel.app';
  cron_secret constant text := 'PASTE-YOUR-CRON_SECRET-HERE';
  secret_id uuid;
begin
  select id into secret_id from vault.secrets where name = 'ugc_app_url';
  if secret_id is null then
    perform vault.create_secret(app_url, 'ugc_app_url');
  else
    perform vault.update_secret(secret_id, app_url);
  end if;

  select id into secret_id from vault.secrets where name = 'ugc_cron_secret';
  if secret_id is null then
    perform vault.create_secret(cron_secret, 'ugc_cron_secret');
  else
    perform vault.update_secret(secret_id, cron_secret);
  end if;
end $$;

-- 2. One helper that posts to a job endpoint with the Bearer secret.
create or replace function public.ugc_call_job(path text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ugc_app_url') || path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ugc_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
$$;

revoke all on function public.ugc_call_job(text) from public, anon, authenticated;

-- 3. Schedules (UTC). Hourly: recover missed runs, lock closed windows. It scrapes only a video
-- whose window has ended and that the daily sync missed (free while the daily sync works).
select cron.schedule('ugc-window-close',    '5 * * * *',  $$select public.ugc_call_job('/api/cron/window-close')$$);
-- Daily 06:00: the routine scraping. New videos, fresh metrics for every video not locked yet
-- (that includes the count after a window's end), and comments for the Spark page.
select cron.schedule('ugc-daily-sync',      '0 6 * * *',  $$select public.ugc_call_job('/api/cron/daily-sync')$$);
-- Daily 07:30: paid (Spark) views from TikTok Ads. Does nothing until the token is configured.
select cron.schedule('ugc-tiktok-ads-sync', '30 7 * * *', $$select public.ugc_call_job('/api/cron/tiktok-ads-sync')$$);

-- Useful afterwards:
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select id, status_code, created from net._http_response order by created desc limit 10;
--   select cron.unschedule('ugc-daily-sync');
