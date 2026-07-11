-- =============================================================
-- STOCK & FINANCE — PHASE 3: PURCHASES
--
-- Buying stock from a seller. One purchase is one supplier bill and may carry
-- several products, which is how a real invoice arrives.
--
-- A purchase is the single source of THREE things — it is never copied:
--   · Stock in     — `stock_report` reads purchase_items directly (Phase 2).
--   · Seller credit— a credit purchase raises sellers.credit_balance (Phase 1).
--   · Expense      — a cash/online purchase IS today's spend (Phase 4 reads it).
-- =============================================================

create table if not exists purchases (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  seq_no         int  not null,
  purchase_code  text generated always as ('PUR-' || lpad(seq_no::text, 5, '0')) stored,
  -- `restrict`: a seller with purchase history can never be deleted out from
  -- under it. (Sellers are deactivated, not deleted, anyway.)
  seller_id      uuid not null references sellers(id) on delete restrict,
  -- How the bill was settled. 'credit' means all or part of it is still owed.
  payment_method payment_method not null,
  total_amount   numeric(12,2) not null check (total_amount > 0),
  -- What was actually handed over now…
  cash_amount    numeric(12,2) not null default 0 check (cash_amount   >= 0),
  online_amount  numeric(12,2) not null default 0 check (online_amount >= 0),
  -- …and what went onto the seller's account.
  credit_amount  numeric(12,2) not null default 0 check (credit_amount >= 0),
  notes          text,
  created_by     uuid references restaurant_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint purchases_restaurant_seq_key unique (restaurant_id, seq_no),
  -- The money must always add up. Enforced here so no code path — now or later —
  -- can produce a purchase whose parts don't reconcile to its total.
  constraint purchases_amounts_balance
    check (cash_amount + online_amount + credit_amount = total_amount)
);

create index if not exists purchases_restaurant_idx on purchases(restaurant_id, created_at desc);
create index if not exists purchases_seller_idx     on purchases(seller_id, created_at desc);

-- ── Purchase lines ────────────────────────────────────────────────────────────
-- Read directly by `stock_report` as the "Purchased" term — no separate stock row
-- is written, so a purchase and its stock effect can never disagree.
create table if not exists purchase_items (
  id            uuid primary key default gen_random_uuid(),
  purchase_id   uuid not null references purchases(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  product_id    uuid not null references products(id) on delete restrict,
  quantity      numeric(12,3) not null check (quantity > 0),
  unit_cost     numeric(12,2) not null check (unit_cost >= 0),
  line_total    numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored,
  created_at    timestamptz not null default now()
);

create index if not exists purchase_items_purchase_idx on purchase_items(purchase_id);
create index if not exists purchase_items_product_idx  on purchase_items(product_id);

alter table purchases      enable row level security;
alter table purchase_items enable row level security;
