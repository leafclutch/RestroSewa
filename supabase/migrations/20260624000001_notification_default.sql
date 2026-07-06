-- =============================================================
-- RestroSewa — Notification Status Default
-- Applied: 2026-06-24
-- MUST be run AFTER 20260624000000_schema_additions.sql commits.
-- The ALTER TYPE ADD VALUE above must be in a committed transaction
-- before the new value can be used as a column default.
-- =============================================================

alter table notifications alter column status set default 'new';
