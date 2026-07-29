# Custom Items (manual order lines)

# Overview
Staff with `manage_custom_items` can add an off-menu line while taking an order — a name, a
STAFF-TYPED price, a quantity, an optional note, and an optional workstation. It reuses the
ordering/billing pipeline wholesale: a custom line is just a `session_order_items` row with no
`menu_item_id`, flagged `is_custom`. See `decisions.md` → "Custom items reuse the order-item row"
and `docs/superpowers/specs/2026-07-29-custom-items-design.md`.

# Responsibilities
- Let trusted staff put an arbitrary priced line on a bill, safely and clearly marked.

# Features
- **Add Custom Item** — a button on the order-taking screen (`menu-browser.tsx`), gated on
  `manage_custom_items`. Form: Name, Price, Quantity, Note (optional), Send-to-station (optional).
- **On the bill / totals / discounts** — participates automatically (every total is
  `Σ item_price×quantity`; discount rides the whole bill; the net IS the sale).
- **Sales & finance** — included via `payments.total_amount`. (Item-level `tracked_revenue` on the
  admin dashboard still excludes them — they have no cost/COGS — but they ARE in `sales_total`.)
- **No stock movement** — no `menu_item_id` ⇒ nothing to join `menu_item_products` ⇒ the derived
  stock model yields zero movement for free.
- **KOT/BOT** — routed to a station ⇒ prints on that station's ticket; left blank ⇒ **bill-only**.
- **Clearly marked** — a "CUSTOM" tag in the order cart, Orders queue and session list; `*`/
  "(custom)" on the printed bill/KOT.

# Business Rules
- **Its own permission** (`manage_custom_items`), NOT `create_orders`: a custom item deliberately
  breaches the anti-fraud boundary of `lib/order-items.ts` (the client can normally never set a
  price), so it's a separate, more-trusted act. Admin bypasses; Cashier + Manager presets include
  it. The server (`submitOrder`) re-checks it — the form is a POST endpoint.
- **Never on the customer phone flow** — only the staff POS path (`submitOrder`) accepts custom
  lines; the customer order action is untouched.
- Server-side validation (`lib/custom-items.ts`): name 1–80, price finite ≥ 0 (≤ 1,000,000), qty
  1–99, workstation (if given) must belong to the restaurant; name/price snapshot onto the row.
- **Bill-only custom lines never reach a docket** — `splitDockets` skips a station-less custom
  item so it can't land on the "General"/no-station KOT (menu items keep their old General behaviour).

# Important Components
- DB: `supabase/migrations/20260729200000_custom_items.sql` — `session_order_items.is_custom`.
- `lib/custom-items.ts` (`resolveCustomItems`) — validate/snapshot, mirror of `lib/order-items.ts`.
- `app/actions/pos.ts` `submitOrder` — accepts `custom_items`, permission-gated, inserts alongside
  menu items. `is_custom` added to `OrderItemRow` / `QueueOrderItem` / `PaidBillItem` + their selects.
- UI: `add/_components/menu-browser.tsx` (form + cart), `add/page.tsx` (passes `canAddCustom` +
  workstations). Markers in `order-item.tsx`, `orders-queue.tsx`, `bill-ticket.tsx`
  (`BillItem.is_custom`), `print-tickets.tsx` (docket skip + marker).
- `lib/permissions.ts` — `MANAGE_CUSTOM_ITEMS`, its group, Cashier/Manager presets.

# Database Relations
`session_order_items` (`is_custom`, nullable `menu_item_id`/`workstation_id`); `payments`. See
`database.md`.

# Permissions
`manage_custom_items` (own group). Cashier + Manager presets. See `modules/permissions.md`.

# Known Limitations
- No post-submit price edit on a custom line — cancel + re-add via the existing item-cancel flow.
- No per-item cost/COGS for custom items (out of `tracked_revenue` by design).

# Future Improvements
- Saved/quick custom items (common off-menu charges); a per-restaurant max custom price.
