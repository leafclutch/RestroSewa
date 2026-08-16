-- =============================================================
-- DISCOUNT WHILE CLEARING CUSTOMER CREDIT & FINANCE INTEGRATION
--
-- Adds optional discount tracking on credit repayments (credit_payments).
-- Gated behind Discount PIN in the server action. When a customer settles
-- their credit with a discount (e.g. balance 310, received 300, discount 10),
-- total credit cleared is 310, cash/online received is 300, and discount is 10.
-- Updates finance_report and finance_transactions so credit clearance discounts
-- are fully reflected in Finance discount metrics and customer debt clearance.
-- =============================================================

alter table credit_payments
  add column if not exists discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  add column if not exists discount_by uuid references restaurant_users(id) on delete set null;

drop function if exists record_credit_payment(uuid, uuid, numeric, text, text, uuid);
drop function if exists record_credit_payment(uuid, uuid, numeric, text, text, uuid, numeric, numeric);
drop function if exists record_credit_payment(uuid, uuid, numeric, text, text, uuid, numeric, numeric, numeric, uuid);

create or replace function public.record_credit_payment(
  p_restaurant_id  uuid,
  p_customer_id    uuid,
  p_amount         numeric,
  p_method         text,
  p_notes          text,
  p_received_by    uuid,
  p_cash           numeric default null,
  p_online         numeric default null,
  p_discount       numeric default 0,
  p_discount_by    uuid default null
)
 returns credit_customers
 language plpgsql
as $function$
declare
  v_cust          credit_customers;
  v_discount      numeric;
  v_received      numeric;
  v_total_cleared numeric;
  v_remaining     numeric;
  v_bill          credits;
  v_take          numeric;
  v_cash          numeric;
  v_online        numeric;
begin
  -- Lock customer row to serialize concurrent repayments
  select * into v_cust
    from credit_customers
   where id = p_customer_id
     and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  v_discount := greatest(coalesce(p_discount, 0), 0);
  v_received := greatest(coalesce(p_amount, 0), 0);

  if (v_received + v_discount) <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if v_cust.balance <= 0 then
    raise exception 'NOTHING_OWED';
  end if;

  -- Cannot clear more than customer's balance
  if (v_received + v_discount) > v_cust.balance + 0.005 then
    raise exception 'AMOUNT_EXCEEDS_BALANCE';
  end if;

  v_total_cleared := least(v_received + v_discount, v_cust.balance);

  -- Resolve tender split for the RECEIVED amount
  if v_received <= 0 then
    v_cash := 0;
    v_online := 0;
  elsif p_cash is null and p_online is null then
    v_cash   := case when p_method = 'cash' then v_received else 0 end;
    v_online := case when p_method = 'cash' then 0 else v_received end;
  else
    v_cash   := coalesce(p_cash, 0);
    v_online := coalesce(p_online, 0);
    if v_cash < 0 or v_online < 0 then
      raise exception 'INVALID_AMOUNT';
    end if;
    if abs((v_cash + v_online) - v_received) > 0.005 then
      raise exception 'SPLIT_MISMATCH';
    end if;
    -- Absorb sub-paisa rounding into cash so cash + online = amount EXACTLY
    v_cash := v_received - v_online;
  end if;

  insert into credit_payments (
    customer_id, credit_id, restaurant_id, amount, discount_amount, method,
    cash_amount, online_amount, notes, received_by, discount_by
  ) values (
    p_customer_id, null, p_restaurant_id, v_received, v_discount, p_method::payment_method,
    v_cash, v_online, nullif(btrim(coalesce(p_notes, '')), ''), p_received_by,
    case when v_discount > 0 then p_discount_by else null end
  );

  -- Allocate total cleared (received + discount) across open bills, oldest first
  v_remaining := v_total_cleared;
  for v_bill in
    select * from credits
     where customer_id = p_customer_id
       and status <> 'fully_paid'
     order by created_at, seq_no
     for update
  loop
    exit when v_remaining <= 0;

    v_take := least(v_remaining, v_bill.bill_amount - v_bill.paid_amount);
    if v_take <= 0 then
      continue;
    end if;

    update credits
       set paid_amount = paid_amount + v_take,
           status = case when bill_amount - (paid_amount + v_take) <= 0.005
                         then 'fully_paid' else 'partially_paid' end,
           settled_at = case when bill_amount - (paid_amount + v_take) <= 0.005
                             then now() else null end
     where id = v_bill.id;

    v_remaining := v_remaining - v_take;
  end loop;

  update credit_customers
     set balance = balance - v_total_cleared
   where id = p_customer_id
  returning * into v_cust;

  return v_cust;
