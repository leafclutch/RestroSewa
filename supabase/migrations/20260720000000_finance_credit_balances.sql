-- =============================================================
-- FINANCE — CREDIT IN THE OPENING / CLOSING BALANCE
--
-- The balance sheet tracked only Cash and Online, so the two credit positions
-- (money customers owe US, money WE owe vendors) had no opening/closing figure.
-- They were reported only as a LIVE snapshot read straight off
-- `credit_customers.balance` / `vendors.credit_balance` — which meant opening a
-- past period showed TODAY's outstanding next to that period's cash. This adds
-- both as first-class balances, evaluated AS OF the period bounds.
--
-- Credit is DERIVED, exactly like cash and stock, never stored per period:
--
--   Credit to us  (T) = Σ customer opening + Σ credit billed − Σ collected   [< T]
--   Credit by us  (T) = Σ vendor  opening  + Σ credit purchased − Σ paid     [< T]
--
-- Verified against live data before writing this: the derived figure equals the
-- stored balance for every customer account and every vendor, to the paisa. So
-- one period's closing credit IS the next period's opening credit by
-- construction — the same carry-forward property cash already had, and it needs
-- no nightly job and cannot drift.
--
-- NOTE ON WHAT WAS *NOT* WRONG: credit sales never leaked into the cash or bank
-- balance. A credit bill writes its FULL value to `payments.total_amount` but
-- only what was actually tendered into `cash_amount`/`online_amount`, and the
-- balances have always summed the tendered columns. That is the accrual model
-- and it is unchanged here.
-- =============================================================


-- ── 1. The customer-side opening anchor ───────────────────────────────────────
-- Vendors already have `opening_credit` (dues carried over from paper books, and
-- the term `reset_restaurant_finance` rebaselines onto). Customer accounts had
-- no equivalent: their balance was only ever derived from the bills. That is
-- fine today, but the finance reset DELETES `credits`/`credit_payments` while
-- KEEPING `credit_customers.balance` — so after a reset a derived figure would
-- read zero and silently forgive real debt. This is the term that carry-forward
-- stands on, mirroring vendors exactly.
alter table credit_customers
  add column if not exists opening_balance numeric(12,2) not null default 0;

-- Existing accounts derive correctly from their bills (verified), so 0 is right
-- for every row that exists today. No backfill.


-- ── 2. The reset must carry the customer balance onto that anchor ─────────────
-- Same one-line shape as the vendor carry-forward six lines below it. Without
-- this, the reset keeps `balance` but destroys the evidence for it, and every
-- derived credit figure afterwards would disagree with the Credits screen.
create or replace function reset_restaurant_finance(p_restaurant_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_before jsonb;
begin
  perform 1 from restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  v_before := restaurant_data_summary(p_restaurant_id);

  update products p
     set opening_stock = s.closing
    from stock_report(p_restaurant_id, '-infinity'::timestamptz, 'infinity'::timestamptz) s
   where s.product_id = p.id
     and p.restaurant_id = p_restaurant_id;

  update vendors
     set opening_credit = credit_balance
   where restaurant_id = p_restaurant_id;

  -- credit_customers.balance is already the outstanding figure and is not
  -- cleared below — but the bills that PROVE it are, so it now also has to be
  -- planted as the account's opening term or the derived balance loses it.
  update credit_customers
     set opening_balance = balance
   where restaurant_id = p_restaurant_id;

  delete from notifications       where restaurant_id = p_restaurant_id;
  delete from credit_payments     where restaurant_id = p_restaurant_id;
  delete from credits             where restaurant_id = p_restaurant_id;
  delete from payments            where restaurant_id = p_restaurant_id;
  delete from session_order_items
        where order_id in (select id from session_orders where restaurant_id = p_restaurant_id);
  delete from session_orders      where restaurant_id = p_restaurant_id;
  delete from sessions            where restaurant_id = p_restaurant_id;
  delete from room_charges        where restaurant_id = p_restaurant_id;
  delete from room_stays          where restaurant_id = p_restaurant_id;
  delete from purchase_items      where restaurant_id = p_restaurant_id;
  delete from purchases           where restaurant_id = p_restaurant_id;
  delete from vendor_payments     where restaurant_id = p_restaurant_id;
  delete from stock_adjustments   where restaurant_id = p_restaurant_id;
  delete from salary_payments     where restaurant_id = p_restaurant_id;
  delete from finance_openings    where restaurant_id = p_restaurant_id;

  update rooms
     set status = 'available'
   where restaurant_id = p_restaurant_id
     and status <> 'available';

  return v_before;
end;
$$;


-- ── 3. finance_report: four balances instead of two ───────────────────────────
-- Return type gains columns, so the function must be dropped rather than
-- replaced.
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
  has_opening boolean
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
  crp as (
    select
      sum(cp.amount) filter (where cp.method = 'cash'  and cp.created_at >= (select eff from seed) and cp.created_at < p_from) cash_before,
      sum(cp.amount) filter (where cp.method <> 'cash' and cp.created_at >= (select eff from seed) and cp.created_at < p_from) online_before,
      sum(cp.amount) filter (where cp.method = 'cash'  and cp.created_at >= p_from and cp.created_at < p_to) cash_in,
      sum(cp.amount) filter (where cp.method <> 'cash' and cp.created_at >= p_from and cp.created_at < p_to) online_in,
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
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= (select eff from seed) and s.created_at < p_from) cash_before,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= (select eff from seed) and s.created_at < p_from) online_before,
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= p_from and s.created_at < p_to) cash_out,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= p_from and s.created_at < p_to) online_out,
      sum(s.amount) filter (where s.created_at >= p_from and s.created_at < p_to) paid,
      sum(s.amount) filter (where s.created_at < p_from) paid_before,
      sum(s.amount) filter (where s.created_at < p_to)   paid_to
    from vendor_payments s where s.restaurant_id = p_restaurant_id
  ),
  sal as (
    select
      sum(sp.amount) filter (where sp.method = 'cash'   and sp.created_at >= (select eff from seed) and sp.created_at < p_from) cash_before,
      sum(sp.amount) filter (where sp.method = 'online' and sp.created_at >= (select eff from seed) and sp.created_at < p_from) online_before,
      sum(sp.amount) filter (where sp.method = 'cash'   and sp.created_at >= p_from and sp.created_at < p_to) cash_out,
      sum(sp.amount) filter (where sp.method = 'online' and sp.created_at >= p_from and sp.created_at < p_to) online_out,
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
        - coalesce((select cash_before from pur),0) - coalesce((select cash_before from vp),0)
        - coalesce((select cash_before from sal),0) open_cash,
      (select online from seed) + coalesce((select online_before from pay),0) + coalesce((select online_before from crp),0)
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
        - coalesce((select paid_to from vp),0) close_by_us
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
      - coalesce((select cash_out from pur),0) - coalesce((select cash_out from vp),0)
      - coalesce((select cash_out from sal),0))::numeric,
    (calc.open_online + coalesce((select online_in from pay),0) + coalesce((select card_in from pay),0)
      + coalesce((select online_in from crp),0)
      - coalesce((select online_out from pur),0) - coalesce((select online_out from vp),0)
      - coalesce((select online_out from sal),0))::numeric,
    calc.close_to_us::numeric, calc.close_by_us::numeric,
    (select present from seed)
  from calc;
