-- =============================================================
-- CUSTOMER CREDITS
--
-- A bill may be closed while all or part of it is still unpaid. The unpaid
-- amount becomes a *credit* — a receivable owned by a named customer that the
-- cashier collects against over time.
--
-- Accounting model (accrual):
--   · The bill is a single, normal `payments` row for its FULL value, so a
--     credit bill still counts as sales on the day it was billed and never
--     produces a second bill.
--   · What the customer actually handed over at billing (the down payment) is
--     recorded in that row's cash/online/card split. The gap between the split
--     and total_amount IS the credit.
--   · Later repayments go to `credit_payments` ONLY — never back into
--     `payments` — so collecting a credit never double-counts as new revenue.
-- =============================================================

-- 'credit' = a bill closed with an outstanding balance. Must be added on its own
-- (Postgres forbids using a new enum value in the transaction that adds it).
alter type payment_method add value if not exists 'credit';

-- Card becomes a first-class split on a bill alongside cash/online, so a
-- part-payment at billing can be taken by card. Existing `card` rows carry their
-- value in `amount` only; the sales code falls back to that for them.
alter table payments add column if not exists card_amount numeric(10,2) not null default 0;

-- ── Credits ───────────────────────────────────────────────────────────────────
-- One row per bill closed with an unpaid balance, always linked to the
-- originating session + payment.
create table if not exists credits (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  -- Human-readable, per-restaurant credit id: CR-00001, CR-00002, …
  seq_no         int  not null,
  credit_number  text generated always as ('CR-' || lpad(seq_no::text, 5, '0')) stored,
  session_id     uuid references sessions(id) on delete set null,
  payment_id     uuid references payments(id) on delete set null,
  customer_name  text not null,
  customer_phone text,
  bill_amount    numeric(10,2) not null check (bill_amount > 0),
  -- Paid at billing time. Already banked on the `payments` row — kept here only
  -- so the credit's payment history can show it.
  down_payment   numeric(10,2) not null default 0 check (down_payment >= 0),
  -- Running total collected = down_payment + every credit_payments row.
  paid_amount    numeric(10,2) not null default 0 check (paid_amount >= 0),
  balance        numeric(10,2) generated always as (bill_amount - paid_amount) stored,
  status         text not null default 'pending'
                   check (status in ('pending', 'partially_paid', 'fully_paid')),
  notes          text,
  created_by     uuid references restaurant_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  settled_at     timestamptz,
  constraint credits_paid_within_bill check (paid_amount <= bill_amount),
  constraint credits_restaurant_seq_key unique (restaurant_id, seq_no)
);

create index if not exists credits_restaurant_id_idx on credits(restaurant_id, created_at desc);
create index if not exists credits_status_idx        on credits(restaurant_id, status);
create index if not exists credits_payment_id_idx    on credits(payment_id);
create index if not exists credits_phone_idx         on credits(restaurant_id, customer_phone);

-- ── Credit repayments (audit trail) ───────────────────────────────────────────
-- Money collected AFTER the bill was closed. The down payment taken at billing
-- is NOT in here — it lives on the payments row — so nothing is counted twice.
create table if not exists credit_payments (
  id            uuid primary key default gen_random_uuid(),
  credit_id     uuid not null references credits(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  amount        numeric(10,2) not null check (amount > 0),
  method        payment_method not null default 'cash',
  notes         text,
  received_by   uuid references restaurant_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists credit_payments_credit_idx     on credit_payments(credit_id, created_at);
create index if not exists credit_payments_restaurant_idx on credit_payments(restaurant_id, created_at desc);

-- Deny-by-default, matching every other table: RLS on with no policy, so only
-- the service role (the server actions) can read or write credit data.
alter table credits         enable row level security;
alter table credit_payments enable row level security;
