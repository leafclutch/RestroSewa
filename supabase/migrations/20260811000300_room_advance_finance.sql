-- =============================================================
-- FINANCE — ADVANCES HELD, THE FIFTH BALANCE
--
-- A deposit raises cash on the day it is taken while the SALE books later, so
-- without a term of its own the report shows cash appearing from nowhere. It is
-- a liability — guests' money sitting in the till — and it is derived exactly
-- like the two credit balances:
--
--   Advances held (T) = Σ room_advances.amount [< T] − Σ payments.advance_amount [< T]
--
-- Refunds need no term of their own: they are negative rows and every sum below
-- already carries them.
--
-- SALES ARE UNTOUCHED. They read `payments`, and the whole bill still books at
-- checkout. Only the cash/bank legs gain a source.
--
-- Both bodies below are the CURRENT LIVE definitions, dumped from the database
-- rather than copied from 20260720000000 — the live ones had already moved on
-- (the mixed-payments migration replaced `method = 'cash'` filters with the
-- cash_amount/online_amount columns in crp, vp and sal). Copying the older file
-- would have silently reverted that.
-- =============================================================

-- Return type gains columns, so the function must be dropped rather than replaced.
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
  -- Appended at the END so any positional reader of the old shape keeps working.
  advances_received numeric, advances_refunded numeric,
  opening_advances_held numeric, closing_advances_held numeric
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
      -- Cash/bank legs, floored on the opening seed exactly like `pay`, because a
      -- deposit taken before the books opened is already inside the seed figure.
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
  -- applied to a bill.
  advuse as (
    select
      sum(p.advance_amount) filter (where p.created_at < p_from) applied_before,
      sum(p.advance_amount) filter (where p.created_at < p_to)   applied_to
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
    calc.close_held::numeric
  from calc;
$$;

revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;


-- ── The ledger ────────────────────────────────────────────────────────────────
create or replace function finance_transactions(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  occurred_at timestamptz,
  kind text,
  party text,
  method text,
  amount numeric,
  reference text,
  cash_delta numeric, online_delta numeric,
  credit_to_us_delta numeric, credit_by_us_delta numeric,
  cash_after numeric, online_after numeric,
  credit_to_us_after numeric, credit_by_us_after numeric
)
language sql stable as $$
  with
  opening as (
    select opening_cash oc, opening_online oo,
           opening_credit_to_us otu, opening_credit_by_us obu
    from finance_report(p_restaurant_id, p_from, p_to)
  ),

  moves as (
    -- A bill. The tendered split is real money; the gap up to the bill total is
    -- credit raised against the customer — EXCEPT for anything already settled by
    -- a room deposit, which is money we took on an earlier day. Without the
    -- advance term here, a prepaid bill reads as a credit sale and the receivable
    -- climbs by a debt nobody owes.
    select
      p.created_at occurred_at,
      'sale'::text kind,
      (select cc.name from credits c
         join credit_customers cc on cc.id = c.customer_id
        where c.payment_id = p.id limit 1) party,
      case
        when coalesce(p.total_amount,p.amount) - (p.cash_amount + p.online_amount + coalesce(p.card_amount,0) + coalesce(p.advance_amount,0)) > 0.005
          then case when p.cash_amount + p.online_amount + coalesce(p.card_amount,0) + coalesce(p.advance_amount,0) > 0.005
                    then 'partial' else 'credit' end
        when coalesce(p.advance_amount,0) > 0.005
             and p.cash_amount + p.online_amount + coalesce(p.card_amount,0) <= 0.005 then 'advance'
        when p.cash_amount > 0.005 and p.online_amount + coalesce(p.card_amount,0) > 0.005 then 'mixed'
        when p.online_amount > 0.005 then 'online'
        when coalesce(p.card_amount,0) > 0.005 then 'card'
        else 'cash'
      end::text method,
      coalesce(p.total_amount,p.amount) amount,
      case when p.bill_number is not null then 'Bill #' || p.bill_number else null end::text reference,
      p.cash_amount cash_delta,
      (p.online_amount + coalesce(p.card_amount,0)) online_delta,
      (coalesce(p.total_amount,p.amount) - (p.cash_amount + p.online_amount + coalesce(p.card_amount,0) + coalesce(p.advance_amount,0))) credit_to_us_delta,
      0::numeric credit_by_us_delta
    from payments p
    where p.restaurant_id = p_restaurant_id
      and p.created_at >= p_from and p.created_at < p_to

    union all

    -- A room deposit taken, or (negative) returned. Real money, no sale, no credit
    -- leg — the sale books in full when the guest checks out. The signs mean one
    -- branch serves both directions.
    select
      a.created_at, 'room_advance',
      rs.guest_name,
      a.method::text,
      a.amount,
      'Room ' || coalesce(r.number, '—'),
      a.cash_amount,
      (a.online_amount + a.card_amount),
      0::numeric,
      0::numeric
    from room_advances a
    join room_stays rs on rs.id = a.stay_id
    left join rooms r on r.id = rs.room_id
    where a.restaurant_id = p_restaurant_id
      and a.created_at >= p_from and a.created_at < p_to

    union all

    -- Money received against an existing debt: cash in, receivable down. NOT new
    -- revenue — the bill was already counted when it was raised (accrual).
    select
      cp.created_at, 'credit_repayment',
      cc.name,
      case when cp.cash_amount > 0.005 and cp.online_amount > 0.005 then 'mixed' else cp.method::text end,
      cp.amount,
      cc.customer_code,
      cp.cash_amount,
      cp.online_amount,
      -cp.amount,
      0::numeric
    from credit_payments cp
    left join credit_customers cc on cc.id = cp.customer_id
    where cp.restaurant_id = p_restaurant_id
      and cp.created_at >= p_from and cp.created_at < p_to

    union all

    -- A supplier bill. Only the settled part leaves the till; the rest is a
    -- payable.
    select
      pu.created_at, 'purchase',
      v.name,
      pu.payment_method::text,
      pu.total_amount,
      pu.purchase_code,
      -pu.cash_amount,
      -pu.online_amount,
      0::numeric,
      pu.credit_amount
    from purchases pu
    left join vendors v on v.id = pu.vendor_id
    where pu.restaurant_id = p_restaurant_id
      and pu.created_at >= p_from and pu.created_at < p_to

    union all

    -- Paying a supplier down: money out AND the payable falls.
    select
      vp.created_at, 'vendor_payment',
      v.name,
      case when vp.cash_amount > 0.005 and vp.online_amount > 0.005 then 'mixed' else vp.method::text end,
      vp.amount,
      v.vendor_code,
      -vp.cash_amount,
      -vp.online_amount,
      0::numeric,
      -vp.amount
    from vendor_payments vp
    left join vendors v on v.id = vp.vendor_id
    where vp.restaurant_id = p_restaurant_id
      and vp.created_at >= p_from and vp.created_at < p_to

    union all

    -- Wages. Money out, no credit leg — payroll's own liability is reported
    -- separately and is not a vendor-style payable.
    select
      sp.created_at,
      case when sp.kind = 'advance' then 'salary_advance' else 'salary' end,
      ru.display_name,
      case when sp.cash_amount > 0.005 and sp.online_amount > 0.005 then 'mixed' else sp.method::text end,
      sp.amount,
      to_char(sp.salary_month, 'Mon YYYY'),
      -sp.cash_amount,
      -sp.online_amount,
      0::numeric,
      0::numeric
    from salary_payments sp
    left join restaurant_users ru on ru.id = sp.restaurant_user_id
    where sp.restaurant_id = p_restaurant_id
      and sp.created_at >= p_from and sp.created_at < p_to

    union all

    -- An account OPENED during the period carrying a balance from paper books.
    -- No money moves, but the debt is real from that moment and it lands in the
    -- closing balance — so without these two branches the running total falls
    -- short by exactly the carried amount.
    select
      v.created_at, 'vendor_opening',
      v.name, 'credit'::text, v.opening_credit, v.vendor_code,
      0::numeric, 0::numeric, 0::numeric, v.opening_credit
    from vendors v
    where v.restaurant_id = p_restaurant_id
      and v.opening_credit > 0
      and v.created_at >= p_from and v.created_at < p_to

    union all

    select
      cc.created_at, 'customer_opening',
      cc.name, 'credit'::text, cc.opening_balance, cc.customer_code,
      0::numeric, 0::numeric, cc.opening_balance, 0::numeric
    from credit_customers cc
    where cc.restaurant_id = p_restaurant_id
      and cc.opening_balance > 0
      and cc.created_at >= p_from and cc.created_at < p_to
  )

  select
    m.occurred_at, m.kind, m.party, m.method, m.amount, m.reference,
    m.cash_delta, m.online_delta, m.credit_to_us_delta, m.credit_by_us_delta,
    ((select oc  from opening) + sum(m.cash_delta)         over w)::numeric,
    ((select oo  from opening) + sum(m.online_delta)       over w)::numeric,
    ((select otu from opening) + sum(m.credit_to_us_delta) over w)::numeric,
    ((select obu from opening) + sum(m.credit_by_us_delta) over w)::numeric
  from moves m
  -- `occurred_at` alone is not a total order — two movements can share an
  -- instant — so the running balance would be non-deterministic without a
  -- tie-break. Ordering the frame by (time, kind, reference) makes every read
  -- of the same period produce the same ledger.
  window w as (order by m.occurred_at, m.kind, m.reference
               rows between unbounded preceding and current row)
  order by m.occurred_at desc, m.kind, m.reference;
$$;

revoke all on function finance_transactions(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_transactions(uuid, timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
