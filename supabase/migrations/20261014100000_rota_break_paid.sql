-- =============================================================
-- ROTA: PAID OR UNPAID BREAK
--
-- A shift's break was always unpaid — deducted from the paid hours. Some employers
-- pay breaks (e.g. a short rest break on a long shift), so each shift now says which.
-- Default false keeps every existing shift exactly as it was.
--
-- `rota_shift_hours` is re-issued with one change: the break comes off only when
-- `break_paid` is false. Mirrors `shiftPaidHours` in lib/rota.ts; keep them in sync.
-- =============================================================

alter table rota_shifts
  add column if not exists break_paid boolean not null default false;

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
          - case when p_shift.break_paid then 0 else p_shift.break_minutes end
        ) / 60.0,
        0
      )::numeric, 4)
    when 'holiday' then coalesce(p_shift.paid_hours, 0)
    else 0
  end;
$$;

revoke all on function rota_shift_hours(rota_shifts) from public;
grant execute on function rota_shift_hours(rota_shifts) to service_role;
