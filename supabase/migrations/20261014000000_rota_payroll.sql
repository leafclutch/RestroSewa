-- =============================================================
-- ADVANCED PAYOUT — ROTA-BASED HOURLY PAYROLL
--
-- Foreign (UK/US) clients pay staff by the hour off a weekly rota rather than a
-- monthly salary. A restaurant opts in through `restaurants.settings.payout_mode`
-- = 'advanced' (set by the super admin); everyone else keeps the existing
-- monthly/cycle payroll and sees nothing new.
--
-- SHAPE
--   staff_hourly_rates  — dated rate revisions, exactly like staff_salaries.
--   rota_shifts         — one row per shift / holiday / sick day / day off.
--   rota_pay_periods    — the pay window (weekly / fortnightly / monthly).
--   salary_payments     — gains `rota_period_id`; wage payments are filed HERE.
--
-- WHY PAYMENTS GO INTO salary_payments
-- finance_report already reads salary_payments for the ledger and the cash/online
-- split, so a rota wage payment lands in Finance with no change to finance_report
-- (whose ledger-reconciles proof cannot catch a dropped filter in a rewrite).
-- The price is that the default payroll's "uncycled month" lookups — which match
-- payments on `cycle_id is null and salary_month = M` — would also pick up a rota
-- payment for someone who once had a monthly salary. Every one of those lookups
-- is re-issued below with `rota_period_id is null` added and NOTHING else changed.
--
-- WHY PERIODS ARE STORED
-- Same reason as salary_cycles: the frequency can be changed later, and history
-- must not move when it is. A period, once created, keeps its dates forever;
-- new periods are clipped so they never overlap an existing one.
--
-- Hours are derived, never stored: (actual ?? planned) end − start, +24h when the
-- shift crosses midnight, − unpaid break. Mirrors `shiftPaidHours` in lib/rota.ts;
-- the two must not drift.
-- =============================================================


-- ── 1. Hourly rates ───────────────────────────────────────────────────────────
create table if not exists staff_hourly_rates (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  hourly_rate        numeric(12,2) not null check (hourly_rate >= 0),
  effective_from     date not null,
  created_by         uuid references restaurant_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint staff_hourly_rates_user_from_key unique (restaurant_user_id, effective_from)
);

create index if not exists staff_hourly_rates_lookup_idx
  on staff_hourly_rates (restaurant_user_id, effective_from desc);


-- ── 2. Shifts ─────────────────────────────────────────────────────────────────
create table if not exists rota_shifts (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  -- The day the shift STARTS. A 17:00–01:30 shift on Monday belongs to Monday.
  shift_date         date not null,
  -- text-with-check rather than an enum, so the list can grow in one line.
  kind               text not null default 'shift'
                       check (kind in ('shift', 'holiday', 'sick', 'off')),
  role_code          text,
  planned_start      time,
  planned_end        time,
  -- Manager's correction after the fact. Null ⇒ the planned time stands.
  actual_start       time,
  actual_end         time,
  break_minutes      int not null default 0 check (break_minutes between 0 and 1440),
  -- Holiday pay: the hours a holiday day is paid at. Ignored for every other kind.
  paid_hours         numeric(5,2) check (paid_hours is null or (paid_hours >= 0 and paid_hours <= 24)),
  notes              text,
  created_by         uuid references restaurant_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint rota_shifts_times_required
    check (kind <> 'shift' or (planned_start is not null and planned_end is not null)),
  constraint rota_shifts_actual_pair
    check ((actual_start is null) = (actual_end is null))
);

-- One shift / leave entry per person per day. Split shifts are out of scope for v1;
-- the unique key is what lets the board treat a cell as a single editable thing.
create unique index if not exists rota_shifts_user_day_key
  on rota_shifts (restaurant_user_id, shift_date);
create index if not exists rota_shifts_restaurant_date_idx
  on rota_shifts (restaurant_id, shift_date);


-- ── 3. Pay periods ────────────────────────────────────────────────────────────
create table if not exists rota_pay_periods (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  frequency     text not null check (frequency in ('weekly', 'fortnightly', 'monthly')),
  created_at    timestamptz not null default now(),
  constraint rota_pay_periods_range check (period_end >= period_start),
  constraint rota_pay_periods_start_key unique (restaurant_id, period_start)
);

create index if not exists rota_pay_periods_window_idx
  on rota_pay_periods (restaurant_id, period_start, period_end);


