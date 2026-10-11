-- =============================================================
-- The joining date is a RECORD, not a payroll input.
--
-- Payroll for a person starts at their SALARY START — their first salary's
-- effective date, which is also where their first cycle begins. The joining date
-- only says when they joined: it can be edited any time and never changes what
-- is owed, which cycles exist, or who appears on the payroll sheet.
--
-- Why: tying payroll to the joining date (20261012000000's checks) meant a
-- joining date recorded long before the agreed salary produced months or cycles
-- that should not exist, and an edit to it could be refused for unrelated money.
--
-- This removes every joining-date rule from the payroll functions, adds a
-- record-only setter, and makes the sheet list a person once their salary has
-- started rather than once they joined.
-- =============================================================

-- ── Set (or revise) a salary: no joining-date rules ────────────────────────────
create or replace function set_staff_salary(
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

  v_eff := coalesce(p_effective_from, current_date);

  -- The joining date is only recorded here (first setup, or as given).
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

-- ── The joining date on its own ───────────────────────────────────────────────
create or replace function set_joining_date(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_date          date
)
returns void
language plpgsql
as $$
begin
  if p_date is null then
    raise exception 'JOINING_DATE_REQUIRED';
  end if;
  update staff_payroll
     set joining_date = p_date,
         updated_at   = now()
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;
end;
$$;

revoke all on function set_joining_date(uuid, uuid, date) from public;
grant execute on function set_joining_date(uuid, uuid, date) to service_role;

-- ── Correct a salary change: no joining-date rule ─────────────────────────────
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
begin
  if p_salary is null or p_salary < 0 then
    raise exception 'INVALID_SALARY';
  end if;
  perform 1 from staff_payroll
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
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

-- ── Set, move or clear a salary cycle: no joining-date rule ───────────────────
create or replace function set_cycle_anchor(
  p_restaurant_id uuid,
  p_staff_id      uuid,
  p_anchor        date,
  p_length        int default 30
)
returns date
language plpgsql
as $$
declare
  v_locked   date;
  v_anchor   date;
begin
  if p_length is null or p_length < 1 or p_length > 366 then
    raise exception 'INVALID_CYCLE_LENGTH';
  end if;

  perform 1 from staff_payroll
   where restaurant_user_id = p_staff_id and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'PAYROLL_NOT_SET';
  end if;

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

-- ── The sheet lists people whose SALARY has started ───────────────────────────
-- Identical to 20260824000000 except the `staff` filter.
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
