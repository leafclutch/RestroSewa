-- =============================================================
-- Table-Group based staff assignment
-- =============================================================
-- Staff are now assigned to TABLE GROUPS only (restaurant_user_table_groups).
-- Individual per-table assignment is removed. A table's orders / calls route to
-- the staff assigned to that table's group. This migration:
--   1. Adds a 'new_order' notification type so a customer placing an order
--      raises an alert through the existing notification system.
--   2. Drops the now-unused individual table→staff assignment table.
--
-- NOTE: PostgreSQL requires an ALTER TYPE ADD VALUE to commit before the new
-- value can be used. 'new_order' is only ever written by application code at
-- runtime (never within this migration), so this is safe.

do $$
begin
  alter type notification_type add value 'new_order';
exception
  when duplicate_object then null;
end $$;

-- Individual table assignment is superseded by table-group assignment.
drop table if exists restaurant_user_tables;
