-- =============================================================
-- ORDER ITEM CANCELLATION — make the stock reservation reversible
--
-- THE BUG
-- Stock in this system is DERIVED, never stored: an item's consumption is
-- computed live from `session_order_items × menu_item_products`. That gives us
-- the immediate reservation we want (the Coke leaves the shelf the instant it is
-- ordered) but it also makes the deduction PERMANENT — the row exists forever,
-- so it deducts forever. If staff reject the table activation, force close the
-- session, or cancel the item, the Coke never comes back.
--
-- THE FIX
-- Cancellation becomes a first-class, DATED event on the item itself:
--   created_at    → the reservation      (−qty)
--   cancelled_at  → the release          (+qty)
--
-- Both the stock level and the product history derive from those two timestamps
-- on the SAME row. That matters:
--
--   * It cannot double-restore. A compensating `stock_adjustments` row could be
--     written twice (reject, then force close the same session); a row can only
--     be cancelled once — `where cancelled_at is null` makes every cancel path
--     idempotent by construction.
--   * The level and the history can never disagree, because neither is stored;
--     they read the same two columns.
--
-- Dating the release (rather than just excluding cancelled items from usage) is
-- what keeps the day rollover exact. An order placed yesterday and cancelled
-- today must be `used` yesterday and `added` back today — otherwise yesterday's
-- closing balance would silently change after the fact.
-- =============================================================

alter table session_order_items
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by  uuid;

alter table session_order_items
  drop constraint if exists session_order_items_cancel_reason_check;
alter table session_order_items
  add  constraint session_order_items_cancel_reason_check
  check (
    cancel_reason is null
    or cancel_reason in ('order_rejected', 'session_closed', 'order_cancelled', 'item_cancelled')
  );

-- A half-cancelled row (a timestamp with no reason, or the reverse) would make
-- the history unexplainable. Keep the two in lockstep at the DB level.
alter table session_order_items
  drop constraint if exists session_order_items_cancel_consistency;
alter table session_order_items
  add  constraint session_order_items_cancel_consistency
  check ((cancelled_at is null) = (cancel_reason is null));

create index if not exists session_order_items_cancelled_at_idx
  on session_order_items (cancelled_at)
  where cancelled_at is not null;


-- ── stock_report ──────────────────────────────────────────────────────────────
-- Adds the `restore` leg. `used` stays GROSS on purpose: the stock really did
-- leave the shelf and come back, and the existing design deliberately splits
-- movements by direction rather than netting them (see 20260711800000). The
-- released quantity lands in `added` — the bucket that already means "put back" —
-- so `closing` reconciles as before: opening + purchased − used + added.
create or replace function stock_report(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  product_id  uuid,
  opening     numeric,
  purchased   numeric,
  used_pos    numeric,
  used_manual numeric,
  used        numeric,
  added       numeric,
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
  -- Cancelled items are NOT excluded here — the reservation genuinely happened.
  -- It is released below, at the moment it was cancelled.
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
  -- The release: stock coming BACK because the item was rejected, force closed
  -- or cancelled. Dated by `cancelled_at`, not `created_at`, so a yesterday order
  -- cancelled today does not rewrite yesterday's closing balance.
  restore as (
    select
      mip.product_id,
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.cancelled_at < p_from)                              as before,
      sum(soi.quantity * mip.qty_per_unit)
        filter (where soi.cancelled_at >= p_from and soi.cancelled_at < p_to) as within
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    where so.restaurant_id = p_restaurant_id
      and soi.cancelled_at is not null
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
  -- Manual movements, split by direction rather than netted.
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
       + coalesce(r.before, 0)
       + coalesce(a.net_before, 0))::numeric                        as opening,
    coalesce(pu.within, 0)::numeric                                 as purchased,
    coalesce(u.within, 0)::numeric                                  as used_pos,
    coalesce(a.out_within, 0)::numeric                              as used_manual,
    (coalesce(u.within, 0) + coalesce(a.out_within, 0))::numeric    as used,
    -- Put back: corrections by hand, plus every reservation released today.
    (coalesce(a.in_within, 0) + coalesce(r.within, 0))::numeric     as added,
    (p.opening_stock
       + coalesce(pu.before, 0)  + coalesce(pu.within, 0)
       - coalesce(u.before, 0)   - coalesce(u.within, 0)
       + coalesce(r.before, 0)   + coalesce(r.within, 0)
       + coalesce(a.net_before, 0)
       - coalesce(a.out_within, 0) + coalesce(a.in_within, 0))::numeric as closing
  from products p
  left join usage u   on u.product_id  = p.id
  left join restore r on r.product_id  = p.id
  left join purch pu  on pu.product_id = p.id
  left join adj a     on a.product_id  = p.id
  where p.restaurant_id = p_restaurant_id;
$$;

revoke all on function stock_report(uuid, timestamptz, timestamptz) from public;
grant execute on function stock_report(uuid, timestamptz, timestamptz) to service_role;


