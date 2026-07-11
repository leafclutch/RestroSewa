-- =============================================================
-- STOCK & FINANCE — PHASE 1: SELLERS
--
-- A seller (supplier) is created ONCE and reused for every future purchase.
-- Each seller carries a credit account: what the restaurant still owes them.
--
-- Direction matters — this is the mirror image of `credits`:
--   · credits        = money customers owe US      (a receivable)
--   · sellers.credit_balance = money WE owe a seller (a payable)
-- They are deliberately separate tables; netting them would be wrong.
--
-- Balance movements (only ever via the DB functions):
--   opening_credit          → seeds the balance (dues carried over from paper)
--   purchase on credit      → increases it   (Phase 3)
--   payment to the seller   → decreases it   (`seller_payments`)
-- =============================================================

create table if not exists sellers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  -- Human-readable, per-restaurant seller id: SLR-00001, SLR-00002, …
  seq_no         int  not null,
  seller_code    text generated always as ('SLR-' || lpad(seq_no::text, 5, '0')) stored,
  name           text not null,
  phone          text,
  address        text,
  notes          text,
  -- Dues already owed to this seller when they were first entered (migrating
  -- from a paper ledger). Seeds credit_balance and never changes afterwards, so
  -- it stays auditable as the opening line of their history.
  opening_credit numeric(12,2) not null default 0 check (opening_credit >= 0),
  -- What we owe them RIGHT NOW. Maintained only by the credit functions.
  credit_balance numeric(12,2) not null default 0 check (credit_balance >= 0),
  is_active      boolean not null default true,
  created_by     uuid references restaurant_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint sellers_restaurant_seq_key unique (restaurant_id, seq_no)
);

-- "A seller should only be created once." Enforced in the database, not just the
-- UI: same name (case/space-insensitive) within a restaurant is rejected outright,
-- so a duplicate can't slip in through a race or a second browser tab.
create unique index if not exists sellers_restaurant_name_key
  on sellers (restaurant_id, lower(btrim(name)));

create index if not exists sellers_restaurant_idx on sellers(restaurant_id, is_active);
create index if not exists sellers_phone_idx      on sellers(restaurant_id, phone);

-- ── Payments made TO a seller, against their credit account ───────────────────
-- The audit trail for every rupee paid down. Purchases (Phase 3) are the other
-- half of the history.
create table if not exists seller_payments (
  id            uuid primary key default gen_random_uuid(),
  seller_id     uuid not null references sellers(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  amount        numeric(12,2) not null check (amount > 0),
  method        payment_method not null default 'cash',
  notes         text,
  paid_by       uuid references restaurant_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists seller_payments_seller_idx     on seller_payments(seller_id, created_at);
create index if not exists seller_payments_restaurant_idx on seller_payments(restaurant_id, created_at desc);

-- Deny-by-default like every other table: RLS on, no policies, so only the
-- service role (the server actions, which check permissions first) can touch it.
alter table sellers         enable row level security;
alter table seller_payments enable row level security;
