-- =============================================================
-- Menu ITEMS get the ordering treatment categories already had.
--
-- THE BUG: `createMenuItem` never set `sort_order`, so every item entered through
-- the admin UI kept the column default 0. Both read paths order by
-- `sort_order, name` — with every value 0 the name tiebreak wins, so a menu
-- silently displayed ALPHABETICALLY on the customer site and the POS, no matter
-- what order the owner typed it in.
--
-- This is the same fault `20260712400000_category_order.sql` fixed for
-- categories, and that `createVariant` already guards against for variants
-- ("Small, Medium, Large — not Large, Medium, Small"). Items were the one level
-- of the menu nobody had done.
--
-- 1. Backfill `sort_order` for items that were never ordered.
-- 2. `swap_menu_item_order` so the admin can actually rearrange them — until now
--    there was no UI to reorder items at all, which is why this rotted unnoticed:
--    a wrong order could not be corrected, only lived with.
--
-- BACKFILL ORDER IS BY NAME, DELIBERATELY, and differs from the category
-- migration (which used created_at). Chosen by the owner: numbering by the order
-- currently DISPLAYED means no live customer menu visibly changes the moment this
-- runs. The mechanism starts working — new items append to the end instead of
-- jumping into the middle — and any menu that wants a different order can now be
-- rearranged with the new arrows.
-- =============================================================

-- Only categories where NOTHING has been ordered yet. If any item in a category
-- carries a position, that category has been arranged (by an admin, or by the
-- bulk importer) and is the source of truth — this must not stomp it.
with untouched as (
  select category_id
    from menu_items
   group by category_id
  having max(sort_order) = 0
),
ranked as (
  select
    mi.id,
    row_number() over (partition by mi.category_id order by mi.name, mi.id) as rn
  from menu_items mi
  join untouched u on u.category_id = mi.category_id
  where mi.is_deleted = false
)
update menu_items mi
   set sort_order = ranked.rn
  from ranked
 where ranked.id = mi.id
   and mi.sort_order = 0;


-- Swap two adjacent items in ONE transaction, so a reorder can never leave the
-- menu with a duplicated or missing position if it fails halfway.
--
-- Scoped by restaurant_id (not category_id) to match swap_category_order's shape
-- and because that is the tenancy boundary that matters; the caller only ever
-- offers neighbours from within one category.
create or replace function swap_menu_item_order(
  p_restaurant_id uuid,
  p_a             uuid,
  p_b             uuid
)
returns boolean
language plpgsql
as $$
declare
  v_a integer;
  v_b integer;
begin
  -- `for update` serialises concurrent reorders so two admins dragging the same
  -- pair cannot interleave into a corrupt order.
  select sort_order into v_a
    from menu_items
   where id = p_a and restaurant_id = p_restaurant_id
     for update;

  select sort_order into v_b
    from menu_items
   where id = p_b and restaurant_id = p_restaurant_id
     for update;

  if v_a is null or v_b is null then
    return false;  -- not ours, or gone
  end if;

  update menu_items set sort_order = v_b where id = p_a and restaurant_id = p_restaurant_id;
  update menu_items set sort_order = v_a where id = p_b and restaurant_id = p_restaurant_id;

  return true;
end;
$$;

revoke all on function swap_menu_item_order(uuid, uuid, uuid) from public;
grant execute on function swap_menu_item_order(uuid, uuid, uuid) to service_role;
