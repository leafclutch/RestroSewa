-- Richer delivery log for the admin history view + retry.
--
-- report_deliveries already records status/error/sent_at per (restaurant, day).
-- Add the fields the owner-facing history needs: when the report was BUILT
-- (generated_at, distinct from when it was sent), exactly WHO it went to
-- (recipients), and how many send attempts it has taken (attempts, accumulated
-- across the hourly auto-retry and any manual retries).
--
-- Additive and idempotent — safe on the rows already in production.
alter table report_deliveries
  add column if not exists generated_at timestamptz,
  add column if not exists recipients   text[] not null default '{}',
  add column if not exists attempts      int    not null default 0;