-- ── 4. Payments point at their period ─────────────────────────────────────────
alter table salary_payments
  add column if not exists rota_period_id uuid references rota_pay_periods(id);  -- NO ACTION: checked at statement end, so a restaurant cascade-delete still works

create index if not exists salary_payments_rota_period_idx
  on salary_payments (rota_period_id);


alter table staff_hourly_rates enable row level security;
alter table rota_shifts        enable row level security;
alter table rota_pay_periods   enable row level security;

grant select, insert, update, delete on staff_hourly_rates, rota_shifts, rota_pay_periods to service_role;


-- ── Realtime: the staff/payroll screens refresh when any of these change ──────
do $$
declare
  w record;
begin
  for w in
    select * from (values
      ('rota_shifts',        'payroll', 'rs_ev_rota_shifts'),
      ('staff_hourly_rates', 'payroll', 'rs_ev_staff_hourly_rates'),
      ('rota_pay_periods',   'payroll', 'rs_ev_rota_pay_periods')
    ) as v(tbl, topic, trg)
  loop
    execute format('drop trigger if exists %I on public.%I', w.trg, w.tbl);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function rs_notify_change(%L)',
      w.trg, w.tbl, w.topic
    );
  end loop;
end;
$$;


-- ── The rate in force on a day ────────────────────────────────────────────────
create or replace function rota_rate_for(p_staff_id uuid, p_date date)
returns numeric
language sql
stable
as $$
  select r.hourly_rate
    from staff_hourly_rates r
   where r.restaurant_user_id = p_staff_id
     and r.effective_from <= p_date
   order by r.effective_from desc
   limit 1;
$$;


-- ── Paid hours of one shift ───────────────────────────────────────────────────
-- end <= start means the shift ran past midnight. Never negative.
create or replace function rota_shift_hours(p_shift rota_shifts)
returns numeric
language sql
immutable
as $$
  select case p_shift.kind
    when 'shift' then
      round(greatest(
        (
          (extract(epoch from coalesce(p_shift.actual_end, p_shift.planned_end))
           - extract(epoch from coalesce(p_shift.actual_start, p_shift.planned_start))) / 60
          + case when coalesce(p_shift.actual_end, p_shift.planned_end)
                      <= coalesce(p_shift.actual_start, p_shift.planned_start)
                 then 1440 else 0 end
          - p_shift.break_minutes
        ) / 60.0,
        0
      )::numeric, 4)
    when 'holiday' then coalesce(p_shift.paid_hours, 0)
    else 0
  end;
$$;


-- ── What one shift pays — rounded once, per shift ─────────────────────────────
create or replace function rota_shift_pay(p_shift rota_shifts)
returns numeric
language sql
stable
as $$
  select round(
    rota_shift_hours(p_shift)
      * coalesce(rota_rate_for(p_shift.restaurant_user_id, p_shift.shift_date), 0),
    2
  );
$$;


-- ── Gross pay for one person over a window ────────────────────────────────────
create or replace function rota_gross(p_staff_id uuid, p_start date, p_end date)
returns numeric
language sql
stable
as $$
  select coalesce(sum(rota_shift_pay(s)), 0)
    from rota_shifts s
   where s.restaurant_user_id = p_staff_id
     and s.shift_date between p_start and p_end;
$$;


-- ── Materialise the period covering a date ────────────────────────────────────
-- Idempotent. An existing period that contains the date wins, whatever the
-- frequency is now. Otherwise the natural window for the CURRENT frequency is
-- clipped against its stored neighbours, so periods never overlap and history
-- never moves.
--
-- p_anchor aligns weekly/fortnightly windows (a Monday); monthly ignores it.
create or replace function ensure_rota_period(
  p_restaurant_id uuid,
  p_date          date,
  p_frequency     text,
  p_anchor        date
)
returns uuid
language plpgsql
as $$
declare
  v_id    uuid;
  v_start date;
  v_end   date;
  v_len   int;
  v_prev  date;
  v_next  date;
