-- =============================================================
-- SALES: THE PART OF A BILL PAID BY AN ADVANCE
--
-- The Sales block lists cash / online / card / credit. An advance is none of
-- those — the money arrived on an earlier day — so a bill settled by a deposit
-- added its full value to `sales_total` while contributing NOTHING to any row
-- beneath it. A fully prepaid stay therefore appeared in Sales as a total with
-- no visible sale behind it, and the section silently stopped adding up:
--
--   observed on DEV: total 9,500, rows summed 3,000, unexplained gap 6,500.
--
-- `sales_advance` closes it. With it the identity is exact:
--
--   cash + online + card + advance + credit = total
--
-- because `credits.down_payment` already includes the advance, so the credit leg
-- (bill_amount − down_payment) is the remainder AFTER the deposit.
--
-- This is NOT new cash in the period — that was banked the day the deposit was
-- taken and is reported under Room Advances. It states how the SALE was settled,
-- which is what the Sales section is for.
--
-- Appended to the end of the return type so positional readers keep working.
-- =============================================================

drop function if exists finance_report(uuid, timestamptz, timestamptz);

create function finance_report(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  opening_cash numeric, opening_online numeric,
  opening_credit_to_us numeric, opening_credit_by_us numeric,
  sales_cash numeric, sales_online numeric, sales_card numeric,
  sales_credit numeric, sales_total numeric,
  purchases_cash numeric, purchases_online numeric, purchases_credit numeric, purchases_total numeric,
  customer_credit_created numeric, customer_credit_collected numeric,
  vendor_credit_created numeric, vendor_credit_paid numeric,
  customer_credit_outstanding numeric, vendor_credit_outstanding numeric,
  pending_customers int, pending_vendors int,
  salary_cash numeric, salary_online numeric, salary_advance numeric, salary_total numeric,
  salary_outstanding numeric,
  closing_cash numeric, closing_online numeric,
  closing_credit_to_us numeric, closing_credit_by_us numeric,
  has_opening boolean,
  advances_received numeric, advances_refunded numeric,
  opening_advances_held numeric, closing_advances_held numeric,
  -- How much of the period's sales was settled by a deposit taken earlier.
  sales_advance numeric
)
language sql stable as $$
  with
  seed as (
    select coalesce(o.opening_cash,0) cash, coalesce(o.opening_online,0) online,
           coalesce(o.effective_from,'-infinity'::timestamptz) eff,
           (o.restaurant_id is not null) present
    from (select 1) _ left join finance_openings o on o.restaurant_id = p_restaurant_id
  ),
  pay as (
    select
      sum(p.cash_amount) filter (where p.created_at >= (select eff from seed) and p.created_at < p_from) cash_before,
      sum(p.online_amount + coalesce(p.card_amount,0)) filter (where p.created_at >= (select eff from seed) and p.created_at < p_from) online_before,
      sum(p.cash_amount) filter (where p.created_at >= p_from and p.created_at < p_to) cash_in,
      sum(p.online_amount) filter (where p.created_at >= p_from and p.created_at < p_to) online_in,
      sum(coalesce(p.card_amount,0)) filter (where p.created_at >= p_from and p.created_at < p_to) card_in,
      sum(coalesce(p.total_amount,p.amount)) filter (where p.created_at >= p_from and p.created_at < p_to) total_in
    from payments p where p.restaurant_id = p_restaurant_id
  ),
  -- Room deposits. Signed rows: a refund is negative, so one set of sums serves
  -- money in and money back out.
  adv as (
    select
      sum(a.cash_amount) filter (where a.created_at >= (select eff from seed) and a.created_at < p_from) cash_before,
      sum(a.online_amount + a.card_amount) filter (where a.created_at >= (select eff from seed) and a.created_at < p_from) online_before,
      sum(a.cash_amount) filter (where a.created_at >= p_from and a.created_at < p_to) cash_in,
      sum(a.online_amount + a.card_amount) filter (where a.created_at >= p_from and a.created_at < p_to) online_in,
      sum(a.amount) filter (where a.amount > 0 and a.created_at >= p_from and a.created_at < p_to) received,
      sum(-a.amount) filter (where a.amount < 0 and a.created_at >= p_from and a.created_at < p_to) refunded,
      -- Liability legs. NO `eff` floor, for the same reason the credit legs have
      -- none: a deposit taken before the books opened is still owed to the guest.
      sum(a.amount) filter (where a.created_at < p_from) held_raised_before,
      sum(a.amount) filter (where a.created_at < p_to)   held_raised_to
    from room_advances a where a.restaurant_id = p_restaurant_id
  ),
  -- The other half of the liability: a deposit stops being held the moment it is
  -- applied to a bill. `applied_in` is also the Sales figure.
  advuse as (
    select
      sum(p.advance_amount) filter (where p.created_at < p_from) applied_before,
      sum(p.advance_amount) filter (where p.created_at < p_to)   applied_to,
      sum(p.advance_amount) filter (where p.created_at >= p_from and p.created_at < p_to) applied_in
    from payments p where p.restaurant_id = p_restaurant_id
  ),
  crp as (
    select
      sum(cp.cash_amount) filter (where cp.created_at >= (select eff from seed) and cp.created_at < p_from) cash_before,
      sum(cp.online_amount) filter (where cp.created_at >= (select eff from seed) and cp.created_at < p_from) online_before,
      sum(cp.cash_amount) filter (where cp.created_at >= p_from and cp.created_at < p_to) cash_in,
      sum(cp.online_amount) filter (where cp.created_at >= p_from and cp.created_at < p_to) online_in,
      sum(cp.amount) filter (where cp.created_at >= p_from and cp.created_at < p_to) collected,
      -- Credit-to-us legs. These have NO `eff` floor on purpose: the cash seed
      -- replaces pre-books cash movement, but a debt raised before the books
      -- opened is still owed today, and the customer's own opening term carries
      -- it. Flooring these would forgive it.
      sum(cp.amount) filter (where cp.created_at < p_from) collected_before,
      sum(cp.amount) filter (where cp.created_at < p_to)   collected_to
    from credit_payments cp where cp.restaurant_id = p_restaurant_id
  ),
  cr as (
    select
      sum(c.bill_amount - c.down_payment) filter (where c.created_at >= p_from and c.created_at < p_to) created,
      sum(c.bill_amount - c.down_payment) filter (where c.created_at < p_from) raised_before,
      sum(c.bill_amount - c.down_payment) filter (where c.created_at < p_to)   raised_to
    from credits c where c.restaurant_id = p_restaurant_id
  ),
  cust as (
    select coalesce(sum(balance),0) outstanding,
           count(*) filter (where balance > 0)::int pending,
           -- The pre-system anchor, dated at the account's creation.
           coalesce(sum(opening_balance) filter (where created_at < p_from),0) open_before,
           coalesce(sum(opening_balance) filter (where created_at < p_to),0)   open_to
    from credit_customers where restaurant_id = p_restaurant_id
  ),
  pur as (
    select
      sum(pu.cash_amount) filter (where pu.created_at >= (select eff from seed) and pu.created_at < p_from) cash_before,
      sum(pu.online_amount) filter (where pu.created_at >= (select eff from seed) and pu.created_at < p_from) online_before,
      sum(pu.cash_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) cash_out,
      sum(pu.online_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) online_out,
      sum(pu.credit_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) credit_out,
      sum(pu.total_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) total_out,
      -- Credit-by-us legs, unfloored for the same reason as the customer side.
      sum(pu.credit_amount) filter (where pu.created_at < p_from) owed_before,
      sum(pu.credit_amount) filter (where pu.created_at < p_to)   owed_to
    from purchases pu where pu.restaurant_id = p_restaurant_id
  ),
  vp as (
    select
      sum(s.cash_amount) filter (where s.created_at >= (select eff from seed) and s.created_at < p_from) cash_before,
      sum(s.online_amount) filter (where s.created_at >= (select eff from seed) and s.created_at < p_from) online_before,
      sum(s.cash_amount) filter (where s.created_at >= p_from and s.created_at < p_to) cash_out,
      sum(s.online_amount) filter (where s.created_at >= p_from and s.created_at < p_to) online_out,
      sum(s.amount) filter (where s.created_at >= p_from and s.created_at < p_to) paid,
      sum(s.amount) filter (where s.created_at < p_from) paid_before,
      sum(s.amount) filter (where s.created_at < p_to)   paid_to
    from vendor_payments s where s.restaurant_id = p_restaurant_id
  ),
  sal as (
    select
      sum(sp.cash_amount) filter (where sp.created_at >= (select eff from seed) and sp.created_at < p_from) cash_before,
      sum(sp.online_amount) filter (where sp.created_at >= (select eff from seed) and sp.created_at < p_from) online_before,
      sum(sp.cash_amount) filter (where sp.created_at >= p_from and sp.created_at < p_to) cash_out,
      sum(sp.online_amount) filter (where sp.created_at >= p_from and sp.created_at < p_to) online_out,
      sum(sp.amount) filter (where sp.kind = 'advance'  and sp.created_at >= p_from and sp.created_at < p_to) advance_out,
      sum(sp.amount) filter (where sp.created_at >= p_from and sp.created_at < p_to) total_out
    from salary_payments sp where sp.restaurant_id = p_restaurant_id
  ),
  ven as (
    select coalesce(sum(credit_balance),0) outstanding,
           count(*) filter (where credit_balance > 0)::int pending,
           coalesce(sum(opening_credit) filter (where created_at < p_from),0) open_before,
           coalesce(sum(opening_credit) filter (where created_at < p_to),0)   open_to
    from vendors where restaurant_id = p_restaurant_id
  ),
  owed as (
    select coalesce((select outstanding_liability from payroll_summary(p_restaurant_id, p_from, p_to)), 0) v
  ),
  calc as (
    select
      (select cash from seed) + coalesce((select cash_before from pay),0) + coalesce((select cash_before from crp),0)
        + coalesce((select cash_before from adv),0)
        - coalesce((select cash_before from pur),0) - coalesce((select cash_before from vp),0)
        - coalesce((select cash_before from sal),0) open_cash,
      (select online from seed) + coalesce((select online_before from pay),0) + coalesce((select online_before from crp),0)
        + coalesce((select online_before from adv),0)
        - coalesce((select online_before from pur),0) - coalesce((select online_before from vp),0)
        - coalesce((select online_before from sal),0) open_online,

      -- The two credit balances, evaluated at each end of the period.
      (select open_before from cust) + coalesce((select raised_before from cr),0)
        - coalesce((select collected_before from crp),0) open_to_us,
      (select open_to from cust) + coalesce((select raised_to from cr),0)
        - coalesce((select collected_to from crp),0) close_to_us,
      (select open_before from ven) + coalesce((select owed_before from pur),0)
        - coalesce((select paid_before from vp),0) open_by_us,
      (select open_to from ven) + coalesce((select owed_to from pur),0)
        - coalesce((select paid_to from vp),0) close_by_us,

      -- The fifth balance: taken, less applied to a bill.
      coalesce((select held_raised_before from adv),0)
        - coalesce((select applied_before from advuse),0) open_held,
      coalesce((select held_raised_to from adv),0)
        - coalesce((select applied_to from advuse),0)     close_held
  )
  select
    calc.open_cash::numeric, calc.open_online::numeric,
    calc.open_to_us::numeric, calc.open_by_us::numeric,
    coalesce((select cash_in from pay),0)::numeric,
    coalesce((select online_in from pay),0)::numeric,
    coalesce((select card_in from pay),0)::numeric,
    coalesce((select created from cr),0)::numeric,
    coalesce((select total_in from pay),0)::numeric,
    coalesce((select cash_out from pur),0)::numeric,
    coalesce((select online_out from pur),0)::numeric,
    coalesce((select credit_out from pur),0)::numeric,
    coalesce((select total_out from pur),0)::numeric,
    coalesce((select created from cr),0)::numeric,
    coalesce((select collected from crp),0)::numeric,
    coalesce((select credit_out from pur),0)::numeric,
    coalesce((select paid from vp),0)::numeric,
    (select outstanding from cust)::numeric,
    (select outstanding from ven)::numeric,
    (select pending from cust),
    (select pending from ven),
    coalesce((select cash_out from sal),0)::numeric,
    coalesce((select online_out from sal),0)::numeric,
    coalesce((select advance_out from sal),0)::numeric,
    coalesce((select total_out from sal),0)::numeric,
    (select v from owed)::numeric,
    (calc.open_cash + coalesce((select cash_in from pay),0) + coalesce((select cash_in from crp),0)
      + coalesce((select cash_in from adv),0)
      - coalesce((select cash_out from pur),0) - coalesce((select cash_out from vp),0)
      - coalesce((select cash_out from sal),0))::numeric,
    (calc.open_online + coalesce((select online_in from pay),0) + coalesce((select card_in from pay),0)
      + coalesce((select online_in from crp),0)
      + coalesce((select online_in from adv),0)
      - coalesce((select online_out from pur),0) - coalesce((select online_out from vp),0)
      - coalesce((select online_out from sal),0))::numeric,
    calc.close_to_us::numeric, calc.close_by_us::numeric,
    (select present from seed),
    coalesce((select received from adv),0)::numeric,
    coalesce((select refunded from adv),0)::numeric,
    calc.open_held::numeric,
    calc.close_held::numeric,
    coalesce((select applied_in from advuse),0)::numeric
  from calc;
$$;

revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
