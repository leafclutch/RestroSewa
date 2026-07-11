-- =============================================================
-- TERMINOLOGY: SELLER → VENDOR
--
-- A pure rename. Every row is preserved: tables and columns are RENAMED in
-- place (never dropped and re-created), so primary keys, foreign keys and all
-- existing purchase/payment history survive untouched.
--
-- The one exception is `seller_code`, which is a GENERATED column derived from
-- `seq_no` — it holds no independent data. Dropping and re-adding it as
-- `vendor_code` re-derives every value from the same seq_no, so vendor N keeps
-- number N. Only the human-facing prefix changes: SLR-00001 → VND-00001.
--
-- Functions are dropped and re-created rather than replaced, because Postgres
-- cannot rename a function's input parameters (record_purchase) or change its
-- return columns (finance_report, dashboard_stats, product_history) in place.
-- =============================================================

-- ── Functions first ───────────────────────────────────────────────────────────
-- plpgsql bodies resolve table names at RUN time, so they'd silently break the
-- moment `sellers` is renamed. Drop them, rename, then re-create against the new
-- names.
drop function if exists create_seller(uuid, text, text, text, text, numeric, uuid);
drop function if exists record_seller_payment(uuid, uuid, numeric, text, text, uuid);
drop function if exists record_purchase(uuid, uuid, text, numeric, numeric, jsonb, text, uuid);
drop function if exists finance_report(uuid, timestamptz, timestamptz);
drop function if exists dashboard_stats(uuid, timestamptz, timestamptz);
drop function if exists product_history(uuid, uuid);

-- ── Tables ────────────────────────────────────────────────────────────────────
alter table sellers         rename to vendors;
alter table seller_payments rename to vendor_payments;

-- ── Columns ───────────────────────────────────────────────────────────────────
alter table vendor_payments rename column seller_id to vendor_id;
alter table purchases       rename column seller_id to vendor_id;

-- Generated column: derived from seq_no, so re-deriving loses nothing.
alter table vendors drop column seller_code;
alter table vendors add column vendor_code text
  generated always as ('VND-' || lpad(seq_no::text, 5, '0')) stored;

-- ── Constraints ───────────────────────────────────────────────────────────────
-- Renaming a PK/UNIQUE constraint renames its backing index too.
alter table vendors rename constraint sellers_pkey                  to vendors_pkey;
alter table vendors rename constraint sellers_created_by_fkey       to vendors_created_by_fkey;
alter table vendors rename constraint sellers_credit_balance_check  to vendors_credit_balance_check;
alter table vendors rename constraint sellers_opening_credit_check  to vendors_opening_credit_check;
alter table vendors rename constraint sellers_restaurant_id_fkey    to vendors_restaurant_id_fkey;
alter table vendors rename constraint sellers_restaurant_seq_key    to vendors_restaurant_seq_key;

alter table vendor_payments rename constraint seller_payments_amount_check        to vendor_payments_amount_check;
alter table vendor_payments rename constraint seller_payments_paid_by_fkey        to vendor_payments_paid_by_fkey;
alter table vendor_payments rename constraint seller_payments_pkey                to vendor_payments_pkey;
alter table vendor_payments rename constraint seller_payments_restaurant_id_fkey  to vendor_payments_restaurant_id_fkey;
alter table vendor_payments rename constraint seller_payments_seller_id_fkey      to vendor_payments_vendor_id_fkey;

alter table purchases rename constraint purchases_seller_id_fkey to purchases_vendor_id_fkey;

-- ── Standalone indexes ────────────────────────────────────────────────────────
alter index sellers_phone_idx            rename to vendors_phone_idx;
alter index sellers_restaurant_idx       rename to vendors_restaurant_idx;
alter index sellers_restaurant_name_key  rename to vendors_restaurant_name_key;
alter index seller_payments_restaurant_idx rename to vendor_payments_restaurant_idx;
alter index seller_payments_seller_idx     rename to vendor_payments_vendor_idx;
alter index purchases_seller_idx           rename to purchases_vendor_idx;

