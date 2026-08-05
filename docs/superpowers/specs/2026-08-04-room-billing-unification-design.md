# Room billing: guest identity at check-in, and one bill for rooms and tables

**Date:** 2026-08-04
**Status:** approved design, ready for an implementation plan

---

## 1. Why

Two complaints, one root:

1. **Check-in records too little about the guest.** A hotel register needs an identity document
   and a permanent address; today a stay stores only name, phone and headcount.
2. **A room bill looks like two different documents.** The unpaid bill inside the room and the
   paid bill in Sales share no layout, and the paid one is *wrong*: it omits the room charge.

The goal is one bill that reads the same before and after payment — `UNPAID → PAID` — while
keeping every hotel-specific detail, and reusing the table-billing machinery rather than growing a
second billing system beside it.

---

## 2. What already exists — do NOT rebuild it

The premise "rooms have a separate billing architecture" is **false**, and the design depends on
that. Verified against the live schema and the shipped RPCs:

- **A room stay is already a session.** `sessions` carries `room_id` and `room_stay_id` alongside
  `table_id` and `walk_in_no`.
- **Checkout already writes an ordinary `payments` row**, hung off `session_id` — not
  `room_stay_id`. `check_out_room` documents the choice: `payments_source_check` is an XOR, credit
  checkouts go through the shared `close_bill_with_credit` (so a room bill has one shape either
  way), `sessions.room_stay_id` still reaches the stay, and Sales already embeds
  `sessions → rooms` so the bill labels itself "Room 101" with no extra code.
- **Bill numbers already work** — the same DB trigger stamps `payments.bill_number` for rooms.
- **`lib/room-billing.ts` `buildFolio()` is already the single room calculator**, pure and
  testable, feeding the folio panel, the printed bill and the charged amount from one call.
- **`BillTicket` (`app/(employee)/employee/_components/bill-ticket.tsx`) is already the single
  printed-bill renderer** for tables, walk-ins, Sales reprints and credit receipts. It already
  supports a `customer` block of name / phone / address.

So the work is **not** to unify two billing systems. It is to delete a second *renderer* and to
close three defects that the split renderer was hiding.

### 2.1 The three real defects

| # | Defect | Evidence |
|---|---|---|
| D1 | `folio-client.tsx` hand-builds its own printed bill from `PrintModal` + `Line` + `Divider` instead of `BillTicket`. | its import list |
| D2 | **A paid room bill in Sales is missing money.** `getPaidBill` rebuilds lines from `session_order_items`, which holds *food only*. The room charge and extras come from `buildFolio` and never appear — the stored total will not reconcile with the visible lines. | `pos.ts` `getPaidBill` |
| D3 | **A room discount is applied but never recorded.** `checkOutRoom` passes `folio.grandTotal` (already net of discount) as `p_total`, but `check_out_room` has **no `p_discount` parameter**, so `payments.discount_amount` stays 0 for every room checkout — invisible in Sales, and under-reported in the Finance discount total. | `rooms.ts` `checkOutRoom` vs the RPC signature |

A fourth, latent: `buildFolio` takes the discount **before** tax while `BillTicket` takes it
**after**, and `room-billing.ts:194` wrongly claims they match. It has no live impact — no
restaurant has `tax_percent` or `service_charge_percent` set, and the user confirms prices are
tax-inclusive — but the two must not be left disagreeing.

---

## 3. Decisions taken

| Decision | Choice |
|---|---|
| Discount vs tax ordering | **Discount before tax** becomes the single rule. Identical arithmetic today (tax = 0); correct if VAT is ever switched on. |
| Paid-bill line reconstruction | **Re-derive from the frozen stay.** `check_out_at` stops the clock and `room_rate` was snapshotted at check-in, so a reprint recomputes the same numbers. No new storage, matches the codebase's derive-don't-store rule. |
| Guest ID fields | **Required for every new check-in.** Columns nullable (7 closed stays exist in production); the *action* enforces presence. |
| Room discount | Keep and finish it — it exists in the UI already; make it reach `payments.discount_amount`. |

**Accepted trade-off of re-deriving:** if an admin later changes `tax_percent` or
`service_charge_percent`, an old bill's *line breakdown* re-renders at the new percentages. The
charged total is immutable — it is stored on the payment row. This is exactly how table bills
already behave, so the two stay consistent.

---

## 4. Architecture

**One renderer, two producers, one mapper.**

