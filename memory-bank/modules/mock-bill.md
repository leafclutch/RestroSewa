# Mock Bill (demo / training / preview billing)

# Overview
A Security-PIN-gated workspace at `/employee/mock-bill` that produces a bill **identical on paper**
to a real one, while writing nothing anywhere. Built for demos, customer previews, staff training
and print-alignment testing. Reached from a small **M** button on the staff dashboard. See
`decisions.md` → "Mock bills write nothing".

# Responsibilities
- Let a cashier compose an arbitrary bill (header, lines, charges, tender, date) and print it.
- Print it through the **same** `BillTicket` the real POS uses, so the paper cannot be told apart.
- Guarantee — structurally, not by convention — that nothing reaches stock, sales, finance,
  analytics, credits, vendor balances, bill/OT numbers, notifications or the daily email.
- Record who opened the tool, and who tried and failed.

# Features
- **The M button** — a quiet round chip at the right of the dashboard's sticky quick-nav, outside
  the scroller so it stays put. Visible only with `print_mock_bills` **and** a Security PIN set.
- **The locked shell** — `/employee/mock-bill` renders a PIN prompt; the editor component is not
  mounted until `unlockMockBill` returns ok. There is no URL that reaches the editor.
- **Editable everything** — restaurant name/address/PAN/phone, paper width, table/room label, bill
  number + its label, date & time, customer name/phone, item lines (add / delete / rename / reprice
  / requantify / reorder), discount, tax %, service %, an optional manual grand total, payment
  method with a cash+online split, cashier, and a staff-only notes field.
- **Six bill states**, which are three different DOCUMENTS, not just three tenders:
  cash / online / card / **mixed** (PAID + a "Cash ₹x · Online ₹y" split), **unpaid** (the
  pre-payment bill — "Status: UNPAID"), and **credit** (an *unpaid bill* in this app's sense: the
  bill was CLOSED with money still owed, printing a Credit ID, "Credit a/c", ON CREDIT or
  PARTIALLY PAID, and BALANCE DUE). A credit bill takes an optional down payment, itself
  cash / online / cash+online.
- **Print** — the shared `PrintModal` + `BillTicket` at 58mm or 80mm.
- **Start over** — resets the draft to the restaurant's seeded defaults.

# Business Rules
- **The only difference on paper is a trailing "· M" after the bill number** ("1024 · M"). No
  watermark, no "MOCK"/"DEMO"/"TEST", nothing a customer would read as anything but part of the
  number. It is applied by the CALLER as a plain string (`markBillNumber`), so `BillTicket` never
  learns mock bills exist — which is what stops mock-awareness leaking onto a real receipt.
- **Nothing is stored.** The draft is React state and dies with the tab. Deliberately no
  `mock_bills` table: every figure in this app is DERIVED from `payments` / `session_order_items` /
  `purchases` / `stock_adjustments`, so a row that is never written can never need an "and exclude
  the mock ones" clause in a report written two years from now.
- **No PIN ⇒ no mock bills** — the same "no un-gated path" rule as the discount PIN and the
  sensitive-edit flows. The button disappears and the route redirects.
- **`print_mock_bills` decides who is offered it**; the Security PIN is the actual authorization
  (server-verified and audited with the actor), mirroring how the Sales tender edit is gated. Two
  independent gates on purpose — one says *who*, the other says *prove it*.
- The editor **owns data, never rendering**. Re-implementing any part of the ticket here would
  reintroduce the drift the shared component exists to prevent.
- `deriveTotals` mirrors `BillTicket`'s arithmetic exactly, including "discount comes off BEFORE
  tax and service". If one changes the other must — `isolation.test.ts` pins the rule.
- **A credit bill's `tendered` is DERIVED from the tender split**, never typed separately — the
  same shape `paid-bill.tsx` uses (`cash + online + card`). So a mixed down payment can never
  disagree with the two amounts printed beside it. The balance floors at zero: over-tendering is a
  mistake, not a negative debt.

# Important Components
- `lib/mock-bill/draft.ts` — the whole state shape and every calculation. **Zero runtime imports**
  (only an erased type import), which is both the isolation guarantee's first layer and what makes
  it runnable under plain `node --test`.
- `app/actions/mock-bill.ts` — the feature's ENTIRE server surface: one function, `unlockMockBill`,
  which only verifies a PIN. It constructs no Supabase client and calls no RPC.
- `app/(employee)/employee/mock-bill/page.tsx` — route guard (`close_bills` + `securityEnabled`) and
  the seed from `getRestaurantConfig`.
- `_components/mock-bill-client.tsx` (locked shell) and `_components/mock-bill-editor.tsx` (editor).
- `lib/mock-bill/isolation.test.ts` — the guard. Asserts the import allow-list and the absence of
  every DB primitive against the module's SOURCE, plus the arithmetic and the mark.
- Reused unchanged: `BillTicket` / `PrintModal` (`_components/bill-ticket.tsx`),
  `SecurityPinDialog`, `verifySecurityPin` / `logSecurityEvent`, `billNumberLabel`,
  `billMethodLabel`.

# Database Relations
**None, and no migration.** The only row this feature ever writes is an audit row in
`security_audit_log` (operation `open_mock_bill`) — a table no financial, stock or sales report
reads. That column is plain `text` with no CHECK constraint, so the new operation was a
TypeScript-only change to `SecurityOperation`.

# Permissions
**`print_mock_bills`** — the feature's OWN permission (group "Mock Billing", label "Print Mock
Bills"), granted per staff member in the super-admin restaurant detail screen. It is **on no job
preset**, deliberately, like Payroll: nobody should acquire the ability to print a convincing
receipt by inheriting a Cashier template. It is standalone, not a rider on `close_bills`, so a
demo/sales account can be granted this **and nothing else**.

`print_mock_bills` + `securityEnabled` gates the button (dashboard), the route (page guard) and the
unlock (action) — the same three, and `isolation.test.ts` asserts they can't diverge. All re-check
server-side; the button is convenience only. A caller without the permission is logged as `blocked`
(detail `missing_print_mock_bills`); a wrong PIN is logged as `failure` by `verifySecurityPin`
itself; success is logged explicitly (there is no RPC to be atomic with). See
`modules/security-pin.md`, `modules/permissions.md`.

Nothing else had to change to make the checkbox appear: `PermissionPicker` renders
`PERMISSION_GROUPS` verbatim and `parsePermissions` (`app/actions/staff.ts`) validates against
`Object.values(PERMISSIONS)`, so `lib/permissions.ts` is the single source for both.

# Known Limitations
- No PIN lockout/rate-limit — inherited from the Security PIN module, which logs every attempt.
- The `BillTicket` prop `grandTotalOverride` is the one mock-only concession in a shared component.
  Every real caller omits it, so real bills are byte-identical, but it must stay documented.
- No saved templates: a demonstrator rebuilds the draft each session (the price of storing nothing).
- Room-style grouped bills (`sections`) and the hotel stay block are not offered — a mock bill is a
  flat table/walk-in bill. The credit block IS offered (see Features).

# Future Improvements
- A localStorage draft so a refresh doesn't lose the composition (still zero server involvement).
- Preset demo baskets, if training use makes rebuilding tedious.
