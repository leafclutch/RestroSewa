-- =============================================================
-- Everyone on their own salary cycle — starting at their SALARY START.
--
-- The setup form no longer offers "calendar month": one model (a salary start =
-- first cycle, and a length) replaces two, and with it the second code path that
-- kept the sheet, the cycle panel and Finance disagreeing.
--
-- Staff still on calendar months are anchored at the later of:
--   • their first salary's effective date — payroll starts there, never at the
--     joining date, which is only a record (20261012300000); and
--   • the day after their last paid period — a month already paid without a
--     cycle stays exactly as it was (history and Finance keep reading it as a
--     month), so no paid money is re-bucketed.
-- Someone with no salary row at all falls back to their joining date.
-- No salary rows are moved. Length stays whatever they had (30 unless changed).
--
-- Idempotent: only touches rows whose anchor is still null.
-- =============================================================

update staff_payroll pr
   set cycle_anchor_date = greatest(
         coalesce(
           (select min(s.effective_from)
              from staff_salaries s
             where s.restaurant_user_id = pr.restaurant_user_id),
           pr.joining_date
         ),
         coalesce((
           select max(paid_until) + 1
             from (
               select max(c.cycle_end) as paid_until
                 from salary_cycles c
                where c.restaurant_user_id = pr.restaurant_user_id
               union all
               select max((sp.salary_month + interval '1 month - 1 day')::date)
                 from salary_payments sp
                where sp.restaurant_user_id = pr.restaurant_user_id
                  and sp.cycle_id is null
             ) p
         ), '-infinity'::date)
       ),
       updated_at = now()
 where pr.cycle_anchor_date is null;
