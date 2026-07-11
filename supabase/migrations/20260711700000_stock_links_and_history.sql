-- =============================================================
-- STOCK — many-to-many menu links, manual deduction reasons, product history
--
-- WHAT WAS ACTUALLY RESTRICTIVE
-- `menu_item_products` was UNIQUE on menu_item_id only. product_id was never
-- unique, so ONE PRODUCT → MANY MENU ITEMS already worked (Chicken could feed
-- Momo, Fried Rice and Burger, each with its own qty_per_unit). What was blocked
-- was the other direction: a menu item could consume only ONE product.
--
-- Dropping that one constraint makes this a true many-to-many junction — which
-- is exactly the recipe/BOM table, reached without a rewrite. A pair is still
-- unique, so the same product can't be attached to the same menu item twice.
-- =============================================================

alter table menu_item_products
  drop constraint if exists menu_item_products_menu_item_id_key;

-- One row per (menu item, product) pair. A menu item may now have several
-- products (a recipe); a product may feed many menu items. Both directions open.
alter table menu_item_products
  add constraint menu_item_products_pair_key unique (menu_item_id, product_id);

create index if not exists menu_item_products_menu_item_idx
  on menu_item_products(menu_item_id);

-- ── Manual deduction reasons ──────────────────────────────────────────────────
-- Stock leaves for reasons other than a sale: the kitchen uses rice and oil,
-- things spoil, staff eat. Widen `kind` to name the reason. 'wastage' is kept so
-- rows written before this migration stay valid.
alter table stock_adjustments
  drop constraint if exists stock_adjustments_kind_check;

alter table stock_adjustments
  add constraint stock_adjustments_kind_check check (kind in (
    'kitchen_usage',
    'waste',
    'damage',
    'staff_consumption',
    'adjustment',
    'other',
    'wastage'  -- legacy, pre-dates the reason list; displayed as "Waste"
  ));

-- ── Product history ───────────────────────────────────────────────────────────
-- Every movement of one product, from the four sources that can move it, with a
-- running balance. Derived like everything else in this module — purchases and
-- POS sales are read where they already live, never copied into a stock ledger.
create or replace function product_history(
  p_restaurant_id uuid,
  p_product_id    uuid
)
returns table (
  at       timestamptz,
  kind     text,      -- opening | purchase | sale | manual
  qty      numeric,   -- signed: + adds stock, − removes it
  reason   text,      -- the manual-deduction reason, when kind = 'manual'
  ref      text,      -- purchase code, or the menu item that sold it
  staff_id uuid,
  balance  numeric    -- stock on hand AFTER this movement
)
language sql
stable
as $$
  with moves as (
    -- Opening count, entered when the product was created.
    select
      p.created_at                as at,
      'opening'::text             as kind,
      p.opening_stock             as qty,
      null::text                  as reason,
      null::text                  as ref,
      p.created_by                as staff_id,
      0                           as tiebreak
    from products p
    where p.id = p_product_id and p.restaurant_id = p_restaurant_id

    union all

    -- Bought in.
    select
      pu.created_at,
      'purchase',
      pi.quantity,
      null,
      pu.purchase_code,
      pu.created_by,
      1
    from purchase_items pi
    join purchases pu on pu.id = pi.purchase_id
    where pi.product_id = p_product_id
      and pu.restaurant_id = p_restaurant_id

    union all

    -- Sold through the POS, via every menu item that consumes this product.
    -- `soi.created_at >= mip.created_at`: sales predating a link were never
    -- tracked against the product, and must not appear retroactively.
    select
      soi.created_at,
      'sale',
      -(soi.quantity * mip.qty_per_unit),
      null,
      soi.item_name,
      so.created_by,
      2
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    where mip.product_id = p_product_id
      and so.restaurant_id = p_restaurant_id
      and soi.created_at >= mip.created_at

    union all

    -- Deducted or corrected by hand.
    select
      a.created_at,
      'manual',
      a.qty,
      a.kind,
      null,
      a.created_by,
      3
    from stock_adjustments a
    where a.product_id = p_product_id
      and a.restaurant_id = p_restaurant_id
  )
  select
    m.at,
    m.kind,
    m.qty,
    m.reason,
    m.ref,
    m.staff_id,
    -- Running balance. The tiebreak keeps rows stamped at the same instant in a
    -- stable order, so the balance column never jitters between reads.
    sum(m.qty) over (order by m.at, m.tiebreak, m.kind
                     rows between unbounded preceding and current row)::numeric
  from moves m
  order by m.at, m.tiebreak, m.kind;