```
                     ┌── unpaid: getRoomFolio(stayId) ──┐
room stay ──────────►│                                   ├──► folioToBill() ──► <BillTicket/>
                     └── paid:   getPaidBill(paymentId) ─┘        (one mapper)
table session ─────────────────────────────────────────────────► <BillTicket/>  (unchanged)
```

### 4.1 Renderer — extend `BillTicket`, do not replace it

Two new **optional** props. Absent, the component behaves exactly as today, so no table, walk-in,
Sales or credit-receipt call site changes.

- `stay?: { roomType, rate, nights, checkIn, checkOut, duration }` — renders the hotel block:
  room type, per-night rate, nights charged, check-in and check-out date/time.
- `sections?: { title: string; lines: BillItem[] }[]` — renders grouped lines
  ("Room charge", "Extras", "Food & beverages") in place of the single flat item list.
  **Precedence:** when `sections` is present it replaces `items` entirely; a caller passes one or
  the other, never both. The subtotal is then the sum over all sections' lines.
- `customer` gains `idType` and `idNumber` beside the existing name / phone / address.

`payment` already decides `BILL` vs `TAX INVOICE` and the tender split, so **status is the only
visual difference between the unpaid and paid room bill** — which is the requirement.

Rejected alternatives:
- *A `BillModel` layer both sides produce.* Cleaner in the abstract; rewrites every table bill call
  site for no immediate gain, on the money path.
- *Materialise room charges as `session_order_items` at checkout.* Would make Sales "just work",
  but those rows are stock **reservations** in this codebase — fake menu lines would corrupt stock
  and analytics. Rejected outright.

### 4.2 Producers — one mapper so they cannot drift

New pure module `lib/billing/room-bill.ts`:

```ts
folioToBill(input): { sections, stay, customer, subtotal, discount, grandTotal, ... }
```

built from the existing `RoomFolio` (`room`, `extras`, `food`, totals) plus the stay's guest
fields. Called from **both** states:

- **Unpaid** — `getRoomFolio(stayId)` already returns folio + charges; the folio panel's preview
  and print modal render `<BillTicket>` from the mapper output, with no `payment`.
- **Paid** — `getPaidBill(paymentId)` detects `sessions.room_stay_id`, reloads the frozen stay,
  its charges and its food, and calls the **same** mapper with
  `discount = payments.discount_amount` and the tender. This closes **D2**.

One mapper is the same discipline `loadFolioInputs` already enforces for the folio itself.

### 4.3 The folio panel stays as-is

`folio-client.tsx` remains the **working screen** — add/remove charges, take payment. Only its
*bill* (the preview and the printed output) becomes `BillTicket`. The panel is not a bill.

---

## 5. Database changes

One migration, additive:

```sql
alter table room_stays
  add column if not exists guest_id_type   text,
  add column if not exists guest_id_number text,
  add column if not exists guest_address   text;

alter table room_stays
  add constraint room_stays_guest_id_type_check
  check (guest_id_type is null or guest_id_type in ('citizenship','nid'));
```

Nullable by necessity — 8 stays exist in production (7 closed) and cannot be backfilled with
identity documents nobody recorded. New check-ins are enforced in `checkInRoom`.

### 5.1 RPC changes

`check_in_room` gains `p_guest_id_type`, `p_guest_id_number`, `p_guest_address`.
`check_out_room` gains `p_discount` and writes it to `payments.discount_amount` (**D3**).

> **Every new parameter MUST have a DEFAULT, and every call site MUST pass arguments by name.**
> This repo has already lost a day to exactly this: migration `20260717140000` records that adding
> `p_discount` to `close_bill_with_credit` without a default broke *every* hotel credit checkout,
> because `check_out_room` called it positionally with 11 arguments.

---

## 6. Part A — check-in fields

- **UI** (the check-in form in `rooms-grid.tsx`): an "ID Type" select (Citizenship / National ID
  (NID)), an "ID Number" text field, and a "Permanent Address" field. All three required, validated
  client-side for feedback and server-side for truth.
- **Action** (`checkInRoom`): reject a missing or unknown ID type, a blank ID number, or a blank
  address, with the same error style as `GUEST_NAME_REQUIRED`.
- **Storage:** on `room_stays`, so the data stays attached to the booking history and to every
  bill derived from that stay. *Not* on `sessions.customer_address`, which belongs to the walk-in
  customer-details feature and dies with the session.
- **On the bill:** rendered in the `customer` block. Absent on the 7 historical stays — the block
  simply omits what it does not have.

---

## 7. Part B/C/D — the unified bill

