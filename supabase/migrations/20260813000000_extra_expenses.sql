-- =============================================================
-- EXTRA EXPENSES — the overheads that are neither stock nor people
--
-- The Finance report already had an "Expenses" section, but everything in it was
-- bought STOCK (purchases, vendor repayments) or PEOPLE (salary). Rent, the
-- electricity bill, the water tanker, the internet line — none of it had anywhere
-- to go. That money left the till and the books never learned about it, so
-- closing cash was wrong by exactly the rent and the only way to reconcile was to
-- remember.
--
-- WHY THERE IS NO "UNPAID" STATE
-- An expense row IS the payment. There is no status column, no `paid` flag, no
-- settle-later screen and no payable leg on the vendor balance. A bill that has
-- arrived but not been paid is simply not an expense yet — it is logged the day
-- the money actually leaves. That keeps this table a pure statement of fact:
-- nothing here can disagree with itself, and no background job or month-end
-- process is needed to keep it true.
--
-- This is the same shape as `purchases` minus the credit leg, deliberately: the
-- cash/online split then reads identically in every reader in the app.
-- =============================================================

create table if not exists extra_expenses (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,

  -- A CHECK rather than a bare text column, for the reason `staff_payroll` states
  -- outright about salary_type: adding a category later should be a deliberate
  -- migration, not a typo. Free text would let "Electricity", "electricity bill"
  -- and "NEA" become three different things, and the category report — the whole
  -- point of having categories — would quietly stop meaning anything.
  category       text not null check (category in (
                   'rent','electricity','water','gas','internet',
                   'maintenance','marketing','licenses','transport','other')),

  -- The specifics the category cannot carry: "July bill, NEA", "tanker x2".
  -- Optional, because a category alone is often the whole truth.
  note           text,

  amount         numeric(12,2) not null check (amount > 0),

  -- Only the ways money can actually leave. `credit` is deliberately absent: it
  -- would mean "we did not pay", which is the absence of an expense, not a kind
  -- of one — exactly the argument salary_payments makes for the same exclusion.
  payment_method payment_method not null
                   check (payment_method in ('cash','online','mixed')),

  cash_amount    numeric(12,2) not null default 0 check (cash_amount   >= 0),
  online_amount  numeric(12,2) not null default 0 check (online_amount >= 0),
  -- The guarantee the whole finance report leans on. Every reader sums
  -- cash_amount and online_amount into two different balances; if they could
  -- disagree with `amount`, cash-in-hand would drift with no way to find out why.
  constraint extra_expenses_split_check
    check (cash_amount + online_amount = amount),

  created_by     uuid references restaurant_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  -- Set when an admin corrects a row behind the Security PIN. Null means the row
  -- is as first entered.
  updated_at     timestamptz
);

-- Finance reads by restaurant + when the money moved, and that is the only way
-- anything reads this table — the report, the ledger and the page all filter to a
-- period. One index covers all three.
create index if not exists extra_expenses_finance_idx
  on extra_expenses(restaurant_id, created_at desc);

-- Deny-by-default, exactly like every other table here: RLS on, no policies. The
-- browser never reads this directly — only the permission-checked server actions,
-- through the service role.
alter table extra_expenses enable row level security;

grant select, insert, update, delete on table extra_expenses to service_role;

notify pgrst, 'reload schema';
