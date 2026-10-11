-- =============================================================
-- Payroll setup, cycles and the sheet working as ONE unit.
--
-- What was broken (all observed on the Staff → Payroll screen):
--
--   • Editing a salary changed nothing the admin could see. Each cycle froze the
--     salary in force on the day it opened; a raise saved today only reached the
--     NEXT cycle, while the sheet, the edit form and the cycle panel all kept
--     showing the frozen figure.
--   • "Effective from" was cut to the 1st of a month (the CHECK that demanded it
--     was dropped in 20260824000000, but set_staff_salary still truncated), and a
--     revision could never be corrected or removed — saving another month just
--     stacked a second row.
--   • An effective date before the joining date was silently moved.
--   • Changing a cycle start silently jumped PAST every existing cycle, paid or
--     not, so correcting a mistyped start date had no visible effect.
--   • payroll_summary's "owed" ignored attendance for calendar-month staff, so
--     Finance and the sheet disagreed about the same person.
--
-- THE ONE RULE, used everywhere from here on:
--   A cycle (or a calendar month, for staff with no cycle) is paid at the salary
--   in force on its FIRST day — or, if none was in force yet (someone who joined
--   part-way through), at their first salary.
--   → salary_for_cycle(staff, start, end)
--
-- And a salary change now re-prices every cycle it governs, unless a cycle has
-- already been paid MORE than the new figure would owe — that one keeps its old
-- salary (nothing is clawed back), and the caller is told how many were kept.
--
-- Idempotent; safe to re-run.
-- =============================================================

-- ── The rule ──────────────────────────────────────────────────────────────────
create or replace function salary_for_cycle(
  p_staff_id uuid,
  p_start    date,
  p_end      date
)
returns numeric
language sql
stable
as $$
  select coalesce(
    salary_for_date(p_staff_id, p_start),
    (select s.monthly_salary
       from staff_salaries s
      where s.restaurant_user_id = p_staff_id
        and s.effective_from <= p_end
      order by s.effective_from asc
      limit 1)
  );
$$;

revoke all on function salary_for_cycle(uuid, date, date) from public;
grant execute on function salary_for_cycle(uuid, date, date) to service_role;

-- Calendar-month staff go through this. Same signature; now the same rule, so a
-- salary that starts mid-month (a mid-month joiner) still covers that month.
create or replace function salary_for_month(
  p_staff_id uuid,
  p_month    date
)
returns numeric
language sql
stable
as $$
  select salary_for_cycle(
    p_staff_id,
    date_trunc('month', p_month)::date,
    (date_trunc('month', p_month) + interval '1 month - 1 day')::date
  );
$$;

revoke all on function salary_for_month(uuid, date) from public;
grant execute on function salary_for_month(uuid, date) to service_role;

-- ── Re-price cycles after a salary change ─────────────────────────────────────
-- Every cycle starting on/after p_from takes the salary the rule now gives it.
-- Returns how many were KEPT at their old salary because they are already paid
-- beyond what the new one would owe.
create or replace function resnapshot_salary_cycles(
  p_staff_id uuid,
  p_from     date
)
returns integer
language plpgsql
as $$
declare
  c        salary_cycles;
  v_salary numeric;
  v_owes   numeric;
  v_paid   numeric;
  v_kept   integer := 0;
begin
  for c in
    select * from salary_cycles
     where restaurant_user_id = p_staff_id
       and cycle_end >= p_from
     order by cycle_start
  loop
    v_salary := coalesce(salary_for_cycle(p_staff_id, c.cycle_start, c.cycle_end), 0);
    continue when v_salary = c.monthly_salary_snapshot;

    v_owes := round(
      v_salary
        * cycle_payable_days(p_staff_id, c.cycle_start, c.cycle_end, c.total_days)
        / nullif(c.total_days, 0),
      2);
    select coalesce(sum(amount), 0) into v_paid
      from salary_payments where cycle_id = c.id;

    if v_paid > v_owes + 0.005 then
      v_kept := v_kept + 1;
      continue;
    end if;

    update salary_cycles
       set monthly_salary_snapshot = v_salary,
           daily_rate              = v_salary / total_days
     where id = c.id;
  end loop;

  return v_kept;
end;
$$;

revoke all on function resnapshot_salary_cycles(uuid, date) from public;
grant execute on function resnapshot_salary_cycles(uuid, date) to service_role;

