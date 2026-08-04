-- ─────────────────────────────────────────────────────────────────────────────
-- Daily-summary scheduler — MANUAL, per-environment setup (NOT a migration).
--
-- This file is intentionally OUTSIDE supabase/migrations/ so scripts/migrate.mjs
-- never runs it: it enables extensions and reads secrets from Vault, which are
-- environment-specific and need elevated privileges. Run it ONCE per project
-- (dev and prod) in the Supabase SQL editor, AFTER storing the two Vault secrets.
--
-- Prerequisites (see docs/daily-summary-setup.md):
--   1. Deploy the app (the /api/cron/daily-summary route must exist).
--   2. Apply migration 20260727300000_report_deliveries.sql.
--   3. Store two Vault secrets (Dashboard → Project Settings → Vault, or SQL):
--        select vault.create_secret('https://your-app.example.com', 'app_base_url');
--        select vault.create_secret('<the CRON_SECRET value>',       'cron_secret');
--      (Use the SAME cron_secret value you set as CRON_SECRET in the app env.)
-- ─────────────────────────────────────────────────────────────────────────────

-- Extensions (enable via Dashboard → Database → Extensions if these error).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Reschedule idempotently: unschedule an existing job of the same name first.
select cron.unschedule('daily-summary-emails')
 where exists (select 1 from cron.job where jobname = 'daily-summary-emails');

-- Every 15 minutes. The route always targets the PREVIOUS business day and
-- dedupes via report_deliveries, so one job serves every restaurant's closing hour.
--
-- WHY */15 AND NOT HOURLY: pg_cron schedules in GMT (`cron.timezone`), and Nepal
-- is UTC+05:45. So the old '0 * * * *' fired at :45 past every NEPAL hour — a
-- restaurant closing at midnight got its report at 00:45, 45 minutes late, every
-- single night. Every whole Nepal hour is UTC HH:15 (Nepal 00:00 = 18:15 UTC,
-- Nepal 04:00 = 22:15 UTC), and */15 fires at :00/:15/:30/:45 — so a tick lands
-- EXACTLY on each restaurant's closing instant and the mail goes out within
-- seconds of it. If a tick is ever missed the report is at most 15 minutes late,
-- not 60. Do not "tidy" this back to an hourly schedule.
select cron.schedule(
  'daily-summary-emails',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url')
           || '/api/cron/daily-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Inspect / troubleshoot:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
