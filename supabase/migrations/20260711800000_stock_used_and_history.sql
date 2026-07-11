-- =============================================================
-- STOCK — manual deductions count as "Used", richer purchase history
--
-- 1. USED TODAY was POS sales only, so a kilo of chicken the kitchen took for a
--    staff meal vanished from the summary even though it left the shelf.
--    Used = POS consumption + manual deductions.
--
--    Manual movements are signed, so they are split rather than netted:
--      used_manual = what was taken OUT by hand (waste, kitchen usage, …)
--      added       = what was put BACK by a correction
--    Netting them would let a +5 correction cancel a −5 wastage and report
--    "nothing used today", which is exactly the lie we're fixing.
--
--    closing is UNCHANGED and still reconciles:
--      opening + purchased − used + added
--      = opening + purchased − (pos + deducted) + added        (same as before,
--      = opening + purchased − pos + (added − deducted)         when adjusted
--                                                               was the net)
--
-- 2. PRODUCT HISTORY now carries the seller, cost and payment method of a
--    purchase, so a stock movement explains itself without opening Purchases.
-- =============================================================

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
  -- Split out so the UI can show WHERE the consumption came from…
  used_pos    numeric,
  used_manual numeric,
  -- …and the single figure the Stock screen puts under "Used".
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
      -- Everything before the window still nets, because it only feeds `opening`.
      sum(a.qty) filter (where a.created_at < p_from)                                    as net_before,
      -- Taken out by hand, as a positive number.
      sum(-a.qty) filter (where a.qty < 0 and a.created_at >= p_from and a.created_at < p_to) as out_within,
      -- Put back by a correction.
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
       + coalesce(a.net_before, 0))::numeric                        as opening,
    coalesce(pu.within, 0)::numeric                                 as purchased,
    coalesce(u.within, 0)::numeric                                  as used_pos,
    coalesce(a.out_within, 0)::numeric                              as used_manual,
    -- USED = sold through the POS + taken out by hand.
    (coalesce(u.within, 0) + coalesce(a.out_within, 0))::numeric    as used,
    coalesce(a.in_within, 0)::numeric                               as added,
    (p.opening_stock
       + coalesce(pu.before, 0)  + coalesce(pu.within, 0)
       - coalesce(u.before, 0)   - coalesce(u.within, 0)
       + coalesce(a.net_before, 0)
       - coalesce(a.out_within, 0) + coalesce(a.in_within, 0))::numeric as closing
  from products p
  left join usage u  on u.product_id  = p.id
  left join purch pu on pu.product_id = p.id
  left join adj a    on a.product_id  = p.id
  where p.restaurant_id = p_restaurant_id;
$$;

revoke all on function stock_report(uuid, timestamptz, timestamptz) from public;
grant execute on function stock_report(uuid, timestamptz, timestamptz) to service_role;

-- ── Product history, with the purchase's seller / cost / payment method ────────
drop function if exists product_history(uuid, uuid);

create function product_history(
  p_restaurant_id uuid,
  p_product_id    uuid
)
returns table (
  at          timestamptz,
  kind        text,      -- opening | purchase | sale | manual
  qty         numeric,   -- signed: + adds stock, − removes it
  reason      text,      -- the manual reason, when kind = 'manual'
  ref         text,      -- purchase code, or the menu item that sold it
  -- Purchase context, so a stock movement explains itself.
  seller_name text,
  seller_code text,
  amount      numeric,   -- what this line of the purchase cost
  method      text,      -- how that purchase was paid (cash / online / credit)
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
      null::text      as seller_name,
      null::text      as seller_code,
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
      s.name,
      s.seller_code,
      pi.line_total,
      pu.payment_method::text,
      pu.created_by,
      1
    from purchase_items pi
    join purchases pu on pu.id = pi.purchase_id
    join sellers s    on s.id = pu.seller_id
    where pi.product_id = p_product_id
      and pu.restaurant_id = p_restaurant_id

    union all

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

    select
      a.created_at,
      'manual',
      a.qty,
      a.kind,          -- the reason the admin picked; the UI shows it verbatim
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
    m.seller_name, m.seller_code, m.amount, m.method, m.staff_id,
    -- Running balance. The tiebreak keeps rows stamped at the same instant in a
    -- stable order, so the balance never jitters between reads.
    sum(m.qty) over (order by m.at, m.tiebreak, m.kind
                     rows between unbounded preceding and current row)::numeric
  from moves m
  order by m.at, m.tiebreak, m.kind;
$$;

revoke all on function product_history(uuid, uuid) from public;
grant execute on function product_history(uuid, uuid) to service_role;
