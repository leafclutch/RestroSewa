# Changelog

Human-readable release notes. Newest first. Group entries by Added / Changed / Fixed / Removed.
Versioning is informal (the app ships continuously); dates anchor the entries.

## [Unreleased] — 2026-08

> **Database migrated to production 2026-08-13.** All thirteen migrations behind room advances,
> the sales split, Extra Expenses, Savings, withdrawals, discounts and the ledger sale detail are
> now live on the production database — 13/13 applied, no failures. **The app itself is not
> deployed yet**; the database being ahead is deliberate and safe, because every change is additive
> (new tables and appended report columns), so the currently running build is unaffected.
> Verified on production: all six touched functions byte-identical to dev, every pre-existing
> figure unchanged across 8 restaurants, and the ledger reconciling to the penny over 1,316 rows.
>
> **The room night boundary migration went out the same day** (`20260816000000`, 1/1). Also
> additive, also ahead of the app. All nine guests currently checked in were priced under both the
> old and the new rule first: **every one bills the same number of nights**, so nobody's folio
> moves when the app deploys.

### Added
- **You can now cancel a checked-in guest.** Under Admin → Rooms there is a **Checked-in guests**
  list with a Cancel button on each stay, and permitted staff get the same control on the guest's
  folio. Cancelling ends the stay without billing it: whatever the guest has run up is written off
  (shown to you before you confirm), the room goes to Cleaning, and it frees up for the next guest.
  - **The deposit is handled in the same step.** Refund all of it, or keep part as a cancellation
    charge — the refund figure follows automatically, and can go back as cash, online, or both.
    What you keep is recorded as a sale; nothing new leaves the till, because that money was
    already banked when the deposit was taken.
  - **New permission, "Cancel a Checked-in Stay".** Owners have it by default. It is separate from
    Check-in and Manage Rooms — granting those does not grant this — so you can give it to exactly
    the people who should have it.
  - Every cancellation needs the **Security PIN**, owners included, and is recorded in
    Settings → Security activity along with how much was kept and refunded.
- **Extra Expenses and Payroll now appear on the staff dashboard**, after Vendors, each as a
  summary card that opens a full page. Extra Expenses shows what went out today and how it was
  paid; Payroll shows this month's sheet — who's on payroll, what's been paid, what's still owed.
  Both are permission-driven: Payroll appears only for staff who can record payments, so
  colleagues' salaries don't land on every dashboard.
- **New staff permission: "Add Expenses & Saving".** For whoever actually pays the bills. They can
  record an expense or put money into a saving, and they see **only what was entered today** — no
  month totals, and never a saving pot's running balance. They cannot withdraw from a pot, create
  or rename one, or edit anything already filed. Granting the fuller "Manage Extra Expenses"
  alongside it lifts the restriction.
- **A new saving can start with what you've already collected.** When creating a pot you can enter
  the amount it already held before you started tracking it here. It counts towards the pot's
  balance and can be withdrawn like any other, but it is **not** recorded as money spent today —
  your cash, bank, profit and daily report are all untouched by it.

### Changed
- **Room nights now end at checkout time, not 24 hours after check-in.** Until now a room charge
  stepped up exactly 24 hours after each guest happened to arrive, so two guests in identical
  rooms crossed into their second night at different times of day. Now there is one checkout hour
  for the whole hotel, set under **Rooms → Room night boundary**:
  - **Room new day starts at** (default 6 AM) — which day an arrival counts as. A guest arriving
    at 3 AM counts as the previous night's guest, so their charge steps up that same day at noon.
    A guest arriving at 8 PM steps up the following day at noon.
  - **Price doubles at** (default 12 PM) — when each following night begins.
  - On the folio, each stay now says plainly when the next night starts, and the room card on the
    dashboard counts down to that moment rather than to a rolling 24-hour mark.
- **Front desk can give a guest extra hours.** On the folio, anyone who can check guests in can
  push that stay's boundary back by up to 12 hours — the usual "you can keep the room until 3".
  The folio shows the extension and who granted it. Guests already checked in keep the hours that
  applied when they arrived, and **past bills never change**, so adjusting the hotel's settings
  can't re-price a bill that has already been paid.