-- ── product_history ───────────────────────────────────────────────────────────
-- The audit trail the release exists for. A rejected Coke now reads:
--     POS Sale        −1   (when it was ordered)
--     Order Rejected  +1   (when staff rejected it)
create or replace function product_history(
  p_restaurant_id uuid,
  p_product_id    uuid
)
returns table (
  at          timestamptz,
  kind        text,      -- opening | purchase | sale | restore | manual
  qty         numeric,   -- signed: + adds stock, − removes it
  reason      text,      -- manual reason, or the cancellation reason on a restore
  ref         text,      -- purchase code, or the menu item
  vendor_name text,
  vendor_code text,
  amount      numeric,
  method      text,
  staff_id    uuid,
  balance     numeric    -- stock on hand AFTER this movement
)
language sql
stable
as $$
  with moves as (
    select
      p.created_at    as at,
      'opening'::text as kind,
      p.opening_stock as qty,
      null::text      as reason,
      null::text      as ref,
      null::text      as vendor_name,
      null::text      as vendor_code,
      null::numeric   as amount,
      null::text      as method,
      p.created_by    as staff_id,
      0               as tiebreak
    from products p
    where p.id = p_product_id and p.restaurant_id = p_restaurant_id

    union all

    select
      pu.created_at,
      'purchase',
      pi.quantity,
      null,
      pu.purchase_code,
      v.name,
      v.vendor_code,
      pi.line_total,
      pu.payment_method::text,
      pu.created_by,
      1
    from purchase_items pi
    join purchases pu on pu.id = pi.purchase_id
    join vendors v    on v.id = pu.vendor_id
    where pi.product_id = p_product_id
      and pu.restaurant_id = p_restaurant_id

    union all

    -- The reservation, at the moment the customer ordered.
    select
      soi.created_at,
      'sale',
      -(soi.quantity * mip.qty_per_unit),
      null,
      soi.item_name,
      null, null, null, null,
      so.created_by,
      2
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    where mip.product_id = p_product_id
      and so.restaurant_id = p_restaurant_id
      and soi.created_at >= mip.created_at

    union all

    -- The release, at the moment it was cancelled. `reason` says why, and the
    -- tiebreak keeps it after its own sale if both land on the same instant.
    select
      soi.cancelled_at,
      'restore',
      (soi.quantity * mip.qty_per_unit),
      soi.cancel_reason,
      soi.item_name,
      null, null, null, null,
      soi.cancelled_by,
      4
    from session_order_items soi
    join session_orders so      on so.id = soi.order_id
    join menu_item_products mip on mip.menu_item_id = soi.menu_item_id
    where mip.product_id = p_product_id
      and so.restaurant_id = p_restaurant_id
      and soi.cancelled_at is not null
      and soi.created_at >= mip.created_at

    union all

    select
      a.created_at,
      'manual',
      a.qty,
      a.kind,
      null,
      null, null, null, null,
      a.created_by,
      3
    from stock_adjustments a
    where a.product_id = p_product_id
      and a.restaurant_id = p_restaurant_id
  )
  select
    m.at, m.kind, m.qty, m.reason, m.ref,
    m.vendor_name, m.vendor_code, m.amount, m.method, m.staff_id,
    sum(m.qty) over (order by m.at, m.tiebreak, m.kind
                     rows between unbounded preceding and current row)::numeric
  from moves m
  order by m.at, m.tiebreak, m.kind;
$$;

revoke all on function product_history(uuid, uuid) from public;
grant execute on function product_history(uuid, uuid) to service_role;


