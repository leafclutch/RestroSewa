-- =============================================================
-- A joining date may not be later than the person's first salary.
--
-- Pay counts from the salary start (20261012300000); the joining date is a
-- record of when they joined. Where the record says they joined AFTER their
-- salary had already started, the record is the thing that is wrong — so the
-- joining date is brought back to the first salary's date.
--
-- Only `staff_payroll.joining_date` changes. No salary, cycle or payment row is
-- touched, and since the joining date no longer drives pay, nothing owed moves.
--
-- Idempotent: a second run finds nothing to change.
-- =============================================================

update staff_payroll pr
   set joining_date = s.first_salary,
       updated_at   = now()
  from (
    select restaurant_user_id, min(effective_from) as first_salary
      from staff_salaries
     group by restaurant_user_id
  ) s
 where s.restaurant_user_id = pr.restaurant_user_id
   and s.first_salary < pr.joining_date;
