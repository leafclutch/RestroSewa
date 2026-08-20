-- =============================================================
-- INDIVIDUAL 30-DAY SALARY CYCLES + AN ATTENDANCE-READY SEAM
--
-- Payroll was keyed entirely to the calendar month: `staff_salaries.effective_from`
-- and `salary_payments.salary_month` were both CHECK-pinned to the 1st, and everyone
-- was paid a full monthly salary the moment the month ended. Attendance did not
-- exist as a concept anywhere.
--
-- Two things change. A staff member can now have their OWN fixed-length cycle
-- anchored on a date the admin picks (anchor the 15th → 15 Aug .. 13 Sep, then
-- 14 Sep .. 13 Oct), and salary becomes payable-days × daily-rate.
--
-- WHY A CYCLE IS STORED WHEN EVERYTHING ELSE HERE IS DERIVED
-- This module derives its state on purpose — salary-for-a-month is looked up from
-- dated revisions, paid is sum(payments), status is read off the two. That works
-- because "July 2026" means the same thing forever. A per-staff cycle does NOT:
-- move someone's anchor from the 15th to the 1st and every past boundary moves
-- with it, so historical payments would land in periods that no longer exist.
-- The PERIOD therefore has to be a stored fact. Everything inside it — payable,
-- paid, remaining, status — stays derived exactly as before.
--
-- WHAT MAKES THIS SAFE FOR THE EXISTING LEDGER
-- `salary_payments.salary_month` stays, and stays populated. `finance_report`
-- reads it for the ledger label and calls `payroll_summary()` for the outstanding
-- liability, so finance_report needs NO changes at all — which matters, because
-- the ledger-reconciles proof cannot catch a dropped period filter in a rewritten
-- finance function. Only payroll_summary's `owed` CTE moves, and it keeps its
-- signature.
-- =============================================================


-- ── 1. The anchor lives on the payroll profile ────────────────────────────────
-- NULL means "calendar month", i.e. precisely what this staff member does today.
-- Existing staff therefore change in no observable way until an admin sets a date.
alter table staff_payroll
  add column if not exists cycle_anchor_date date,
  add column if not exists cycle_length_days int not null default 30
    check (cycle_length_days between 1 and 366);


-- ── 2. The cycles themselves ──────────────────────────────────────────────────
-- One row per staff member per period. `cycle_end` is INCLUSIVE — the last day
-- actually paid for.
--
-- `monthly_salary_snapshot` is frozen at cycle start. A raise changes the future;
-- it cannot reach back into a cycle already under way. `daily_rate` is carried at
-- 6dp for display only — money is always computed from the snapshot and the day
-- counts, never from a rounded rate, or a fully-worked ₹25,000 cycle would pay
-- ₹24,999.90 and leave a phantom balance owing forever.
create table if not exists salary_cycles (
  id                      uuid primary key default gen_random_uuid(),
  restaurant_id           uuid not null references restaurants(id) on delete cascade,
  restaurant_user_id      uuid not null references restaurant_users(id) on delete cascade,
  cycle_start             date not null,
  cycle_end               date not null,
  total_days              int  not null check (total_days > 0),
  monthly_salary_snapshot numeric(12,2) not null check (monthly_salary_snapshot >= 0),
  daily_rate              numeric(14,6) not null check (daily_rate >= 0),
  -- 'calendar_month' is the backfilled shape: a real month, of its real length.
  -- 'rolling_30' is an anchored cycle. Kept distinct so history reads honestly
  -- rather than pretending July 2026 was ever a 30-day window.
  kind                    text not null default 'rolling_30'
                            check (kind in ('calendar_month', 'rolling_30')),
  attendance_verified_at  timestamptz,
  attendance_verified_by  uuid references restaurant_users(id) on delete set null,
  created_at              timestamptz not null default now(),
  constraint salary_cycles_range   check (cycle_end >= cycle_start),
  constraint salary_cycles_user_start_key unique (restaurant_user_id, cycle_start)
);

create index if not exists salary_cycles_user_window_idx
  on salary_cycles (restaurant_user_id, cycle_start, cycle_end);

