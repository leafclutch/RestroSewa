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
- **Advance payments** — a deposit taken at check-in (optional section on the check-in form) and
  again mid-stay from the folio. Cash / Online / Card / Mixed — **no credit**: an advance IS money
  received, so a guest who hands over nothing simply hasn't paid one. Deducted from the bill at
  checkout; an overshoot is refunded in the same transaction as **cash, online, or both**
  (`check_out_room` has always taken `p_refund_cash` + `p_refund_online` — the UI gained the mixed
  option 2026-08-12). No card refund: a swipe cannot be reversed at the desk, so the refund row
  hardcodes `card = 0`. The refund panel shows how the deposit was originally held, so the
  receptionist can see what is actually available to hand back.
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
- **A room discount needs the restaurant's discount PIN** — the SAME PIN a table bill uses, verified
  in `checkOutRoom` via `verify_discount_pin`. No PIN configured = no discounts anywhere. The
  `apply_discounts` permission alone was the only gate here until 2026-08-05.
- **A room NIGHT ends at checkout time, not 24 hours after the guest walked in.** Two
  per-restaurant hours in `restaurants.settings` (jsonb — no migration): `room_new_day_hour`
  (default 6) decides which DAY an arrival belongs to, `room_price_double_hour` (default 12) is
  when each following night begins. Night *n* ends at the double-hour on `arrival's room-day + n`.
  That one line produces both of the cases the feature was asked for: arriving 8 PM doubles at
  **tomorrow** noon, arriving 3 AM belongs to yesterday's room-day and doubles at **today** noon.
  The arithmetic is `roomNights`/`roomNightBoundary` in `lib/business-day.ts` — day maths lives
  there and nowhere else, and it reuses `businessDate`'s shift-back trick rather than writing a
  second Nepal-offset implementation.
  ⚠️ **`lib/room-billing.ts` imports it RELATIVELY, `from "./business-day.ts"`** — the only
  production file in the repo that does. `lib/room-billing.test.ts` runs under `node --test`,
  which resolves neither the `@/` alias nor an extensionless specifier. Do not "tidy" it to `@/`.
- **The boundary hours are SNAPSHOTTED onto the stay at check-in** (`room_stays.new_day_hour` /
  `double_hour`), exactly as `room_rate` is. Not optional decoration: a paid room bill is REBUILT
  from the frozen stay when reprinted from Sales, so without the snapshot an admin changing the
  checkout hour would silently re-price **every historical bill in the system**. Null = no
  snapshot = follow the live setting, which is what let stays already in progress adopt the rule
  the day it shipped. `resolveRoomDayRule` is the ONLY way to resolve it; never read the settings
  by hand.
- **A per-stay shift pushes that boundary later**, `room_stays.price_shift_hours` (0–12, CHECK-ed
  in the DB and clamped again in `normalizeShiftHours`). Capped at 12 on purpose: 24 would step
  clean over a boundary, turning "a few more hours" into a free night. It applies to **every**
  boundary of the stay, not just the next one — in practice only the departure day is ever
  affected, and one number is honest to display where a one-shot grace with a used/unused state is
  not. Gated on `check_in` with **no PIN** (a PIN at the front desk means it stops being recorded)
  but never anonymous: `price_shift_by` + `price_shift_at` are stored and shown on the folio.
- ⚠️ **FIVE places counted nights, and all five must stay on one rule.** `buildFolio` is the
  calculator; its four call sites are `getRoomsOverview` (the dashboard grid), `loadFolioInputs`
  (folio view *and* checkout), and `getPaidBill` in `pos.ts` (the reprint). The fifth was
  `rooms-grid.tsx`'s `untilNextNight`, which did its own `elapsed % 24h` — it now counts down to
  the server-supplied `folio.nextBoundary`. Miss any one and two screens disagree about the same
  guest. `nightsFor` still keeps the legacy 24-hour behaviour when no rule is passed, and that
  fallback means "unchanged", never "midnight".
