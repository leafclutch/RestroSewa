-- A stay can now END a second way: cancelled.
--
-- ── WHY THIS IS A MIGRATION ALL BY ITSELF ────────────────────────────────────
-- `scripts/migrate.mjs` wraps every migration in `begin … commit`, and Postgres
-- refuses to USE an enum value that was added in the same transaction:
--
--   ERROR: unsafe use of new value "cancelled" of enum type room_stay_status
--
-- The next migration (20260818000100) writes `status = 'cancelled'` inside a
-- plpgsql function body, so the two CANNOT share a file. Merging them looks
-- tidier and fails on the first run. Leave them apart.
--
-- Additive and idempotent: an older app build never selects on this value, so
-- the deploy window is safe in both directions.

alter type room_stay_status add value if not exists 'cancelled';