### Added
- **Transaction history now says where a sale came from.** Every sale used to read just "Sale".
  It now reads **"Room sale · Room 203"** or **"Restaurant sale · Table 5"** (walk-ins show their
  slot), and a bill on credit still shows the customer beside it — "Room sale · Room 203 · Ram
  Bahadur". The CSV export gains a **Source** column with the same detail. A restaurant without
  rooms keeps the plain "Sale" wording, exactly as its Sales block stays a single heading.
- **Discounts now appear in Finance, not just the emailed report.** A new **Discounts** block on
  `/admin/finance`, sitting just above Closing balance: how many bills were discounted, what those
  bills would have come to, what they actually came to, and the total given away. Also in the CSV
  export. The daily PDF now reads the same figure from the same place, so the two can't disagree.
  Note it changes no balance — every sales figure on the page is already after discount, so this
  block explains what was foregone rather than adding another deduction.

### Fixed
- **Transaction history now names a refund as a refund.** Money handed back from a room deposit
  read **"Room Advance"** — exactly the same as the deposit that created it, with only the minus
  sign to tell them apart. It now reads **"Room Advance Refund"**. The same fault was hiding on
  savings: taking money out of a pot read "Extra Expense", and now reads **"Saving Withdrawal"**.
  The CSV export uses the same wording, so an exported row and the row it came from can no longer
  be named differently.

- **Transaction history now shows money the way it actually moved.** Each row was coloured by what
  it was *called* rather than which way the money went, so several read backwards: a refunded room
  deposit showed green as if money came in, a saving withdrawal showed red as if money went out,
  and a sale on credit showed green although nothing was collected. Every row now reads
  **green +amount for money in, red −amount for money out**, and events that moved no money (a
  credit sale, a purchase entirely on credit, a carried-over balance) say **"no money moved"**
  instead of borrowing a colour. Where a bill is worth more than what changed hands, the full
  value is shown beneath — "−₹3,000 / of ₹5,000" — rather than overstating the outflow.

### Added
- **New: Extra Expenses.** A new page under Stock & Finance for the overheads that are neither
  stock nor wages — rent, electricity, water, gas, internet, maintenance, marketing, licences,
  transport and anything else. Pick a category, add a note ("July bill, NEA"), enter the amount
  and say whether it was paid in **Cash, Online, or both**. Until now that money left the till and
  the books never learned about it, so closing cash was wrong by exactly the rent.
  - It flows straight into the four balances: cash out of the till, online out of the bank, on the
    day you record it. The Finance ledger shows each one as its own line.
  - The **Expenses** section of the Finance report gains an **Extra expenses** line with the
    categories that actually had spend listed beneath it, so "where did the cash go" is answerable
    without opening another page. The same lines appear in the CSV export and the daily PDF.
  - **Estimated profit is now sales − purchases − salaries − extra expenses.** It was overstating
    profit by every overhead you paid.
  - An expense is always money that has **already left** — there's no "unpaid bill" state to chase.
    Log it the day you pay it.
  - Recording needs the new **Manage Extra Expenses** permission; correcting or deleting one is
    owner-only and needs the **Security PIN**, because the row has already moved a day's cash
    balance. Every correction and deletion is logged with its before-and-after figures.
- **New: Saving, inside Extra Expenses.** A **Saving** tab where you create named pots — an
  emergency fund, a new oven, next year's licence — and file money into each one, in cash, online
  or both, exactly like any other expense. Open a pot to see everything ever put into it and what
  it holds in total.
  - Money set aside leaves your cash or bank the day you file it, and shows in Finance as a
    single **Saving** line. The pot names and their entries stay on the Extra Expenses page —
    the finance report deliberately doesn't repeat them.
  - Rename a pot at any time; everything already filed under it follows the new name. A pot with
    money in it **cannot** be deleted, so nothing is ever stranded.
  - Saving counts against estimated profit like any other expense, so a month where you save
    heavily will read as a leaner month.
  - **Withdraw** takes money back out of a pot, in cash, online or both. It returns to your cash
    or bank the day you record it, the pot balance drops by the same amount, and the period's
    **Saving** figure is net — deposits less withdrawals. You cannot take out more than a pot
    holds. Because saving lowers estimated profit, withdrawing raises it again; over any stretch
    covering both, the two cancel out.