- **A stay can END two ways: checked out, or CANCELLED.** `room_stay_status` gained `'cancelled'`
  and `cancel_room_stay` ends a stay without billing it, settling the deposit instead.
  ⚠️ **The whole design is where the KEPT money goes.** A deposit already raised cash AND
  `advances_held` (the fifth balance — guests' money in the till) the day it was taken. If the
  hotel keeps ₹2,000 and that is not recognised as income, it stays booked as a deposit against a
  stay that no longer exists and **`advances_held` never returns to zero** — the balances still
  reconcile, they just reconcile to a lie. So a retained deposit is a **SALE**: one `payments` row
  with `total_amount = amount = advance_amount = the retained figure` and `cash = online = card =
  0`. No new money moves (it is already in the till), the sale is recognised, and held clears.
  That also keeps `left on credit = total − (cash+online+card+advance_amount) = 0` — drop the
  advance term and every cancellation opens a credit account for a guest who owes nothing.
  A full refund (kept = 0) writes **no payment row at all**, not a zero-value sale.
  **No finance-function changes were needed**: a cancellation writes only `payments` and
  `room_advances`, which both functions already read.
- **A cancelled stay's BILL is the cancellation charge, not the nights.** `buildFolio` takes
  `cancelled` + `cancellation_charge` and returns a single "Cancellation charge" line with
  `nights: 0`, no food, no extras, **and no tax or service** — `cancel_room_stay` records a payment
  of exactly the charge, so tax on top would print a bill that cannot reconcile to its own sale.
  This lives in the calculator and not the printer because `getPaidBill` rebuilds paid room bills
  from the frozen stay; without it a Sales reprint would show "1 night × ₹5,000" over a ₹2,000
  payment. Written-off charges are shown on the cancel FORM so the decision is made in view of
  them, then never billed.
- **Cancelling needs `cancel_room_stay` AND the Security PIN**, for everyone including the owner —
  the only PIN operation that is not admin-only. The permission says who may try, the PIN says it
  is really them, and the audit detail records held/kept/refunded (who cancelled without how much
  they kept is not an audit trail). The permission is deliberately **outside** the
  view/check_in/manage ladder: writing off a guest's bill is not a bigger version of configuring
  rooms, and a receptionist who checks guests in all day should not acquire it by default.
  The room parks in **Cleaning**, exactly as a checkout.
- **A room bill is DERIVED from the frozen stay, never snapshotted.** `check_out_at` stops the
  inputs moving and `room_rate` was captured at check-in, so `buildFolio` returns the same
  document before and after payment — the unpaid preview and the Sales reprint are literally one
  calculator and one renderer. Never write a second one, and never store the lines.
- **`payments.discount_amount` is the discount of record.** The paid bill re-derives the folio
  with that number, so its printed lines reconcile to `payments.total_amount`.
- **An advance is a PAYMENT against the bill, never a reduction of it.** `total_amount` stays the
  whole sale; `payments.advance_amount` says how much of it arrived earlier. The tender is
  validated against `folio.balanceDue`, but `p_total` still receives `grandTotal`.
  ⚠️ **The invariant this changes:** what is left on credit is now
  `total − (cash + online + card + advance_amount)`. Every reader moves together or a prepaid bill
  raises phantom debt — see `database.md`.
- **`room_advances.amount` is SIGNED**: positive = deposit taken, negative = refund returned. So
  "held on this stay" is `sum(amount)`, a refund needs no second table, and the finance cash legs
  need no refund branch. Refunds are written by `check_out_room` BEFORE it closes the stay, because
  `record_room_advance` refuses to write against a settled one.
- **Taking an advance rides on `check_in`** (no new permission — a second box would silently break
  the front desk). **Correcting or deleting one is owner-only + the Security PIN**
  (`edit_room_advance`), and only while the stay is active.

# Important Components
- `app/actions/rooms.ts` (getRoomsOverview, checkInRoom, markRoomClean, checkOutRoom, add/remove
  charge — gated on `ROOM_ACCESS`), `app/actions/rooms-admin.ts` (CRUD, `manage_rooms`).
- Employee dashboard `rooms-section.tsx` (computes `canCheckIn` itself); `/admin/rooms`.

# Database Relations
`rooms`, `room_types`, `restaurant_user_rooms`, `sessions` (room stays), `payments`,
`room_advances` — see `database.md`.

# Realtime Behaviour
Room cards refresh on session/order channels; new room-service orders ring assigned staff.
See `modules/realtime.md`.

# Permissions
`view_rooms` / `check_in` / `manage_rooms` (three tiers via `ROOM_ACCESS`), plus
`cancel_room_stay` — a FOURTH, standalone lane, not part of the ladder and implied by none of the
other three. `ROOM_ACCESS.canCancelStay`. See `modules/permissions.md`, `modules/security-pin.md`.

# Known Limitations
- No multi-night rate calendar / reservations engine — it's a live-stay folio model.

# Future Improvements
- Advance bookings/reservations; nightly rate rules; housekeeping assignments.
