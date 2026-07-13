-- =============================================================
-- USED TODAY = ACTUAL CONSUMPTION, NOT RESERVATIONS
--
-- THE BUG
-- 20260712200000 made the stock reservation reversible, and it fixed Final Stock:
-- reject an order and the Coke comes back on the shelf. But it parked the released
-- quantity in `added` and left `used` GROSS, so the summary read:
--
--     Yesterday 10 | Used Today 1 | Added 1 | Final 10
--
-- Final Stock was right, "Used Today 1" was a lie — nothing was consumed. `used`
-- was counting RESERVATIONS, and a reservation that gets released was never a use.
--
-- THE FIX
-- A release now cancels out the use it reverses, instead of being reported as a
-- separate addition:
--
--     Used Today = (POS sales − reservations released) + manual deductions
--
-- WHY THE RELEASE IS SPLIT IN TWO
-- Only a release that cancels a use FROM THE SAME DAY can be netted out of that
-- day's `used`. A Coke ordered YESTERDAY and rejected TODAY cannot be:
--
--   * Yesterday is closed. It really did leave the shelf yesterday, yesterday's
--     `used` was 1 and yesterday's closing was 9. Rewriting that after the fact
--     would silently change a day the admin has already read and reconciled.
--   * So the +1 has to land TODAY. If it were netted into today's `used`, today's
--     Used would read −1 — a nonsense figure on a day nothing was consumed.
--
-- It is therefore reported today for what it actually is: stock coming BACK, in
-- `added`. Each day stays internally consistent, and no closed day ever moves.
--
--     `reversed`  same-day releases   → netted out of `used`  (Used Today drops)
--     `added`     prior-day releases  → stock returned today  (Used Today unmoved)
--
-- The audit trail is untouched: `product_history` still shows both legs, the
-- −1 POS Sale and the +1 Order Rejected. The summary shows the truth (nothing
-- consumed); the history shows how it got there.
-- =============================================================

-- Return type changes (a `reversed` column is added), so the function must be
-- dropped rather than replaced. `dashboard_stats` calls it, but its body is a
-- string literal — Postgres does not track that as a dependency, and it selects
-- `s.closing` by name, so an extra column cannot break it.
drop function if exists stock_report(uuid, timestamptz, timestamptz);

create function stock_report(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  product_id  uuid,
  opening     numeric,
  purchased   numeric,
  used_pos    numeric,   -- POS consumption NET of same-day reversals
  used_manual numeric,
  used        numeric,   -- "Used Today" = used_pos + used_manual
  reversed    numeric,   -- same-day reservations released (already out of used_pos)
  added       numeric,   -- manual corrections + prior-day reservations returned today
  closing     numeric
)
language sql
stable
as $$
  with
  -- POS consumption, via every menu item that consumes the product.
  --
  -- `soi.created_at >= mip.created_at` is load-bearing: a menu item usually has
  -- sales history predating its link. Without it, linking an existing item would
  -- retroactively deduct EVERY past sale and drive stock negative on day one.
  --
  -- Cancelled items are NOT excluded here — the reservation genuinely happened,
  -- and it is what the release below cancels out.
  usage as (
    select
      mip.product_id,
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.created_at < p_from)                            as before,
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.created_at >= p_from and soi.created_at < p_to) as within
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= mip.created_at
    group by mip.product_id
  ),
  -- The release: stock coming back because the item was rejected, force closed or
  -- cancelled. Dated by `cancelled_at` — when it came back — not `created_at`.
  --
  -- `reversed` and `returned` are the same event, split by WHICH DAY the use it
  -- reverses belongs to. Same day ⇒ it cancels that use out of `used`. Earlier day
  -- ⇒ that day is settled, so today just gains the stock back.
  release as (
    select
      mip.product_id,
      -- Released before the window opened — folded into `opening`, whenever the
      -- use itself happened, because both legs are behind us.
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.cancelled_at < p_from)                    as before,
      -- Released today, reserved today ⇒ nothing was consumed today.
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.cancelled_at >= p_from and soi.cancelled_at < p_to
                  and soi.created_at   >= p_from)                   as reversed,
      -- Released today, reserved on an earlier (closed) day ⇒ stock returned.
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.cancelled_at >= p_from and soi.cancelled_at < p_to
                  and soi.created_at   <  p_from)                   as returned
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    where so.restaurant_id = p_restaurant_id
      and soi.cancelled_at is not null
      -- Same guard as `usage`: if the sale was never counted as a use (it predates
      -- the product link), releasing it must not conjure stock out of nothing.
      and soi.created_at >= mip.created_at
    group by mip.product_id
  ),
  purch as (
    select
      pi.product_id,
      sum(pi.quantity) filter (where pu.created_at < p_from)                            as before,
      sum(pi.quantity) filter (where pu.created_at >= p_from and pu.created_at < p_to)  as within
    from purchase_items pi
    join purchases pu on pu.id = pi.purchase_id
    where pu.restaurant_id = p_restaurant_id
    group by pi.product_id
  ),
  -- Manual movements, split by direction rather than netted, so a +5 correction
  -- cannot cancel a −5 wastage and report "nothing used today".
  adj as (
    select
      a.product_id,
      sum(a.qty) filter (where a.created_at < p_from)                                    as net_before,
      sum(-a.qty) filter (where a.qty < 0 and a.created_at >= p_from and a.created_at < p_to) as out_within,
      sum(a.qty)  filter (where a.qty > 0 and a.created_at >= p_from and a.created_at < p_to) as in_within
    from stock_adjustments a
    where a.restaurant_id = p_restaurant_id
    group by a.product_id
  )
  select
    p.id,
    -- Opening = stock on hand the instant the window began. Today's opening IS
    -- yesterday's closing, so the rollover needs no nightly job.
    (p.opening_stock
       + coalesce(pu.before, 0)
       - coalesce(u.before, 0)
       + coalesce(rl.before, 0)
       + coalesce(a.net_before, 0))::numeric                        as opening,
    coalesce(pu.within, 0)::numeric                                 as purchased,
    -- NET POS consumption. `reversed` is a subset of `usage.within` — same joins,
    -- same guard, and a row can only be cancelled at or after it was created — so
    -- this can never go negative.
    (coalesce(u.within, 0) - coalesce(rl.reversed, 0))::numeric     as used_pos,
    coalesce(a.out_within, 0)::numeric                              as used_manual,
    (coalesce(u.within, 0) - coalesce(rl.reversed, 0)
       + coalesce(a.out_within, 0))::numeric                        as used,
    coalesce(rl.reversed, 0)::numeric                               as reversed,
    -- Put back: corrections by hand, plus reservations from a CLOSED day released
    -- today. Same-day releases are not here — they cancelled a use instead.
    (coalesce(a.in_within, 0) + coalesce(rl.returned, 0))::numeric  as added,
    -- Unchanged: every leg still lands exactly once, so
    --   closing = opening + purchased − used + added
    -- reconciles whichever bucket a release fell into.
    (p.opening_stock
       + coalesce(pu.before, 0)  + coalesce(pu.within, 0)
       - coalesce(u.before, 0)   - coalesce(u.within, 0)
       + coalesce(rl.before, 0)  + coalesce(rl.reversed, 0) + coalesce(rl.returned, 0)
       + coalesce(a.net_before, 0)
       - coalesce(a.out_within, 0) + coalesce(a.in_within, 0))::numeric as closing
  from products p
  left join usage u   on u.product_id  = p.id
  left join release rl on rl.product_id = p.id
  left join purch pu  on pu.product_id = p.id
  left join adj a     on a.product_id  = p.id
  where p.restaurant_id = p_restaurant_id;
