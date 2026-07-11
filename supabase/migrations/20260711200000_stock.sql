-- =============================================================
-- STOCK & FINANCE — PHASE 2: STOCK
--
-- Stock is DERIVED, never stored as a running total. A product's level at any
-- moment is:
--
--   opening_stock                     (seeded once, at product creation)
--   + purchases                       (Phase 3 — from purchase_items)
--   - usage                           (LIVE from session_order_items via the
--                                      menu_item → product link)
--   + adjustments                     (manual corrections / wastage)
--
-- Why derived rather than a `current_stock` column:
--   · Sales and purchases are ALREADY recorded by the POS and the purchase
--     ledger. Writing a second stock row for each would duplicate that data —
--     and a cached total can drift out of sync with it; a derived one cannot.
--   · The "yesterday → today" rollover then needs NO nightly job. Yesterday's
--     stock is just the same sum evaluated at midnight, so it is always exact,
--     for any date, even retrospectively.
-- =============================================================

create table if not exists products (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references restaurants(id) on delete cascade,
  seq_no              int  not null,
  product_code        text generated always as ('PRD-' || lpad(seq_no::text, 5, '0')) stored,
  name                text not null,
  -- Free text (bottle, kg, litre, packet…). One unit per product — purchases,
  -- usage and adjustments are all expressed in it, so no conversion is possible
  -- (or needed): buy in the unit you sell in.
  unit                text not null,
  -- Stock on hand when the product was first entered. Counted from created_at,
  -- so it lands in "yesterday" from the following day onward.
  opening_stock       numeric(12,3) not null default 0,
  low_stock_threshold numeric(12,3) not null default 0 check (low_stock_threshold >= 0),
  -- Most recent purchase price, maintained by Phase 3. Drives inventory value
  -- and the estimated-profit card in Phase 5.
  last_unit_cost      numeric(12,2) not null default 0 check (last_unit_cost >= 0),
  is_active           boolean not null default true,
  created_by          uuid references restaurant_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint products_restaurant_seq_key unique (restaurant_id, seq_no)
);

-- One product per name per restaurant — same rule as sellers, enforced in the DB
-- so a duplicate can't slip through a race or a second tab.
create unique index if not exists products_restaurant_name_key
  on products (restaurant_id, lower(btrim(name)));

create index if not exists products_restaurant_idx on products(restaurant_id, is_active);

-- ── Menu item → product link ──────────────────────────────────────────────────
-- What a menu item consumes when it sells. The UNIQUE on menu_item_id is what
-- makes this 1:1 (one product per menu item) — the chosen model. Dropping that
-- one constraint turns this into a full multi-ingredient recipe table later,
-- with no other schema change.
--
-- A menu item with NO link deducts nothing when sold (cooked dishes, by design).
create table if not exists menu_item_products (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  menu_item_id  uuid not null unique references menu_items(id) on delete cascade,
  product_id    uuid not null references products(id) on delete cascade,
  -- Units of the product consumed per ONE menu item sold (e.g. 1 bottle, or
  -- 0.33 for a third of a litre).
  qty_per_unit  numeric(12,3) not null default 1 check (qty_per_unit > 0),
  created_at    timestamptz not null default now()
);

create index if not exists menu_item_products_product_idx on menu_item_products(product_id);
create index if not exists menu_item_products_restaurant_idx on menu_item_products(restaurant_id);

-- ── Manual stock movements ────────────────────────────────────────────────────
-- ONLY corrections and wastage live here. Sales and purchases do NOT — they are
-- read from the POS and purchase tables directly, so nothing is double-counted.
create table if not exists stock_adjustments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  product_id    uuid not null references products(id) on delete cascade,
  kind          text not null check (kind in ('adjustment', 'wastage')),
  -- Signed: positive adds stock (found/returned), negative removes it (spoiled,
  -- broken, miscounted). Never zero.
  qty           numeric(12,3) not null check (qty <> 0),
  notes         text,
  created_by    uuid references restaurant_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists stock_adjustments_product_idx    on stock_adjustments(product_id, created_at);
create index if not exists stock_adjustments_restaurant_idx on stock_adjustments(restaurant_id, created_at desc);

-- Deny-by-default, like every other table: service role only.
alter table products           enable row level security;
alter table menu_item_products enable row level security;
alter table stock_adjustments  enable row level security;