-- ── dashboard_stats ───────────────────────────────────────────────────────────
-- A cancelled item is neither a cost nor a revenue — it was never consumed and
-- never billed. Only COGS and tracked revenue change; `sales` already comes from
-- `payments`, which a cancelled item never reaches.
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
      and soi.cancelled_at is null
  ),
  revenue as (
    select coalesce(sum(soi.quantity * soi.item_price),0) tracked
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and soi.cancelled_at is null
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


-- ── The cancel paths ──────────────────────────────────────────────────────────
-- Each is ONE transaction: the items are released and the session/order is
-- closed together, or neither happens. Permission checks stay in the server
-- actions; these functions are scoped by restaurant_id and do the data work.
--
-- `where cancelled_at is null` makes every one of them idempotent — a double-tap,
-- or a force close after a reject, cannot release the same item twice.
-- `item_status <> 'served'` protects what was genuinely consumed.

-- Scenario 2 — staff reject the table activation.
-- The session close is a compare-and-swap on `pending_activation`: if someone
-- activated the table first, we must NOT cancel their order, so nothing is
-- released and only the notification is resolved.
create or replace function reject_table_activation(
  p_restaurant_id   uuid,
  p_session_id      uuid,
  p_notification_id uuid,
  p_by              uuid
)
returns integer
language plpgsql
as $$
declare
  v_closed  uuid;
  v_count   integer := 0;
begin
  if p_session_id is not null then
    update sessions
       set status = 'closed', closed_at = now()
     where id = p_session_id
       and restaurant_id = p_restaurant_id
       and status = 'pending_activation'
    returning id into v_closed;

    -- Only release the reservation if this call is the one that closed it.
    if v_closed is not null then
      update session_order_items soi
         set cancelled_at  = now(),
             cancel_reason = 'order_rejected',
             cancelled_by  = p_by
        from session_orders so
       where so.id = soi.order_id
         and so.session_id = p_session_id
         and so.restaurant_id = p_restaurant_id
         and soi.cancelled_at is null;
      get diagnostics v_count = row_count;

      update session_orders
         set status = 'cancelled'
       where session_id = p_session_id
         and restaurant_id = p_restaurant_id
         and status <> 'cancelled';
    end if;
  end if;

  update notifications
     set status = 'resolved', acknowledged_at = now()
   where id = p_notification_id
     and restaurant_id = p_restaurant_id;

  return v_count;
end;
$$;

revoke all on function reject_table_activation(uuid, uuid, uuid, uuid) from public;
grant execute on function reject_table_activation(uuid, uuid, uuid, uuid) to service_role;


-- Scenario 3 — the session is force closed before the order is completed.
-- Served items stay deducted: they were genuinely consumed. Everything still
-- pending or ready never reached the customer, so it goes back on the shelf.
create or replace function force_close_session(
  p_restaurant_id uuid,
  p_session_id    uuid,
  p_by            uuid
)
returns integer
language plpgsql
as $$
declare
  v_table uuid;
  v_room  uuid;
  v_count integer := 0;
begin
  select table_id, room_id into v_table, v_room
    from sessions
   where id = p_session_id and restaurant_id = p_restaurant_id;

  update session_order_items soi
     set cancelled_at  = now(),
         cancel_reason = 'session_closed',
         cancelled_by  = p_by
    from session_orders so
   where so.id = soi.order_id
     and so.session_id = p_session_id
     and so.restaurant_id = p_restaurant_id
     and soi.cancelled_at is null
     and soi.item_status <> 'served';
  get diagnostics v_count = row_count;

  -- An order with nothing left on it is a cancelled order.
  update session_orders so
     set status = 'cancelled'
   where so.session_id = p_session_id
     and so.restaurant_id = p_restaurant_id
     and so.status <> 'cancelled'
     and not exists (
       select 1 from session_order_items soi
        where soi.order_id = so.id and soi.cancelled_at is null
     );

  update notifications
     set status = 'completed'
   where restaurant_id = p_restaurant_id
     and status in ('new', 'acknowledged')
     and (
       (v_table is not null and table_id = v_table) or
       (v_table is null and v_room is not null and room_id = v_room)
     );

  update sessions
     set status = 'closed', closed_at = now()
   where id = p_session_id and restaurant_id = p_restaurant_id;

  return v_count;
end;
$$;

revoke all on function force_close_session(uuid, uuid, uuid) from public;
grant execute on function force_close_session(uuid, uuid, uuid) to service_role;


-- Scenario 4 — a whole order, or a single item, is cancelled before it is served.
create or replace function cancel_order(
  p_restaurant_id uuid,
  p_order_id      uuid,
  p_by            uuid
)
returns integer
language plpgsql
as $$
declare v_count integer := 0;
begin
  update session_order_items soi
     set cancelled_at  = now(),
         cancel_reason = 'order_cancelled',
         cancelled_by  = p_by
    from session_orders so
   where so.id = soi.order_id
     and so.id = p_order_id
     and so.restaurant_id = p_restaurant_id
     and soi.cancelled_at is null
     and soi.item_status <> 'served';
  get diagnostics v_count = row_count;

  update session_orders so
     set status = 'cancelled'
   where so.id = p_order_id
     and so.restaurant_id = p_restaurant_id
     and not exists (
       select 1 from session_order_items soi
        where soi.order_id = so.id and soi.cancelled_at is null
     );

  return v_count;
end;
$$;

revoke all on function cancel_order(uuid, uuid, uuid) from public;
grant execute on function cancel_order(uuid, uuid, uuid) to service_role;


create or replace function cancel_order_item(
  p_restaurant_id uuid,
  p_item_id       uuid,
  p_by            uuid
)
returns integer
language plpgsql
as $$
declare
  v_order uuid;
  v_count integer := 0;
begin
  update session_order_items soi
     set cancelled_at  = now(),
         cancel_reason = 'item_cancelled',
         cancelled_by  = p_by
    from session_orders so
   where so.id = soi.order_id
     and soi.id = p_item_id
     and so.restaurant_id = p_restaurant_id
     and soi.cancelled_at is null
     and soi.item_status <> 'served'
  returning so.id into v_order;
  get diagnostics v_count = row_count;

  -- Cancelling the last live item cancels the order it belonged to.
  if v_order is not null then
    update session_orders so
       set status = 'cancelled'
     where so.id = v_order
       and not exists (
         select 1 from session_order_items soi
          where soi.order_id = so.id and soi.cancelled_at is null
       );
  end if;

  return v_count;
end;
$$;

revoke all on function cancel_order_item(uuid, uuid, uuid) from public;
grant execute on function cancel_order_item(uuid, uuid, uuid) to service_role;
