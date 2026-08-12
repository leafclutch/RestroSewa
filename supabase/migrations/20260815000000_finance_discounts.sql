-- =============================================================
-- DISCOUNTS ON THE FINANCE REPORT
--
-- The emailed PDF has always reported the day's discounts; the on-screen report
-- never did, because `finance_report` did not carry them — the mailer ran its
-- own `payments.discount_amount` query. Two screens reading two sources is how
-- they drift, so the figure moves into the function every other total comes from
-- and the screen, the CSV and the report all read the same number.
--
-- A DISCOUNT IS NOT A BALANCE MOVEMENT. The net amount IS the sale everywhere in
-- this app (there is no gross/net split), so nothing here touches cash, bank or
-- credit, and no closing figure changes. It is reported, not accounted — which
-- is why it needs no matching change in `finance_transactions` and why the
-- ledger reconciliation is unaffected.
--
-- Body taken from the LIVE definition (pg_get_functiondef); only the two columns,
-- the `disc` CTE and the two select items are new.
-- =============================================================

-- The return type changes, so this must be dropped rather than replaced.
drop function if exists finance_report(uuid, timestamptz, timestamptz);

create function finance_report(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(opening_cash numeric, opening_online numeric, opening_credit_to_us numeric, opening_credit_by_us numeric, sales_cash numeric, sales_online numeric, sales_card numeric, sales_credit numeric, sales_total numeric, purchases_cash numeric, purchases_online numeric, purchases_credit numeric, purchases_total numeric, customer_credit_created numeric, customer_credit_collected numeric, vendor_credit_created numeric, vendor_credit_paid numeric, customer_credit_outstanding numeric, vendor_credit_outstanding numeric, pending_customers integer, pending_vendors integer, salary_cash numeric, salary_online numeric, salary_advance numeric, salary_total numeric, salary_outstanding numeric, closing_cash numeric, closing_online numeric, closing_credit_to_us numeric, closing_credit_by_us numeric, has_opening boolean, advances_received numeric, advances_refunded numeric, opening_advances_held numeric, closing_advances_held numeric, sales_advance numeric, advances_cash numeric, advances_online numeric, refunds_cash numeric, refunds_online numeric, sales_advance_cash numeric, sales_advance_online numeric, sales_room_cash numeric, sales_room_online numeric, sales_room_card numeric, sales_room_credit numeric, sales_room_total numeric, sales_table_cash numeric, sales_table_online numeric, sales_table_card numeric, sales_table_credit numeric, sales_table_total numeric, extra_expenses_cash numeric, extra_expenses_online numeric, extra_expenses_total numeric, extra_expenses_by_category jsonb, discounts_total numeric, discounted_bills integer)
 LANGUAGE sql
 STABLE
AS $function$
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
  -- The same bills, cut by which side of the business raised them.
  paysrc as (
    select
      sum(p.cash_amount)                       filter (where in_period and is_room) room_cash,
      sum(p.online_amount)                     filter (where in_period and is_room) room_online,
      sum(coalesce(p.card_amount,0))           filter (where in_period and is_room) room_card,
      sum(coalesce(p.total_amount,p.amount))   filter (where in_period and is_room) room_total,
      sum(p.cash_amount)                       filter (where in_period and not is_room) table_cash,
      sum(p.online_amount)                     filter (where in_period and not is_room) table_online,
      sum(coalesce(p.card_amount,0))           filter (where in_period and not is_room) table_card,
      sum(coalesce(p.total_amount,p.amount))   filter (where in_period and not is_room) table_total
    from (
      select p.*,
             (p.created_at >= p_from and p.created_at < p_to) in_period,
             (p.room_stay_id is not null
               or se.room_stay_id is not null
               or se.room_id is not null
               or se.type = 'room_service') is_room
      from payments p
      left join sessions se on se.id = p.session_id
      where p.restaurant_id = p_restaurant_id
    ) p
  ),
  -- Room deposits. Signed rows: a refund is negative, so one set of sums serves
  -- money in and money back out, and the split legs are the same sums under
  -- opposite sign filters.
  adv as (
    select
      sum(a.cash_amount) filter (where a.created_at >= (select eff from seed) and a.created_at < p_from) cash_before,
      sum(a.online_amount + a.card_amount) filter (where a.created_at >= (select eff from seed) and a.created_at < p_from) online_before,
      sum(a.cash_amount) filter (where a.created_at >= p_from and a.created_at < p_to) cash_in,
      sum(a.online_amount + a.card_amount) filter (where a.created_at >= p_from and a.created_at < p_to) online_in,
      sum(a.amount) filter (where a.amount > 0 and a.created_at >= p_from and a.created_at < p_to) received,
      sum(-a.amount) filter (where a.amount < 0 and a.created_at >= p_from and a.created_at < p_to) refunded,
      -- Deposits TAKEN, split. Card rides with online: it is bank money for every
      -- balance in this app.
      sum(a.cash_amount) filter (where a.amount > 0 and a.created_at >= p_from and a.created_at < p_to) adv_cash_in,
      sum(a.online_amount + a.card_amount) filter (where a.amount > 0 and a.created_at >= p_from and a.created_at < p_to) adv_online_in,
      -- Refunds RETURNED, split and negated so they report as positive amounts.
      sum(-a.cash_amount) filter (where a.amount < 0 and a.created_at >= p_from and a.created_at < p_to) ref_cash_in,
      sum(-(a.online_amount + a.card_amount)) filter (where a.amount < 0 and a.created_at >= p_from and a.created_at < p_to) ref_online_in,
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
  -- How the applied advance behind the period's SALES was originally tendered.
  --
  -- Keyed on the PAYMENT's date (the checkout day), while the deposit rows it
  -- reads may be days older — that is the whole point of an advance.
  --
  -- A settled stay's NET advance rows equal `payments.advance_amount` by
  -- construction (a refund is negative and already netted), so the cash figure is
  -- the cash actually RETAINED, not the cash originally taken.
  --
  -- The online part is derived as `applied - cash`, and cash is clamped to
  -- [0, applied]. That makes the two halves sum to `sales_advance` always, so the
  -- Sales block cannot stop adding up.
  advsold as (
    select
      sum(least(greatest(x.stay_cash, 0), x.applied))
        filter (where x.paid_at >= p_from and x.paid_at < p_to) sales_adv_cash,
      sum(x.applied - least(greatest(x.stay_cash, 0), x.applied))
        filter (where x.paid_at >= p_from and x.paid_at < p_to) sales_adv_online
    from (
      select
        p.created_at paid_at,
        coalesce(p.advance_amount, 0) applied,
        (select coalesce(sum(a.cash_amount), 0)
           from room_advances a where a.stay_id = se.room_stay_id) stay_cash
      from payments p
      join sessions se on se.id = p.session_id
      where p.restaurant_id = p_restaurant_id
        and coalesce(p.advance_amount, 0) > 0
        and se.room_stay_id is not null
    ) x
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
  -- Credit sales, cut the same way. Same room test as `paysrc`, via the credit's
  -- own session.
  crsrc as (
    select
      sum(c.owed) filter (where c.in_period and c.is_room) room_credit,
      sum(c.owed) filter (where c.in_period and not c.is_room) table_credit
    from (
      select (c.bill_amount - c.down_payment) owed,
             (c.created_at >= p_from and c.created_at < p_to) in_period,
             (se.room_stay_id is not null
               or se.room_id is not null
               or se.type = 'room_service') is_room
      from credits c
      left join sessions se on se.id = c.session_id
      where c.restaurant_id = p_restaurant_id
    ) c
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
  -- Overheads: rent, power, water, internet. Money out, no credit leg — an
  -- expense row IS the payment (see the table's own migration).
  exp as (
    select
      sum(e.cash_amount) filter (where e.created_at >= (select eff from seed) and e.created_at < p_from) cash_before,
      sum(e.online_amount) filter (where e.created_at >= (select eff from seed) and e.created_at < p_from) online_before,
      sum(e.cash_amount) filter (where e.created_at >= p_from and e.created_at < p_to) cash_out,
      sum(e.online_amount) filter (where e.created_at >= p_from and e.created_at < p_to) online_out,
      sum(e.amount) filter (where e.created_at >= p_from and e.created_at < p_to) total_out
    from extra_expenses e where e.restaurant_id = p_restaurant_id
  ),
  -- "Where did the cash go" answered without a second round trip. Categories with
  -- no spend in the period are simply absent, so a quiet day stays short rather
  -- than printing ten zeroes. Ordered biggest-first, with the category name as a
  -- tie-break so the same period always renders in the same order.
  expcat as (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'category', t.category,
        'cash',     t.cash,
        'online',   t.online,
        'total',    t.total
      ) order by t.total desc, t.category),
      '[]'::jsonb) v
    from (
      select e.category,
             sum(e.cash_amount)   cash,
             sum(e.online_amount) online,
             sum(e.amount)        total
      from extra_expenses e
      where e.restaurant_id = p_restaurant_id
        and e.created_at >= p_from and e.created_at < p_to
      group by e.category
    ) t
  ),
  -- Money given away at the till. NOT a balance movement: the NET amount IS the
  -- sale everywhere in this app, so a discount never touches cash, bank or credit
  -- — it only explains why the sale was smaller. Reported so the owner can see
  -- what was foregone.
  disc as (
    select
      sum(coalesce(p.discount_amount,0))
        filter (where p.created_at >= p_from and p.created_at < p_to) total,
      count(*) filter (where coalesce(p.discount_amount,0) > 0.005
                         and p.created_at >= p_from and p.created_at < p_to)::int bills
    from payments p where p.restaurant_id = p_restaurant_id
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
        - coalesce((select cash_before from sal),0)
        - coalesce((select cash_before from exp),0) open_cash,
      (select online from seed) + coalesce((select online_before from pay),0) + coalesce((select online_before from crp),0)
        + coalesce((select online_before from adv),0)
        - coalesce((select online_before from pur),0) - coalesce((select online_before from vp),0)
        - coalesce((select online_before from sal),0)
        - coalesce((select online_before from exp),0) open_online,

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
      - coalesce((select cash_out from sal),0)
      - coalesce((select cash_out from exp),0))::numeric,
    (calc.open_online + coalesce((select online_in from pay),0) + coalesce((select card_in from pay),0)
      + coalesce((select online_in from crp),0)
      + coalesce((select online_in from adv),0)
      - coalesce((select online_out from pur),0) - coalesce((select online_out from vp),0)
      - coalesce((select online_out from sal),0)
      - coalesce((select online_out from exp),0))::numeric,
    calc.close_to_us::numeric, calc.close_by_us::numeric,
    (select present from seed),
    coalesce((select received from adv),0)::numeric,
    coalesce((select refunded from adv),0)::numeric,
    calc.open_held::numeric,
    calc.close_held::numeric,
    coalesce((select applied_in from advuse),0)::numeric,
    coalesce((select adv_cash_in from adv),0)::numeric,
    coalesce((select adv_online_in from adv),0)::numeric,
    coalesce((select ref_cash_in from adv),0)::numeric,
    coalesce((select ref_online_in from adv),0)::numeric,
    coalesce((select sales_adv_cash from advsold),0)::numeric,
    coalesce((select sales_adv_online from advsold),0)::numeric,
    coalesce((select room_cash from paysrc),0)::numeric,
    coalesce((select room_online from paysrc),0)::numeric,
    coalesce((select room_card from paysrc),0)::numeric,
    coalesce((select room_credit from crsrc),0)::numeric,
    coalesce((select room_total from paysrc),0)::numeric,
    coalesce((select table_cash from paysrc),0)::numeric,
    coalesce((select table_online from paysrc),0)::numeric,
    coalesce((select table_card from paysrc),0)::numeric,
    coalesce((select table_credit from crsrc),0)::numeric,
    coalesce((select table_total from paysrc),0)::numeric,
    coalesce((select cash_out from exp),0)::numeric,
    coalesce((select online_out from exp),0)::numeric,
    coalesce((select total_out from exp),0)::numeric,
    (select v from expcat),
    coalesce((select total from disc),0)::numeric,
    coalesce((select bills from disc),0)
  from calc;
$function$;

notify pgrst, 'reload schema';
