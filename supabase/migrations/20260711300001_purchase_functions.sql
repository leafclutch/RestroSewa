-- =============================================================
-- STOCK & FINANCE — PHASE 3: PURCHASE FUNCTIONS
-- =============================================================

-- ── Record a purchase ─────────────────────────────────────────────────────────
-- One transaction writes the bill, its lines, the seller's credit movement and
-- each product's latest cost. Any of those failing rolls back all of them — a
-- purchase can never exist without its stock, or raise a debt without its bill.
--
-- `for update` on the seller serialises two admins buying from the same supplier
-- at once, so neither can raise the balance from a stale read.
create or replace function record_purchase(
  p_restaurant_id uuid,
  p_seller_id     uuid,
  p_method        text,
  p_cash          numeric,
  p_online        numeric,
  p_items         jsonb,   -- [{ product_id, quantity, unit_cost }, …]
  p_notes         text,
  p_created_by    uuid
) returns purchases
language plpgsql
as $$
declare
  v_seller   sellers;
  v_total    numeric := 0;
  v_paid     numeric := coalesce(p_cash, 0) + coalesce(p_online, 0);
  v_credit   numeric := 0;
  v_cash     numeric := coalesce(p_cash, 0);
  v_online   numeric := coalesce(p_online, 0);
  v_seq      int;
  v_purchase purchases;
  v_item     jsonb;
  v_count    int;
begin
  if p_method not in ('cash', 'online', 'credit') then
    raise exception 'INVALID_METHOD';
  end if;
  if v_cash < 0 or v_online < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Lock the seller for the whole transaction (their balance may move below).
  select * into v_seller
    from sellers
   where id = p_seller_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'SELLER_NOT_FOUND';
  end if;
  if not v_seller.is_active then
    raise exception 'SELLER_INACTIVE';
  end if;

  -- Validate the lines and total them up. The total is computed HERE, from the
  -- lines — never trusted from the client, so the bill always equals its parts.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'quantity')::numeric <= 0 then
      raise exception 'INVALID_QUANTITY';
    end if;
    if (v_item->>'unit_cost')::numeric < 0 then
      raise exception 'INVALID_UNIT_COST';
    end if;

    -- Every product must be ours, and active.
    select count(*) into v_count
      from products
     where id = (v_item->>'product_id')::uuid
       and restaurant_id = p_restaurant_id
       and is_active;
    if v_count = 0 then
      raise exception 'PRODUCT_NOT_FOUND';
    end if;

    v_total := v_total + round((v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric, 2);
  end loop;

  if v_total <= 0 then
    raise exception 'INVALID_TOTAL';
  end if;

  if p_method = 'credit' then
    -- Part-payment is allowed, but something must be left owing — otherwise this
    -- is simply a paid bill, not a credit one.
    if v_paid >= v_total then
      raise exception 'NOTHING_ON_CREDIT';
    end if;
    v_credit := v_total - v_paid;
  else
    -- Cash / online: the bill is settled in full, right now.
    v_credit := 0;
    if p_method = 'cash' then
      v_cash := v_total; v_online := 0;
    else
      v_cash := 0; v_online := v_total;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('purchase_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from purchases where restaurant_id = p_restaurant_id;

  insert into purchases (
    restaurant_id, seq_no, seller_id, payment_method,
    total_amount, cash_amount, online_amount, credit_amount, notes, created_by
  )
  values (
    p_restaurant_id, v_seq, p_seller_id, p_method::payment_method,
    v_total, v_cash, v_online, v_credit,
    nullif(btrim(coalesce(p_notes, '')), ''), p_created_by
  )
  returning * into v_purchase;

  insert into purchase_items (purchase_id, restaurant_id, product_id, quantity, unit_cost)
  select
    v_purchase.id,
    p_restaurant_id,
    (i->>'product_id')::uuid,
    (i->>'quantity')::numeric,
    (i->>'unit_cost')::numeric
  from jsonb_array_elements(p_items) i;

  -- Latest cost per product — drives inventory value and estimated profit.
  update products p
     set last_unit_cost = x.unit_cost
    from (
      select distinct on ((i->>'product_id')::uuid)
             (i->>'product_id')::uuid as product_id,
             (i->>'unit_cost')::numeric as unit_cost
        from jsonb_array_elements(p_items) i
    ) x
   where p.id = x.product_id
     and p.restaurant_id = p_restaurant_id;

  -- The credit half of the bill becomes a debt to this seller.
  if v_credit > 0 then
    update sellers
       set credit_balance = credit_balance + v_credit
     where id = p_seller_id;
  end if;

  return v_purchase;
end;
$$;

revoke all on function record_purchase(uuid, uuid, text, numeric, numeric, jsonb, text, uuid) from public;
grant execute on function record_purchase(uuid, uuid, text, numeric, numeric, jsonb, text, uuid) to service_role;

-- ── stock_report, now with purchases ──────────────────────────────────────────
-- Phase 2 left explicit 0 constants where purchases belong. This fills them in
-- by reading `purchase_items` directly — no stock rows are written for a
-- purchase, so the ledger and the stock level cannot drift apart.
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
  -- POS consumption, via the 1:1 menu-item link.
  --
  -- `soi.created_at >= mip.created_at` is load-bearing: a menu item usually has
  -- sales history predating its link. Without it, linking an existing item would
  -- retroactively deduct EVERY past sale and drive stock negative on day one.
  -- Tracking begins when the link is made.
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
  purch as (
    select
      pi.product_id,
      sum(pi.quantity) filter (where pu.created_at < p_from)                        as before,
      sum(pi.quantity) filter (where pu.created_at >= p_from and pu.created_at < p_to) as within
    from purchase_items pi
    join purchases pu on pu.id = pi.purchase_id
    where pu.restaurant_id = p_restaurant_id
    group by pi.product_id
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
  select
    p.id,
    -- Opening = stock on hand the instant the window began. Today's opening is
    -- yesterday's closing by construction, so the rollover needs no nightly job.
    (p.opening_stock
       + coalesce(pu.before, 0)
       - coalesce(u.before, 0)
       + coalesce(a.before, 0))::numeric                                       as opening,
    coalesce(pu.within, 0)::numeric                                            as purchased,
    coalesce(u.within, 0)::numeric                                             as used,
    coalesce(a.within, 0)::numeric                                             as adjusted,
    (p.opening_stock
       + coalesce(pu.before, 0) + coalesce(pu.within, 0)
       - coalesce(u.before, 0)  - coalesce(u.within, 0)
       + coalesce(a.before, 0)  + coalesce(a.within, 0))::numeric              as closing
  from products p
  left join usage u  on u.product_id  = p.id
  left join purch pu on pu.product_id = p.id
  left join adj a    on a.product_id  = p.id
  where p.restaurant_id = p_restaurant_id;
$$;

revoke all on function stock_report(uuid, timestamptz, timestamptz) from public;
grant execute on function stock_report(uuid, timestamptz, timestamptz) to service_role;
