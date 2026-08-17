-- =============================================================
-- UNIT-WISE CANCELLATION — the stock and margin readers
--
-- The previous migration made a partial cancellation REPRESENTABLE. This one
-- makes it COUNT: four readers currently restore, or keep charging for, the whole
-- line the moment any part of it is cancelled.
--
-- ⚠️ THIS FILE MUST BE NUMERICALLY A NO-OP.
-- `20260821000000` backfilled one event row per existing whole-row cancellation,
-- carrying the same qty and the same timestamp. So summing events must return
-- exactly what reading `cancelled_at` returned. Prove it, don't assume it:
-- snapshot stock_report / product_history / dashboard_stats for every restaurant
-- before and after, and diff. A single differing figure means the backfill or
-- this rewrite is wrong.
--
--
-- WHY A SECOND VIEW RATHER THAN CHANGING `order_item_consumption`
--
-- The obvious move — have the consumption view emit a release leg per event —
-- is wrong, and wrong quietly. That view is read by four places, and only two of
-- them filter on cancellation:
--
--   * stock_report.usage       — no cancellation predicate at all (deliberately:
--                                the reservation genuinely happened). Release rows
--                                would be counted as CONSUMPTION. `used` inflates.
--   * dashboard_stats.cost     — same shape, so COGS double-counts.
--   * product_history 'sale'   — one row per (item × product). N events would
--                                duplicate the sale N times, and `balance` is a
--                                running window sum, so EVERY LATER ROW for that
--                                product becomes wrong.
--
-- Two of those three fail silently and in the money direction. So releases get
-- their own relation and the consumption view is left exactly as it was.
-- =============================================================


-- ── 1. The release view ───────────────────────────────────────────────────────
--
-- It JOINS `order_item_consumption` rather than re-deriving the recipe rule. That
-- view exists precisely because the variant-vs-item resolution is subtle
-- ("six copies of a rule is six chances to drift"), and `qty_per_unit` is already
-- exposed on it — so `ev.qty * c.qty_per_unit` is exact and needs no division.
--
-- ⚠️ It carries BOTH timestamps, and that is the whole point of the file.
-- `stock_report` splits a release three ways — before / reversed / returned —
-- keyed on the cancellation date AND the date of the use it reverses. Collapsing
-- `item_created_at` into the release date is how a cross-day partial cancel
-- silently reclassifies out of `added` into a reduction of `used_pos`, which
-- rewrites a closed day's closing balance after the fact.

drop view if exists order_item_release;
create view order_item_release as
select
  ev.id,
  ev.order_item_id,
  c.restaurant_id,
  c.product_id,
  c.item_name,
  c.created_at    as item_created_at,   -- when the stock was reserved
  ev.cancelled_at as released_at,       -- when THIS slice came back
  ev.reason,
  ev.cancelled_by,
  (ev.qty * c.qty_per_unit)::numeric as qty
from session_order_item_cancellations ev
join order_item_consumption c on c.order_item_id = ev.order_item_id;

-- Same lockdown as order_item_consumption: a plain view runs with the OWNER's
-- rights, so leaving it granted would be a hole straight through RLS.
alter view order_item_release set (security_invoker = on);
revoke all on order_item_release from anon, authenticated;
grant select on order_item_release to service_role;


