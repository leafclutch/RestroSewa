# Rooms

# Overview
The hotel side: rooms and room-types with check-in/out, folios, room service, and cleaning.
Mirrors tables (sessions) but adds a stay/folio and a three-tier permission. See
`architecture.md` → "Session flow".

# Responsibilities
- Rooms + room-types, room assignment to staff, check-in/out, folio/room billing, room-service
  charges, cleaning turn-over.

# Features
- **Check-in** — start a stay/session for a guest (needs `check_in`).
- **Checkout** — settle and close the stay (billing action).
- **Room billing / folio** — the stay's running charges + bill.
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