$$;

revoke all on function product_history(uuid, uuid) from public;
grant execute on function product_history(uuid, uuid) to service_role;

-- ── dashboard_stats: fix revenue double-counting ──────────────────────────────
-- With one product per menu item, joining order items to links returned one row
-- each, so summing revenue over that join was safe. Now that a menu item may
-- consume SEVERAL products, the join multiplies its rows — and the old query
-- would count that item's revenue once PER product, inflating tracked_revenue
-- and making "estimated profit" look better than it is.
--
-- COGS still sums over the join (each link legitimately has its own cost), but
-- revenue is now taken from the order items themselves, counted once, using a
-- semi-join (EXISTS) to ask only "is this item stocked at all?".
create or replace function dashboard_stats(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  inventory_value      numeric,
  product_count        int,
  low_count            int,
  out_count            int,
  sales_total          numeric,
  purchases_total      numeric,
  cogs                 numeric,
  tracked_revenue      numeric,
  customer_outstanding numeric,
  seller_outstanding   numeric
)
language sql
stable
as $$
  with
  sr as (
    select s.closing, p.last_unit_cost, p.low_stock_threshold
    from stock_report(p_restaurant_id, p_from, p_to) s
    join products p on p.id = s.product_id
    where p.is_active
  ),
  stock as (
    select
      coalesce(sum(greatest(closing, 0) * last_unit_cost), 0) as value,
      count(*)::int                                           as products,
      count(*) filter (
        where closing > 0 and low_stock_threshold > 0 and closing <= low_stock_threshold
      )::int                                                  as low,
      count(*) filter (where closing <= 0)::int               as out
    from sr
  ),
  -- Cost: one row per link, so a recipe's products each add their own cost.
  cost as (
    select coalesce(sum(soi.quantity * mip.qty_per_unit * p.last_unit_cost), 0) as cogs
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    join products p             on p.id = mip.product_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and soi.created_at >= mip.created_at
  ),
  -- Revenue: one row per ORDER ITEM. EXISTS, not JOIN — otherwise a two-product
  -- recipe would count its revenue twice.
  revenue as (
    select coalesce(sum(soi.quantity * soi.item_price), 0) as tracked
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and exists (
        select 1 from menu_item_products mip
        where mip.menu_item_id = soi.menu_item_id
          and soi.created_at >= mip.created_at
      )
  ),
  sales as (
    select coalesce(sum(coalesce(total_amount, amount)), 0) as v
    from payments
    where restaurant_id = p_restaurant_id
      and created_at >= p_from and created_at < p_to
  ),
  purch as (
    select coalesce(sum(total_amount), 0) as v
    from purchases
    where restaurant_id = p_restaurant_id
      and created_at >= p_from and created_at < p_to
  ),
  cust as (
    select coalesce(sum(bill_amount - paid_amount), 0) as v
    from credits
    where restaurant_id = p_restaurant_id and status <> 'fully_paid'
  ),
  sell as (
    select coalesce(sum(credit_balance), 0) as v
    from sellers
    where restaurant_id = p_restaurant_id
  )
  select
    stock.value::numeric,
    stock.products,
    stock.low,
    stock.out,
    sales.v::numeric,
    purch.v::numeric,
    cost.cogs::numeric,
    revenue.tracked::numeric,
    cust.v::numeric,
    sell.v::numeric
  from stock, cost, revenue, sales, purch, cust, sell;
$$;

revoke all on function dashboard_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function dashboard_stats(uuid, timestamptz, timestamptz) to service_role;
