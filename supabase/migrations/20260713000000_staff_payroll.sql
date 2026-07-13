-- =============================================================
-- STAFF PAYROLL
--
-- Built on the staff the Super Admin already creates. There is NO employee table
-- here — `restaurant_users` IS the employee record, and payroll hangs off it.
--
-- Like Stock and Finance before it, payroll STATE is derived, never stored:
--
--   salary for a month  →  the newest salary revision effective on or before it
--   paid for a month    →  sum(salary_payments for that month)
--   remaining           →  salary − paid
--   status              →  unpaid | partial | paid, read off those two numbers
--
-- No `status` column, no `remaining` column, no month-end job. A status column
-- would be a second copy of a fact the payments already state, and the two would
-- eventually disagree. Nothing here can disagree with itself.
--
-- WHY SALARY IS EFFECTIVE-DATED (staff_salaries, not a column on the profile)
-- A plain `monthly_salary` column would rewrite HISTORY on every raise. Pay Ram
-- ₹25,000 for July, then raise him to ₹30,000 in September, and July silently
-- flips from "Paid" to "Partially Paid — ₹5,000 remaining". A salary is a fact
-- about a PERIOD, so it is stored as dated revisions and every month is settled
-- against the salary that was actually in force for it. A raise changes the
-- future; it cannot reach back into a month you have already paid and closed.
-- =============================================================