begin
  if p_frequency not in ('weekly', 'fortnightly', 'monthly') then
    raise exception 'INVALID_FREQUENCY';
  end if;

  -- Serialise period creation per restaurant.
  perform pg_advisory_xact_lock(hashtext('rota_period:' || p_restaurant_id::text));

  select id into v_id
    from rota_pay_periods
   where restaurant_id = p_restaurant_id
     and p_date between period_start and period_end
   limit 1;
  if found then
    return v_id;
  end if;

  if p_frequency = 'monthly' then
    v_start := date_trunc('month', p_date)::date;
    v_end   := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
  else
    v_len   := case p_frequency when 'weekly' then 7 else 14 end;
    v_start := p_anchor + (floor((p_date - p_anchor)::numeric / v_len)::int * v_len);
    v_end   := v_start + v_len - 1;
  end if;

  select max(period_end) into v_prev
    from rota_pay_periods
   where restaurant_id = p_restaurant_id and period_end < p_date;
  select min(period_start) into v_next
    from rota_pay_periods
   where restaurant_id = p_restaurant_id and period_start > p_date;

  if v_prev is not null and v_start <= v_prev then v_start := v_prev + 1; end if;
  if v_next is not null and v_end   >= v_next then v_end   := v_next - 1; end if;

  insert into rota_pay_periods (restaurant_id, period_start, period_end, frequency)
  values (p_restaurant_id, v_start, v_end, p_frequency)
  returning id into v_id;

  return v_id;
end;
$$;


