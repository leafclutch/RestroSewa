-- Rename 'gas' to 'fuel' in extra_expenses and update category check constraint

-- 1. Update any existing historical records
update extra_expenses
   set category = 'fuel'
 where category = 'gas';

-- 2. Widen/update the category CHECK constraint replacing 'gas' with 'fuel'
alter table extra_expenses drop constraint if exists extra_expenses_category_check;
alter table extra_expenses add constraint extra_expenses_category_check
  check (category in (
    'rent','electricity','water','fuel','internet',
    'maintenance','marketing','licenses','transport','other',
    'saving'
  ));
