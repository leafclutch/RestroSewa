-- =============================================================
-- SERVICE ROLE GRANTS
--
-- WHY THIS EXISTS: until now, NO migration granted anything. On a hosted
-- Supabase project that never showed, because the platform ships
-- `alter default privileges` for the postgres role out of the box, so every
-- table a migration created silently picked up the right privileges.
--
-- Replay those same migrations into a database WITHOUT that setup and you get a
-- schema that is complete and entirely unusable: `permission denied for table
-- finance_openings` the first time PostgREST touches it. That failure has been
-- hit for real once already, on the dev project, and was patched by hand by
-- diffing production's grants — which means the repo still could not build a
-- working database from scratch. Self-hosting is the second time, so it goes in
-- a migration.
--
-- WHY ONLY service_role: this is not a simplification, it is what production
-- actually has. `information_schema.role_table_grants` on production lists
-- exactly two grantees for the public schema — `postgres` and `service_role` —
-- across all 45 relations. `anon` and `authenticated` hold ZERO privileges, by
-- design: every server path uses the service-role client (bypassing RLS), and
-- customer pages are served through scoped service-role queries rather than
-- anon reads. Granting anon anything here would widen the blast radius of a
-- leaked anon key for no benefit.
--
-- Idempotent, and a deliberate no-op against the existing hosted projects — the
-- grants it writes are the grants they already have, so it can be applied or
-- baselined there without changing a single privilege.
-- =============================================================

grant usage on schema public to service_role;

-- Existing objects. `all tables` includes views, which is why this reaches 45
-- relations and not 44 — `order_item_consumption` is a view and PostgREST reads
-- it like any other relation.
grant select, insert, update, delete on all tables in schema public to service_role;

-- Future objects. Without this, the NEXT migration to add a table reintroduces
-- exactly the bug this file exists to kill.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
