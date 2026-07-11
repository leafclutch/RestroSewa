-- =============================================================
-- FINANCE UI — pending-party counts
--
-- The redesigned Credit Summary needs two figures the report didn't carry:
-- HOW MANY customers still owe us, and HOW MANY sellers we still owe. Amounts
-- alone don't tell an admin whether ₹6,000 is one bad debt or thirty small ones.
--
-- Postgres cannot change a function's return columns in place, so the function
-- is dropped and recreated. The body is otherwise IDENTICAL to
-- 20260711400000_finance.sql — only the two counts are added.
-- =============================================================

drop function if exists finance_report(uuid, timestamptz, timestamptz);

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
  seller_credit_created     numeric,
  seller_credit_paid        numeric,
  customer_credit_outstanding numeric,
  seller_credit_outstanding   numeric,
  -- NEW: how many parties are actually behind those outstanding totals.
  pending_customers         int,
  pending_sellers           int,
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
    select
      coalesce(sum(credit_balance), 0)                as outstanding,
      count(*) filter (where credit_balance > 0)::int as pending
    from sellers where restaurant_id = p_restaurant_id
  ),

  calc as (
    select
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
    coalesce((select pending from cr), 0)               as pending_customers,
    coalesce((select pending from sel), 0)              as pending_sellers,

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