Every field the request lists, and where it comes from:

| Field | Source |
|---|---|
| Bill number | Paid: `payments.bill_number`, formatted by `lib/billing/bill-number.ts` exactly as a table bill. Unpaid: the same provisional number a table bill preview uses — **confirm which helper `print-tickets.tsx` passes as `billNo` and reuse it verbatim**, rather than inventing a room-only scheme |
| Status Paid/Unpaid | presence of `payment` — already how `BillTicket` picks BILL vs TAX INVOICE |
| Guest name, phone | `room_stays.guest_name` / `guest_phone` |
| ID type, ID number, address | new `room_stays` columns |
| Room number | `sessions → rooms.number` |
| Room type, per-night rate, nights, extra nights | `buildFolio` + `room_types.name` → new `stay` prop |
| Check-in / check-out date & time | `room_stays.check_in_at` / `check_out_at` |
| Room charge / Food / Extras | `folio.room`, `folio.food`, `folio.extras` → `sections` |
| Discount | `payments.discount_amount` (after D3) |
| Payment method, tender split, grand total | `payments` — already rendered by `BillTicket` |
| Notes | `room_stays.notes` |

**Flow (unchanged mechanically, now consistent visually):**
check-in → stay active → food/room-service added → unpaid bill in the room → payment →
same bill in Sales, only the status differs.

**Responsive/PWA:** `BillTicket` renders inside the existing `PrintModal`, which is already
responsive and already used on mobile and in the installed PWA. No new layout surface is
introduced, which is the point of reusing it.

---

## 8. Out of scope

- Reservations, nightly rate calendars, housekeeping — unchanged (see `modules/rooms.md`).
- Any change to table, walk-in or credit bills beyond the shared formula alignment in §3.
- ESC/POS direct printing (built and shelved — see the thermal-printing notes).

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A positional RPC call breaks hotel checkout again | Defaults on every new parameter; call by name; smoke-test a cash, a mixed and a **credit** checkout |
| Changing `BillTicket` breaks table bills | New props are optional; table call sites pass nothing new. Verify a table bill and a credit receipt are byte-identical before/after |
| Re-derived old bills shift if tax % changes | Accepted (§3). Stored total is authoritative; matches table behaviour |
| Required ID blocks a busy front desk | Explicit user decision; error messages must say exactly which field is missing |

---

## 10. Verification

1. **Unpaid = paid.** Check in a guest, add a room-service order and an extra charge, print the
   unpaid bill, take payment, open the same bill from Sales. Both show the same lines, same
   totals, same hotel block; only BILL → TAX INVOICE and the tender lines differ.
2. **D2 regression test.** A paid room bill's visible lines must sum to `payments.total_amount`.
   This fails on `main` today — it is the sharpest proof the fix works.
3. **D3.** After a discounted checkout, `payments.discount_amount` is non-zero and the figure
   appears in Sales and in the Finance discount total.
4. **Table bills unchanged.** Print a table bill and a credit receipt before and after; diff.
5. **Credit checkout still works** (the historical breakage) — cash, mixed, and credit.
6. **Old stays.** A bill for one of the 7 pre-existing stays renders without the ID block and
   without errors.
7. `tsc --noEmit`, `npm run lint`, and a production build clean.

---

## 11. File map

| File | Change |
|---|---|
| `supabase/migrations/20260804000000_room_guest_identity.sql` | new columns + check constraint; `check_in_room` and `check_out_room` signatures (one migration — the columns and the RPCs that write them ship together) |
| `app/actions/rooms.ts` | `checkInRoom` validates + passes the three fields; `checkOutRoom` passes `p_discount` |
| `app/(employee)/employee/dashboard/_components/rooms-grid.tsx` | check-in form fields |
| `lib/billing/room-bill.ts` | **new** — `folioToBill()`, the one mapper |
| `app/(employee)/employee/_components/bill-ticket.tsx` | optional `stay` + `sections` props; `customer` gains ID fields; **and the total formula moves to discount-before-tax** (§3) — currently `subtotal + tax + service − discount`, becomes `taxable = subtotal − discount` then tax/service on `taxable`. No number moves while tax and service are 0 |
| `app/(employee)/employee/room/[stayId]/_components/folio-client.tsx` | bill preview/print switches to `BillTicket`; panel unchanged |
| `app/actions/pos.ts` | `getPaidBill` reloads the stay for room sessions and uses the mapper |
| `lib/room-billing.ts` | correct the stale "matching the table bill ticket" comment |