$$;

revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;


-- ── 4. The transaction ledger ─────────────────────────────────────────────────
-- Every movement in the period, in one list, each carrying what it did to all
-- four balances and what those balances stood at afterwards. "Balance before" is
-- simply the previous row's after, so it is never stored twice and the two can
-- never disagree.
--
-- The running totals START from the period's opening balances, which means the
-- last row's `*_after` must equal the report's closing figures exactly. That is
-- the reconciliation property worth protecting: if a movement is ever added to
-- one of these functions and not the other, the ledger stops landing on the
-- closing balance and the bug is visible on screen rather than silent.
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
    -- credit raised against the customer.
    select
      p.created_at occurred_at,
      'sale'::text kind,
      (select cc.name from credits c
         join credit_customers cc on cc.id = c.customer_id
        where c.payment_id = p.id limit 1) party,
      case
        when coalesce(p.total_amount,p.amount) - (p.cash_amount + p.online_amount + coalesce(p.card_amount,0)) > 0.005
          then case when p.cash_amount + p.online_amount + coalesce(p.card_amount,0) > 0.005
                    then 'partial' else 'credit' end
        when p.cash_amount > 0.005 and p.online_amount + coalesce(p.card_amount,0) > 0.005 then 'mixed'
        when p.online_amount > 0.005 then 'online'
        when coalesce(p.card_amount,0) > 0.005 then 'card'
        else 'cash'
      end::text method,
      coalesce(p.total_amount,p.amount) amount,
      case when p.bill_number is not null then 'Bill #' || p.bill_number else null end::text reference,
      p.cash_amount cash_delta,
      (p.online_amount + coalesce(p.card_amount,0)) online_delta,
      (coalesce(p.total_amount,p.amount) - (p.cash_amount + p.online_amount + coalesce(p.card_amount,0))) credit_to_us_delta,
      0::numeric credit_by_us_delta
    from payments p
    where p.restaurant_id = p_restaurant_id
      and p.created_at >= p_from and p.created_at < p_to

    union all

    -- Money received against an existing debt: cash in, receivable down. NOT new
    -- revenue — the bill was already counted when it was raised (accrual).
    select
      cp.created_at, 'credit_repayment',
      cc.name,
      cp.method::text,
      cp.amount,
      cc.customer_code,
      case when cp.method = 'cash' then cp.amount else 0 end,
      case when cp.method <> 'cash' then cp.amount else 0 end,
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
      vp.method::text,
      vp.amount,
      v.vendor_code,
      case when vp.method = 'cash' then -vp.amount else 0 end,
      case when vp.method <> 'cash' then -vp.amount else 0 end,
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
      sp.method::text,
      sp.amount,
      to_char(sp.salary_month, 'Mon YYYY'),
      case when sp.method = 'cash' then -sp.amount else 0 end,
      case when sp.method <> 'cash' then -sp.amount else 0 end,
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
    -- short by exactly the carried amount. (Found by the reconciliation check:
    -- two live restaurants were off by precisely their vendors' opening credit.)
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
