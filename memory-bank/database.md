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
  `security_pin_hash` (bcrypt admin Security PIN; NULL = sensitive edits off; never leaves the
  server — see `modules/security-pin.md`), `settings jsonb`. **`settings`** holds: `business_closing_hour`, `daily_summary {enabled,
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
- **room_stays** — one guest's stay. `room_rate` is the rate SNAPSHOTTED at check-in (a later
  price change must not re-bill a guest already in the bed) and `check_out_at` freezes the folio;
  the bill is DERIVED from those two, never stored. **`guest_id_type`** (`citizenship` | `nid`,
  CHECK-constrained), **`guest_id_number`**, **`guest_address`** = the hotel register.
  **Nullable on purpose** — stays that predate the columns cannot be backfilled with documents
  nobody recorded; `checkInRoom` requires all three for every NEW check-in.
- **room_charges** — extras on a stay (laundry, mini bar, late checkout…). Food rides on the
  stay's `session` instead, which is what puts room service on the room bill.
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
  **`is_custom`** flags a manual off-menu line (staff-typed name/price, `menu_item_id` NULL) — it
  bills/discounts/reports like any item but moves no stock (no `menu_item_id` to join
  `menu_item_products`). See `modules/custom-items.md`.
- **order_tickets** — OT batching. An item is bound to **one ticket for life** (`ticket_id`);
  `ot_number` assigned at **print time**; `location_label`; per-workstation `ticket_code` prefix.

## Billing & credit
- **payments** — one row per bill. `cash_amount`, `online_amount`, `card_amount`, `total_amount`,
  `discount_amount`, `advance_amount`, `payment_method` (cash | online | card | credit | **mixed**),
  `bill_number`. Rule: net (after discount) IS the sale; mixed splits cash+online in lockstep. Bill
  number stamped by a DB trigger; history-preserving.
  ⚠️ **`advance_amount` is NOT a fourth tender** — no money moved today for it; it records how much
  of the bill a room deposit already covered. It changed a load-bearing invariant everywhere:
  `left on credit = total_amount − (cash + online + card + advance_amount)`. Readers that must stay
  in lockstep: `finance_transactions` (sale branch), `check_out_room`, `close_bill_with_credit`,
  `edit_payment_tender` (clamps the editable tender to `total − advance`), `lib/credits.ts`.
- **room_advances** — room deposits. `amount` is **SIGNED**: positive = taken, negative = refunded,
  so held = `sum(amount)` and a refund needs no second table. CHECK enforces
  `cash+online+card = amount` and `amount <> 0`; `method` in (cash|online|card|mixed). Written only
  via `record_room_advance` / `edit_room_advance` / `delete_room_advance` (the last two log to
  `security_audit_log` and refuse a settled stay). `credits.down_payment` **includes** the advance,
  which is what keeps `finance_report`'s customer-credit leg (`bill_amount − down_payment`) correct
  with no change.
- **credits / credit_payments / credit_customers** — customer **receivables** (money owed TO
  us), accrual: the sale counts at billing; repayments move cash later. `credit_payments` supports
  `discount_amount` and `discount_by` (migration `20260820000000_credit_payment_discount.sql`),
  populated via `record_credit_payment` RPC with Discount PIN verification (`verify_discount_pin`).
  Settles open bills FIFO and reduces `credit_customers.balance` by `amount + discount_amount`. Gated on
  process_payments + close_bills.
- **extra_expenses** — overheads (rent/electricity/water/fuel/internet/maintenance/marketing/
  licenses/transport/other — updated from 'gas' via `20260819000000_rename_gas_to_fuel.sql`). The shape of `purchases` **minus the credit leg**: CHECK enforces
  `cash_amount + online_amount = amount` and `amount > 0`; `payment_method` in (cash|online|mixed)
  — `credit` is excluded because "we didn't pay" is the absence of an expense, not a kind of one.
  **No status column and no RPCs**: the row IS the payment, written by a plain insert through
  `app/actions/expenses.ts` with `resolveSplit()` validating and the CHECK as backstop. Correct or
  delete only via `updateExtraExpense`/`removeExtraExpense` (admin + Security PIN), which log
  before/after to `security_audit_log` — there is no RPC to log success atomically, so those
  actions log it themselves. **Category is a CHECK, not free text**, and the keys are single words
  so `initcap(category)` in `finance_transactions` equals the label in `lib/expenses.ts`.
  **No back-dating** — an expense lands on the day it is recorded, because back-dating would
  rewrite a business day whose PDF is already in `report_deliveries`.
  **`category = 'saving'` is a SAVING** — same table, same tender split, same effect on every
  balance, plus a `saving_title_id`. Two constraints carry it: `(category='saving') =
  (saving_title_id is not null)` (an equivalence, so neither a pot-less saving nor a rent row with
  a pot is representable) and `on delete restrict` on the FK (a pot holding money cannot be
  deleted, so entries are never stranded while Finance still counts them).
  **`amount` is SIGNED for savings only**: a withdrawal is a negative row (the `room_advances`
  trick), so `amount <> 0 and (category='saving' or amount > 0)`. Each leg must agree in sign with
  the amount — `cash_amount * amount >= 0`, same for online — WITHOUT which `amount −5000,
  cash +8000, online −13000` would pass the split check and credit the till 8,000 that never
  existed. `extra_expenses_split_check` is unchanged; it already holds for negative rows.
- **saving_titles** — savings pots. A table rather than free text so a pot can be RENAMED without
  rewriting the history filed under it, and so its all-time total is exact. Unique per restaurant
  on `lower(btrim(name))` (an expression index, like `vendors`). Pots appear ONLY on
  `/admin/expenses`; Finance shows a single "Saving" category line and never the per-title detail.

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
- **product_workstations** — M2M product→station (`restaurant_id`, `product_id`, `workstation_id`,
  PK on the last two). **Organisational only**: it groups/filters the stock list and is referenced
  by NO other DB object — `stock_report` output is identical with it empty, set or cleared. No row
  = "Unassigned", where every pre-existing product sits. Written whole-set by
  `set_product_workstations` (cross-tenant station ids are filtered out, not raised); FKs all
  `cascade`, so deleting a station unassigns rather than blocks (unlike menu_items' `restrict`).

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

## Security & audit
- **security_audit_log** — every sensitive-edit attempt: `actor_user_id`/`actor_name`, `operation`
  (`edit_payment_tender`/`edit_purchase`/future), `target_type`/`target_id`, `outcome`
  (`success`|`failure`|`blocked`), `detail jsonb` (before→after). Written via `log_security_event`;
  read owner-only in Settings. See `modules/security-pin.md`.

## Key RPCs (one transaction each, granted to service_role)
`finance_report`, `stock_report`, `dashboard_stats`, `product_history`, `record_purchase`,
`create_product`, `create_vendor`, `record_vendor_payment`, `delete_vendor`, `delete_product`,
`set_finance_opening`, `set_discount_pin`, `set_security_pin`/`verify_security_pin`,
`log_security_event`, `edit_payment_tender`, `edit_purchase` (reverses old vendor credit → new,
recomputes `last_unit_cost`, raises `VENDOR_BALANCE_NEGATIVE`), `transfer_session`,
`reject_table_activation`, `force_close_session`, `cancel_order`, `cancel_order_item`. They raise **bare error codes**
(e.g. `VENDOR_HAS_PURCHASES`, `PRODUCT_HAS_LINKS`) that actions map to friendly text.