-- ── Pay wages, or an advance against them ─────────────────────────────────────
-- Lock, overpay guard and insert in one transaction, exactly like
-- record_salary_payment, so two managers cannot both spend the same balance.
create or replace function record_rota_payment(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_period_id     uuid,
  p_amount        numeric,
  p_kind          text,
  p_method        text,
  p_notes         text,
  p_by            uuid,
  p_cash          numeric default null,
  p_online        numeric default null
)
returns uuid
language plpgsql
as $$
declare
  v_period    rota_pay_periods;
  v_gross     numeric;
  v_paid      numeric;
  v_remaining numeric;
  v_cash      numeric;
  v_online    numeric;
  v_id        uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_kind not in ('advance', 'salary') then
    raise exception 'INVALID_KIND';
  end if;
  if p_method not in ('cash', 'online', 'mixed') then
    raise exception 'INVALID_METHOD';
  end if;

  select * into v_period
    from rota_pay_periods
   where id = p_period_id
     and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'PERIOD_NOT_FOUND';
  end if;

  perform 1
     from restaurant_users
    where id = p_staff_id
      and restaurant_id = p_restaurant_id
      and deleted_at is null;
  if not found then
    raise exception 'STAFF_NOT_FOUND';
  end if;

  v_gross := rota_gross(p_staff_id, v_period.period_start, v_period.period_end);

  select coalesce(sum(amount), 0) into v_paid
    from salary_payments
   where restaurant_user_id = p_staff_id
     and rota_period_id = p_period_id;

  v_remaining := v_gross - v_paid;
  if v_remaining <= 0.005 then
    raise exception 'ALREADY_PAID';
  end if;
  if p_amount > v_remaining + 0.005 then
    raise exception 'AMOUNT_EXCEEDS_REMAINING';
  end if;

  if p_cash is null and p_online is null then
    v_cash   := case when p_method = 'cash' then p_amount else 0 end;
    v_online := case when p_method = 'cash' then 0 else p_amount end;
  else
    v_cash   := coalesce(p_cash, 0);
    v_online := coalesce(p_online, 0);
    if v_cash < 0 or v_online < 0 then
      raise exception 'INVALID_AMOUNT';
    end if;
    if abs((v_cash + v_online) - p_amount) > 0.005 then
      raise exception 'SPLIT_MISMATCH';
    end if;
    v_cash := p_amount - v_online;
  end if;

  insert into salary_payments (
    restaurant_id, restaurant_user_id, salary_month, cycle_id, rota_period_id,
    amount, kind, method, cash_amount, online_amount, notes, paid_by
  )
  values (
    p_restaurant_id, p_staff_id, date_trunc('month', v_period.period_start)::date,
    null, p_period_id, p_amount, p_kind, p_method::payment_method,
    v_cash, v_online, nullif(btrim(coalesce(p_notes, '')), ''), p_by
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- ── The rota payroll sheet for one period ─────────────────────────────────────
-- Every active (or paid-in-period) staff member with hours, rate, gross, paid.
create or replace function rota_payroll_sheet(
  p_restaurant_id uuid,
  p_period_id     uuid
)
returns table (
  restaurant_user_id uuid,
  display_name       text,
  title              text,
  is_active          boolean,
  shift_count        integer,
  hours              numeric,
  rate_now           numeric,
  gross              numeric,
  advance_paid       numeric,
  salary_paid        numeric,
  total_paid         numeric,
  payment_count      integer
)
language sql
stable
as $$
  with p as (
    select * from rota_pay_periods
     where id = p_period_id and restaurant_id = p_restaurant_id
  ),
  sh as (
    select s.restaurant_user_id,
           count(*) filter (where s.kind in ('shift', 'holiday'))::int n,
           coalesce(sum(rota_shift_hours(s)), 0) hrs,
           coalesce(sum(rota_shift_pay(s)), 0)   gross
      from rota_shifts s, p
     where s.restaurant_id = p_restaurant_id
       and s.shift_date between p.period_start and p.period_end
     group by s.restaurant_user_id
  ),
  pay as (
    select sp.restaurant_user_id,
           coalesce(sum(sp.amount) filter (where sp.kind = 'advance'), 0) adv,
           coalesce(sum(sp.amount) filter (where sp.kind = 'salary'), 0)  sal,
           coalesce(sum(sp.amount), 0) tot,
           count(*)::int n
      from salary_payments sp
     where sp.rota_period_id = p_period_id
       and sp.restaurant_id = p_restaurant_id
     group by sp.restaurant_user_id
  )
  select ru.id, ru.display_name, ru.title, ru.is_active,
         coalesce(sh.n, 0), round(coalesce(sh.hrs, 0), 2),
         rota_rate_for(ru.id, (select period_end from p)),
         coalesce(sh.gross, 0),
         coalesce(pay.adv, 0), coalesce(pay.sal, 0), coalesce(pay.tot, 0),
         coalesce(pay.n, 0)
    from restaurant_users ru
    left join sh  on sh.restaurant_user_id  = ru.id
    left join pay on pay.restaurant_user_id = ru.id
   where ru.restaurant_id = p_restaurant_id
     and ru.deleted_at is null
     and exists (select 1 from p)
     and (ru.is_active or sh.restaurant_user_id is not null or pay.restaurant_user_id is not null)
   order by ru.display_name;
$$;


-- ── What the rota still owes, for the Finance outstanding-liability figure ────
-- Per stored period that has started: max(gross − paid, 0), per person. Shifts
-- that fall in no stored period yet (nobody has opened that period's sheet) are
-- counted at full gross, so the liability is never understated.
create or replace function rota_outstanding(p_restaurant_id uuid)
returns numeric
language sql
stable
as $$
  with per_period as (
    select greatest(
             rota_gross(ru.id, rp.period_start, rp.period_end)
               - coalesce((select sum(sp.amount) from salary_payments sp
                            where sp.rota_period_id = rp.id
                              and sp.restaurant_user_id = ru.id), 0),
             0) v
      from rota_pay_periods rp
      join restaurant_users ru
        on ru.restaurant_id = rp.restaurant_id and ru.deleted_at is null
     where rp.restaurant_id = p_restaurant_id
       and rp.period_start <= current_date
  ),
  unperioded as (
    select coalesce(sum(rota_shift_pay(s)), 0) v
      from rota_shifts s
      join restaurant_users ru on ru.id = s.restaurant_user_id and ru.deleted_at is null
     where s.restaurant_id = p_restaurant_id
       and s.shift_date <= current_date
       and not exists (
         select 1 from rota_pay_periods rp
          where rp.restaurant_id = p_restaurant_id
            and s.shift_date between rp.period_start and rp.period_end
       )
  )
  select coalesce((select sum(v) from per_period), 0) + (select v from unperioded);
$$;


revoke all on function rota_rate_for(uuid, date)                     from public;
revoke all on function rota_shift_hours(rota_shifts)                 from public;
revoke all on function rota_shift_pay(rota_shifts)                   from public;
revoke all on function rota_gross(uuid, date, date)                  from public;
revoke all on function ensure_rota_period(uuid, date, text, date)    from public;
revoke all on function record_rota_payment(uuid, uuid, uuid, numeric, text, text, text, uuid, numeric, numeric) from public;
revoke all on function rota_payroll_sheet(uuid, uuid)                from public;
revoke all on function rota_outstanding(uuid)                        from public;
grant execute on function rota_rate_for(uuid, date)                  to service_role;
grant execute on function rota_shift_hours(rota_shifts)              to service_role;
grant execute on function rota_shift_pay(rota_shifts)                to service_role;
grant execute on function rota_gross(uuid, date, date)               to service_role;
grant execute on function ensure_rota_period(uuid, date, text, date) to service_role;
grant execute on function record_rota_payment(uuid, uuid, uuid, numeric, text, text, text, uuid, numeric, numeric) to service_role;
grant execute on function rota_payroll_sheet(uuid, uuid)             to service_role;
grant execute on function rota_outstanding(uuid)                     to service_role;


-- =============================================================
-- DEFAULT PAYROLL: keep rota payments out of the month lookups.
-- Each function below is re-issued verbatim from its latest migration with ONE
-- change — `rota_period_id is null` on the "uncycled month" payment match —
-- plus, in payroll_summary, the rota outstanding added to the liability.
-- =============================================================

create or replace function record_salary_payment(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_month         date,
  p_amount        numeric,
  p_kind          text,
  p_method        text,
  p_notes         text,
  p_by            uuid,
  p_cash          numeric default null,
  p_online        numeric default null
)
returns uuid
language plpgsql
as $$
declare
  v_cash      numeric;
  v_online    numeric;
  v_month     date;
  v_as_of     date;
  v_cycle     salary_cycles;
  v_cycle_id  uuid;
  v_payable   numeric;
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
  if p_method not in ('cash', 'online', 'mixed') then
    raise exception 'INVALID_METHOD';
  end if;

  v_as_of := coalesce(p_month, current_date);

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

  -- Materialise the cycle if this staff member is anchored, then find it.
  perform ensure_salary_cycle(p_staff_id, v_as_of);

  select * into v_cycle
    from salary_cycles
   where restaurant_user_id = p_staff_id
     and v_as_of between cycle_start and cycle_end
   limit 1;

  if found then
    v_cycle_id := v_cycle.id;
    v_month    := date_trunc('month', v_cycle.cycle_start)::date;
    v_payable  := cycle_payable_amount(v_cycle);
  else
    -- Anchor-less staff: the calendar month, exactly as before — but attendance
    -- still applies, so a docked day reduces the ceiling here too.
    v_month   := date_trunc('month', v_as_of)::date;
    v_payable := salary_for_month(p_staff_id, v_month);
    if v_payable is null then
      raise exception 'SALARY_NOT_SET';
    end if;
    v_payable := round(
      v_payable
        * cycle_payable_days(
            p_staff_id, v_month,
            (v_month + interval '1 month - 1 day')::date,
            extract(day from (v_month + interval '1 month - 1 day'))::int)
        / extract(day from (v_month + interval '1 month - 1 day'))::int,
      2);
  end if;

  if v_payable is null then
    raise exception 'SALARY_NOT_SET';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from salary_payments
   where restaurant_user_id = p_staff_id
     and restaurant_id = p_restaurant_id
     and (
       (v_cycle_id is not null and cycle_id = v_cycle_id)
       or (v_cycle_id is null and cycle_id is null and rota_period_id is null and salary_month = v_month)
     );

  v_remaining := v_payable - v_paid;

  -- Refuse to overpay. The alternative — a negative "remaining" — would quietly
  -- corrupt both the payroll status and the outstanding-liability total.
  -- (Rounding slack matches the rest of the codebase.)
  if v_remaining <= 0.005 then
    raise exception 'ALREADY_PAID';
  end if;
  if p_amount > v_remaining + 0.005 then
    raise exception 'AMOUNT_EXCEEDS_REMAINING';
  end if;

  -- Resolve the tender split. No split given → single-tender, derived from the
  -- method, i.e. precisely what this function did before.
  if p_cash is null and p_online is null then
    v_cash   := case when p_method = 'cash' then p_amount else 0 end;
    v_online := case when p_method = 'cash' then 0 else p_amount end;
  else
    v_cash   := coalesce(p_cash, 0);
    v_online := coalesce(p_online, 0);
    if v_cash < 0 or v_online < 0 then
      raise exception 'INVALID_AMOUNT';
    end if;
    if abs((v_cash + v_online) - p_amount) > 0.005 then
      raise exception 'SPLIT_MISMATCH';
    end if;
    -- Absorb sub-paisa rounding into cash so cash + online = amount EXACTLY and
    -- the CHECK constraint holds. Without this a 33.333/66.667 split fails.
    v_cash := p_amount - v_online;
  end if;

  insert into salary_payments (
    restaurant_id, restaurant_user_id, salary_month, cycle_id, amount, kind, method,
    cash_amount, online_amount, notes, paid_by
  )
  values (
    p_restaurant_id, p_staff_id, v_month, v_cycle_id, p_amount, p_kind, p_method::payment_method,
    v_cash, v_online,
    nullif(btrim(coalesce(p_notes, '')), ''), p_by
  )
  returning id into v_id;

  return v_id;
end;
$$;


create or replace function payroll_cycle_sheet(
  p_restaurant_id uuid,
  p_as_of         date default current_date
)
returns table (
  restaurant_user_id uuid,
  display_name       text,
  title              text,
  is_active          boolean,
  joining_date       date,
  cycle_id           uuid,
  cycle_kind         text,
  cycle_start        date,
  cycle_end          date,
  total_days         int,
  monthly_salary     numeric,
  payable_days       numeric,
  absent_days        numeric,
  payable_amount     numeric,
  advance_paid       numeric,
  salary_paid        numeric,
  total_paid         numeric,
  remaining          numeric,
  payment_count      integer,
  attendance_verified boolean
)
language plpgsql
as $$
declare
  r record;
begin
  -- Top up cycles first, one staff member at a time. Anchor-less staff return
  -- null from this and are simply skipped.
  for r in
    select pr.restaurant_user_id
      from staff_payroll pr
      join restaurant_users ru on ru.id = pr.restaurant_user_id
     where pr.restaurant_id = p_restaurant_id
       and ru.deleted_at is null
       and pr.cycle_anchor_date is not null
  loop
    perform ensure_salary_cycle(r.restaurant_user_id, p_as_of);
  end loop;

  return query
  with staff as (
    select pr.restaurant_user_id, pr.joining_date, pr.cycle_anchor_date,
           pr.cycle_length_days, ru.display_name, ru.title, ru.is_active
      from staff_payroll pr
      join restaurant_users ru on ru.id = pr.restaurant_user_id
     where pr.restaurant_id = p_restaurant_id
       and ru.deleted_at is null
       -- Salary has started by p_as_of. The joining date is a record only and
       -- decides nothing here (20261012300000).
       and (
         (pr.cycle_anchor_date is not null and pr.cycle_anchor_date <= p_as_of)
         or exists (
           select 1 from salary_cycles c
            where c.restaurant_user_id = pr.restaurant_user_id
              and p_as_of between c.cycle_start and c.cycle_end
         )
         -- A calendar month from before cycles began (paid, or owed, as a month).
         or (
           p_as_of < date_trunc('month', coalesce(pr.cycle_anchor_date, 'infinity'::date))
           and salary_for_month(pr.restaurant_user_id, p_as_of) is not null
         )
       )
  ),
  windowed as (
    select
      s.*,
      c.id                                                            as c_id,
      coalesce(c.kind, 'calendar_month')                              as c_kind,
      coalesce(c.cycle_start, date_trunc('month', p_as_of)::date)     as c_start,
      coalesce(c.cycle_end,
               (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date) as c_end,
      coalesce(c.total_days,
               extract(day from (date_trunc('month', p_as_of)
                                 + interval '1 month - 1 day'))::int) as c_days,
      coalesce(c.monthly_salary_snapshot,
               salary_for_month(s.restaurant_user_id,
                                date_trunc('month', p_as_of)::date))  as c_salary,
      (c.attendance_verified_at is not null)                          as c_verified
    from staff s
    left join lateral (
      select * from salary_cycles sc
       where sc.restaurant_user_id = s.restaurant_user_id
         and p_as_of between sc.cycle_start and sc.cycle_end
       limit 1
    ) c on true
  ),
  calc as (
    select
      w.*,
      cycle_payable_days(w.restaurant_user_id, w.c_start, w.c_end, w.c_days) as p_days
    from windowed w
  ),
  paid as (
    select
      c.restaurant_user_id,
      coalesce(sum(sp.amount) filter (where sp.kind = 'advance'), 0) adv,
      coalesce(sum(sp.amount) filter (where sp.kind = 'salary'), 0)  sal,
      coalesce(sum(sp.amount), 0)                                    tot,
      count(sp.id)::int                                              n
    from calc c
    left join salary_payments sp
      on sp.restaurant_id = p_restaurant_id
     and sp.restaurant_user_id = c.restaurant_user_id
     -- A payment belongs to the cycle it was filed against; before cycles
     -- existed it was filed against a month, so fall back to that.
     and (
       (c.c_id is not null and sp.cycle_id = c.c_id)
       or (c.c_id is null and sp.cycle_id is null and sp.rota_period_id is null
           and sp.salary_month = date_trunc('month', c.c_start)::date)
     )
    group by c.restaurant_user_id
  )
  select
    c.restaurant_user_id,
    c.display_name,
    c.title,
    c.is_active,
    c.joining_date,
    c.c_id,
    c.c_kind,
    c.c_start,
    c.c_end,
    c.c_days,
    c.c_salary,
    c.p_days,
    (c.c_days - c.p_days)::numeric,
    round(coalesce(c.c_salary, 0) * c.p_days / nullif(c.c_days, 0), 2),
    coalesce(p.adv, 0)::numeric,
    coalesce(p.sal, 0)::numeric,
    coalesce(p.tot, 0)::numeric,
    greatest(
      round(coalesce(c.c_salary, 0) * c.p_days / nullif(c.c_days, 0), 2)
        - coalesce(p.tot, 0),
      0
    )::numeric,
    coalesce(p.n, 0),
    c.c_verified
  from calc c
  left join paid p on p.restaurant_user_id = c.restaurant_user_id
  order by c.display_name;
end;
$$;


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
      and sp.rota_period_id is null
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


create or replace function payroll_summary(
  p_restaurant_id uuid,
  p_from          timestamptz,
  p_to            timestamptz,
  p_today_from    timestamptz default null,
  p_month_from    timestamptz default null
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
      coalesce(sum(cash_amount) filter (where created_at >= p_from and created_at < p_to), 0) p_cash,
      coalesce(sum(online_amount) filter (where created_at >= p_from and created_at < p_to), 0) p_online,
      coalesce(sum(amount) filter (
        where created_at >= coalesce(p_today_from, date_trunc('day', now()))), 0)                              t_tot,
      coalesce(sum(amount) filter (
        where created_at >= coalesce(p_month_from, date_trunc('month', now()))), 0)                            m_tot,
      coalesce(sum(amount), 0)                                                                                a_tot,
      coalesce(sum(amount) filter (where kind = 'advance'), 0)                                                a_adv
    from salary_payments
    where restaurant_id = p_restaurant_id
  ),
  cycle_owed as (
    select coalesce(sum(greatest(cycle_payable_amount(c) - coalesce(p.paid, 0), 0)), 0) v
    from salary_cycles c
    join restaurant_users ru on ru.id = c.restaurant_user_id
    left join lateral (
      select coalesce(sum(sp.amount), 0) paid
        from salary_payments sp
       where sp.cycle_id = c.id
         and sp.restaurant_id = p_restaurant_id
    ) p on true
    where c.restaurant_id = p_restaurant_id
      and ru.deleted_at is null
      and c.cycle_start <= current_date
  ),
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
  uncycled as (
    select m.*
      from months m
     where not exists (
       select 1 from salary_cycles c
        where c.restaurant_user_id = m.restaurant_user_id
          and c.cycle_start <= (m.month + interval '1 month - 1 day')::date
          and c.cycle_end   >= m.month
     )
  ),
  month_owed as (
    select coalesce(sum(
      greatest(
        round(
          coalesce(salary_for_month(m.restaurant_user_id, m.month), 0)
            * cycle_payable_days(
                m.restaurant_user_id, m.month,
                (m.month + interval '1 month - 1 day')::date,
                extract(day from (m.month + interval '1 month - 1 day'))::int)
            / extract(day from (m.month + interval '1 month - 1 day'))::int,
          2)
        - coalesce(p.paid, 0),
        0)
    ), 0) v
    from uncycled m
    left join lateral (
      select coalesce(sum(sp.amount), 0) paid
        from salary_payments sp
       where sp.restaurant_user_id = m.restaurant_user_id
         and sp.restaurant_id = p_restaurant_id
         and sp.cycle_id is null
         and sp.rota_period_id is null
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
    (cycle_owed.v + month_owed.v + rota_outstanding(p_restaurant_id))::numeric,
    headcount.v
  from pay, cycle_owed, month_owed, headcount;
$$;


