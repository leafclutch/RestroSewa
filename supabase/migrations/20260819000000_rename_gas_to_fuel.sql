-- Rename 'gas' to 'fuel' in extra_expenses and update the category CHECK.
--
-- "Gas" reads as cooking gas to one restaurant and vehicle fuel to another; "Fuel"
-- covers both, which is what the category was always being used for.

-- 1. Existing rows. There is no separate label table — `finance_transactions`
--    renders a ledger row as `initcap(category)` and `extra_expenses_by_category`
--    returns the raw key — so the key IS the label, and renaming it means
--    rewriting the rows.
update extra_expenses
   set category = 'fuel'
 where category = 'gas';

-- 2. The CHECK. Dropping and re-adding is the only way to change one.
--
-- ⚠️ 'gas' is deliberately STILL ALLOWED, and this is the only reason the migration
-- is safe to apply in the usual DB-before-app order.
--
-- Every other migration in this repo is additive, so the database can go first and
-- the running build keeps working. A CHECK that removed 'gas' would invert that:
-- the deployed build still offers "Gas" in the expense form, so from the moment
-- this runs until the new build ships, every gas expense insert would fail on the
-- constraint with an opaque Postgres error — a live restaurant unable to file an
-- expense during the deploy window.
--
-- Accepting both keys costs nothing. Nothing writes 'gas' any more
-- (`SPENDING_CATEGORIES` in lib/expenses.ts no longer offers it), and
-- `expenseCategoryLabel` maps a stray 'gas' to "Fuel" on read, so a row written by
-- the old build during the window still displays correctly. It can be tightened to
-- fuel-only in a later migration once no build offering "Gas" is deployed anywhere
-- — check first that `select count(*) from extra_expenses where category = 'gas'`
-- is zero on every environment, since this migration only rewrites rows that
-- existed when it ran.
alter table extra_expenses drop constraint if exists extra_expenses_category_check;
alter table extra_expenses add constraint extra_expenses_category_check
  check (category in (
    'rent','electricity','water','fuel','internet',
    'maintenance','marketing','licenses','transport','other',
    'saving',
    -- Transitional; see above. Not offered by the app.
    'gas'
  ));
