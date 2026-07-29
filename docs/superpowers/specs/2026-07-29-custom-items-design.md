# Custom Items (manual order lines) — design

**Date:** 2026-07-29
**Status:** Approved (design). Implementation in progress.

## Goal
Let permitted staff add a manual, off-menu line while taking an order — Item Name, Price,
Quantity, optional Note, and an optional workstation. It appears on the bill, participates in
discounts/totals, flows into sales & finance, does NOT move stock, is clearly marked as custom,
and prints on a KOT/BOT only when routed to a workstation (otherwise bill-only).

## Why the architecture already fits
`session_order_items` stores **immutable snapshots** (`item_name`, `item_price`, `quantity`,
`notes`) with **nullable** `menu_item_id` / `variant_id` / `workstation_id`. So a custom item is a
row with no `menu_item_id`:
- Totals/discounts: every total is `Σ(item_price × quantity)`; the payable the client sends already
  includes custom lines; discount rides the whole bill. ✅
- Sales/finance: the sale is `payments.total_amount`; `finance_report` sums payments. ✅
- Stock: deduction JOINs `menu_item_products.menu_item_id`; NULL → no movement. ✅ (derived-stock)
- KOT/BOT: items route by `workstation_id`; NULL-station items never hit a KOT, only the bill. ✅

The one boundary custom items intentionally breach: `lib/order-items.ts` exists so the client can
NEVER set a price. Custom items must therefore take a **separate, validated, permission-gated
path**, never `resolveOrderItems`, and never be reachable from the customer phone flow.

## Decisions (locked with the user)
1. **Marker:** explicit `session_order_items.is_custom boolean not null default false` — NOT
   inferred from `menu_item_id IS NULL` (a deleted menu item also nulls it, so inference is
   ambiguous for historical rows).
2. **Permission:** dedicated `manage_custom_items` (its own group). Admin bypasses; Cashier +
   Manager presets include it; Waiter/Chef/Host don't. UI gates on it; the **server re-checks** it.
3. **KOT routing:** optional station picker on the form, default blank = bill-only. A station →
   the line joins that station's KOT/BOT via the existing `generate_order_ticket` flow.

## Architecture
### 1. Database (one migration)
`alter table session_order_items add column is_custom boolean not null default false;`
Nothing else. (Index not needed — reads are already by `order_id`.)

### 2. Permission (`lib/permissions.ts`)
- Add `MANAGE_CUSTOM_ITEMS = "manage_custom_items"`; put it in a "Custom items" group so the
  super-admin editor picks it up data-drivenly. Add to Cashier + Manager presets.
- No new `*_ACCESS` helper needed — a single `hasPermission(ru, MANAGE_CUSTOM_ITEMS)` check.

### 3. Validation helper (`lib/custom-items.ts`, plain server-usable module)
`resolveCustomItems(service, restaurantId, lines)` → validates & snapshots:
- name: trimmed, 1–80 chars. price: finite, ≥ 0, ≤ 1_000_000. quantity: int 1–99. notes: trimmed
  or null. workstation_id: if given, must belong to the restaurant → snapshot `workstation_name`;
  else both null.
- Returns rows shaped like `session_order_items` inserts with `is_custom: true`,
  `menu_item_id: null`, `variant_id: null`.

### 4. Order path (`app/actions/pos.ts` → `submitOrder`)
- Accept a new `custom_items` FormData field (JSON). Menu items still go through
  `resolveOrderItems` unchanged.
- If `custom_items` is non-empty, require `hasPermission(ru, MANAGE_CUSTOM_ITEMS)` (reject
  otherwise); validate via `resolveCustomItems`; insert both sets under the same `session_orders`
  row. Refuse an order that is ONLY invalid/empty.
- Customer phone flow (its own action) is untouched.

### 5. KOT/BOT
- No new print logic. A routed custom line is stamped by `generate_order_ticket` (groups by
  station, ignores `menu_item_id`). NULL-station custom line → bill only.

### 6. Marking (UI + print)
- `is_custom` is selected wherever order items are read (queue, session detail, bill preview,
  paid-bill). Render a small "Custom" tag beside the name in the app, and a subtle `(custom)`
  marker on the printed bill (and KOT when routed). Reuses existing item-row components.

### 7. UI (`menu-browser.tsx`)
- "Add Custom Item" button, gated on `manage_custom_items`. Opens a small form (Name, Price,
  Quantity, Note, Send-to-station optional). Confirm → adds a custom line to the cart; the existing
  bill preview + submit handle the rest.

## Out of scope (v1)
Editing a custom line's price after submit (cancel + re-add, via the existing cancel flow);
custom items on the customer phone flow; per-item cost/COGS for custom items (they stay out of
`tracked_revenue` by design, but are fully in `sales_total`).

## Verified architecture facts
- `session_order_items`: nullable `menu_item_id`/`variant_id`/`workstation_id`; snapshot
  `item_name`/`item_price`/`workstation_name`/`quantity`/`notes`.
- `submitOrder` inserts `resolveOrderItems(...)` rows; close-bill trusts client `total_amount`
  (net = sale) with PIN-gated discount.
- Stock/finance/sales all derive from these rows + `payments`.