$$;

revoke all on function stock_report(uuid, timestamptz, timestamptz) from public;
grant execute on function stock_report(uuid, timestamptz, timestamptz) to service_role;


-- ── dashboard_stats ───────────────────────────────────────────────────────────
-- Same principle, applied to the money.
--
-- 20260712200000 dropped cancelled items from COGS and tracked revenue with a flat
-- `cancelled_at is null`. For TODAY that is right. For a day already closed it is
-- not: a Coke sold yesterday and rejected today would vanish from YESTERDAY's COGS
-- the moment it was cancelled — so the Finance screen would disagree with the Stock
-- screen, which (correctly) still shows it as used yesterday.
--
-- The test is not "was it ever cancelled" but "was it still live when this window
-- closed". `cancelled_at >= p_to` ⇒ it was consumed as far as that day was
-- concerned, and that day does not get to change afterwards. COGS and tracked
-- revenue use the same rule, so the margin between them stays matched.
create or replace function dashboard_stats(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  inventory_value     numeric,
  product_count       integer,
  low_count           integer,
  out_count           integer,
  sales_total         numeric,
  purchases_total     numeric,
  cogs                numeric,
  tracked_revenue     numeric,
  customer_outstanding numeric,
  vendor_outstanding  numeric
)
language sql
stable
as $$
  with
  sr as (
    select s.closing, p.last_unit_cost, p.low_stock_threshold
    from stock_report(p_restaurant_id, p_from, p_to) s
    join products p on p.id = s.product_id where p.is_active
  ),
  stock as (
    select coalesce(sum(greatest(closing,0) * last_unit_cost),0) value,
           count(*)::int products,
           count(*) filter (where closing > 0 and low_stock_threshold > 0 and closing <= low_stock_threshold)::int low,
           count(*) filter (where closing <= 0)::int out
    from sr
  ),
  cost as (
    select coalesce(sum(soi.quantity * mip.qty_per_unit * p.last_unit_cost),0) cogs
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    join products p on p.id = mip.product_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and soi.created_at >= mip.created_at
      and (soi.cancelled_at is null or soi.cancelled_at >= p_to)
  ),
  revenue as (
    select coalesce(sum(soi.quantity * soi.item_price),0) tracked
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and (soi.cancelled_at is null or soi.cancelled_at >= p_to)
      and exists (select 1 from menu_item_products mip
                   where mip.menu_item_id = soi.menu_item_id and soi.created_at >= mip.created_at)
  ),
  sales as (
    select coalesce(sum(coalesce(total_amount, amount)),0) v from payments
    where restaurant_id = p_restaurant_id and created_at >= p_from and created_at < p_to
  ),
  purch as (
    select coalesce(sum(total_amount),0) v from purchases
    where restaurant_id = p_restaurant_id and created_at >= p_from and created_at < p_to
  ),
  cust as (
    select coalesce(sum(balance),0) v from credit_customers where restaurant_id = p_restaurant_id
  ),
  ven as (
    select coalesce(sum(credit_balance),0) v from vendors where restaurant_id = p_restaurant_id
  )
  select stock.value::numeric, stock.products, stock.low, stock.out,
         sales.v::numeric, purch.v::numeric, cost.cogs::numeric, revenue.tracked::numeric,
         cust.v::numeric, ven.v::numeric
  from stock, cost, revenue, sales, purch, cust, ven;
$$;

revoke all on function dashboard_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function dashboard_stats(uuid, timestamptz, timestamptz) to service_role;
