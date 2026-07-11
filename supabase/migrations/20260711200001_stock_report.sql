-- =============================================================
-- STOCK & FINANCE — PHASE 2: STOCK REPORT
--
-- One function answers the whole Stock screen for any window:
--
--   Final Stock = Yesterday's Stock + Purchased - Used (+/- Adjustments)
--
-- "Yesterday's Stock" is simply this same sum evaluated at the window's start,
-- which is why the daily rollover needs no scheduled job and can never fall out
-- of step: today's opening IS yesterday's closing, by construction.
--
-- Usage is read LIVE from the POS (`session_order_items` → `menu_item_products`),
-- so a sale deducts stock the moment it is ordered, with no second stock row and
-- no manual deduction. Menu items with no link consume nothing — by design.
--
-- NOTE: Phase 3 replaces this function to add the `purchased` terms from
-- `purchase_items`. Until then purchases are structurally zero (the table does
-- not exist yet), which is why they are written as explicit 0 constants here.
-- =============================================================

create or replace function stock_report(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  product_id uuid,
  opening    numeric,
  purchased  numeric,
  used       numeric,
  adjusted   numeric,
  closing    numeric
)
language sql
stable
as $$
  with
  -- Everything the POS consumed, resolved through the 1:1 menu-item link.
  -- session_order_items carries no restaurant_id, so scope via session_orders.
  --
  -- `soi.created_at >= mip.created_at` is load-bearing: a menu item almost always
  -- has sales history predating the link. Without this, linking an existing item
  -- to a product would retroactively deduct EVERY past sale of it and drive stock
  -- wildly negative on day one. Tracking starts when the link is made; anything
  -- sold before that was never counted against this product.
  usage as (
    select
      mip.product_id,
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.created_at < p_from)                                as before,
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.created_at >= p_from and soi.created_at < p_to)     as within
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= mip.created_at
    group by mip.product_id
  ),
  adj as (
    select
      a.product_id,
      sum(a.qty) filter (where a.created_at < p_from)                          as before,
      sum(a.qty) filter (where a.created_at >= p_from and a.created_at < p_to) as within
    from stock_adjustments a
    where a.restaurant_id = p_restaurant_id
    group by a.product_id
  )
  -- Purchases are structurally zero until Phase 3 creates `purchase_items`; the
  -- 0 constants below are the seams it plugs into.
  select
    p.id,
    -- Opening = stock on hand the instant the window began. The product's seeded
    -- opening_stock always counts: a product entered today with 50 on the shelf
    -- genuinely has 50 to open with.
    (p.opening_stock + 0 - coalesce(u.before, 0) + coalesce(a.before, 0))::numeric as opening,
    0::numeric                                                                     as purchased,
    coalesce(u.within, 0)::numeric                                                 as used,
    coalesce(a.within, 0)::numeric                                                 as adjusted,
    (p.opening_stock
       + 0
       - coalesce(u.before, 0) - coalesce(u.within, 0)
       + coalesce(a.before, 0) + coalesce(a.within, 0))::numeric                   as closing
  from products p
  left join usage u on u.product_id = p.id
  left join adj   a on a.product_id = p.id
  where p.restaurant_id = p_restaurant_id;
$$;

revoke all on function stock_report(uuid, timestamptz, timestamptz) from public;
grant execute on function stock_report(uuid, timestamptz, timestamptz) to service_role;

-- ── Create a product ──────────────────────────────────────────────────────────
create or replace function create_product(
  p_restaurant_id uuid,
  p_name          text,
  p_unit          text,
  p_opening_stock numeric,
  p_low_stock     numeric,
  p_created_by    uuid
) returns products
language plpgsql
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_seq  int;
  v_prod products;
begin
  if v_name = '' then raise exception 'NAME_REQUIRED'; end if;
  if v_unit = '' then raise exception 'UNIT_REQUIRED'; end if;
  if coalesce(p_opening_stock, 0) < 0 then raise exception 'INVALID_OPENING_STOCK'; end if;
  if coalesce(p_low_stock, 0) < 0 then raise exception 'INVALID_LOW_STOCK'; end if;

  perform pg_advisory_xact_lock(hashtext('product_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from products where restaurant_id = p_restaurant_id;

  begin
    insert into products (restaurant_id, seq_no, name, unit, opening_stock, low_stock_threshold, created_by)
    values (p_restaurant_id, v_seq, v_name, v_unit,
            coalesce(p_opening_stock, 0), coalesce(p_low_stock, 0), p_created_by)
    returning * into v_prod;
  exception
    when unique_violation then
      raise exception 'PRODUCT_EXISTS';
  end;

  return v_prod;
end;
$$;

revoke all on function create_product(uuid, text, text, numeric, numeric, uuid) from public;
grant execute on function create_product(uuid, text, text, numeric, numeric, uuid) to service_role;