-- Overlapping cycles would double-count someone's salary. An exclusion constraint
-- would say this more directly but needs btree_gist, and adding an extension
-- across three environments to guard a case only an anchor change can cause is a
-- worse trade than ten lines of trigger.
create or replace function salary_cycles_no_overlap()
returns trigger
language plpgsql
as $$
begin
  perform 1
     from salary_cycles c
    where c.restaurant_user_id = new.restaurant_user_id
      and c.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and c.cycle_start <= new.cycle_end
      and c.cycle_end   >= new.cycle_start;
  if found then
    raise exception 'CYCLE_OVERLAP';
  end if;
  return new;
end;
$$;

drop trigger if exists salary_cycles_no_overlap_trg on salary_cycles;
create trigger salary_cycles_no_overlap_trg
  before insert or update on salary_cycles
  for each row execute function salary_cycles_no_overlap();


-- ── 3. Attendance — the seam a real module will later write into ──────────────
-- ONLY EXCEPTIONS ARE STORED. A day with no row counts as fully present, so ten
-- absences are ten rows rather than thirty. That is also what makes this
-- forward-compatible: when a real attendance module starts recording every day,
-- its `present` rows carry day_fraction 1.0 and change no total.
--
-- `status` is deliberately text-with-a-check rather than an enum: the future list
-- (leave, late, overtime, holiday…) will grow, and growing a check constraint is
-- a one-line migration where growing an enum in use is not.
create table if not exists staff_attendance_days (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  work_date          date not null,
  status             text not null default 'present'
                       check (status in ('present','absent','half_day','leave','holiday')),
  -- What salary actually consumes. Kept separate from `status` on purpose: a
  -- future 'leave' may be paid at one restaurant and unpaid at another, and only
  -- this number decides the money.
  day_fraction       numeric(4,3) not null default 1
                       check (day_fraction >= 0 and day_fraction <= 1),
  -- 'admin' today. Later: 'check_in', 'biometric', 'import'.
  source             text not null default 'admin',
  notes              text,
  recorded_by        uuid references restaurant_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint staff_attendance_user_day_key unique (restaurant_user_id, work_date)
);

create index if not exists staff_attendance_user_date_idx
  on staff_attendance_days (restaurant_user_id, work_date);


-- ── 4. Payments point at their cycle ──────────────────────────────────────────
-- `salary_month` is NOT removed and NOT made nullable. finance_report reads it.
alter table salary_payments
  add column if not exists cycle_id uuid references salary_cycles(id) on delete set null;

create index if not exists salary_payments_cycle_idx on salary_payments (cycle_id);


-- ── 5. A salary revision may start on any day now ─────────────────────────────
-- An anchored cycle can begin on the 15th, so pinning revisions to the 1st would
-- mean a raise could never take effect at the start of a cycle. Every existing
-- row already satisfies the looser rule, so this widens nothing retroactively.
alter table staff_salaries drop constraint if exists staff_salaries_month_start;


alter table salary_cycles         enable row level security;
alter table staff_attendance_days enable row level security;


-- ── The salary in force on a given DAY ────────────────────────────────────────
-- `salary_for_month` stays untouched for the callers that still think in months.
create or replace function salary_for_date(
  p_staff_id uuid,
  p_date     date
)
returns numeric
language sql
stable
as $$
  select s.monthly_salary
    from staff_salaries s
   where s.restaurant_user_id = p_staff_id
     and s.effective_from <= p_date
   order by s.effective_from desc
   limit 1;
$$;

revoke all on function salary_for_date(uuid, date) from public;
grant execute on function salary_for_date(uuid, date) to service_role;


-- ── Payable days for a window ─────────────────────────────────────────────────
-- Total days minus whatever each exception day gives up. Mirrors `payableDays`
-- in lib/payroll.ts exactly; the two must not drift.
create or replace function cycle_payable_days(
  p_staff_id uuid,
  p_start    date,
  p_end      date,
  p_total    int
)
returns numeric
language sql
stable
as $$
  select greatest(
    p_total - coalesce((
      select sum(1 - a.day_fraction)
        from staff_attendance_days a
       where a.restaurant_user_id = p_staff_id
         and a.work_date between p_start and p_end
    ), 0),
    0
  )::numeric;