-- ── The payroll profile — one row per staff member ────────────────────────────
-- Only what payroll adds to a person. Their name, title, role and status all
-- still live on `restaurant_users`; none of it is copied here.
create table if not exists staff_payroll (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  -- UNIQUE is what forbids a second payroll record for the same person.
  restaurant_user_id uuid not null unique references restaurant_users(id) on delete cascade,
  -- Monthly only today. A check constraint rather than a bare text column, so
  -- adding 'daily' or 'hourly' later is a deliberate migration, not a typo.
  salary_type        text not null default 'monthly' check (salary_type in ('monthly')),
  joining_date       date not null,
  created_by         uuid references restaurant_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists staff_payroll_restaurant_idx on staff_payroll(restaurant_id);


-- ── Salary revisions ──────────────────────────────────────────────────────────
-- The salary in force from `effective_from` until the next revision supersedes
-- it. The current salary is simply the latest row.
create table if not exists staff_salaries (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  monthly_salary     numeric(12,2) not null check (monthly_salary >= 0),
  -- Always the 1st of a month: a salary applies to whole months, and pinning it
  -- to the 1st means "the salary for month M" is a plain `<=` comparison.
  effective_from     date not null,
  created_by         uuid references restaurant_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint staff_salaries_month_start
    check (effective_from = date_trunc('month', effective_from)::date),
  -- Re-setting the salary for a month you have already set REPLACES it (upsert
  -- below) rather than stacking two revisions on the same month.
  constraint staff_salaries_user_month_key unique (restaurant_user_id, effective_from)
);

create index if not exists staff_salaries_lookup_idx
  on staff_salaries(restaurant_user_id, effective_from desc);


-- ── Payments — advances and settlements alike ─────────────────────────────────
-- One table, not two. An advance and a final payment differ only in WHEN they
-- were handed over relative to the month; both are money leaving the business
-- against the same month's salary, and both must reduce the same "remaining".
-- Splitting them into two tables would mean summing two places to answer one
-- question, and one day the two sums would disagree.
create table if not exists salary_payments (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  -- The month this money SETTLES (1st of it) — not the day it was handed over.
  -- An advance for July paid on 5 July and the balance paid on 2 August both
  -- belong to July's payroll, while both hit the cash balance on the day they
  -- were actually paid. Keeping `salary_month` and `created_at` separate is what
  -- lets payroll and finance each be right.
  salary_month       date not null,
  amount             numeric(12,2) not null check (amount > 0),
  kind               text not null check (kind in ('advance', 'salary')),
  -- Real money out the door, so only the two ways it can actually leave.
  -- `credit` would mean "we didn't pay them", which is the absence of a payment.
  method             payment_method not null check (method in ('cash', 'online')),
  notes              text,
  paid_by            uuid references restaurant_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint salary_payments_month_start
    check (salary_month = date_trunc('month', salary_month)::date)
);

-- Finance reads by restaurant + when the money moved; payroll reads by person +
-- which month it settles. One index each.
create index if not exists salary_payments_finance_idx
  on salary_payments(restaurant_id, created_at);
create index if not exists salary_payments_payroll_idx
  on salary_payments(restaurant_user_id, salary_month);

-- Deny-by-default, exactly like every other table here: RLS on, no policies. The
-- browser never reads these directly — only the permission-checked server
-- actions, through the service role.
alter table staff_payroll   enable row level security;
alter table staff_salaries  enable row level security;
alter table salary_payments enable row level security;


-- ── Set (or revise) a staff member's salary ───────────────────────────────────
-- Creates the payroll profile on first use, then upserts the revision for the
-- chosen month. One transaction, so a staff member can never end up with a
-- salary revision but no profile.
create or replace function set_staff_salary(
  p_restaurant_id  uuid,
  p_staff_id       uuid,
  p_monthly_salary numeric,
  p_joining_date   date,
  p_effective_from date,
  p_by             uuid
)
returns void
language plpgsql
as $$
declare
  v_month date;
begin
  if p_monthly_salary is null or p_monthly_salary < 0 then
    raise exception 'INVALID_SALARY';
  end if;
  if p_joining_date is null then
    raise exception 'JOINING_DATE_REQUIRED';
  end if;

  -- The staff member must be OURS. This is the tenant boundary for the whole
  -- function: everything below hangs off a row we have just proved we own.
  if not exists (
    select 1 from restaurant_users
     where id = p_staff_id and restaurant_id = p_restaurant_id and deleted_at is null
  ) then
    raise exception 'STAFF_NOT_FOUND';
  end if;

  v_month := date_trunc('month', coalesce(p_effective_from, current_date))::date;

  -- A salary cannot start before the person did.
  if v_month < date_trunc('month', p_joining_date)::date then
    v_month := date_trunc('month', p_joining_date)::date;
  end if;

  insert into staff_payroll (restaurant_id, restaurant_user_id, joining_date, created_by)
  values (p_restaurant_id, p_staff_id, p_joining_date, p_by)
  on conflict (restaurant_user_id) do update
    set joining_date = excluded.joining_date,
        updated_at   = now();

  insert into staff_salaries (restaurant_id, restaurant_user_id, monthly_salary, effective_from, created_by)
  values (p_restaurant_id, p_staff_id, p_monthly_salary, v_month, p_by)
  on conflict (restaurant_user_id, effective_from) do update
    set monthly_salary = excluded.monthly_salary,
        created_by     = excluded.created_by,
        created_at     = now();
end;
$$;

revoke all on function set_staff_salary(uuid, uuid, numeric, date, date, uuid) from public;
grant execute on function set_staff_salary(uuid, uuid, numeric, date, date, uuid) to service_role;


-- ── The salary in force for a given month ─────────────────────────────────────
-- The newest revision effective on or before that month. Returns NULL when the
-- month predates the first revision — which is what makes "no salary set yet"
-- distinguishable from "salary of zero".
create or replace function salary_for_month(
  p_staff_id uuid,
  p_month    date
)
returns numeric
language sql
stable
as $$
  select s.monthly_salary
    from staff_salaries s
   where s.restaurant_user_id = p_staff_id
     and s.effective_from <= date_trunc('month', p_month)::date
   order by s.effective_from desc
   limit 1;
$$;

revoke all on function salary_for_month(uuid, date) from public;
grant execute on function salary_for_month(uuid, date) to service_role;


-- ── Record a salary payment or an advance ─────────────────────────────────────
-- Atomic, and the only way money is ever recorded against payroll.
--
-- `for update` on the profile row serialises every payment for one person: two
-- admins paying the same staff member at the same moment queue, so the second
-- one sees the first one's payment when it computes what is left. Without it,
-- both could read "₹20,000 remaining" and both pay it.
create or replace function record_salary_payment(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_month         date,
  p_amount        numeric,
  p_kind          text,
  p_method        text,
  p_notes         text,
  p_by            uuid
)
returns uuid
language plpgsql
as $$
declare
  v_month     date;
  v_salary    numeric;
  v_paid      numeric;
  v_remaining numeric;
  v_id        uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_kind not in ('advance', 'salary') then
    raise exception 'INVALID_KIND';
  end if;
  if p_method not in ('cash', 'online') then
    raise exception 'INVALID_METHOD';
  end if;

  v_month := date_trunc('month', coalesce(p_month, current_date))::date;

  -- Lock the payroll profile. Scoping by restaurant_id here is the tenant check:
  -- no profile of ours, no payment.
  perform 1
     from staff_payroll
    where restaurant_user_id = p_staff_id
      and restaurant_id = p_restaurant_id
      for update;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;

  v_salary := salary_for_month(p_staff_id, v_month);
  if v_salary is null then
    raise exception 'SALARY_NOT_SET';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from salary_payments
   where restaurant_user_id = p_staff_id
     and restaurant_id = p_restaurant_id
     and salary_month = v_month;

  v_remaining := v_salary - v_paid;

  -- Refuse to overpay. The alternative — a negative "remaining" — would quietly
  -- corrupt both the payroll status and the outstanding-liability total.
  -- (Rounding slack matches the rest of the codebase.)
  if v_remaining <= 0.005 then
    raise exception 'ALREADY_PAID';
  end if;
  if p_amount > v_remaining + 0.005 then
    raise exception 'AMOUNT_EXCEEDS_REMAINING';
  end if;

  insert into salary_payments (
    restaurant_id, restaurant_user_id, salary_month, amount, kind, method, notes, paid_by
  )
  values (
    p_restaurant_id, p_staff_id, v_month, p_amount, p_kind, p_method::payment_method,
    nullif(btrim(coalesce(p_notes, '')), ''), p_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_salary_payment(uuid, uuid, date, numeric, text, text, text, uuid) from public;
grant execute on function record_salary_payment(uuid, uuid, date, numeric, text, text, text, uuid) to service_role;


-- ── The payroll sheet for one month ───────────────────────────────────────────
-- Every staff member with a payroll profile, and where they stand for the month.
-- Left-joined against the payments, so a month with nothing paid still returns a
-- row (Unpaid) rather than vanishing.
create or replace function payroll_month(
  p_restaurant_id uuid,
  p_month         date
)
returns table (
  restaurant_user_id uuid,
  display_name       text,
  title              text,
  is_active          boolean,
  joining_date       date,
  salary_type        text,
  monthly_salary     numeric,  -- null ⇒ no salary in force for this month yet
  advance_paid       numeric,
  salary_paid        numeric,
  total_paid         numeric,
  remaining          numeric,
  payment_count      integer
)
language sql
stable
as $$
  with m as (select date_trunc('month', p_month)::date as month),
  paid as (
    select
      sp.restaurant_user_id,
      coalesce(sum(sp.amount) filter (where sp.kind = 'advance'), 0) as advance,
      coalesce(sum(sp.amount) filter (where sp.kind = 'salary'), 0)  as salary,
      coalesce(sum(sp.amount), 0)                                    as total,
      count(*)::int                                                  as n
    from salary_payments sp
    where sp.restaurant_id = p_restaurant_id
      and sp.salary_month = (select month from m)
    group by sp.restaurant_user_id
  )
  select
    ru.id,
    ru.display_name,
    ru.title,
    ru.is_active,
    pr.joining_date,
    pr.salary_type,
    sal.monthly_salary,
    coalesce(p.advance, 0)::numeric,
    coalesce(p.salary, 0)::numeric,
    coalesce(p.total, 0)::numeric,
    -- Nothing owed for a month the person had no salary in, and never negative:
    -- `record_salary_payment` refuses to overpay, so this floor is a belt-and-
    -- braces guard for data that predates it or arrives another way.
    greatest(coalesce(sal.monthly_salary, 0) - coalesce(p.total, 0), 0)::numeric,
    coalesce(p.n, 0)
  from staff_payroll pr
  join restaurant_users ru on ru.id = pr.restaurant_user_id
  cross join m
  left join lateral (
    select s.monthly_salary
      from staff_salaries s
     where s.restaurant_user_id = pr.restaurant_user_id
       and s.effective_from <= m.month
     order by s.effective_from desc
     limit 1
  ) sal on true
  left join paid p on p.restaurant_user_id = pr.restaurant_user_id
  where pr.restaurant_id = p_restaurant_id
    and ru.deleted_at is null
    -- Someone who had not joined yet has no payroll for this month.
    and date_trunc('month', pr.joining_date)::date <= m.month
  order by ru.display_name;
$$;

revoke all on function payroll_month(uuid, date) from public;
grant execute on function payroll_month(uuid, date) to service_role;


-- ── Payroll totals for the Finance module ─────────────────────────────────────
-- Two different questions, deliberately answered by one function so they cannot
-- drift apart:
--
--   * What LEFT the business in this period  (period_*)  — cash-basis, by when
--     the money actually moved (`created_at`). This is what hits the balances.
--   * What we still OWE                      (outstanding_liability) — accrual,
--     by which month the salary belongs to (`salary_month`).
--
-- The liability walks every month from each person's joining month to the
-- current one, so a month nobody has paid at all still counts as owed. Months
-- are floored at zero individually — an overpaid month cannot mask an unpaid one.
create or replace function payroll_summary(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz
)
returns table (
  period_salary        numeric,
  period_advance       numeric,
  period_total         numeric,
  period_cash          numeric,
  period_online        numeric,
  today_total          numeric,
  month_total          numeric,
  all_time_total       numeric,
  all_time_advance     numeric,
  outstanding_liability numeric,
  staff_on_payroll     integer
)
language sql
stable
as $$
  with
  pay as (
    select
      coalesce(sum(amount) filter (where kind = 'salary'  and created_at >= p_from and created_at < p_to), 0) p_sal,
      coalesce(sum(amount) filter (where kind = 'advance' and created_at >= p_from and created_at < p_to), 0) p_adv,
      coalesce(sum(amount) filter (where created_at >= p_from and created_at < p_to), 0)                      p_tot,
      coalesce(sum(amount) filter (where method = 'cash'   and created_at >= p_from and created_at < p_to), 0) p_cash,
      coalesce(sum(amount) filter (where method = 'online' and created_at >= p_from and created_at < p_to), 0) p_online,
      coalesce(sum(amount) filter (where created_at >= date_trunc('day', now())), 0)                          t_tot,
      coalesce(sum(amount) filter (where created_at >= date_trunc('month', now())), 0)                        m_tot,
      coalesce(sum(amount), 0)                                                                                a_tot,
      coalesce(sum(amount) filter (where kind = 'advance'), 0)                                                a_adv
    from salary_payments
    where restaurant_id = p_restaurant_id
  ),
  -- Every payroll month of every staff member, from the month they joined to the
  -- month we are in now.
  months as (
    select
      pr.restaurant_user_id,
      generate_series(
        date_trunc('month', pr.joining_date),
        date_trunc('month', now()),
        interval '1 month'
      )::date as month
    from staff_payroll pr
    join restaurant_users ru on ru.id = pr.restaurant_user_id
    where pr.restaurant_id = p_restaurant_id
      and ru.deleted_at is null
  ),
  owed as (
    select coalesce(sum(
      greatest(
        coalesce(sal.monthly_salary, 0) - coalesce(p.paid, 0),
        0
      )
    ), 0) v
    from months m
    left join lateral (
      select s.monthly_salary
        from staff_salaries s
       where s.restaurant_user_id = m.restaurant_user_id
         and s.effective_from <= m.month
       order by s.effective_from desc
       limit 1
    ) sal on true
    left join lateral (
      select coalesce(sum(sp.amount), 0) paid
        from salary_payments sp
       where sp.restaurant_user_id = m.restaurant_user_id
         and sp.restaurant_id = p_restaurant_id
         and sp.salary_month = m.month
    ) p on true
  ),
  headcount as (
    select count(*)::int v
    from staff_payroll pr
    join restaurant_users ru on ru.id = pr.restaurant_user_id
    where pr.restaurant_id = p_restaurant_id and ru.deleted_at is null and ru.is_active
  )
  select
    pay.p_sal::numeric, pay.p_adv::numeric, pay.p_tot::numeric,
    pay.p_cash::numeric, pay.p_online::numeric,
    pay.t_tot::numeric, pay.m_tot::numeric,
    pay.a_tot::numeric, pay.a_adv::numeric,
    owed.v::numeric,
    headcount.v
  from pay, owed, headcount;
$$;

revoke all on function payroll_summary(uuid, timestamptz, timestamptz) from public;
grant execute on function payroll_summary(uuid, timestamptz, timestamptz) to service_role;


-- ── finance_report: salary is money leaving the business ──────────────────────
-- Salary now behaves exactly like a vendor payment: it comes OUT of cash or bank
-- on the day it was paid, it reduces the closing balance, and — because the
-- opening balance is carried forward by re-running the same sums up to `p_from`
-- — it reduces every subsequent period's opening too.
--
-- Without the `*_before` legs the closing balance would be right for today and
-- wrong for every day after, since tomorrow's opening is today's closing.
--
-- The return type gains columns, so the old function must be dropped rather than
-- replaced.
drop function if exists finance_report(uuid, timestamptz, timestamptz);

create function finance_report(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  opening_cash numeric, opening_online numeric,
  sales_cash numeric, sales_online numeric, sales_card numeric,
  sales_credit numeric, sales_total numeric,
  purchases_cash numeric, purchases_online numeric, purchases_credit numeric, purchases_total numeric,
  customer_credit_created numeric, customer_credit_collected numeric,
  vendor_credit_created numeric, vendor_credit_paid numeric,
  customer_credit_outstanding numeric, vendor_credit_outstanding numeric,
  pending_customers int, pending_vendors int,
  salary_cash numeric, salary_online numeric, salary_advance numeric, salary_total numeric,
  salary_outstanding numeric,
  closing_cash numeric, closing_online numeric, has_opening boolean
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
      sum(cp.amount) filter (where cp.created_at >= p_from and cp.created_at < p_to) collected
    from credit_payments cp where cp.restaurant_id = p_restaurant_id
  ),
  cr as (
    select sum(c.bill_amount - c.down_payment) filter (where c.created_at >= p_from and c.created_at < p_to) created
    from credits c where c.restaurant_id = p_restaurant_id
  ),
  cust as (
    select coalesce(sum(balance),0) outstanding,
           count(*) filter (where balance > 0)::int pending
    from credit_customers where restaurant_id = p_restaurant_id
  ),
  pur as (
    select
      sum(pu.cash_amount) filter (where pu.created_at >= (select eff from seed) and pu.created_at < p_from) cash_before,
      sum(pu.online_amount) filter (where pu.created_at >= (select eff from seed) and pu.created_at < p_from) online_before,
      sum(pu.cash_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) cash_out,
      sum(pu.online_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) online_out,
      sum(pu.credit_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) credit_out,
      sum(pu.total_amount) filter (where pu.created_at >= p_from and pu.created_at < p_to) total_out
    from purchases pu where pu.restaurant_id = p_restaurant_id
  ),
  vp as (
    select
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= (select eff from seed) and s.created_at < p_from) cash_before,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= (select eff from seed) and s.created_at < p_from) online_before,
      sum(s.amount) filter (where s.method = 'cash'  and s.created_at >= p_from and s.created_at < p_to) cash_out,
      sum(s.amount) filter (where s.method <> 'cash' and s.created_at >= p_from and s.created_at < p_to) online_out,
      sum(s.amount) filter (where s.created_at >= p_from and s.created_at < p_to) paid
    from vendor_payments s where s.restaurant_id = p_restaurant_id
  ),
  -- Payroll, on the same shape as every other money-out CTE above.
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
           count(*) filter (where credit_balance > 0)::int pending
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
        - coalesce((select online_before from sal),0) open_online
  )
  select
    calc.open_cash::numeric, calc.open_online::numeric,
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
    (select present from seed)
  from calc;
$$;

revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;


-- ── Real-time ─────────────────────────────────────────────────────────────────
-- Paying someone moves the finance balances, so a payment announces itself on
-- BOTH topics: the Staff screen refreshes the payroll sheet, the Finance screen
-- refreshes the balances. Neither has to poll, and neither can go stale while
-- the other updates.
drop trigger if exists rs_ev_staff_payroll on staff_payroll;
create trigger rs_ev_staff_payroll
  after insert or update or delete on staff_payroll
  for each row execute function rs_notify_change('payroll');

drop trigger if exists rs_ev_staff_salaries on staff_salaries;
create trigger rs_ev_staff_salaries
  after insert or update or delete on staff_salaries
  for each row execute function rs_notify_change('payroll');

drop trigger if exists rs_ev_salary_payments on salary_payments;
create trigger rs_ev_salary_payments
  after insert or update or delete on salary_payments
  for each row execute function rs_notify_change('payroll');

drop trigger if exists rs_ev_salary_payments_finance on salary_payments;
create trigger rs_ev_salary_payments_finance
  after insert or update or delete on salary_payments
  for each row execute function rs_notify_change('finance');
