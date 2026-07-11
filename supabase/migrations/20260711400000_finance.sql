-- =============================================================
-- STOCK & FINANCE — PHASE 4: DAILY FINANCE REPORT
--
-- The report INVENTS nothing. Every figure is read from data that already
-- exists: `payments` (bills), `credits`/`credit_payments` (customer debt),
-- `purchases` (supplier bills) and `seller_payments` (supplier debt).
--
-- The only new state is the opening balance seed — the one number the database
-- cannot derive, because it is the cash that was in the drawer before the system
-- existed.
--
--   Closing = Seed + (money in − money out) since the seed
--   Opening for a period = the same sum evaluated at the period's start
--
-- So each period's opening IS the previous period's closing, by construction —
-- the carry-forward needs no nightly job and cannot drift.
--
-- MONEY IN : bill collections (payments) + customer credit repayments
-- MONEY OUT: purchases paid now + payments made to sellers
-- Credit — customer or seller — moves NO money on the day it is created. That is
-- the whole point of it, and why credit sales/purchases are excluded from the
-- cash and bank balances.
-- =============================================================

-- One seed per restaurant. `effective_from` is the moment the books opened:
-- movements before it are already baked into the seed and must not be re-counted.
create table if not exists finance_openings (
  restaurant_id  uuid primary key references restaurants(id) on delete cascade,
  opening_cash   numeric(12,2) not null default 0,
  opening_online numeric(12,2) not null default 0,
  effective_from timestamptz not null default now(),
  created_by     uuid references restaurant_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table finance_openings enable row level security;

-- ── The report ────────────────────────────────────────────────────────────────
create or replace function finance_report(
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
  seller_credit_created     numeric,
  seller_credit_paid        numeric,
  customer_credit_outstanding numeric,
  seller_credit_outstanding   numeric,
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
      -- With no seed, treat the books as opening at the dawn of time with zero:
      -- every movement ever recorded then counts, which is the honest default.
      coalesce(o.effective_from, '-infinity'::timestamptz) as eff,
      (o.restaurant_id is not null)                      as present
    from (select 1) _
    left join finance_openings o on o.restaurant_id = p_restaurant_id
  ),

  -- Bills. A credit bill records its FULL value in total_amount and only what was
  -- actually tendered in the split — so the gap between them is the credit, and
  -- only the tendered part is real money in.
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

  -- Customer credit repayments — money in, but NOT new revenue (the bill was
  -- already counted as sales when it was raised).
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

  -- Customer credit raised in the period = the unpaid part of the bills closed on
  -- credit during it. This IS "Credit Sales".
  cr as (
    select
      sum(c.bill_amount - c.down_payment) filter (where c.created_at >= p_from and c.created_at < p_to) as created,
      sum(c.bill_amount - c.paid_amount)  filter (where c.status <> 'fully_paid')                       as outstanding
    from credits c
    where c.restaurant_id = p_restaurant_id
  ),

  -- Supplier bills. Only the cash/online part left the till today; the credit
  -- part is a debt, not a payment.
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

  -- Money paid down against supplier debt.
  sp as (
    select
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= (select eff from seed) and s.created_at < p_from) as cash_before,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= (select eff from seed) and s.created_at < p_from) as online_before,
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= p_from and s.created_at < p_to) as cash_out,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= p_from and s.created_at < p_to) as online_out,
      sum(s.amount) filter (where s.created_at >= p_from and s.created_at < p_to)                        as paid
    from seller_payments s
    where s.restaurant_id = p_restaurant_id
  ),

  sel as (
    select coalesce(sum(credit_balance), 0) as outstanding
    from sellers where restaurant_id = p_restaurant_id
  ),

  calc as (
    select
      -- Opening = seed + everything that moved between the seed and this period.
      (select cash   from seed)
        + coalesce((select cash_before from pay), 0)
        + coalesce((select cash_before from crp), 0)
        - coalesce((select cash_before from pur), 0)
        - coalesce((select cash_before from sp),  0)  as open_cash,
      (select online from seed)
        + coalesce((select online_before from pay), 0)
        + coalesce((select online_before from crp), 0)
        - coalesce((select online_before from pur), 0)
        - coalesce((select online_before from sp),  0) as open_online
  )

  select
    calc.open_cash::numeric,
    calc.open_online::numeric,

    coalesce((select cash_in   from pay), 0)::numeric  as sales_cash,
    coalesce((select online_in from pay), 0)::numeric  as sales_online,
    coalesce((select card_in   from pay), 0)::numeric  as sales_card,
    coalesce((select created   from cr),  0)::numeric  as sales_credit,
    coalesce((select total_in  from pay), 0)::numeric  as sales_total,

    coalesce((select cash_out   from pur), 0)::numeric as purchases_cash,
    coalesce((select online_out from pur), 0)::numeric as purchases_online,
    coalesce((select credit_out from pur), 0)::numeric as purchases_credit,
    coalesce((select total_out  from pur), 0)::numeric as purchases_total,

    coalesce((select created   from cr),  0)::numeric  as customer_credit_created,
    coalesce((select collected from crp), 0)::numeric  as customer_credit_collected,
    coalesce((select credit_out from pur), 0)::numeric as seller_credit_created,
    coalesce((select paid      from sp),  0)::numeric  as seller_credit_paid,

    coalesce((select outstanding from cr),  0)::numeric as customer_credit_outstanding,
    (select outstanding from sel)::numeric              as seller_credit_outstanding,

    -- Closing = opening + money in − money out, for the period itself.
    (calc.open_cash
      + coalesce((select cash_in  from pay), 0)
      + coalesce((select cash_in  from crp), 0)
      - coalesce((select cash_out from pur), 0)
      - coalesce((select cash_out from sp),  0))::numeric as closing_cash,
    (calc.open_online
      + coalesce((select online_in from pay), 0)
      + coalesce((select card_in   from pay), 0)
      + coalesce((select online_in from crp), 0)
      - coalesce((select online_out from pur), 0)
      - coalesce((select online_out from sp),  0))::numeric as closing_online,

    (select present from seed) as has_opening
  from calc;
$$;

revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;

-- ── Seed / re-seed the opening balance ────────────────────────────────────────
create or replace function set_finance_opening(
  p_restaurant_id  uuid,
  p_cash           numeric,
  p_online         numeric,
  p_effective_from timestamptz,
  p_created_by     uuid
) returns finance_openings
language plpgsql
as $$
declare
  v_row finance_openings;
begin
  if coalesce(p_cash, 0) < 0 or coalesce(p_online, 0) < 0 then
    raise exception 'INVALID_OPENING';
  end if;

  insert into finance_openings (restaurant_id, opening_cash, opening_online, effective_from, created_by)
  values (p_restaurant_id, coalesce(p_cash, 0), coalesce(p_online, 0),
          coalesce(p_effective_from, now()), p_created_by)
  on conflict (restaurant_id) do update
    set opening_cash   = excluded.opening_cash,
        opening_online = excluded.opening_online,
        effective_from = excluded.effective_from,
        updated_at     = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function set_finance_opening(uuid, numeric, numeric, timestamptz, uuid) from public;
grant execute on function set_finance_opening(uuid, numeric, numeric, timestamptz, uuid) to service_role;
