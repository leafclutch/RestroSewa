-- ── Report delivery log ───────────────────────────────────────────────────────
-- One row per report actually sent (or attempted) for a restaurant and a period.
-- The daily-summary cron inserts here AFTER building + sending, and the unique
-- key is what makes sending exactly-once: an hourly job that targets the same
-- (restaurant, day) again simply conflicts and skips.
--
-- Built for extension: `period_type` is 'daily' today; 'weekly'/'monthly' slot in
-- later with the same table and no schema change (period_key holds the day, ISO
-- week, or month as a string).
create table if not exists report_deliveries (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  period_type     text not null,           -- 'daily' | 'weekly' | 'monthly'
  period_key      text not null,           -- e.g. '2026-07-27' for daily
  status          text not null,           -- 'sent' | 'failed'
  recipient_count int  not null default 0,
  error           text,
  sent_at         timestamptz not null default now(),
  unique (restaurant_id, period_type, period_key)
);

-- Only the service role (the cron route) ever touches this. Enable RLS with no
-- policy so anon/authenticated are denied; service_role bypasses RLS.
alter table report_deliveries enable row level security;