-- ── 2. stock_report ───────────────────────────────────────────────────────────
--
-- ⚠️ DROP before CREATE, and it is not optional. `create or replace` cannot change
-- a function's return type (42P13), and the installed return type is NOT the same
-- everywhere: production has the 9-column version this file rebuilds, while dev is
-- carrying a hand-installed 8-column variant (no `reversed`) that references
-- `soi.cancelled_quantity` — a column that did not exist until the previous
-- migration, so `stock_report` and `dashboard_stats` currently raise 42703 on dev.
-- Dropping first makes this file land identically on both, whatever was there.

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
  used_pos    numeric,
  used_manual numeric,
  used        numeric,
  reversed    numeric,
  added       numeric,
  closing     numeric
)
language sql
stable
as $fn$
  with
  -- POS consumption. Cancelled items are NOT excluded here — the reservation
  -- genuinely happened, and it is what the release below cancels out. UNCHANGED:
  -- netting this retroactively would rewrite closed days.
  usage as (
    select
      c.product_id,
      sum(c.qty) filter (where c.created_at < p_from)                          as before,
      sum(c.qty) filter (where c.created_at >= p_from and c.created_at < p_to) as within
    from order_item_consumption c
    where c.restaurant_id = p_restaurant_id
    group by c.product_id
  ),
  -- The release: stock coming back because the item was rejected, force closed or
  -- cancelled. Dated by `released_at` — when it came back — not by the order date.
  --
  -- `reversed` and `returned` are the same event, split by WHICH DAY the use it
  -- reverses belongs to. Same day ⇒ it cancels that use out of `used`. Earlier day
  -- ⇒ that day is settled, so today just gains the stock back.
  --
  -- Now reads ONE ROW PER CANCELLATION EVENT instead of one per cancelled line, so
  -- cancelling 1 of 3 today and the other 2 tomorrow lands 1 unit today and 2
  -- tomorrow. The old shape had a single `cancelled_at` and had to pick one day.
  release as (
    select
      r.product_id,
      sum(r.qty) filter (where r.released_at < p_from)                        as before,
      sum(r.qty) filter (where r.released_at >= p_from and r.released_at < p_to
                           and r.item_created_at >= p_from)                   as reversed,
      sum(r.qty) filter (where r.released_at >= p_from and r.released_at < p_to
                           and r.item_created_at <  p_from)                   as returned
    from order_item_release r
    where r.restaurant_id = p_restaurant_id
    group by r.product_id
  ),
  purch as (
    select
      pi.product_id,
      sum(pi.quantity) filter (where pu.created_at < p_from)                           as before,
      sum(pi.quantity) filter (where pu.created_at >= p_from and pu.created_at < p_to) as within
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
      sum(a.qty) filter (where a.created_at < p_from)                                        as net_before,
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
    -- NET POS consumption. `reversed` is still a subset of `usage.within` — but
    -- the proof has changed. It used to hold because a row could only be cancelled
    -- once; now it holds because `session_order_items_unit_counts_check` caps
    -- Σ events at the ordered quantity. That constraint is load-bearing HERE.
    (coalesce(u.within, 0) - coalesce(rl.reversed, 0))::numeric     as used_pos,
    coalesce(a.out_within, 0)::numeric                              as used_manual,
    (coalesce(u.within, 0) - coalesce(rl.reversed, 0)
       + coalesce(a.out_within, 0))::numeric                        as used,
    coalesce(rl.reversed, 0)::numeric                               as reversed,
    -- Put back: corrections by hand, plus reservations from a CLOSED day released
    -- today. Same-day releases are not here — they cancelled a use instead.
    (coalesce(a.in_within, 0) + coalesce(rl.returned, 0))::numeric  as added,
    -- Every leg still lands exactly once, so
    --   closing = opening + purchased − used + added
    -- reconciles whichever bucket a release fell into.
    (p.opening_stock
       + coalesce(pu.before, 0)  + coalesce(pu.within, 0)
       - coalesce(u.before, 0)   - coalesce(u.within, 0)
       + coalesce(rl.before, 0)  + coalesce(rl.reversed, 0) + coalesce(rl.returned, 0)
       + coalesce(a.net_before, 0)
       - coalesce(a.out_within, 0) + coalesce(a.in_within, 0))::numeric as closing
  from products p
  left join usage u    on u.product_id  = p.id
  left join release rl on rl.product_id = p.id
  left join purch pu   on pu.product_id = p.id
  left join adj a      on a.product_id  = p.id
  where p.restaurant_id = p_restaurant_id;
$fn$;

revoke all on function stock_report(uuid, timestamptz, timestamptz) from public;
grant execute on function stock_report(uuid, timestamptz, timestamptz) to service_role;


-- ── 3. product_history — the restore leg ──────────────────────────────────────
--
-- Rebuilt from the authoritative definition in 20260713200000 with ONE hunk
-- changed, rather than retyped: the 'restore' branch reads cancellation EVENTS
-- instead of the parent row's single `cancelled_at`. A 3-then-2 cancellation now
-- reads as TWO restore lines at their own timestamps, which is what an auditor
-- asking "when did this come back" actually wants.
--
-- ⚠️ The 'sale' leg is deliberately untouched and must stay one row per
-- (item × product): `balance` is a running window sum over these rows, so a leg
-- that fanned out would corrupt every later row for that product.

create or replace function product_history(
  p_restaurant_id uuid,
  p_product_id    uuid
)
returns table (
  at          timestamptz,
  kind        text,
  qty         numeric,
  reason      text,
  ref         text,
  vendor_name text,
  vendor_code text,
  amount      numeric,
  method      text,
  staff_id    uuid,
  balance     numeric
)
language sql
stable
as $fn$
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

    -- The reservation, at the moment the customer ordered. `ref` is the sold
    -- line's snapshot name, so a variant reads as "Momo (Chicken)" here — the
    -- history says which variant drew the stock down.
    select
      c.created_at,
      'sale',
      -c.qty,
      null,
      c.item_name,
      null, null, null, null,
      c.created_by,
      2
    from order_item_consumption c
    where c.product_id = p_product_id
      and c.restaurant_id = p_restaurant_id

    union all

    -- The release, at the moment it was cancelled. `reason` says why, and the
    -- tiebreak keeps it after its own sale if both land on the same instant.
    select
      r.released_at,
      'restore',
      r.qty,
      r.reason,
      r.item_name,
      null, null, null, null,
      r.cancelled_by,
      4
    from order_item_release r
    where r.product_id = p_product_id
      and r.restaurant_id = p_restaurant_id

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
$fn$;

revoke all on function product_history(uuid, uuid) from public;
grant execute on function product_history(uuid, uuid) to service_role;


-- ── 4. dashboard_stats — COGS and tracked revenue ─────────────────────────────
--
-- Both gates were "was this line still live when the window closed"
-- (`cancelled_at is null or cancelled_at >= p_to`) — an all-or-nothing test.
-- Generalised to "how many of its units were still live", which reduces to
-- exactly the old behaviour at both extremes (0 cancelled, or all cancelled).
--
-- ⚠️ The two subtract from DIFFERENT relations and must not be swapped:
--   COGS    is in RECIPE units → subtract order_item_release.qty (qty_per_unit applied)
--   revenue is in SOLD units   → subtract session_order_item_cancellations.qty (raw)
-- Mixing them is invisible for any recipe with qty_per_unit = 1 and silently wrong
-- for every other one.
--
-- No greatest(…, 0) guard anywhere: the unit-counts CHECK makes a negative
-- impossible, and masking one would hide the corruption instead of surfacing it.

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
  vendor_outstanding   numeric
)
language sql
stable
as $fn$
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
  -- COGS. A Large Coffee now costs what a Large Coffee actually consumes, so the
  -- margin on it stops being a guess. Net of whatever had been cancelled by the
  -- time the window closed — otherwise cancelling today would shrink yesterday's.
  cost as (
    select coalesce(sum((c.qty - coalesce(rel.qty, 0)) * p.last_unit_cost),0) cogs
    from order_item_consumption c
    join products p on p.id = c.product_id
    left join lateral (
      select sum(r.qty) qty
        from order_item_release r
       where r.order_item_id = c.order_item_id
         and r.product_id    = c.product_id
         and r.released_at   < p_to
    ) rel on true
    where c.restaurant_id = p_restaurant_id
      and c.created_at >= p_from and c.created_at < p_to
  ),
  -- Revenue from lines that DO deduct stock, so margin compares like with like.
  -- `exists` against the view, not the table: an item whose only recipes live on
  -- its variants is still stock-tracked, and joining the view directly would
  -- multiply the revenue by the number of ingredients.
  revenue as (
    select coalesce(sum((soi.quantity - coalesce(x.q, 0)) * soi.item_price),0) tracked
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
    left join lateral (
      select sum(ev.qty) q
        from session_order_item_cancellations ev
       where ev.order_item_id = soi.id
         and ev.cancelled_at  < p_to
    ) x on true
    where so.restaurant_id = p_restaurant_id
      and soi.created_at >= p_from and soi.created_at < p_to
      and exists (select 1 from order_item_consumption c where c.order_item_id = soi.id)
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
$fn$;

revoke all on function dashboard_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function dashboard_stats(uuid, timestamptz, timestamptz) to service_role;


notify pgrst, 'reload schema';
