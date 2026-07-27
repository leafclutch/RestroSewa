-- ── Delete a product (only when it has no history) ────────────────────────────
-- Products have always been *deactivated*, never deleted: purchase lines, recipe
-- links and stock adjustments all point at them, and stock levels are DERIVED
-- from those, so deleting a referenced product would corrupt both the purchase
-- history and every stock figure. This adds a true delete for the one safe case:
-- a product created by mistake that nothing points at yet.
--
-- Reference checks run INSIDE this transaction with the product row locked
-- `for update`, so a purchase line or recipe link created between an app-level
-- check and this call cannot slip through. Anything with history raises a coded
-- error the action turns into "deactivate instead".
create or replace function delete_product(
  p_restaurant_id uuid,
  p_product_id    uuid
) returns void
language plpgsql
as $$
declare
  v_exists boolean;
begin
  select true into v_exists
    from products
   where id = p_product_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  -- Recipe links: a product wired into a menu item deducts on every sale.
  if exists (select 1 from menu_item_products where product_id = p_product_id) then
    raise exception 'PRODUCT_HAS_LINKS';
  end if;

  -- Purchase history: the product appears on a supplier bill.
  if exists (select 1 from purchase_items where product_id = p_product_id) then
    raise exception 'PRODUCT_HAS_HISTORY';
  end if;

  -- Manual stock movements (wastage, corrections, kitchen usage).
  if exists (select 1 from stock_adjustments where product_id = p_product_id) then
    raise exception 'PRODUCT_HAS_HISTORY';
  end if;

  delete from products where id = p_product_id and restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function delete_product(uuid, uuid) from public;
grant execute on function delete_product(uuid, uuid) to service_role;
