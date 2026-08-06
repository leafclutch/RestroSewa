# Changelog

Human-readable release notes. Newest first. Group entries by Added / Changed / Fixed / Removed.
Versioning is informal (the app ships continuously); dates anchor the entries.

## [Unreleased] — 2026-08
### Fixed
- **The Place order button sat below the bottom of the screen when adding items to a table.** With a
  full menu you had to scroll to reach it. The menu now scrolls inside the page and the order bar
  stays pinned to the bottom, so Place order is always in reach — and on an installed iPhone it no
  longer sits under the home indicator.
- **Printed bills sat hard against the left edge of the paper.** The receipt now keeps a 3mm margin
  on each side (2mm on 58mm rolls), and feeds a little more blank paper at the end so the footer is
  no longer on the tear line.
- **A bill changed its title once it was paid** — "BILL" before payment, "TAX INVOICE" after, with
  the number line switching from "Bill No" to "Receipt No". One sale, one document: it is now
  **BILL** either way, printed slightly larger and bolder. Only the PAID/tender block changes. (If
  you've set the label to "Order No" in Settings, that still wins — and now applies to both.)
### Added
- **Your phone number can now be printed on bills.** Admin → Settings → Bill header has a phone
  field next to the PAN; it prints on the line under the PAN. Leave it blank to omit it.
- **New: a Deduction Report** (Stock → "Deduction report"). Everything deducted by hand —
  thrown away, damaged, used in the kitchen, eaten by staff — for a day, week, month, year or a
  custom range, with what it was worth, a breakdown by reason, and filters for reason and
  workstation. Until now these deductions could only be seen one product at a time in that
  product's history. Corrections that put stock *back* are shown separately and never subtracted
  from the loss. Values use each product's last purchase price, which the report says on its face.
- **Purchases can be filtered by workstation.** Picking a station switches the list from bills to
  the individual lines for that station, with what they cost — so "what did the Bar spend" is a
  real number rather than the total of bills that happen to include a bar item. A bill that mixes
  stations contributes only its relevant lines to each.
- **Products can now be assigned to workstations.** Creating or editing a product offers your
  stations (Kitchen, Bar, Reception, or whatever you've set up) as a multi-select — chicken to the
  Kitchen, beer to the Bar, coffee beans to both. The stock list then groups under station headings
  with an All / per-station / Unassigned filter that switches instantly. A product on two stations
  shows under both. **Existing products need no change**: they simply list under Unassigned, and
  stock levels, purchases and deductions work exactly as before either way.
- **Guest ID at check-in** — checking a guest in now asks for **ID type (Citizenship / National ID),
  ID number and permanent address**. All three are required, kept with the booking, and printed on
  the room bill. Stays checked in before this keep working and simply print without the ID line.
### Changed
- **The room bill is now the same document as a table bill** — same header, same
  Item/Qty/Rate/Amount columns, same footer — with the hotel details a room needs (room type,
  check-in/out, nights × rate, guest ID) and its charges grouped into **Room charge / Extras /
  Food & beverages**. The bill you show a guest before payment and the one you reprint from Sales
  afterwards are the same bill; only UNPAID → PAID, the cashier, the discount and the tender lines
  change.
### Fixed
- **A paid room bill was missing its room charge and extras.** Reprinting one from Sales listed
  only the food, so the lines didn't add up to what the guest paid. It now shows every line.
- **A discount given at room checkout wasn't recorded.** The guest was charged the discounted
  amount, but Sales and the daily discount total showed nothing. It is now saved on the payment and
  appears on the bill.
- **A room discount no longer skips the discount PIN.** Room checkout now asks for the same
  restaurant discount PIN a table bill does — one PIN for both — and with no PIN set, discounts are
  off in rooms too.
- **Cash + Online at room checkout fills itself in.** Type either amount and the other is worked
  out from the payable, instead of having to type both by hand.
- **The room screen still said UNPAID after checkout.** Printing from a checked-out stay now gives
  a proper receipt — PAID with the payment method, the tender split and the cashier, or the balance
  still owed on a credit checkout — identical to the copy in Sales. The folio's own totals now show
  the discount too, instead of the pre-discount amount.

## [Unreleased] — 2026-07
### Added
- **Custom items** — staff with the new **Add Custom Items** permission can add an off-menu line
  while taking an order (name, price, quantity, optional note, optional station). It appears on the
  bill, joins discounts/totals and sales/finance, moves no stock, and is clearly marked "Custom".
  It prints on a KOT/BOT only when routed to a station; otherwise it's bill-only. Cashier and
  Manager presets include the permission.
- **Security PIN** — a separate admin-only 4-digit PIN (Admin → Settings) that authorizes editing
  completed money records, with a **Security activity** audit log. Enables two edits that didn't
  exist before: correcting a completed bill's **cash/online/card split** (Sales list; amount &
  bill number stay frozen) and **editing a purchase** (vendor/method/lines/notes, from the detail
  modal). Every attempt is logged (success / wrong-PIN / blocked). Purchase edits refuse to corrupt
  a vendor balance. No PIN set ⇒ these edits are off. The **payment split** edit is available to
  billing staff (Process Payments) as well as the owner — still PIN-gated and audited with who did
  it; the **purchase** edit stays owner-only. Staff without the permission never see the controls.
- **Walk-in permission** (`view_walkins` / `manage_walkins`) — the Walk-ins section now needs its
  own permission (View = read-only, Manage = operate); enforced front and back. Cashier /
  Receptionist / Manager presets include Manage; Waiter does not.
- **Room credit — Mixed down-payment**: on a credit checkout the "Paid now" amount can be split
  Cash + Online (parity with the table/walk-in bill).
- **Business-type awareness**: Restaurant-only clients no longer see the **Rooms** module anywhere
  (sidebar, staff dashboard, `/admin/rooms`, the permission editor); a forged room-create POST is
  refused too. Driven by `restaurants.type` via `lib/business-type.ts`.
- **Daily Finance Report**: automatic per-business-day PDF (logo, name, business date, opening/
  closing balances, cash/online/mixed/credit sales, discounts, purchases, vendor payments, new
  vendor credit, customer-credit collected, estimated profit, total bills/orders, inventory
  value, low/out-of-stock, outstanding credit) emailed from HRestroSewa Gmail; admin recipients
  editor (≤3) + delivery **history with Retry**.
- **`manage_purchases`** and **`manage_vendors`** permissions (split from `manage_stock`).
- **Purchases** and **Vendors** sections on the staff dashboard (for staff with the manage
  right), plus `/employee/purchases` and `/employee/vendors`.
- **Vendor delete** and **Product delete** (guarded hard-delete; else Deactivate).
- **"Assign all"** shortcut when assigning staff to a table group (Admin → Tables).
- Three-tier room permissions (`view_rooms` / `check_in` / `manage_rooms`) + Stock summary on the
  staff dashboard + `/employee/stock`.
- `/api/_perf` layered latency probe (secret-gated).

### Changed
- Report email transport → **Gmail SMTP** (nodemailer) with retry; the email body is a short
  cover note and the PDF carries the detail.
- Vendor/purchase read + product-picker gating widened so a pure purchaser/vendor-clerk works
  without `view_stock` (write-implies-read).
- Admin sidebar Stock group gated per-lane (stock / purchases / vendors / finance) so no link
  bounces.

### Fixed
- Closed a real security hole: `app/actions/staff.ts` had **no** auth guards (now super-admin
  gated).
- Dashboard action abort race (via the latency/round-trip model).

### Removed
- 4 dead permissions (`view_customers`, `manage_customers`, `view_settings`, `manage_settings`).
- Payment/close push notifications (kept new-order rings only).

---
_Earlier foundational work (stock & finance module, OT batching + printing, mixed payments,
customer credit, walk-ins, cleaning status, business day, bill numbering, discounts, branding,
customer dark theme, session transfer) predates this changelog — see `completed.md` and git._
