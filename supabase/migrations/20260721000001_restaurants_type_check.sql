-- =============================================================
-- restaurants_type_check — split out of 20260721000000
--
-- WHY IT IS ITS OWN FILE: the previous migration adds 'restaurant_hotel' to the
-- `restaurant_type` enum, and PostgreSQL will not let a new enum value be USED in
-- the same transaction that added it:
--
--   ERROR: 55P04: unsafe use of new value "restaurant_hotel" of enum type
--   HINT:  New enum values must be committed before they can be used.
--
-- Every migration here is applied as a single transaction (deliberately — the
-- ledger row rides with it so "applied" and "recorded" cannot disagree), so the
-- ADD VALUE and the constraint that references it have to be separate files.
-- Splitting is the fix that keeps both migrations atomic; the alternative,
-- running one of them outside a transaction, trades a real guarantee for nothing.
--
-- This surfaced on 2026-08-01, migrating to the self-hosted stack. It had never
-- appeared before because 20260721000000 was BASELINED on both existing projects
-- — recorded as applied without ever being executed, since they had already been
-- changed by hand. A fresh database was the first thing to actually run it.
--
-- A no-op wherever the constraint already exists, which is both current projects.
--
-- The constraint has teeth: `restaurant_type` has seven values but production
-- only PERMITS three, so without it a database would happily create a 'cafe' that
-- production rejects — a difference that would surface only on deploy.
-- =============================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_type_check') then
    alter table restaurants add constraint restaurants_type_check
      check (type = any (array['restaurant'::restaurant_type,
                               'hotel'::restaurant_type,
                               'restaurant_hotel'::restaurant_type]));
  end if;
end $$;
