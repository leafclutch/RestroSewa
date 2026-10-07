-- =============================================================
-- STOCK HISTORY — a date window, so a busy product doesn't ship its whole life
--
-- The Stock screen loaded EVERY movement of a product on every open: Shining
-- Crown's "Shikhar ice" is ~1,800 rows after two months, and growing daily. The
-- screen now opens on "This Week" (with Month / Year / All Time), so the server
-- only sends the window being looked at.
--
-- A new function rather than new parameters on product_history: that one stays
-- exactly as it is for anything still calling it, and PostgREST never has to
-- choose between two overloads of the same name.
--
-- Body = product_history's live definition; only the final select changes (see
-- the comment there). Null bounds mean "no limit", so (null, null) is the whole
-- history, identical to product_history.
-- =============================================================

CREATE OR REPLACE FUNCTION public.product_history_range(p_restaurant_id uuid, p_product_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(at timestamp with time zone, kind text, qty numeric, reason text, ref text, vendor_name text, vendor_code text, amount numeric, method text, staff_id uuid, balance numeric)
 LANGUAGE sql
 STABLE
AS $function$
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
  -- The running balance is computed over the WHOLE history first, and only then
  -- narrowed to the window — so the first row of a week still carries the true
  -- on-hand figure, not one restarted from zero.
  select
    h.at, h.kind, h.qty, h.reason, h.ref,
    h.vendor_name, h.vendor_code, h.amount, h.method, h.staff_id, h.balance
  from (
    select
      m.at, m.kind, m.qty, m.reason, m.ref,
      m.vendor_name, m.vendor_code, m.amount, m.method, m.staff_id, m.tiebreak,
      sum(m.qty) over (order by m.at, m.tiebreak, m.kind
                       rows between unbounded preceding and current row)::numeric balance
    from moves m
  ) h
  where (p_from is null or h.at >= p_from)
    and (p_to   is null or h.at <  p_to)
  order by h.at, h.tiebreak, h.kind;
$function$;

revoke all on function product_history_range(uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function product_history_range(uuid, uuid, timestamptz, timestamptz) to service_role;
