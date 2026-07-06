-- =============================================================
-- RestroSewa — Schema Additions
-- Applied: 2026-06-24
-- Adds all columns referenced in code but missing from initial schema.
-- =============================================================

-- =============================================================
-- RESTAURANT USERS — permissions + soft-delete
-- =============================================================

alter table restaurant_users
  add column if not exists permissions jsonb not null default '[]',
  add column if not exists deleted_at  timestamptz;

create index if not exists restaurant_users_deleted_at_idx
  on restaurant_users(deleted_at)
  where deleted_at is not null;

-- =============================================================
-- RESTAURANTS — resource limits + contact fields + ordering config
-- =============================================================

alter table restaurants
  add column if not exists max_tables                integer,
  add column if not exists max_rooms                 integer,
  add column if not exists logo_url                  text,
  add column if not exists pan_vat_number            text,
  add column if not exists address                   text,
  add column if not exists contact_phone             text,
  add column if not exists contact_email             text,
  add column if not exists customer_ordering_enabled boolean not null default true,
  add column if not exists qr_mode                   text    not null default 'ordering_enabled';

-- =============================================================
-- SESSIONS — customer PIN for QR ordering authorization
-- =============================================================

alter table sessions
  add column if not exists customer_pin text;

create index if not exists sessions_customer_pin_idx
  on sessions(customer_pin)
  where customer_pin is not null;

-- =============================================================
-- NOTIFICATIONS — expand status enum + add acknowledged_at
-- =============================================================

-- Add missing enum values.
-- NOTE: PostgreSQL requires ALTER TYPE ADD VALUE to commit before new values
-- can be used in DML. These are added here; the default and any data migration
-- must run in a SEPARATE transaction (i.e. a second SQL execution after this
-- migration commits). The application code sets status explicitly so the DB
-- default of 'pending' is irrelevant for new rows once the code is deployed.
do $$ begin
  begin alter type notification_status add value 'new';         exception when duplicate_object then null; end;
  begin alter type notification_status add value 'acknowledged'; exception when duplicate_object then null; end;
  begin alter type notification_status add value 'completed';   exception when duplicate_object then null; end;
end $$;

alter table notifications
  add column if not exists acknowledged_at timestamptz;

-- =============================================================
-- MENU ITEMS — extended fields
-- =============================================================

alter table menu_items
  add column if not exists food_type              text    not null default 'veg',
  add column if not exists availability_status    text    not null default 'available',
  add column if not exists preparation_time       integer,
  add column if not exists tax_percent            numeric(5,2) not null default 0,
  add column if not exists sku                    text,
  add column if not exists is_featured            boolean not null default false,
  add column if not exists badges                 jsonb   not null default '[]',
  add column if not exists time_from              time,
  add column if not exists time_until             time,
  add column if not exists date_from              date,
  add column if not exists date_until             date,
  add column if not exists available_days         integer[] not null default '{0,1,2,3,4,5,6}',
  add column if not exists room_service_available boolean not null default false,
  add column if not exists is_deleted             boolean not null default false;

-- Sync is_available → availability_status for existing rows
update menu_items
  set availability_status = case when is_available then 'available' else 'out_of_stock' end
  where availability_status = 'available' and not is_available;

create index if not exists menu_items_is_deleted_idx
  on menu_items(is_deleted)
  where is_deleted = false;

-- =============================================================
-- MENU ITEM ADDONS — is_required flag
-- =============================================================

alter table menu_item_addons
  add column if not exists is_required boolean not null default false;
