# Rooms

# Overview
The hotel side: rooms and room-types with check-in/out, folios, room service, and cleaning.
**Exists only for a hotel / restaurant+hotel client** — a restaurant-only `restaurants.type` hides
the whole module (sidebar, dashboard, `/admin/rooms` redirect, permission editor, room-create
actions) via `lib/business-type.ts` `hasRooms`. See `decisions.md` → "Module visibility follows type".
Mirrors tables (sessions) but adds a stay/folio and a three-tier permission. See
`architecture.md` → "Session flow".

# Responsibilities
- Rooms + room-types, room assignment to staff, check-in/out, folio/room billing, room-service
  charges, cleaning turn-over.

# Features
- **Check-in** — start a stay/session for a guest (needs `check_in`). Captures the hotel
  register: guest name, phone, count **plus ID type (Citizenship / NID), ID number and permanent
  address** — all three required, validated server-side in `checkInRoom`, stored on `room_stays`
  and printed on every bill derived from the stay.
- **Checkout** — settle and close the stay. Payment supports Cash / Online / Card / **Mixed
  (Cash+Online)** / Credit; on a credit checkout the "Paid now" down-payment can itself be split
  Cash+Online (parity with the table bill; server = `check_out_room` taking `p_cash`/`p_online`/`p_card`).
- **Room billing / folio** — the stay's running charges + bill. The folio PANEL is the working
  screen; the printed bill is the shared `BillTicket`, the same component a table bill uses,
  fed by the one mapper `lib/billing/room-bill.ts` `folioToBill()`.
- **Room service** — add/remove charges to the folio (an order-style charge).
- **Assignments** — staff assigned to rooms (`restaurant_user_rooms`) see only their rooms.
- **Cleaning** — room parks in Cleaning on checkout; `markRoomClean` turns it over.
- **Room shifting** — move a stay to another room via the shared session-transfer service.

# Business Rules
- **Three-tier permission**: `view_rooms` is read-only; `check_in` starts stays + marks clean;
  `manage_rooms` is full room/room-type CRUD. Write implies read (`ROOM_ACCESS`). This replaced
  the old "receptionist = cashier with view_rooms" model.
- One open session per room (unique index); state derived + only `cleaning_since` stored (shared
  cleaning palette with tables).
- Check-out gates on `close_bills`; room-service charges gate on `create_orders` (unchanged by the
  three-tier split).
- **A room bill is DERIVED from the frozen stay, never snapshotted.** `check_out_at` stops the
  inputs moving and `room_rate` was captured at check-in, so `buildFolio` returns the same
  document before and after payment — the unpaid preview and the Sales reprint are literally one
  calculator and one renderer. Never write a second one, and never store the lines.
- **`payments.discount_amount` is the discount of record.** The paid bill re-derives the folio
  with that number, so its printed lines reconcile to `payments.total_amount`.

# Important Components
- `app/actions/rooms.ts` (getRoomsOverview, checkInRoom, markRoomClean, checkOutRoom, add/remove
  charge — gated on `ROOM_ACCESS`), `app/actions/rooms-admin.ts` (CRUD, `manage_rooms`).
- Employee dashboard `rooms-section.tsx` (computes `canCheckIn` itself); `/admin/rooms`.

# Database Relations
`rooms`, `room_types`, `restaurant_user_rooms`, `sessions` (room stays), `payments` — see
`database.md`.

# Realtime Behaviour
Room cards refresh on session/order channels; new room-service orders ring assigned staff.
See `modules/realtime.md`.

# Permissions
`view_rooms` / `check_in` / `manage_rooms` (three tiers via `ROOM_ACCESS`). See
`modules/permissions.md`.

# Known Limitations
- No multi-night rate calendar / reservations engine — it's a live-stay folio model.

# Future Improvements
- Advance bookings/reservations; nightly rate rules; housekeeping assignments.
