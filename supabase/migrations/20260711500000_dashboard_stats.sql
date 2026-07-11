-- =============================================================
-- STOCK & FINANCE — PHASE 5: DASHBOARD ANALYTICS
--
-- Every headline figure in one round trip. Like the rest of the module it
-- derives, never stores: stock levels come from `stock_report`, money from the
-- existing bills / purchases / credit ledgers.
--
-- COST OF GOODS SOLD — read this before trusting "estimated profit":
-- Cost is only known for menu items LINKED to a product (the 1:1 model). A
-- cooked dish has no stock link, so it contributes revenue with NO cost. The
-- function therefore returns `tracked_revenue` alongside `cogs` so the UI can
-- say exactly how much of the day's sales the cost figure actually covers —
-- without that, "profit" would silently read as pure revenue.
-- =============================================================

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
      -- Value what is actually on the shelf, at what it last cost to buy.
      -- Oversold (negative) stock is worth nothing, not a negative asset.
      coalesce(sum(greatest(closing, 0) * last_unit_cost), 0) as value,
      count(*)::int                                           as products,
      -- Mirrors `stockStatus` in lib/stock.ts: a threshold of 0 means "don't warn".
      count(*) filter (
        where closing > 0 and low_stock_threshold > 0 and closing <= low_stock_threshold
      )::int                                                  as low,
      count(*) filter (where closing <= 0)::int               as out
    from sr
  ),
  -- Cost and revenue of the STOCKED items sold in the window. The
  -- `soi.created_at >= mip.created_at` guard is the same one `stock_report`
  -- relies on: sales predating a link were never tracked against that product.
  sold as (
    select
      coalesce(sum(soi.quantity * mip.qty_per_unit * p.last_unit_cost), 0) as cogs,
      coalesce(sum(soi.quantity * soi.item_price), 0)                      as tracked_revenue
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    join products p             on p.id = mip.product_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from
      and soi.created_at <  p_to
      and soi.created_at >= mip.created_at
  ),
  sales as (
    -- Accrual, matching the Sales dashboard: the full value billed.
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
    sold.cogs::numeric,
    sold.tracked_revenue::numeric,
    cust.v::numeric,
    sell.v::numeric
  from stock, sold, sales, purch, cust, sell;
$$;

revoke all on function dashboard_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function dashboard_stats(uuid, timestamptz, timestamptz) to service_role;