-- ── Cycles open at the rule's salary ──────────────────────────────────────────
-- Identical to 20260824000000 except the snapshot line: salary_for_cycle rather
-- than salary_for_date, so a first cycle opening the day someone joins (before
-- their salary row's date) is not frozen at zero.
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

  for v_i in 0 .. v_idx loop
    v_start := v_pr.cycle_anchor_date + (v_i * v_pr.cycle_length_days);
    v_end   := v_start + (v_pr.cycle_length_days - 1);

    select id into v_id
      from salary_cycles
     where restaurant_user_id = p_staff_id and cycle_start = v_start;

    if v_id is null then
      v_salary := coalesce(salary_for_cycle(p_staff_id, v_start, v_end), 0);

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

-- ── Set (or revise) a salary ──────────────────────────────────────────────────
-- Now returns the number of cycles kept at their old salary (0 almost always).
drop function if exists set_staff_salary(uuid, uuid, numeric, date, date, uuid);

create function set_staff_salary(
  p_restaurant_id  uuid,
  p_staff_id       uuid,
  p_monthly_salary numeric,
  p_joining_date   date,
  p_effective_from date,
  p_by             uuid
)
returns integer
language plpgsql
as $$
declare
  v_eff date;
begin
  if p_monthly_salary is null or p_monthly_salary < 0 then
    raise exception 'INVALID_SALARY';
  end if;
  if p_joining_date is null then
    raise exception 'JOINING_DATE_REQUIRED';
  end if;

  if not exists (
    select 1 from restaurant_users
     where id = p_staff_id and restaurant_id = p_restaurant_id and deleted_at is null
  ) then
    raise exception 'STAFF_NOT_FOUND';
  end if;

  -- Any day, as given. Before the joining date is a mistake to report, not to fix.
  v_eff := coalesce(p_effective_from, current_date);
  if v_eff < p_joining_date then
    raise exception 'EFFECTIVE_BEFORE_JOINING';
  end if;

  -- A later joining date must not orphan money already paid before it.
  if exists (
    select 1 from salary_payments sp
      left join salary_cycles c on c.id = sp.cycle_id
     where sp.restaurant_user_id = p_staff_id
       and coalesce(c.cycle_end,
                    (sp.salary_month + interval '1 month - 1 day')::date) < p_joining_date
  ) then
    raise exception 'PAYMENTS_BEFORE_JOINING';
  end if;
  -- Unpaid cycles that now end before they joined owe nothing: drop them.
  delete from salary_cycles c
   where c.restaurant_user_id = p_staff_id
     and c.cycle_end < p_joining_date
     and not exists (select 1 from salary_payments sp where sp.cycle_id = c.id);

  insert into staff_payroll (restaurant_id, restaurant_user_id, joining_date, created_by)
  values (p_restaurant_id, p_staff_id, p_joining_date, p_by)
  on conflict (restaurant_user_id) do update
    set joining_date = excluded.joining_date,
        updated_at   = now();

  insert into staff_salaries (restaurant_id, restaurant_user_id, monthly_salary, effective_from, created_by)
  values (p_restaurant_id, p_staff_id, p_monthly_salary, v_eff, p_by)
  on conflict (restaurant_user_id, effective_from) do update
    set monthly_salary = excluded.monthly_salary,
        created_by     = excluded.created_by,
        created_at     = now();

  return resnapshot_salary_cycles(p_staff_id, v_eff);
end;
$$;

revoke all on function set_staff_salary(uuid, uuid, numeric, date, date, uuid) from public;
grant execute on function set_staff_salary(uuid, uuid, numeric, date, date, uuid) to service_role;

-- ── Correct or remove a salary change ─────────────────────────────────────────
create or replace function update_salary_revision(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_old_from      date,
  p_new_from      date,
  p_salary        numeric,
  p_by            uuid
)
returns integer
language plpgsql
as $$
declare
  v_joining date;
begin
  if p_salary is null or p_salary < 0 then
    raise exception 'INVALID_SALARY';
  end if;
  select joining_date into v_joining
    from staff_payroll
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;
  if p_new_from < v_joining then
    raise exception 'EFFECTIVE_BEFORE_JOINING';
  end if;

  delete from staff_salaries
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id
     and effective_from = p_old_from;
  if not found then
    raise exception 'REVISION_NOT_FOUND';
  end if;

  insert into staff_salaries (restaurant_id, restaurant_user_id, monthly_salary, effective_from, created_by)
  values (p_restaurant_id, p_staff_id, p_salary, p_new_from, p_by)
  on conflict (restaurant_user_id, effective_from) do update
    set monthly_salary = excluded.monthly_salary,
        created_by     = excluded.created_by,
        created_at     = now();

  return resnapshot_salary_cycles(p_staff_id, least(p_old_from, p_new_from));
end;
$$;

revoke all on function update_salary_revision(uuid, uuid, date, date, numeric, uuid) from public;
grant execute on function update_salary_revision(uuid, uuid, date, date, numeric, uuid) to service_role;

create or replace function delete_salary_revision(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_from          date
)
returns integer
language plpgsql
as $$
begin
  perform 1 from staff_payroll
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;
  -- Someone on payroll always has a salary; the last one can be changed, not removed.
  if (select count(*) from staff_salaries where restaurant_user_id = p_staff_id) <= 1 then
    raise exception 'LAST_REVISION';
  end if;

  delete from staff_salaries
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id
     and effective_from = p_from;
  if not found then
    raise exception 'REVISION_NOT_FOUND';
  end if;

  return resnapshot_salary_cycles(p_staff_id, p_from);
end;
$$;

revoke all on function delete_salary_revision(uuid, uuid, date) from public;
grant execute on function delete_salary_revision(uuid, uuid, date) to service_role;

-- ── Set, move or clear a salary cycle ─────────────────────────────────────────
-- Now returns the anchor actually used. Cycles that hold NOTHING — no payment,
-- attendance not verified — after the last one that does are replaced by the new
-- anchor instead of being jumped over, so correcting a mistyped start date takes
-- effect. A null anchor puts the person back on calendar months.
drop function if exists set_cycle_anchor(uuid, uuid, date, int);

create function set_cycle_anchor(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_anchor        date,
  p_length        int default 30
)
returns date
language plpgsql
as $$
declare
  v_joining  date;
  v_locked   date;
  v_anchor   date;
begin
  if p_length is null or p_length < 1 or p_length > 366 then
    raise exception 'INVALID_CYCLE_LENGTH';
  end if;

  select joining_date into v_joining
    from staff_payroll
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;
  if p_anchor is not null and p_anchor < v_joining then
    raise exception 'ANCHOR_BEFORE_JOINING';
  end if;

  -- The last cycle anything has been recorded against. Everything after it is
  -- an empty placeholder the old anchor generated, and goes.
  select max(c.cycle_end) into v_locked
    from salary_cycles c
   where c.restaurant_user_id = p_staff_id
     and (c.attendance_verified_at is not null
          or exists (select 1 from salary_payments sp where sp.cycle_id = c.id));

  delete from salary_cycles c
   where c.restaurant_user_id = p_staff_id
     and (v_locked is null or c.cycle_start > v_locked)
     and c.attendance_verified_at is null
     and not exists (select 1 from salary_payments sp where sp.cycle_id = c.id);

  v_anchor := p_anchor;
  if v_anchor is not null then
    -- Only a cycle that holds money or verified attendance still blocks.
    while v_locked is not null and v_anchor <= v_locked loop
      v_anchor := v_anchor + p_length;
    end loop;
  end if;

  update staff_payroll
     set cycle_anchor_date = v_anchor,
         cycle_length_days = p_length,
         updated_at        = now()
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id;

  return v_anchor;
end;
$$;

revoke all on function set_cycle_anchor(uuid, uuid, date, int) from public;
grant execute on function set_cycle_anchor(uuid, uuid, date, int) to service_role;

-- ── Finance's "salary outstanding" agrees with the sheet ──────────────────────
-- Identical to 20260824000000 except `month_owed`: a calendar month now owes
-- the rule's salary scaled by attendance, exactly as payroll_cycle_sheet and
-- record_salary_payment compute it — not the bare salary.
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

-- ── Bring existing cycles onto the rule ───────────────────────────────────────
-- Cycles opened before today froze whatever salary_for_date said on their first
-- day — 0 for a first cycle that opened before the salary row's date. Re-price
-- every staff member once, under the same never-claw-back guard.
do $$
declare
  s record;
begin
  for s in select distinct restaurant_user_id from salary_cycles loop
    perform resnapshot_salary_cycles(s.restaurant_user_id, '1900-01-01'::date);
  end loop;
end;
$$;