$$;

revoke all on function cycle_payable_days(uuid, date, date, int) from public;
grant execute on function cycle_payable_days(uuid, date, date, int) to service_role;


-- ── What a cycle owes ─────────────────────────────────────────────────────────
-- Computed from the SNAPSHOT and the day counts, never from the rounded rate.
create or replace function cycle_payable_amount(p_cycle salary_cycles)
returns numeric
language sql
stable
as $$
  select round(
    p_cycle.monthly_salary_snapshot
      * cycle_payable_days(p_cycle.restaurant_user_id, p_cycle.cycle_start,
                           p_cycle.cycle_end, p_cycle.total_days)
      / nullif(p_cycle.total_days, 0),
    2
  );
$$;

revoke all on function cycle_payable_amount(salary_cycles) from public;
grant execute on function cycle_payable_amount(salary_cycles) to service_role;


-- ── Materialise the cycle covering a date ─────────────────────────────────────
-- Idempotent. Returns the cycle id, creating it (and every cycle between the
-- anchor and it) only when the staff member actually has an anchor. Anchor-less
-- staff keep calendar-month behaviour and get no rows here at all.
create or replace function ensure_salary_cycle(
  p_staff_id uuid,
  p_as_of    date default current_date
)
returns uuid
language plpgsql
as $$
declare
  v_pr      staff_payroll;
  v_idx     int;
  v_i       int;
  v_start   date;
  v_end     date;
  v_salary  numeric;
  v_id      uuid;
begin
  select * into v_pr
    from staff_payroll
   where restaurant_user_id = p_staff_id
     for update;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;

  if v_pr.cycle_anchor_date is null then
    return null;               -- calendar-month staff: nothing to materialise
  end if;
  if p_as_of < v_pr.cycle_anchor_date then
    return null;               -- before they were anchored
  end if;

  v_idx := floor((p_as_of - v_pr.cycle_anchor_date)::numeric / v_pr.cycle_length_days);

  -- Fill every cycle from the anchor up to the one asked for, so the liability
  -- walk never sees a hole because nobody happened to open the screen that month.
  for v_i in 0 .. v_idx loop
    v_start := v_pr.cycle_anchor_date + (v_i * v_pr.cycle_length_days);
    v_end   := v_start + (v_pr.cycle_length_days - 1);

    select id into v_id
      from salary_cycles
     where restaurant_user_id = p_staff_id and cycle_start = v_start;

    if v_id is null then
      -- The salary in force on the day the cycle OPENS. Frozen from here on.
      v_salary := coalesce(salary_for_date(p_staff_id, v_start), 0);

      insert into salary_cycles (
        restaurant_id, restaurant_user_id, cycle_start, cycle_end, total_days,
        monthly_salary_snapshot, daily_rate, kind
      )
      values (
        v_pr.restaurant_id, p_staff_id, v_start, v_end, v_pr.cycle_length_days,
        v_salary, v_salary / v_pr.cycle_length_days, 'rolling_30'
      )
      returning id into v_id;
    end if;
  end loop;

  return v_id;
end;
$$;

revoke all on function ensure_salary_cycle(uuid, date) from public;
grant execute on function ensure_salary_cycle(uuid, date) to service_role;


-- ── Set (or move) a staff member's cycle anchor ───────────────────────────────
-- Moving the anchor only ever affects the FUTURE. Cycles that already exist are
-- left exactly as they are; the new anchor takes effect from the first cycle that
-- does not overlap one of them. That is what keeps history immutable while still
-- letting an admin correct a start date.
create or replace function set_cycle_anchor(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_anchor        date,
  p_length        int default 30
)
returns void
language plpgsql
as $$
declare
  v_last_end date;
  v_anchor   date;
