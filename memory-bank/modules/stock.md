# Stock

# Overview
Inventory, purchases, vendors — the Stock & Finance module's operational half. Stock is always
**derived**, never stored. See `architecture.md` → "Stock flow" and `decisions.md` → "Derived
stock".

# Responsibilities
- Products & inventory levels, purchases, vendor accounts (payables).
- Product↔menu-item recipe links, manual adjustments, stock history, low/out alerts.

# Features
- **Inventory** (`/admin/stock`, `/employee/stock`) — per-product opening/purchased/used/
  adjusted/closing for a chosen business day via `stock_report`; low/out status; inventory value.
- **Purchases** (`/admin/purchases`, `/employee/purchases`) — record supplier bills
  (`record_purchase` — one tx writes bill + lines, raises vendor credit, sets last cost).
- **Vendors** (`/admin/vendors`, `/employee/vendors`) — CRUD + pay (`create_vendor`,
  `record_vendor_payment`), deactivate, or hard-delete when unreferenced (`delete_vendor`).
- **Product links** (recipe/BOM) — attach a product to a menu item or one variant, `qty_per_unit`.
- **Manual deductions** — wastage/damage/kitchen/correction (`stock_adjustments`).
- **History** — `product_history` (running balance that equals `stock_report`'s closing).
- **Deduction Report** (`/admin/deductions`, `/employee/deductions`) — every `stock_adjustments`
  row for a period, with reason and workstation filters, a value-removed total and a by-reason
  breakdown. Read-only, `view_stock`. Before this, adjustments were only readable ONE PRODUCT AT A
  TIME through `product_history`; there was no such report at all. Reached from the **"Deduction
  report" button on the Stock page**, not the sidebar — it belongs next to where deductions are
  recorded. (The reason label **"Waste"** is a different thing and stays: it is one of the six
  deduction reasons in `lib/stock.ts`, and `stock_adjustments.kind` still stores `waste`.)
- **Purchases by station** — picking a workstation on the Purchases screen switches the list from
  BILLS to LINES. A bill mixes stations, so its `total_amount` cannot answer "what did the Bar
  cost"; only a line can.
- **Delete product** — hard-delete when unreferenced (`delete_product`), else Deactivate.
- **Workstations on a product** — optional, multi-select, on create and edit. The list groups by
  station under headers (a shared product appears under each), and a chip row filters
  All / <station> / Unassigned. The filter is **client-side** over rows already fetched, so it
  costs no round trip.

# Business Rules
- Stock deducts when an order line is placed (the row IS the reservation); **restores** on
  reject/force-close/cancel via a dated `cancelled_at` (never compensating rows → no double
  restore). Served items are never restored.
- Manual deductions count as used stock; only an explicit "add" correction returns stock.
- Inventory always derived; `opening_stock` set once (not editable — corrections go through
  adjustments). Value negative stock at 0.
- Recipe usage counts only for sales at/after the link's `created_at` (retro-deduction filter).
- Waste is valued at each product's **current** `last_unit_cost` — an estimate, and the screen says
  so, because no historical cost per movement is recorded. Recording a purchase therefore moves the
  value of PAST waste for that product.
- A correction that ADDS stock never nets against waste; `summariseWaste` keeps the two apart so a
  +5 correction cannot cancel a −5 wastage and report that nothing was lost.
- A product's workstation is **metadata, never mechanism**: it does not affect deduction, purchases
  or reports. Station-level POS *consumption* is already derivable from
  `session_order_items.workstation_id` — so a usage report must key on the MENU ITEM's station
  (who cooked it), while purchases/waste/holding key on the PRODUCT's station (who buys and keeps
  it). The two can legitimately disagree; mixing them yields an unreconcilable number.

# Important Components
- `app/actions/{stock,purchases,vendors,deductions}.ts`; `lib/deductions.ts` (totals, shared by the
  action and the screen so a station re-total needs no round trip); `lib/workstations/stations.ts`
  (the ONE definition of the station-filter rule) + `components/station-chips.tsx`, used by all
  three screens.
- RPCs `stock_report`, `record_purchase`,
  `create_product`, `create_vendor`, `record_vendor_payment`, `product_history`,
  `delete_product`, `delete_vendor`, `set_product_workstations`.
- `lib/stock.ts`; admin/employee `stock-client`, `purchases-client`, `vendors-client`.

# Database Relations
`products`, `menu_item_products` (M2M recipe), `product_workstations` (M2M station),
`stock_adjustments`, `purchases`/`purchase_items`, `vendors`/`vendor_payments` — see `database.md`.

# Realtime Behaviour
Stock/purchases/vendors lists refresh on the `stock`/`purchases`/`orders` channels (a POS sale, a
purchase, or a manual deduction all move stock). See `modules/realtime.md`.

# Permissions
`view_stock` (read), `manage_stock` (products/adjustments/recipes), `manage_purchases` (record
purchases), `manage_vendors` (vendor CRUD + pay). Write-implies-read. See `modules/permissions.md`.

# Reservation and release — the two legs, and where they now come from
Stock is DERIVED, never stored. An order row's existence IS the deduction; a cancellation IS the
restore. Since 2026-08-17 those two legs read from **different relations**, and that separation is
load-bearing:

- **Reservation** — `order_item_consumption`, one row per (item × product), `qty = quantity ×
  qty_per_unit`. Read by `stock_report.usage`, `product_history`'s 'sale' leg and
  `dashboard_stats.cost`. ⚠️ **None of those filters on cancellation**, deliberately: the reservation
  genuinely happened, and netting it retroactively would rewrite closed days.
- **Release** — `order_item_release`, one row per CANCELLATION EVENT. Read by `stock_report.release`
  and `product_history`'s 'restore' leg.

⚠️ **Do not merge them.** Emitting release legs from the consumption view makes `usage` and `cost`
count releases as consumption (both silently, both in the money direction) and fans out
`product_history`'s sale leg, corrupting its running `balance` for every later row.

⚠️ `order_item_release` carries **both** `item_created_at` and `released_at`. `stock_report` splits a
release three ways — `before` / `reversed` (released in-window, ordered in-window) / `returned`
(released in-window, ordered earlier) — keyed on the pair. Collapsing them reclassifies a cross-day
partial cancel out of `added` into a reduction of `used_pos`, which changes a settled day's closing.

`used_pos` can never go negative because the released quantity is a subset of the reserved quantity.
That used to hold because a row could only be cancelled once; it now holds because
`session_order_items_unit_counts_check` caps `Σ events` at the ordered quantity. **That constraint is
part of the stock arithmetic, not just data hygiene.**

# Known Limitations
- 1 unit per product; recipe is per (item/variant, product) pair — no nested sub-recipes.
- COGS/profit only for linked items (see `modules/finance.md`).

# Future Improvements
- Multi-unit / unit conversions; supplier price history; reorder suggestions.
