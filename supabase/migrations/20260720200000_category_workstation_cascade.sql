-- =============================================================
-- A MENU ITEM'S WORKSTATION FOLLOWS ITS CATEGORY
--
-- THE BUG: `menu_items.workstation_id` is a denormalised copy, taken from the
-- category once when the item is created (`app/actions/menu.ts` createMenuItem)
-- and then NEVER updated again. `updateCategory` writes only the category row.
-- So moving a category from Bar to Kitchen left every item in it still routed to
-- the Bar — silently, with the admin screen showing the new workstation because
-- it reads the CATEGORY, while tickets, queues and OT printing read the ITEM.
--
-- It looked like a variants-only bug because variants made it survivable: live
-- data had 6 of 48 variant-bearing items drifted vs 1 of 219 plain ones. That is
-- a coincidence of which items happened to be created before the change, not a
-- variant code path. `menu_item_variants` has NO workstation column at all —
-- `lib/order-items.ts` routes variant and non-variant lines through the very
-- same `menu_items.workstation_id`.
--
-- THE FIX, in the DATABASE rather than the action, for two reasons:
--   1. The category and its items can then never be left disagreeing, whatever
--      path does the write — an admin action, a future bulk import, or a manual
--      SQL fix.
--   2. The currently-deployed production build gets the fix immediately, with no
--      redeploy, because it already updates `menu_categories` and the cascade now
--      rides along.
--
-- CONSEQUENCE, DELIBERATE: `menu_items.workstation_id` becomes strictly derived.
-- The initial schema commented it as "resolved workstation (NOT NULL, may
-- override category)", i.e. a per-item override was once intended — but no UI has
-- ever exposed one (workstation appears only on the category create/edit forms),
-- so no setting anyone could have made is being destroyed. If per-item overrides
-- are ever genuinely wanted, BOTH triggers below have to be revisited; a nullable
-- `workstation_override_id` consulted first would be the shape to reach for.
-- =============================================================


-- ── 1. Changing a category's workstation moves every item in it ───────────────
create or replace function cascade_category_workstation()
returns trigger
language plpgsql
as $$
begin
  update menu_items
     set workstation_id = new.workstation_id
   where category_id = new.id
     and workstation_id is distinct from new.workstation_id;
  return null; -- after-trigger: return value is ignored
end;
$$;

drop trigger if exists rs_cascade_category_workstation on menu_categories;

-- Row-level and narrowly scoped: `update of workstation_id` plus the WHEN clause
-- means renaming a category, or saving the form without changing the station,
-- touches no menu_items at all.
create trigger rs_cascade_category_workstation
after update of workstation_id on menu_categories
for each row
when (old.workstation_id is distinct from new.workstation_id)
execute function cascade_category_workstation();


-- ── 2. An item always takes its category's workstation ────────────────────────
-- Covers the other direction: creation, and any future "move this item to another
-- category" feature (not possible in the UI today — `category_id` is only ever
-- set at insert). Without this, that feature would silently reintroduce exactly
-- the bug above, and it would again look like it was about something else.
create or replace function set_item_workstation_from_category()
returns trigger
language plpgsql
as $$
begin
  select c.workstation_id into new.workstation_id
    from menu_categories c
   where c.id = new.category_id;
  return new;
end;
$$;

drop trigger if exists rs_item_workstation_from_category on menu_items;

create trigger rs_item_workstation_from_category
before insert or update of category_id on menu_items
for each row
execute function set_item_workstation_from_category();


-- ── 3. Repair the rows that already drifted ───────────────────────────────────
-- Without this the existing mis-routed items keep going to the wrong station
-- until somebody happens to re-save their category. Deliberately NOT limited to
-- non-deleted rows: a deleted item can be restored, and it should come back
-- routed correctly.
update menu_items mi
   set workstation_id = c.workstation_id
  from menu_categories c
 where c.id = mi.category_id
   and mi.workstation_id is distinct from c.workstation_id;


-- Historical `session_order_items` keep the workstation they were SNAPSHOT with,
-- and that is correct: a ticket already sent to the Bar must not retroactively
-- move to the Kitchen. Only future orders route by the new assignment.