begin
  if p_anchor is null then
    raise exception 'ANCHOR_REQUIRED';
  end if;
  if p_length is null or p_length < 1 or p_length > 366 then
    raise exception 'INVALID_CYCLE_LENGTH';
  end if;

  perform 1 from staff_payroll
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;

  select max(cycle_end) into v_last_end
    from salary_cycles
   where restaurant_user_id = p_staff_id;

  -- Never let a new anchor reach back over a cycle that already exists — the
  -- overlap trigger would reject it anyway, but failing here says why.
  v_anchor := p_anchor;
  while v_last_end is not null and v_anchor <= v_last_end loop
    v_anchor := v_anchor + p_length;
  end loop;

  update staff_payroll
     set cycle_anchor_date = v_anchor,
         cycle_length_days = p_length,
         updated_at        = now()
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function set_cycle_anchor(uuid, uuid, date, int) from public;
grant execute on function set_cycle_anchor(uuid, uuid, date, int) to service_role;


-- ── Record / clear one day of attendance ──────────────────────────────────────
-- `p_fraction` null means "this day is normal again" and DELETES the row, so the
-- table keeps holding exceptions only.
create or replace function set_attendance_day(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_date          date,
  p_status        text,
  p_fraction      numeric,
  p_notes         text,
  p_by            uuid
)
returns void
language plpgsql
as $$
begin
  perform 1 from staff_payroll
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;

  -- A verified cycle is a closed statement. Reopen it deliberately rather than
  -- letting an edit silently change a number somebody already signed off.
  perform 1 from salary_cycles
   where restaurant_user_id = p_staff_id
     and p_date between cycle_start and cycle_end
     and attendance_verified_at is not null;
  if found then
    raise exception 'CYCLE_VERIFIED';
  end if;

  if p_fraction is null or (p_status = 'present' and p_fraction >= 1) then
    delete from staff_attendance_days
     where restaurant_user_id = p_staff_id and work_date = p_date;
    return;
  end if;

  if p_fraction < 0 or p_fraction > 1 then
    raise exception 'INVALID_FRACTION';
  end if;

  insert into staff_attendance_days (
    restaurant_id, restaurant_user_id, work_date, status, day_fraction,
    source, notes, recorded_by
  )
  values (
    p_restaurant_id, p_staff_id, p_date, p_status, p_fraction,
    'admin', nullif(btrim(coalesce(p_notes, '')), ''), p_by
  )
  on conflict (restaurant_user_id, work_date) do update
    set status       = excluded.status,
        day_fraction = excluded.day_fraction,
        source       = excluded.source,
        notes        = excluded.notes,
        recorded_by  = excluded.recorded_by,
        updated_at   = now();
end;
$$;

revoke all on function set_attendance_day(uuid, uuid, date, text, numeric, text, uuid) from public;
grant execute on function set_attendance_day(uuid, uuid, date, text, numeric, text, uuid) to service_role;


-- ── Verify (or reopen) a cycle's attendance ───────────────────────────────────
create or replace function verify_cycle_attendance(
  p_restaurant_id uuid,
  p_cycle_id      uuid,
  p_verified      boolean,
  p_by            uuid
)
returns void
language plpgsql
as $$
begin
  update salary_cycles
     set attendance_verified_at = case when p_verified then now() else null end,
         attendance_verified_by = case when p_verified then p_by else null end
   where id = p_cycle_id and restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'CYCLE_NOT_FOUND';
  end if;
end;
$$;

revoke all on function verify_cycle_attendance(uuid, uuid, boolean, uuid) from public;
grant execute on function verify_cycle_attendance(uuid, uuid, boolean, uuid) to service_role;


