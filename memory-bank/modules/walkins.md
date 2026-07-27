# Walk-ins

# Overview
Fixed walk-in workspaces (W1/W2/W3) on the staff dashboard for takeaway, phone, and delivery
orders — sessions that behave like tables but belong to no table group. See `walk-ins` and
`modules/tables.md`.

# Responsibilities
- Provide persistent walk-in slots to take non-dine-in orders and bill them.

# Features
- **Walk-in slots** — fixed W1/W2/W3 slots that persist like tables (not created/deleted per
  order); shown in the dashboard "Walk-ins" section.
- **Takeaway / phone / delivery** — the same order+bill flow as a table, for off-floor orders.
- **Customer info** — optional customer name/phone captured on the walk-in; can print on the
  KOT/bill.
- **Billing** — bill + settle exactly like a table session (cash/online/mixed/credit).

# Business Rules
- Walk-ins are **not** in a table group, so there's no group-staff routing — they show to staff
  who can see tables.
- In Without-PIN mode there's no PIN on a walk-in.
- Optional customer details print on the ticket/bill when provided.
- Same session semantics as tables (one active order-set per slot; parks/cleans like a table).

# Important Components
- Employee dashboard `walkins-section.tsx`; shares `app/actions/pos.ts` billing/order paths with
  tables.

# Database Relations
`sessions` (walk-in type), `session_orders`/`session_order_items`, `payments`. See `database.md`
and `modules/tables.md`.

# Realtime Behaviour
Walk-in slots refresh on order/session channels like tables (see `modules/realtime.md`).

# Permissions
Follows table/order/billing permissions (`view_tables`, `create_orders`, `close_bills`,
`process_payments`). See `modules/permissions.md`.

# Known Limitations
- Fixed W1/W2/W3 count; no per-slot delivery-driver/address model.

# Future Improvements
- Configurable slot count; delivery address + driver assignment; order-ready SMS.
