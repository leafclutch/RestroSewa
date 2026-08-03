-- =============================================================
-- MATCH PRODUCTION'S ACCESS POSTURE: no anon, no authenticated, RLS everywhere
--
-- Found on 2026-08-01 while migrating to the self-hosted stack, by diffing the
-- new database against production. Two gaps, and they compound each other.
--
-- 1. SELF-HOSTED SUPABASE GRANTS anon AND authenticated FULL CRUD ON EVERY TABLE.
--    Hosted Supabase does not — production's `role_table_grants` for the public
--    schema lists exactly two grantees, `postgres` and `service_role`, and anon
--    holds nothing. The self-hosted image ships `alter default privileges`
--    granting `arwdDxt` to anon, authenticated AND service_role, from TWO
--    grantor roles (postgres and supabase_admin), so every table a migration
--    created picked all of it up silently.
--
--    That matters because THE ANON KEY IS PUBLIC. It ships inside the client
--    bundle; anyone who loads a menu page has it.
--
-- 2. Three tables were never RLS-enabled — restaurant_user_room_types,
--    restaurant_user_rooms and restaurant_user_table_groups. Their migrations
--    simply never said so, and production had it switched on by hand, so the
--    repo could not reproduce it. (Same class of drift as
--    20260721000000_align_schema_with_production.sql.)
--
-- Either alone is survivable. Together they mean a public key could read and
-- rewrite staff-to-table assignment on a fresh install: RLS was the only thing
-- standing between anon and those tables, and on exactly those three it was off.
--
-- Nothing in the app needs either role: every server path uses the service-role
-- client, and there is NO client-side table access anywhere (verified — the only
-- `.from(` matches in client components are `Array.from`). Revoking is therefore
-- parity with production, not a behaviour change.
--
-- A no-op against both hosted projects: they already have RLS on all 44 tables
-- and no anon/authenticated grants to revoke.
-- =============================================================

-- ── 1. RLS on the three stragglers ────────────────────────────────────────────
-- Transparent to the app, which talks as service_role and bypasses RLS. Like
-- every other table here: RLS on, no policies, reachable only via service role.
alter table restaurant_user_room_types   enable row level security;
alter table restaurant_user_rooms        enable row level security;
alter table restaurant_user_table_groups enable row level security;

-- ── 2. Take back what the self-hosted image handed out ────────────────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ── 3. Stop it coming back on the NEXT table anyone creates ───────────────────
-- Default privileges are recorded PER GRANTOR ROLE, and the image sets them for
-- both `postgres` and `supabase_admin`. A bare `alter default privileges` only
-- touches the current role's, which would leave the other one intact and the
-- hole reopening on the next migration.
--
-- Driven off pg_default_acl rather than a hardcoded list, and guarded by
-- pg_has_role, because altering another role's default privileges requires
-- membership in it: on hosted Supabase the migration runs as `postgres`, which is
-- NOT a member of `supabase_admin`, and an unguarded statement would fail there.
do $$
declare
  r record;
begin
  for r in
    select distinct pg_get_userbyid(d.defaclrole) as grantor
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
     where n.nspname = 'public'
  loop
    if pg_has_role(current_user, r.grantor, 'USAGE') then
      execute format(
        'alter default privileges for role %I in schema public '
        || 'revoke all on tables from anon, authenticated', r.grantor);
      execute format(
        'alter default privileges for role %I in schema public '
        || 'revoke all on sequences from anon, authenticated', r.grantor);
    end if;
  end loop;
end $$;
