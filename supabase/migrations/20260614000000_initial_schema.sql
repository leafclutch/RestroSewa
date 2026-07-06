-- =============================================================
-- RestroSewa — Initial Schema
-- Applied: 2026-06-14
-- =============================================================

-- =============================================================
-- EXTENSIONS
-- =============================================================

create extension if not exists "pgcrypto";

-- =============================================================
-- ENUMS
-- =============================================================

create type restaurant_type as enum (
  'restaurant', 'cafe', 'lodge', 'guesthouse', 'hotel', 'resort'
);

create type subscription_tier as enum ('free', 'basic', 'pro');

create type user_role as enum ('restaurant_admin', 'restaurant_employee');

create type room_status as enum ('available', 'occupied', 'cleaning', 'maintenance');

create type room_stay_status as enum ('active', 'checked_out');

create type room_charge_type as enum (
  'room_rate', 'laundry', 'mini_bar', 'extra_bed', 'other'
);

create type session_type as enum ('table', 'walk_in', 'credit', 'room_service');

create type session_status as enum ('active', 'closed');

create type order_status as enum (
  'pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled'
);

create type item_status as enum ('pending', 'ready', 'served');

create type payment_method as enum ('cash', 'card', 'upi', 'other');

create type notification_type as enum (
  'call_waiter',
  'request_bill',
  'call_reception',
  'call_housekeeping',
  'call_restaurant',
  'request_maintenance'
);

create type notification_status as enum ('pending', 'resolved');

-- =============================================================
-- RESTAURANTS
-- =============================================================

