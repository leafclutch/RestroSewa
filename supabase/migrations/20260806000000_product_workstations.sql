-- =============================================================
-- PRODUCT → WORKSTATION MAPPING
--
-- Menu items have always carried a workstation: `menu_items.workstation_id` is
-- NOT NULL and cascaded from the category, and it is what routes a sold line
-- onto a KOT/BOT and rings the right station. PRODUCTS never had one, so the
-- stock list is a single undifferentiated page — a hotel sees chicken, whisky
-- and bath towels in the same ten rows with no way to ask what the Bar holds.
--
-- WHAT THIS IS: organisational metadata, and nothing more. It does not touch the
-- derived-stock pipeline (`stock_report`, `product_history`,
-- `order_item_consumption` are all unchanged), so what a sale deducts is exactly
-- what it deducted before. A product with no station keeps working and simply
-- reads as "Unassigned".
--
-- WHY A JOIN TABLE and not a column: one product legitimately belongs to several
-- stations (coffee beans are drawn on by the Bar AND the kitchen). This mirrors
-- `restaurant_user_workstations`, the M2M that already assigns staff to
-- stations, so there is one shape for "belongs to N workstations" in the schema.
-- =============================================================

create table if not exists product_workstations (
  -- Carried DELIBERATELY, unlike restaurant_user_workstations. Every read in this
  -- app is scoped by restaurant_id; the one table that omits it
  -- (session_order_items) has already caused queries to filter on a column that
  -- isn't there and fail silently. Here it also means the reverse lookup — "what
  -- does this station hold" — needs no join back to products.
  restaurant_id  uuid not null references restaurants(id)  on delete cascade,
  product_id     uuid not null references products(id)     on delete cascade,
  -- `cascade`, where menu_categories/menu_items use `restrict`. That difference
  -- is the point: a menu item without a station cannot print, so deleting a
  -- station it uses must be refused. A product without a station is a perfectly
  -- normal product, so deleting a station should quietly unassign it rather than
  -- block the delete on data that carries no meaning of its own.
  workstation_id uuid not null references workstations(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (product_id, workstation_id)
);

-- The station-first lookup ("everything the Bar holds"); the product-first one is
-- already served by the primary key.
create index if not exists product_workstations_restaurant_idx
  on product_workstations (restaurant_id, workstation_id);

-- Deny by default, like every other table: reached only through the service role.
alter table product_workstations enable row level security;

-- Explicit, even though 20260801000000 sets default privileges for future tables:
-- those defaults belong to the role that declared them, and this migration may be
-- replayed by a different one when a database is built from scratch.
grant select, insert, update, delete on table product_workstations to service_role;

-- ── Replace a product's stations ──────────────────────────────────────────────
-- The whole set, in one transaction, so a product is never briefly assigned to
-- nothing while an update is in flight.
--
-- Cross-tenant ids are FILTERED OUT rather than raising: the id list comes from a
-- form, and the honest response to "save these four stations, one of which isn't
-- yours" is to save the three that are. The product itself is checked properly —
-- writing stations onto another restaurant's product is the failure that matters.
create or replace function set_product_workstations(
  p_restaurant_id    uuid,
  p_product_id       uuid,
  p_workstation_ids  uuid[]
) returns void
language plpgsql
as $$
begin
  perform 1
     from products
    where id = p_product_id and restaurant_id = p_restaurant_id
    for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  delete from product_workstations where product_id = p_product_id;

  -- An empty or null array clears the mapping, which is how a product goes back
  -- to Unassigned.
  insert into product_workstations (restaurant_id, product_id, workstation_id)
  select p_restaurant_id, p_product_id, w.id
    from workstations w
   where w.restaurant_id = p_restaurant_id
     and w.id = any(coalesce(p_workstation_ids, '{}'::uuid[]))
  on conflict do nothing;
end;
$$;

revoke all on function set_product_workstations(uuid, uuid, uuid[]) from public;
grant execute on function set_product_workstations(uuid, uuid, uuid[]) to service_role;