end;
$function$;

revoke all on function record_credit_payment(uuid, uuid, numeric, text, text, uuid, numeric, numeric, numeric, uuid) from public;
grant execute on function record_credit_payment(uuid, uuid, numeric, text, text, uuid, numeric, numeric, numeric, uuid) to service_role;


-- ── 2. finance_report with Credit Clearance Discounts ─────────

drop function if exists finance_transactions(uuid, timestamptz, timestamptz);
drop function if exists finance_report(uuid, timestamptz, timestamptz);

create function finance_report(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(
   opening_cash numeric, opening_online numeric, opening_credit_to_us numeric, opening_credit_by_us numeric,
   sales_cash numeric, sales_online numeric, sales_card numeric, sales_credit numeric, sales_total numeric,
   purchases_cash numeric, purchases_online numeric, purchases_credit numeric, purchases_total numeric,
   customer_credit_created numeric, customer_credit_collected numeric, vendor_credit_created numeric, vendor_credit_paid numeric,
   customer_credit_outstanding numeric, vendor_credit_outstanding numeric, pending_customers integer, pending_vendors integer,
   salary_cash numeric, salary_online numeric, salary_advance numeric, salary_total numeric, salary_outstanding numeric,
   closing_cash numeric, closing_online numeric, closing_credit_to_us numeric, closing_credit_by_us numeric,
   has_opening boolean, advances_received numeric, advances_refunded numeric, opening_advances_held numeric, closing_advances_held numeric,
   sales_advance numeric, advances_cash numeric, advances_online numeric, refunds_cash numeric, refunds_online numeric,
   sales_advance_cash numeric, sales_advance_online numeric, sales_room_cash numeric, sales_room_online numeric, sales_room_card numeric,
   sales_room_credit numeric, sales_room_total numeric, sales_table_cash numeric, sales_table_online numeric, sales_table_card numeric,
   sales_table_credit numeric, sales_table_total numeric, extra_expenses_cash numeric, extra_expenses_online numeric, extra_expenses_total numeric,
   extra_expenses_by_category jsonb, discounts_total numeric, discounted_bills integer, customer_credit_discounted numeric, credit_discounts_total numeric
 )
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
      -- Debt FORGIVEN in the period. Reported beside the money so "collected" stays
      -- what actually arrived; the two together are what the customer stopped owing.
      sum(coalesce(cp.discount_amount, 0)) filter (where cp.created_at >= p_from and cp.created_at < p_to) discounted,
      -- Credit-to-us legs. These have NO `eff` floor on purpose: the cash seed
      -- replaces pre-books cash movement, but a debt raised before the books
      -- opened is still owed today, and the customer's own opening term carries
      -- it. Flooring these would forgive it.
      --
      -- `+ discount_amount` is load-bearing: a write-off clears debt without moving
      -- money, so a leg counting only `amount` would leave the forgiven part sitting
      -- in the closing balance forever. The ledger's credit delta is
      -- `-(amount + discount)` for the same reason — the two must move together.
      sum(cp.amount + coalesce(cp.discount_amount, 0)) filter (where cp.created_at < p_from) collected_before,
      sum(cp.amount + coalesce(cp.discount_amount, 0)) filter (where cp.created_at < p_to)   collected_to
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
  -- Money given away, from the TWO places it can be given: at the till (a bill
  -- discounted at payment) and at credit clearance (debt forgiven when a customer
  -- settles). Neither is a balance movement here — the till discount never entered
  -- `sales_total` in the first place (the NET amount IS the sale everywhere in this
  -- app), and the credit write-off moves the receivable via `crp`, not this CTE.
  -- Reported so the owner can see what was foregone.
  --
  -- `credit_total` is broken out because the two are NOT interchangeable: a till
  -- discount reduced a sale that was never booked at gross, while a credit write-off
  -- forgives a sale already booked in full on an earlier day. `total` is the sum of
  -- both, so a caller wanting till-only must subtract `credit_total`.
  disc as (
    select
      coalesce(sum(d.discount_amount), 0) total,
      count(*)::int bills,
      coalesce(sum(case when d.src = 'credit' then d.discount_amount else 0 end), 0) credit_total
    from (
      select discount_amount, created_at, 'payment'::text src
        from payments
       where restaurant_id = p_restaurant_id
         and coalesce(discount_amount, 0) > 0.005
      union all
      select discount_amount, created_at, 'credit'::text src
        from credit_payments
       where restaurant_id = p_restaurant_id
         and coalesce(discount_amount, 0) > 0.005
    ) d
    where d.created_at >= p_from and d.created_at < p_to
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
    coalesce((select bills from disc),0),
    coalesce((select discounted from crp),0)::numeric,
    coalesce((select credit_total from disc),0)::numeric
  from calc;
$function$;

revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;


-- ── 3. finance_transactions with Credit Repayment Discounts ───

create function finance_transactions(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(occurred_at timestamp with time zone, kind text, party text, method text, amount numeric, reference text, cash_delta numeric, online_delta numeric, credit_to_us_delta numeric, credit_by_us_delta numeric, cash_after numeric, online_after numeric, credit_to_us_after numeric, credit_by_us_after numeric, source text, source_label text)
 LANGUAGE sql
 STABLE
AS $function$
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
      0::numeric credit_by_us_delta,
      -- WHICH SIDE OF THE BUSINESS raised this bill, and which table or room.
      --
      -- The room test is IDENTICAL to `paysrc` in finance_report. If the two ever
      -- drift apart the ledger and the Sales block would classify the same bill
      -- differently — exactly the sort of quiet contradiction nobody reports until
      -- it has been wrong for a month. Three markers, because `room_id` survives a
      -- session transfer while a type set at creation might not.
      case
        when p.room_stay_id is not null or se.room_stay_id is not null
          or se.room_id is not null or se.type = 'room_service' then 'room'
        when se.walk_in_no is not null then 'walkin'
        when se.table_id is not null then 'table'
        else null
      end::text source,
      case
        when p.room_stay_id is not null or se.room_stay_id is not null
          or se.room_id is not null or se.type = 'room_service'
          then 'Room ' || coalesce(r.number, '—')
        when se.walk_in_no is not null then 'Walk-in ' || se.walk_in_no
        when se.table_id is not null then 'Table ' || coalesce(t.number, '—')
        else null
      end::text source_label
    from payments p
    left join sessions se on se.id = p.session_id
    -- The stay can hang off the PAYMENT or the SESSION, and the room can be
    -- reached through either; coalesce covers both. Every join is to a primary
    -- key, so none of them can multiply a payment into two ledger rows.
    left join room_stays rs on rs.id = coalesce(p.room_stay_id, se.room_stay_id)
    left join rooms r on r.id = coalesce(se.room_id, rs.room_id)
    left join restaurant_tables t on t.id = se.table_id
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
      0::numeric,
      null::text, null::text
    from room_advances a
    join room_stays rs on rs.id = a.stay_id
    left join rooms r on r.id = rs.room_id
    where a.restaurant_id = p_restaurant_id
      and a.created_at >= p_from and a.created_at < p_to

    union all

    -- Money received against an existing debt: cash in, receivable down. NOT new
    -- revenue — the bill was already counted when it was raised (accrual).
    --
    -- A clearance may also FORGIVE part of the debt. The cash and online legs carry
    -- only what actually arrived, but the receivable falls by money + discount —
    -- otherwise the forgiven part would sit in the closing credit balance forever.
    -- `finance_report`'s `crp` legs use the same `amount + discount_amount`; if one
    -- moves without the other, `opening + Σ deltas == closing` breaks on the credit
    -- leg alone and nothing else fails.
    select
      cp.created_at, 'credit_repayment',
      cc.name,
      case when cp.cash_amount > 0.005 and cp.online_amount > 0.005 then 'mixed' else cp.method::text end,
      cp.amount,
      cc.customer_code,
      cp.cash_amount,
      cp.online_amount,
      -(cp.amount + coalesce(cp.discount_amount, 0)),
      0::numeric,
      null::text,
      -- The reference column is free on this branch (a repayment has no code of its
      -- own), so it names the write-off rather than leaving the row reading as a
      -- payment that cleared more than it collected.
      case when coalesce(cp.discount_amount, 0) > 0.005
           then 'Discount ₹' || trim(to_char(cp.discount_amount, 'FM999,999,990.00'))
           else null end
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
      pu.credit_amount,
      null::text, null::text
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
      -vp.amount,
      null::text, null::text
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
      0::numeric,
      null::text, null::text
    from salary_payments sp
    left join restaurant_users ru on ru.id = sp.restaurant_user_id
    where sp.restaurant_id = p_restaurant_id
      and sp.created_at >= p_from and sp.created_at < p_to

    union all

    -- An overhead. `party` carries the category so the ledger reads "Electricity"
    -- where a purchase would read the vendor's name; the note becomes the
    -- reference, which is where a bill number or purchase code sits on other
    -- rows. `initcap` matches the labels in lib/expenses.ts by construction —
    -- the category keys are deliberately single words so the two cannot drift.
    select
      e.created_at,
      'extra_expense',
      initcap(e.category),
      e.payment_method::text,
      e.amount,
      nullif(e.note, ''),
      -e.cash_amount,
      -e.online_amount,
      0::numeric,
      0::numeric,
      null::text, null::text
    from extra_expenses e
    where e.restaurant_id = p_restaurant_id
      and e.created_at >= p_from and e.created_at < p_to

    union all

    -- An account OPENED during the period carrying a balance from paper books.
    -- No money moves, but the debt is real from that moment and it lands in the
    -- closing balance — so without these two branches the running total falls
    -- short by exactly the carried amount.
    select
      v.created_at, 'vendor_opening',
      v.name, 'credit'::text, v.opening_credit, v.vendor_code,
      0::numeric, 0::numeric, 0::numeric, v.opening_credit,
      null::text, null::text
    from vendors v
    where v.restaurant_id = p_restaurant_id
      and v.opening_credit > 0
      and v.created_at >= p_from and v.created_at < p_to

    union all

    select
      cc.created_at, 'customer_opening',
      cc.name, 'credit'::text, cc.opening_balance, cc.customer_code,
      0::numeric, 0::numeric, cc.opening_balance, 0::numeric,
      null::text, null::text
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
    ((select obu from opening) + sum(m.credit_by_us_delta) over w)::numeric,
    m.source, m.source_label
  from moves m
  -- `occurred_at` alone is not a total order — two movements can share an
  -- instant — so the running balance would be non-deterministic without a
  -- tie-break. Ordering the frame by (time, kind, reference) makes every read
  -- of the same period produce the same ledger.
  window w as (order by m.occurred_at, m.kind, m.reference
               rows between unbounded preceding and current row)
  order by m.occurred_at desc, m.kind, m.reference;
$function$;

revoke all on function finance_transactions(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_transactions(uuid, timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
