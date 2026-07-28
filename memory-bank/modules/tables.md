# Tables

# Overview
Dine-in tables grouped into **table groups**; each group's assigned staff receive its orders and
calls. A table's live state is derived from its session. See `architecture.md` → "Session flow".

# Responsibilities
- Table groups + tables, staff assignment per group.
- Session lifecycle (activate → serve → bill → close → cleaning), table shifting.

# Features
- **Activation** — a table opens a session (customer QR or staff). Activation requests can be
  accepted/rejected (`reject_table_activation` — a compare-and-swap on `pending_activation`).
- **Session lifecycle** — orders accrue under the session; billing settles it; on close the table
  parks in **Cleaning** (`modules/rooms.md` shares the cleaning palette).
- **Table shifting** — move a live session to another table keeping bill/orders/tickets/customer
  (`transfer_session`; see `session-transfer`).
- **Cleaning** — table shows Cleaning until marked clean; only `cleaning_since` stored.
- **Staff assignment** — per group; **"Assign all"** one-tap shortcut (Admin → Tables) toggles the
  whole team (`setTableGroupWaiters`).
- **Realtime** — table cards update live as orders/sessions change.

# Business Rules
- **One open session per table** (unique partial index); the customer follows the session, not the
  QR code.
- Table state (available/occupied/cleaning) is DERIVED from sessions + `cleaning_since` — never a
  stored status column.
- Ungrouped tables can't receive orders (staff are assigned per group) — admin must assign a group.

# Important Components
- `app/actions/tables-admin.ts`, `app/actions/transfer.ts`, `app/actions/pos.ts`.
- `app/(admin)/admin/tables/_components/tables-client.tsx` (groups, tables, `TableGroupWaiterBar`
  with Assign-all).
- Employee dashboard `tables-section.tsx`; RPCs `transfer_session`, `reject_table_activation`,
  `force_close_session`.

# Database Relations
`table_groups`, `restaurant_tables`, `restaurant_user_tables` (group↔staff), `sessions`,
`session_transfers` — see `database.md`.

# Realtime Behaviour
Subscribes to table/order/session channels; new orders + session changes refresh the grid; new
orders also ring the group's staff (see `modules/notifications.md`, `modules/realtime.md`).

# Permissions
`view_tables` / `manage_tables`; opening/billing use order + billing perms. See
`modules/permissions.md`.

# Known Limitations
- Fixed group model; no per-seat or split-by-guest sessions.

# Future Improvements
- Floor-plan layout view; merge/split sessions.
