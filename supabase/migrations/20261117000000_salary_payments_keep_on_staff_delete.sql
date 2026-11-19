-- =============================================================
-- SALARY PAYMENTS SURVIVE A STAFF DELETE
--
-- Deleting a staff member (superadmin "Delete" hard-deletes restaurant_users)
-- cascaded into salary_payments, wiping every advance / salary / rota wage ever
-- paid to them. Finance sums salary_payments by restaurant, so that cash —
-- which really left the business — "came back" into the balance.
--
-- Now:
--   • each payment carries a `staff_name` snapshot (backfilled, then filled on
--     insert by trigger), so history can still name who was paid;
--   • restaurant_user_id is nullable and ON DELETE SET NULL instead of CASCADE;
--   • finance_transactions labels such rows "<name> (deleted)".
--
-- finance_transactions below is the live definition from
-- 20261005100000_credit_charges.sql with only the wages `party` changed.
-- Payments already cascade-deleted before this migration cannot be recovered.
-- =============================================================

-- ── 1. Name snapshot ──────────────────────────────────────────────────────────
alter table salary_payments add column if not exists staff_name text;

update salary_payments sp
   set staff_name = ru.display_name
  from restaurant_users ru
 where ru.id = sp.restaurant_user_id
   and sp.staff_name is null;

create or replace function salary_payments_fill_staff_name()
returns trigger
language plpgsql
as $$
begin
  if new.staff_name is null and new.restaurant_user_id is not null then
    select ru.display_name into new.staff_name
      from restaurant_users ru
     where ru.id = new.restaurant_user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists salary_payments_fill_staff_name_trg on salary_payments;
create trigger salary_payments_fill_staff_name_trg
  before insert on salary_payments
  for each row execute function salary_payments_fill_staff_name();


-- ── 2. Stop the cascade ───────────────────────────────────────────────────────
alter table salary_payments alter column restaurant_user_id drop not null;

do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.conrelid = 'public.salary_payments'::regclass
       and con.contype = 'f'
       and con.confrelid = 'public.restaurant_users'::regclass
       and att.attname = 'restaurant_user_id'
  loop
    execute format('alter table salary_payments drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table salary_payments
  add constraint salary_payments_restaurant_user_id_fkey
  foreign key (restaurant_user_id) references restaurant_users(id) on delete set null;


-- ── 3. Finance ledger names deleted staff ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_transactions(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
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
      coalesce(ru.display_name, sp.staff_name || ' (deleted)'),
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

    -- Extra income — the mirror of `extra_expense`, positive instead of negative
    -- and with no category (this table has none): `party` carries the free-text
    -- description instead, exactly where a purchase carries the vendor's name.
    -- No credit leg, for the same reason an expense row has none: the row IS the
    -- money, the day it arrived.
    select
      i.created_at,
      'extra_income',
      nullif(i.description, ''),
      i.payment_method::text,
      i.amount,
      null::text,
      i.cash_amount,
      (i.online_amount + i.card_amount),
      0::numeric,
      0::numeric,
      null::text, null::text
    from extra_income i
    where i.restaurant_id = p_restaurant_id
      and i.created_at >= p_from and i.created_at < p_to

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

    union all

    -- A charge added to a customer's account by hand — an old or forgotten debt.
    -- Like an opening balance it moves no money and is not a sale (so it has no
    -- `payments` row and the 'sale' branch never sees it), but the receivable rises
    -- by it — without this branch the ledger's running credit-to-us total would fall
    -- short of finance_report's closing figure by exactly the charge.
    select
      c.created_at, 'customer_charge',
      cc.name, 'credit'::text, c.bill_amount, c.credit_number,
      0::numeric, 0::numeric, c.bill_amount, 0::numeric,
      null::text, null::text
    from credits c
    join credit_customers cc on cc.id = c.customer_id
    where c.restaurant_id = p_restaurant_id
      and c.kind = 'charge'
      and c.created_at >= p_from and c.created_at < p_to
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
  window w as (order by m.occurred_at, m.kind, m.reference
               rows between unbounded preceding and current row)
  order by m.occurred_at desc, m.kind, m.reference;
$function$;