-- ── The payroll sheet, by cycle ───────────────────────────────────────────────
-- Replaces `payroll_month` as the screen's read. VOLATILE, not stable: it
-- materialises any missing cycle for anchored staff, so the liability walk never
-- finds a hole because nobody happened to open the screen that month.
--
-- Anchor-less staff are NOT given rows in `salary_cycles`. Their window is the
-- calendar month containing `p_as_of`, derived on the fly — which is exactly what
-- they did before this migration. Attendance is applied to both shapes, so an
-- admin can dock a day without first moving someone onto a rolling cycle.
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
       and pr.joining_date <= p_as_of
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
       or (c.c_id is null and sp.cycle_id is null
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

revoke all on function payroll_cycle_sheet(uuid, date) from public;
grant execute on function payroll_cycle_sheet(uuid, date) to service_role;


-- ── Record a salary payment or an advance, against a CYCLE ────────────────────
-- Same signature, same tender-split behaviour, same locking. What changes is the
-- ceiling: the overpay guard used to compare against the full monthly salary, so
-- a cycle where someone was absent ten days would happily accept a full month's
-- pay and then report a negative remaining. It now compares against what the
-- cycle actually owes.
--
-- `p_month` is still whatever date identifies the period. For anchored staff that
-- is any day inside the cycle; for anchor-less staff it is the month, as before.
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
       or (v_cycle_id is null and cycle_id is null and salary_month = v_month)
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

revoke all on function record_salary_payment(uuid, uuid, date, numeric, text, text, text, uuid, numeric, numeric) from public;
grant execute on function record_salary_payment(uuid, uuid, date, numeric, text, text, text, uuid, numeric, numeric) to service_role;


-- ── Payroll totals for the Finance module ─────────────────────────────────────
-- SIGNATURE UNCHANGED, and every figure but one is byte-identical to before.
-- finance_report calls this for `salary_outstanding`; leaving the shape alone is
-- what lets finance_report stay untouched.
--
-- Only `owed` moves. It used to walk calendar months from each person's joining
-- month. It now sums the CYCLES, plus any calendar month that NO cycle covers —
-- so a month nobody has cycled yet still counts as owed, and a month backfilled
-- into a cycle is counted exactly once, by the cycle.
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
  -- What every existing cycle still owes.
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
  -- Every payroll month from each person's joining month to now — minus the ones
  -- a cycle already accounts for. Left on calendar months deliberately: for staff
  -- with no anchor, a payroll month is a month, not a trading day.
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
      greatest(coalesce(sal.monthly_salary, 0) - coalesce(p.paid, 0), 0)
    ), 0) v
    from uncycled m
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
         and sp.cycle_id is null
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
    (cycle_owed.v + month_owed.v)::numeric,
    headcount.v
  from pay, cycle_owed, month_owed, headcount;
$$;

revoke all on function payroll_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public;
grant execute on function payroll_summary(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to service_role;


-- ── Backfill: every month that has ever been paid becomes a cycle ─────────────
-- History must read exactly as it did before. A backfilled cycle is the REAL
-- calendar month, of its real length, snapshotting the salary that was in force
-- for it, with NO attendance rows — so payable_days = total_days and the payable
-- amount is the full salary, which is precisely what the month-based system paid.
--
-- Only months that actually have payments are backfilled. An unpaid month keeps
-- being answered by the `uncycled` branch of payroll_summary above, so nothing
-- is double-counted and nothing is lost.
insert into salary_cycles (
  restaurant_id, restaurant_user_id, cycle_start, cycle_end, total_days,
  monthly_salary_snapshot, daily_rate, kind
)
select
  sp.restaurant_id,
  sp.restaurant_user_id,
  sp.salary_month,
  (sp.salary_month + interval '1 month - 1 day')::date,
  extract(day from (sp.salary_month + interval '1 month - 1 day'))::int,
  coalesce(salary_for_month(sp.restaurant_user_id, sp.salary_month), 0),
  coalesce(salary_for_month(sp.restaurant_user_id, sp.salary_month), 0)
    / extract(day from (sp.salary_month + interval '1 month - 1 day'))::int,
  'calendar_month'
from salary_payments sp
group by sp.restaurant_id, sp.restaurant_user_id, sp.salary_month
on conflict (restaurant_user_id, cycle_start) do nothing;

update salary_payments sp
   set cycle_id = c.id
  from salary_cycles c
 where c.restaurant_user_id = sp.restaurant_user_id
   and c.cycle_start = sp.salary_month
   and sp.cycle_id is null;
