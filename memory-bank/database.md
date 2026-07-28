# Database

Why each important table exists, its key columns, relations and business rules. **Not** a
schema dump — read the migrations (`supabase/migrations/*`) for exact DDL. Postgres on Supabase;
almost everything is reached through the **service_role** client or **RPCs** (RLS is a backstop).

> **Schema drift warning:** the live DBs have occasionally diverged from repo migrations.
> Trust the migrations for intent, but verify exact columns against the live DB
> (`SUPABASE_DB_URL`) before relying on a detail. Older migration filenames still say "seller"
> (renamed to "vendor" in `20260711900000`) — those filenames are immutable history.

## Tenancy & identity
- **restaurants** — the tenant. `name`, `logo_url` (Supabase Storage), `qr_mode`,
  **`type`** (enum `restaurant | hotel | restaurant_hotel`, DB-checked — the business type set at
  creation; gates which modules exist, e.g. Rooms — read via `hasRooms`/`hasRestaurant`),
  `max_rooms`, `pan_vat_number`, `bill_number_next`, `discount_pin_hash` (never leaves the server),
  `settings jsonb`. **`settings`** holds: `business_closing_hour`, `daily_summary {enabled,
  emails[]}`, `bill_number_pad`, `bill_number_label`, `print_paper_width`, tax/service percents.
  Rule: config is cached (`getRestaurantConfig`, 60s) — every writer calls
  `revalidateRestaurantInfo`.
- **restaurant_users** — admins & staff. `role` (restaurant_admin | restaurant_employee),
  `permissions text[]` (default `{}`), `display_name`, `auth_user_id`, `is_active`, salary
  fields. Rule: admin role bypasses perms; orphan permission strings are inert. Closing hour is
  read from the restaurant, exposed as `closingHour` on the request context.

## Tables, rooms, sessions
- **table_groups / restaurant_tables** — tables belong to a group; a group's assigned staff get
  its orders/calls. **restaurant_user_tables** = the group↔staff assignment (the "Assign staff"
  / "Assign all" UI writes here via `setTableGroupWaiters`).
- **rooms / room_types / restaurant_user_rooms** — hotel side; same assignment idea.
- **sessions** — one open visit per table/room. `type`, `status`, transfer handled by ONE
  column; **unique partial indexes** enforce one-open-per-table and one-open-per-room. Customer
  follows the session, not the QR. Table/room state (available/occupied/cleaning) is **derived**
  from sessions + only `cleaning_since` is stored.
- **session_transfers** — audit of table/room shifts (`transfer_session` RPC).

## Orders & tickets
- **session_orders / session_order_items** — order batches + lines under a session.
  `created_at` = the stock **reservation**; `cancelled_at`/`cancel_reason`/`cancelled_by` = the
  **release** (rejects/force-close/cancel). Rule: a served item is never released; the row is
  the deduction, so never "simplify" cancellation into compensating adjustments (double-release).
- **order_tickets** — OT batching. An item is bound to **one ticket for life** (`ticket_id`);
  `ot_number` assigned at **print time**; `location_label`; per-workstation `ticket_code` prefix.

## Billing & credit
- **payments** — one row per bill. `cash_amount`, `online_amount`, `card_amount`, `total_amount`,
  `discount_amount`, `payment_method` (cash | online | card | credit | **mixed**), `bill_number`.
  Rule: net (after discount) IS the sale; mixed splits cash+online in lockstep. Bill number
  stamped by a DB trigger; history-preserving.
- **credits / credit_payments / credit_customers** — customer **receivables** (money owed TO
  us), accrual: the sale counts at billing; repayments move cash later. Gated on
  process_payments + close_bills.

## Purchasing & stock (payables + inventory)
- **vendors / vendor_payments** — supplier **payables** (money owed BY us). `credit_balance` is
  the mirror of customer credit; moves ONLY via `create_vendor` (opening), a credit purchase, or
  `record_vendor_payment`. Unique on `(restaurant_id, lower(name))`. Deactivate to hide;
  hard-delete only when unreferenced (`delete_vendor` RPC).
- **purchases / purchase_items** — supplier bills. `record_purchase` writes bill + lines, raises
  vendor credit, and sets `products.last_unit_cost` in ONE transaction; a purchase is the single
  source of stock-in, debt and expense.
- **products** — inventory items. `opening_stock` (set once, not editable), `low_stock_threshold`,
  `last_unit_cost`, `is_active`. **No `current_stock`** — stock is derived. Delete only when
  unreferenced (`delete_product` RPC); else deactivate.
- **menu_item_products** — M2M **recipe/BOM** (which products a menu item/variant consumes,
  `qty_per_unit`). Rule: usage counts only for sales at/after the link's `created_at` (the
  load-bearing `soi.created_at >= mip.created_at` filter — else linking retro-deducts all past
  sales).
- **stock_adjustments** — manual movements only (wastage/damage/kitchen/correction). Every reason
  removes stock; only an explicit "add" correction puts it back.

## Menu & stations
- **menu_categories / menu_items / menu_item_variants** — the menu. `is_deleted` soft-delete.
- **workstations** — kitchen/bar stations; own OT numbering (`ot_next`, `ticket_code`).
  Category→item station is **trigger-enforced** in the DB.

## Finance, payroll, reports
- **finance_openings** — the ONE stored figure finance can't derive: the opening cash/online
  seed (PK = restaurant_id), `effective_from`. Everything else is derived by `finance_report`.
- **payroll** tables — salaries, payments, advances; gated on `view_payroll`/`manage_payroll`.
- **report_deliveries** — daily-report log & exactly-once guard. Unique
  `(restaurant_id, period_type, period_key)`; `status`, `error`, `recipients text[]`,
  `generated_at`, `sent_at`, `attempts`. `period_type='daily'` today; weekly/monthly reuse it
  (no schema change).

## Key RPCs (one transaction each, granted to service_role)
`finance_report`, `stock_report`, `dashboard_stats`, `product_history`, `record_purchase`,
`create_product`, `create_vendor`, `record_vendor_payment`, `delete_vendor`, `delete_product`,
`set_finance_opening`, `set_discount_pin`, `transfer_session`, `reject_table_activation`,
`force_close_session`, `cancel_order`, `cancel_order_item`. They raise **bare error codes**
(e.g. `VENDOR_HAS_PURCHASES`, `PRODUCT_HAS_LINKS`) that actions map to friendly text.