-- =============================================================
-- FUNCTIONS, re-created against the vendor names
-- =============================================================

-- ── Create a vendor (once) ────────────────────────────────────────────────────
create function create_vendor(
  p_restaurant_id  uuid,
  p_name           text,
  p_phone          text,
  p_address        text,
  p_notes          text,
  p_opening_credit numeric,
  p_created_by     uuid
) returns vendors
language plpgsql
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_open   numeric := coalesce(p_opening_credit, 0);
  v_seq    int;
  v_vendor vendors;
begin
  if v_name = '' then
    raise exception 'NAME_REQUIRED';
  end if;
  if v_open < 0 then
    raise exception 'INVALID_OPENING_CREDIT';
  end if;

  perform pg_advisory_xact_lock(hashtext('vendor_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from vendors
   where restaurant_id = p_restaurant_id;

  begin
    insert into vendors (
      restaurant_id, seq_no, name, phone, address, notes,
      opening_credit, credit_balance, created_by
    )
    values (
      p_restaurant_id, v_seq, v_name,
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      v_open, v_open, p_created_by
    )
    returning * into v_vendor;
  exception
    when unique_violation then
      -- The unique index on lower(btrim(name)) fired: this supplier already has
      -- an account and must be reused, not duplicated.
      raise exception 'VENDOR_EXISTS';
  end;

  return v_vendor;
end;
$$;

revoke all on function create_vendor(uuid, text, text, text, text, numeric, uuid) from public;
grant execute on function create_vendor(uuid, text, text, text, text, numeric, uuid) to service_role;

-- ── Pay a vendor ──────────────────────────────────────────────────────────────
create function record_vendor_payment(
  p_restaurant_id uuid,
  p_vendor_id     uuid,
  p_amount        numeric,
  p_method        text,
  p_notes         text,
  p_paid_by       uuid
) returns vendors
language plpgsql
as $$
declare
  v_vendor  vendors;
  v_applied numeric;
begin
  select * into v_vendor
    from vendors
   where id = p_vendor_id
     and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'VENDOR_NOT_FOUND';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if v_vendor.credit_balance <= 0 then
    raise exception 'NOTHING_OWED';
  end if;

  if p_amount > v_vendor.credit_balance + 0.005 then
    raise exception 'AMOUNT_EXCEEDS_BALANCE';
  end if;
  v_applied := least(p_amount, v_vendor.credit_balance);

  insert into vendor_payments (vendor_id, restaurant_id, amount, method, notes, paid_by)
  values (
    p_vendor_id, p_restaurant_id, v_applied, p_method::payment_method,
    nullif(btrim(coalesce(p_notes, '')), ''), p_paid_by
  );

  update vendors
     set credit_balance = credit_balance - v_applied
   where id = p_vendor_id
  returning * into v_vendor;

  return v_vendor;
end;
$$;

revoke all on function record_vendor_payment(uuid, uuid, numeric, text, text, uuid) from public;
grant execute on function record_vendor_payment(uuid, uuid, numeric, text, text, uuid) to service_role;

-- ── Record a purchase ─────────────────────────────────────────────────────────
create function record_purchase(
  p_restaurant_id uuid,
  p_vendor_id     uuid,
  p_method        text,
  p_cash          numeric,
  p_online        numeric,
  p_items         jsonb,
  p_notes         text,
  p_created_by    uuid
) returns purchases
language plpgsql
as $$
declare
  v_vendor   vendors;
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

  select * into v_vendor
    from vendors
   where id = p_vendor_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'VENDOR_NOT_FOUND';
  end if;
  if not v_vendor.is_active then
    raise exception 'VENDOR_INACTIVE';
  end if;

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
    if v_paid >= v_total then
      raise exception 'NOTHING_ON_CREDIT';
    end if;
    v_credit := v_total - v_paid;
  else
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
    restaurant_id, seq_no, vendor_id, payment_method,
    total_amount, cash_amount, online_amount, credit_amount, notes, created_by
  )
  values (
    p_restaurant_id, v_seq, p_vendor_id, p_method::payment_method,
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

  -- The credit half of the bill becomes a debt to this vendor.
  if v_credit > 0 then
    update vendors
       set credit_balance = credit_balance + v_credit
     where id = p_vendor_id;
  end if;

  return v_purchase;
end;
$$;

revoke all on function record_purchase(uuid, uuid, text, numeric, numeric, jsonb, text, uuid) from public;
grant execute on function record_purchase(uuid, uuid, text, numeric, numeric, jsonb, text, uuid) to service_role;

-- ── Daily finance report ──────────────────────────────────────────────────────
create function finance_report(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  opening_cash              numeric,
  opening_online            numeric,
  sales_cash                numeric,
  sales_online              numeric,
  sales_card                numeric,
  sales_credit              numeric,
  sales_total               numeric,
  purchases_cash            numeric,
  purchases_online          numeric,
  purchases_credit          numeric,
  purchases_total           numeric,
  customer_credit_created   numeric,
  customer_credit_collected numeric,
  vendor_credit_created     numeric,
  vendor_credit_paid        numeric,
  customer_credit_outstanding numeric,
  vendor_credit_outstanding   numeric,
  pending_customers         int,
  pending_vendors           int,
  closing_cash              numeric,
  closing_online            numeric,
  has_opening               boolean
)
language sql
stable
as $$
  with
  seed as (
    select
      coalesce(o.opening_cash, 0)                        as cash,
      coalesce(o.opening_online, 0)                      as online,
      coalesce(o.effective_from, '-infinity'::timestamptz) as eff,
      (o.restaurant_id is not null)                      as present
    from (select 1) _
    left join finance_openings o on o.restaurant_id = p_restaurant_id
  ),
  pay as (
    select
      sum(p.cash_amount)                     filter (where p.created_at >= (select eff from seed) and p.created_at < p_from) as cash_before,
      sum(p.online_amount + coalesce(p.card_amount, 0))
                                             filter (where p.created_at >= (select eff from seed) and p.created_at < p_from) as online_before,
      sum(p.cash_amount)                     filter (where p.created_at >= p_from and p.created_at < p_to) as cash_in,
      sum(p.online_amount)                   filter (where p.created_at >= p_from and p.created_at < p_to) as online_in,
      sum(coalesce(p.card_amount, 0))        filter (where p.created_at >= p_from and p.created_at < p_to) as card_in,
      sum(coalesce(p.total_amount, p.amount))
                                             filter (where p.created_at >= p_from and p.created_at < p_to) as total_in
    from payments p
    where p.restaurant_id = p_restaurant_id
  ),
  crp as (
    select
      sum(cp.amount) filter (where cp.method = 'cash'   and cp.created_at >= (select eff from seed) and cp.created_at < p_from) as cash_before,
      sum(cp.amount) filter (where cp.method <> 'cash'  and cp.created_at >= (select eff from seed) and cp.created_at < p_from) as online_before,
      sum(cp.amount) filter (where cp.method = 'cash'   and cp.created_at >= p_from and cp.created_at < p_to) as cash_in,
      sum(cp.amount) filter (where cp.method <> 'cash'  and cp.created_at >= p_from and cp.created_at < p_to) as online_in,
      sum(cp.amount) filter (where cp.created_at >= p_from and cp.created_at < p_to)                          as collected
    from credit_payments cp
    where cp.restaurant_id = p_restaurant_id
  ),
  cr as (
    select
      sum(c.bill_amount - c.down_payment) filter (where c.created_at >= p_from and c.created_at < p_to) as created,
      sum(c.bill_amount - c.paid_amount)  filter (where c.status <> 'fully_paid')                       as outstanding,
      count(*) filter (where c.status <> 'fully_paid')::int                                             as pending
    from credits c
    where c.restaurant_id = p_restaurant_id
  ),
  pur as (
    select
      sum(pu.cash_amount)    filter (where pu.created_at >= (select eff from seed) and pu.created_at < p_from) as cash_before,
      sum(pu.online_amount)  filter (where pu.created_at >= (select eff from seed) and pu.created_at < p_from) as online_before,
      sum(pu.cash_amount)    filter (where pu.created_at >= p_from and pu.created_at < p_to) as cash_out,
      sum(pu.online_amount)  filter (where pu.created_at >= p_from and pu.created_at < p_to) as online_out,
      sum(pu.credit_amount)  filter (where pu.created_at >= p_from and pu.created_at < p_to) as credit_out,
      sum(pu.total_amount)   filter (where pu.created_at >= p_from and pu.created_at < p_to) as total_out
    from purchases pu
    where pu.restaurant_id = p_restaurant_id
  ),
  vp as (
    select
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= (select eff from seed) and s.created_at < p_from) as cash_before,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= (select eff from seed) and s.created_at < p_from) as online_before,
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= p_from and s.created_at < p_to) as cash_out,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= p_from and s.created_at < p_to) as online_out,
      sum(s.amount) filter (where s.created_at >= p_from and s.created_at < p_to)                        as paid
    from vendor_payments s
    where s.restaurant_id = p_restaurant_id
  ),
  ven as (
    select
      coalesce(sum(credit_balance), 0)                as outstanding,
      count(*) filter (where credit_balance > 0)::int as pending
    from vendors where restaurant_id = p_restaurant_id
  ),
  calc as (
    select
      (select cash from seed)
        + coalesce((select cash_before from pay), 0)
        + coalesce((select cash_before from crp), 0)
        - coalesce((select cash_before from pur), 0)
        - coalesce((select cash_before from vp),  0)  as open_cash,
      (select online from seed)
        + coalesce((select online_before from pay), 0)
        + coalesce((select online_before from crp), 0)
        - coalesce((select online_before from pur), 0)
        - coalesce((select online_before from vp),  0) as open_online
  )
  select
    calc.open_cash::numeric,
    calc.open_online::numeric,

    coalesce((select cash_in   from pay), 0)::numeric,
    coalesce((select online_in from pay), 0)::numeric,
    coalesce((select card_in   from pay), 0)::numeric,
    coalesce((select created   from cr),  0)::numeric,
    coalesce((select total_in  from pay), 0)::numeric,

    coalesce((select cash_out   from pur), 0)::numeric,
    coalesce((select online_out from pur), 0)::numeric,
    coalesce((select credit_out from pur), 0)::numeric,
    coalesce((select total_out  from pur), 0)::numeric,

    coalesce((select created   from cr),  0)::numeric,
    coalesce((select collected from crp), 0)::numeric,
    coalesce((select credit_out from pur), 0)::numeric,
    coalesce((select paid      from vp),  0)::numeric,

    coalesce((select outstanding from cr),  0)::numeric,
    (select outstanding from ven)::numeric,
    coalesce((select pending from cr), 0),
    coalesce((select pending from ven), 0),

    (calc.open_cash
      + coalesce((select cash_in  from pay), 0)
      + coalesce((select cash_in  from crp), 0)
      - coalesce((select cash_out from pur), 0)
      - coalesce((select cash_out from vp),  0))::numeric,
    (calc.open_online
      + coalesce((select online_in from pay), 0)
      + coalesce((select card_in   from pay), 0)
      + coalesce((select online_in from crp), 0)
      - coalesce((select online_out from pur), 0)
      - coalesce((select online_out from vp),  0))::numeric,

    (select present from seed)
  from calc;
$$;

revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;

-- ── Dashboard analytics ───────────────────────────────────────────────────────
create function dashboard_stats(
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
  ven as (
    select coalesce(sum(credit_balance), 0) as v
    from vendors
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
    ven.v::numeric
  from stock, cost, revenue, sales, purch, cust, ven;
$$;

revoke all on function dashboard_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function dashboard_stats(uuid, timestamptz, timestamptz) to service_role;

-- ── Product history ───────────────────────────────────────────────────────────
create function product_history(
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