- **New: advance payments on rooms.** Take a deposit at check-in — there's now an optional
  **Advance payment** box on the check-in form (Cash / Online / Card / Cash + Online) — and take
  more later from the room's folio at any time during the stay. At checkout the bill shows
  **Grand total → Advance received → Balance payable**, and the guest only pays the balance; the
  printed bill and the Sales reprint show the same three lines. If the deposit came to more than
  the final bill, checkout shows **Refund due** instead and records the money going back, as cash
  or a transfer.
  - The money lands in your cash-in-hand **the day you take it**, so an evening till count now
    matches the report — but it is **not** counted as a sale until the guest checks out, so no day
    is inflated by a deposit and no bill is counted twice.
  - Sales now carries **Paid by advance — cash** and **— online** lines, so a stay settled by its
    deposit shows up as a sale instead of only lifting the total, and a mixed deposit doesn't
    collapse into one figure. The Sales rows add up exactly again.
  - **A refund can be split too** — return part in cash and transfer the rest, with the deposit's
    own make-up shown beside it ("Held as ₹3,000 cash + ₹2,000 online") so you can see what's
    actually there to give back.
  - Every advance figure in Finance now shows its cash/online split — received, refunded, and the
    part applied to a bill — on screen, in the CSV and in the daily PDF.
- **Finance now separates Restaurant sales from Room sales.** Tables and walk-ins in one block,
  hotel stays in another, and an **All sales** line showing the two together — so you can see at a
  glance what the kitchen earned and what the rooms earned. The advance lines live in Room sales,
  where they belong. **A restaurant without rooms sees none of this** — one block, still headed
  "Sales", exactly as before. Applies on screen, in the CSV export and in the daily PDF.
  - Finance gains a **Room advances** section (received / refunded) and an **Advance held** figure
    on the opening and closing balances — guests' money that is sitting in your till but isn't
    yours yet. It's in the CSV export and the daily PDF too.
  - A mistyped deposit can be removed from the folio by the **owner only**, using the Security PIN,
    and only while the guest is still checked in. Every attempt is recorded in
    Admin → Settings → Security activity.
  - Taking an advance needs no new permission — anyone who can check a guest in can take one.

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
- **New: Mock bills, for demos and training.** A small **M** button on the dashboard opens a mock
  billing screen behind the Security PIN. It has its **own permission** — "Mock Billing → Print Mock
  Bills", ticked per staff member on the staff screen. It is **off by default for everyone**,
  including Cashiers and Managers, so you decide exactly who can demo; you can also make an account
  that can print mock bills and do nothing else at all. Everything
  on it is editable — restaurant header, table, customer, bill number, date and time, items, prices,
  quantities, discount, tax, payment method, even the total — and it prints exactly like a real bill
  on the same thermal paper. It covers every kind of bill you actually hand out: paid (cash, online,
  card or a cash+online split), **unpaid** (the bill you print before taking payment), and **on
  credit** — with a Credit ID, the account name, an optional amount paid at billing, and the balance
  due, printing as ON CREDIT or PARTIALLY PAID just like the real thing. **Nothing you do there is saved or counted:** no stock is deducted, no
  sale is recorded, no bill or ticket number is used up, and it never appears in Sales, Finance,
  reports or the daily email. Mock bills carry one quiet mark so your team can recognise one — a
  small "M" after the bill number ("Bill No 1024 · M"). Every attempt to open the screen, successful
  or not, is listed in Admin → Settings → Security activity. If no Security PIN is set, the button
  doesn't appear.
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