create table restaurants (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text unique not null,
  type                  restaurant_type not null default 'restaurant',
  is_active             boolean not null default true,
  subscription_tier     subscription_tier not null default 'free',
  subscription_expires_at timestamptz,
  settings              jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

-- =============================================================
-- SUPER ADMINS (platform owners, separate from restaurant users)
-- =============================================================

create table super_admins (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

-- =============================================================
-- RESTAURANT USERS (all staff: admins + employees)
-- Synthetic email: emp-{user_id}-{restaurant_id}@restrosewa.internal
-- PIN = Supabase password
-- =============================================================

create table restaurant_users (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  display_name  text not null,
  title         text not null default '',
  role          user_role not null default 'restaurant_employee',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index restaurant_users_restaurant_id_idx on restaurant_users(restaurant_id);
create index restaurant_users_auth_user_id_idx  on restaurant_users(auth_user_id);

-- =============================================================
-- WORKSTATIONS (Kitchen, Bar, Coffee Counter, etc.)
-- Created by Super Admin only. Restaurant Admin assigns menu + users.
-- =============================================================

create table workstations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  display_color text,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index workstations_restaurant_id_idx on workstations(restaurant_id);

create table restaurant_user_workstations (
  restaurant_user_id uuid not null references restaurant_users(id) on delete cascade,
  workstation_id     uuid not null references workstations(id) on delete cascade,
  primary key (restaurant_user_id, workstation_id)
);

-- =============================================================
-- TABLE GROUPS & RESTAURANT TABLES
-- =============================================================

create table table_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index table_groups_restaurant_id_idx on table_groups(restaurant_id);

create table restaurant_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  group_id      uuid references table_groups(id) on delete set null,
  number        text not null,
  qr_token      uuid unique not null default gen_random_uuid(),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index restaurant_tables_restaurant_id_idx on restaurant_tables(restaurant_id);
create index restaurant_tables_qr_token_idx      on restaurant_tables(qr_token);

-- =============================================================
-- ROOMS
-- =============================================================

create table room_types (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  description   text,
  base_price    numeric(10,2) not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index room_types_restaurant_id_idx on room_types(restaurant_id);

create table rooms (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  room_type_id  uuid not null references room_types(id) on delete restrict,
  number        text not null,
  qr_token      uuid unique not null default gen_random_uuid(),
  status        room_status not null default 'available',
  created_at    timestamptz not null default now()
);

create index rooms_restaurant_id_idx on rooms(restaurant_id);
create index rooms_qr_token_idx      on rooms(qr_token);

create table room_stays (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  room_id       uuid not null references rooms(id) on delete restrict,
  guest_name    text not null,
  guest_phone   text,
  guest_count   int not null default 1,
  room_rate     numeric(10,2) not null,
  check_in_at   timestamptz not null default now(),
  check_out_at  timestamptz,
  status        room_stay_status not null default 'active',
  notes         text,
  created_at    timestamptz not null default now()
);

create index room_stays_restaurant_id_idx on room_stays(restaurant_id);
create index room_stays_room_id_idx       on room_stays(room_id);
create index room_stays_status_idx        on room_stays(status);

create table room_charges (
  id            uuid primary key default gen_random_uuid(),
  room_stay_id  uuid not null references room_stays(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  type          room_charge_type not null default 'other',
  description   text not null,
  amount        numeric(10,2) not null,
  created_by    uuid references restaurant_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index room_charges_room_stay_id_idx on room_charges(room_stay_id);

-- =============================================================
-- CREDIT CUSTOMERS
-- =============================================================

create table credit_customers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  phone         text,
  balance       numeric(10,2) not null default 0,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index credit_customers_restaurant_id_idx on credit_customers(restaurant_id);

-- =============================================================
-- MENU
-- menu_categories.workstation_id — default workstation for the category
-- menu_items.workstation_id     — resolved workstation (NOT NULL, may override category)
-- =============================================================

create table menu_categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  workstation_id uuid not null references workstations(id) on delete restrict,
  name          text not null,
  description   text,
  image_url     text,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index menu_categories_restaurant_id_idx on menu_categories(restaurant_id);

create table menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id   uuid not null references menu_categories(id) on delete restrict,
  workstation_id uuid not null references workstations(id) on delete restrict,
  name          text not null,
  description   text,
  price         numeric(10,2) not null,
  image_url     text,
  is_available  boolean not null default true,
  has_variants  boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index menu_items_restaurant_id_idx  on menu_items(restaurant_id);
create index menu_items_category_id_idx    on menu_items(category_id);
create index menu_items_workstation_id_idx on menu_items(workstation_id);

create table menu_item_variants (
  id           uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name         text not null,
  price        numeric(10,2) not null,
  is_available boolean not null default true,
  sort_order   int not null default 0
);

create index menu_item_variants_item_id_idx on menu_item_variants(menu_item_id);

create table menu_item_addons (
  id           uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name         text not null,
  price        numeric(10,2) not null default 0,
  is_available boolean not null default true,
  sort_order   int not null default 0
);

create index menu_item_addons_item_id_idx on menu_item_addons(menu_item_id);

-- =============================================================
-- SESSIONS (unified billing unit for all order types)
-- Only one source FK is set per row, matching the session type.
-- =============================================================

create table sessions (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references restaurants(id) on delete cascade,
  type                session_type not null default 'table',
  table_id            uuid references restaurant_tables(id) on delete set null,
  room_stay_id        uuid references room_stays(id) on delete set null,
  credit_customer_id  uuid references credit_customers(id) on delete set null,
  status              session_status not null default 'active',
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz
);

create index sessions_restaurant_id_idx on sessions(restaurant_id);
create index sessions_table_id_idx      on sessions(table_id);
create index sessions_room_stay_id_idx  on sessions(room_stay_id);
create index sessions_status_idx        on sessions(status);

-- =============================================================
-- ORDERS & ITEMS
-- =============================================================

create table session_orders (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  created_by    uuid references restaurant_users(id) on delete set null,
  status        order_status not null default 'pending',
  notes         text,
  created_at    timestamptz not null default now()
);

create index session_orders_session_id_idx on session_orders(session_id);
create index session_orders_status_idx     on session_orders(status);

create table session_order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references session_orders(id) on delete cascade,
  -- Live references (nullable: item may be deleted after order)
  menu_item_id   uuid references menu_items(id) on delete set null,
  variant_id     uuid references menu_item_variants(id) on delete set null,
  workstation_id uuid references workstations(id) on delete set null,
  -- Immutable snapshots — never change after submission
  item_name      text not null,
  item_price     numeric(10,2) not null,
  workstation_name text,
  quantity       int not null default 1 check (quantity > 0),
  item_status    item_status not null default 'pending',
  notes          text,
  created_at     timestamptz not null default now()
);

create index session_order_items_order_id_idx      on session_order_items(order_id);
create index session_order_items_workstation_id_idx on session_order_items(workstation_id);
create index session_order_items_item_status_idx   on session_order_items(item_status);

-- =============================================================
-- PAYMENTS
-- Linked to either a session (table/walk-in/credit) or a room_stay (final checkout).
-- =============================================================

create table payments (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  session_id      uuid references sessions(id) on delete cascade,
  room_stay_id    uuid references room_stays(id) on delete cascade,
  amount          numeric(10,2) not null,
  payment_method  payment_method not null default 'cash',
  notes           text,
  created_by      uuid references restaurant_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint payments_source_check check (
    (session_id is not null and room_stay_id is null) or
    (session_id is null and room_stay_id is not null)
  )
);

create index payments_session_id_idx   on payments(session_id);
create index payments_room_stay_id_idx on payments(room_stay_id);

-- =============================================================
-- CUSTOMER NOTIFICATIONS
-- =============================================================

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id      uuid references restaurant_tables(id) on delete set null,
  room_id       uuid references rooms(id) on delete set null,
  session_id    uuid references sessions(id) on delete set null,
  room_stay_id  uuid references room_stays(id) on delete set null,
  type          notification_type not null,
  status        notification_status not null default 'pending',
  created_at    timestamptz not null default now()
);

create index notifications_restaurant_id_idx on notifications(restaurant_id);
create index notifications_status_idx        on notifications(status);
create index notifications_created_at_idx    on notifications(created_at desc);

-- =============================================================
-- AUTH HELPER FUNCTIONS
-- =============================================================

-- Read restaurant_id from JWT claims (embedded by the custom hook below)
create or replace function get_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select (current_setting('request.jwt.claims', true)::jsonb ->> 'restaurant_id')::uuid;
$$;

-- Read user_role from JWT claims
create or replace function get_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'user_role';
$$;

-- Custom access token hook: embeds restaurant_id + user_role into the JWT
-- Register in Supabase Dashboard → Authentication → Hooks → Custom Access Token
create or replace function custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims   jsonb;
  rec      record;
begin
  claims := event -> 'claims';

  -- Super admin check first
  if exists (
    select 1 from super_admins
    where auth_user_id = (event ->> 'user_id')::uuid
  ) then
    claims := jsonb_set(claims, '{user_role}', '"super_admin"');
    return jsonb_set(event, '{claims}', claims);
  end if;

  -- Restaurant user check
  select restaurant_id, role
  into rec
  from restaurant_users
  where auth_user_id = (event ->> 'user_id')::uuid
  limit 1;

  if rec.restaurant_id is not null then
    claims := jsonb_set(claims, '{restaurant_id}', to_jsonb(rec.restaurant_id));
    claims := jsonb_set(claims, '{user_role}',     to_jsonb(rec.role::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage  on schema public to supabase_auth_admin;
grant execute on function custom_access_token_hook to supabase_auth_admin;
revoke execute on function custom_access_token_hook from authenticated, anon, public;

-- =============================================================
-- ROW LEVEL SECURITY
-- Strategy:
--   Server Actions → service role client (bypasses RLS)
--   Client-side / Realtime → authenticated user key (RLS enforced)
--   Customer pages → service role client (scoped queries, no anon policies)
-- =============================================================

alter table restaurants               enable row level security;
alter table super_admins              enable row level security;
alter table restaurant_users          enable row level security;
alter table workstations              enable row level security;
alter table restaurant_user_workstations enable row level security;
alter table table_groups              enable row level security;
alter table restaurant_tables         enable row level security;
alter table room_types                enable row level security;
alter table rooms                     enable row level security;
alter table room_stays                enable row level security;
alter table room_charges              enable row level security;
alter table credit_customers          enable row level security;
alter table menu_categories           enable row level security;
alter table menu_items                enable row level security;
alter table menu_item_variants        enable row level security;
alter table menu_item_addons          enable row level security;
alter table sessions                  enable row level security;
alter table session_orders            enable row level security;
alter table session_order_items       enable row level security;
alter table payments                  enable row level security;
alter table notifications             enable row level security;

-- Staff see their own restaurant; super admin sees all
create policy "restaurant: staff read own"
  on restaurants for select
  using (
    get_user_role() = 'super_admin'
    or id = get_restaurant_id()
  );

create policy "restaurant_users: staff read own"
  on restaurant_users for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "workstations: staff read own"
  on workstations for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "restaurant_user_workstations: staff read own"
  on restaurant_user_workstations for select
  using (
    get_user_role() = 'super_admin'
    or exists (
      select 1 from restaurant_users ru
      where ru.id = restaurant_user_workstations.restaurant_user_id
      and ru.restaurant_id = get_restaurant_id()
    )
  );

create policy "table_groups: staff read own"
  on table_groups for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "restaurant_tables: staff read own"
  on restaurant_tables for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "room_types: staff read own"
  on room_types for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "rooms: staff read own"
  on rooms for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "room_stays: staff read own"
  on room_stays for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "room_charges: staff read own"
  on room_charges for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "credit_customers: staff read own"
  on credit_customers for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "menu_categories: staff read own"
  on menu_categories for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "menu_items: staff read own"
  on menu_items for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "menu_item_variants: staff read own"
  on menu_item_variants for select
  using (
    get_user_role() = 'super_admin'
    or exists (
      select 1 from menu_items mi
      where mi.id = menu_item_variants.menu_item_id
      and mi.restaurant_id = get_restaurant_id()
    )
  );

create policy "menu_item_addons: staff read own"
  on menu_item_addons for select
  using (
    get_user_role() = 'super_admin'
    or exists (
      select 1 from menu_items mi
      where mi.id = menu_item_addons.menu_item_id
      and mi.restaurant_id = get_restaurant_id()
    )
  );

create policy "sessions: staff read own"
  on sessions for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "session_orders: staff read own"
  on session_orders for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "session_order_items: staff read own"
  on session_order_items for select
  using (
    get_user_role() = 'super_admin'
    or exists (
      select 1 from session_orders so
      where so.id = session_order_items.order_id
      and so.restaurant_id = get_restaurant_id()
    )
  );

create policy "payments: staff read own"
  on payments for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );

create policy "notifications: staff read own"
  on notifications for select
  using (
    get_user_role() = 'super_admin'
    or restaurant_id = get_restaurant_id()
  );
