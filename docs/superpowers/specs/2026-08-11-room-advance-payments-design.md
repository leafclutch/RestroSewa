# Room advance payments — design

**Date:** 2026-08-11
**Status:** approved design, not yet planned or built
**Module:** rooms (hotel side) + finance

## Problem

A hotel takes a deposit at check-in. RestroSewa has nowhere to put it. Today the receptionist's
only options are to hold the cash off the books until checkout — so the day's cash-in-hand
under-reports by the deposit and a nightly till count cannot be reconciled — or to fake a
part-payment against a stay that has not been billed yet.

The money must be recorded when it is received, deducted from the final bill, and carried
correctly through the four derived balances and every report.

## Decisions taken

1. **Cash on the day taken; the sale on the day of checkout.** A ₹5,000 advance on Monday raises
   Monday's cash-in-hand and leaves Monday's Sales at ₹0. Wednesday books the whole ₹8,000 bill
   with only ₹3,000 of fresh money. This is the accrual rule the app already applies to credit,
   pointed the other way.
2. **No "credit" advance.** Methods are Cash / Online / Card / Mixed (cash+online). An advance is
   money received; a guest who hands over nothing has simply not paid an advance, and settling or
   crediting the whole bill at checkout already works.
3. **Advances can be taken at check-in and again from the folio** during the stay.
4. **An advance larger than the bill is refunded at checkout**, cash or online, recorded as money
   out that day.
5. **Editing or deleting an advance needs the Security PIN**, and only while the stay is open.

## Data model

### New table `room_advances`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `restaurant_id` | uuid not null | FK `restaurants`, carried for tenant filtering as everywhere else |
| `stay_id` | uuid not null | FK `room_stays` on delete cascade |
| `amount` | numeric(12,2) not null | **signed**: positive = deposit taken, negative = refund returned |
| `cash_amount` | numeric(12,2) not null default 0 | |
| `online_amount` | numeric(12,2) not null default 0 | |
| `card_amount` | numeric(12,2) not null default 0 | |
| `method` | text not null | `cash` \| `online` \| `card` \| `mixed`, stored as `payments` does |
| `note` | text | |
| `created_by` | uuid | FK `restaurant_users` |
| `created_at` | timestamptz not null default now() | |

Constraints: `cash_amount + online_amount + card_amount = amount` (CHECK), `amount <> 0`.
Index on `(restaurant_id, created_at)` for the finance legs and `(stay_id)` for the folio.

**Signed rows are the whole trick.** A refund is a negative row, so:

- advance held on a stay = `sum(amount)` — one number, one sign convention;
- the refund lands in the ledger on the day it is physically handed back;
- the finance cash/bank legs need no separate refund branch, because the signs already work.

There is no stored balance anywhere. Consistent with every other figure in this app.

### `payments` gains one column

`advance_amount numeric(12,2) not null default 0` — how much of this bill was settled by advances
already received. For an ₹8,000 bill with ₹5,000 held and ₹3,000 paid in cash at checkout:

```
payments.total_amount   = 8000   ← the sale; unchanged meaning
payments.cash_amount    = 3000   ← money moving today
payments.advance_amount = 5000   ← money that moved on Monday
```

**This is the one dangerous change in the feature.** The invariant

```
left on credit = total_amount − (cash_amount + online_amount + card_amount)
```

becomes

```
left on credit = total_amount − (cash_amount + online_amount + card_amount + advance_amount)
```

Every reader of that expression moves in lockstep or an ₹8,000 bill silently raises ₹5,000 of
phantom customer debt. This is the same class of failure as the mixed-payments rollout. The
readers:

- `finance_transactions` — the `sale` branch's `credit_to_us_delta` and its `method` classifier;
- `check_out_room` — the `v_paid < p_total` fork that decides credit vs. settled;
- `close_bill_with_credit` — `INVALID_DOWN_PAYMENT`, `v_owed`, `credits.down_payment`;
- `edit_payment_tender` — must clamp the edited tender to `total_amount − advance_amount`;
- `lib/credits.ts` and the Sales/credit views that render "paid vs. owed".

**A useful consequence:** `credits.down_payment` should include the advance, because it *is* money
received against that bill. `finance_report` derives customer credit created as
`bill_amount − down_payment`, so that leg then stays correct with no change at all.

## Finance

### `finance_report`

- **Cash and bank legs gain `room_advances`**, both the before-period and in-period windows, on
  the same `effective_from` seed floor the other cash legs use. Positive and negative rows are
  summed together; refunds need no separate term.
- **Sales figures are untouched.** They read `payments`, and the full ₹8,000 still books on
  Wednesday.
- **Two new reported figures:** advances received and advances refunded in the period.
- **A fifth balance, "Advances held"**, derived exactly like the two credit balances:

  ```
  Advances held (T) = Σ room_advances.amount [< T] − Σ payments.advance_amount [< T]
  ```

  Without it, Monday's cash rises with nothing on the report explaining why. It is a liability:
  money in the till that belongs to a guest.

The return type changes, so the function is **dropped and recreated**, exactly as the credit
balances migration did. Consumers to update: `app/actions/finance.ts`, `lib/finance.ts`, the
Finance screen, the CSV export, and `lib/reports/daily-summary.ts` + `daily-summary-pdf.ts`.

### `finance_transactions`

One new branch over `room_advances`: cash/bank delta, no sale, no credit leg, `kind` of
`room_advance` (a negative row renders as a refund). The sale branch subtracts `advance_amount`
from its credit delta as described above.

**The reconciliation property is the test that matters:** the last row's running total must still
land exactly on the report's closing cash, across an advance day, a refund and a checkout.

### Untouched

`dashboard_stats` (it has no cash balance, and `sales_total` still reads the full bill from one
payment row), stock, purchases, vendors, payroll, bill numbering, analytics revenue.

## Billing and print

`lib/room-billing.ts` — `buildFolio` gains an `advances` input and returns `advancePaid` and
`balanceDue` (`grandTotal − advancePaid`, floored at 0) plus `refundDue`
(`max(0, advancePaid − grandTotal)`). Pure functions, no imports, as today.

`lib/billing/room-bill.ts` — `folioToBill()` maps `advance` and `balance` onto `RoomBillView`.
Still a pure mapper; it re-derives nothing.

`BillTicket` renders three lines **only when an advance exists**:

```
Grand Total        8,000
Advance received  −5,000
Balance payable    3,000
```

Undefined for every table bill, walk-in and mock bill, so those stay byte-identical. This follows
the `grandTotalOverride` precedent: one shared renderer, additive, never a copy. The paid bill in
Sales re-derives the same way from `payments.advance_amount`, so the document reads identically
before and after payment.

## Screens

**Check-in form** — a new optional **Advance payment** section under the register fields: amount,
method chips, the cash+online pair that auto-fills on Mixed (the widget checkout already uses), and
a note. Blank or zero writes no row, so a check-in without a deposit is byte-identical to today.
The advance is written inside `check_in_room`, in the **same transaction** as the stay — there must
be no window in which a guest is checked in and their deposit is lost.

**Folio panel** — an **Advances** block listing each dated row with its split and the net held, and
an *Add advance* button opening the same form.

**Checkout** — Total / less Advance / Balance payable. Tender validates against **balance payable**,
not the total: the mixed cash+online equality check, the "amount tendered must equal" check, and the
credit rule (`credit = total − advance − tendered`) all move to the balance. When the advance
exceeds the bill the block inverts to **Refund due ₹X** with a cash/online choice, and
`check_out_room` writes the negative `room_advances` row in the same transaction.

## Permissions

**No new permission.**

- Recording an advance rides on `check_in`. A receptionist who can put a guest in the room must be
  able to take their deposit; a second permission would mean one unticked box silently breaks the
  front desk.
- Refunding rides on `close_bills`, which checkout already requires.
- **Editing or deleting an advance requires the Security PIN** — a new `edit_room_advance` member
  on the `SecurityOperation` union. `security_audit_log.operation` is plain `text` with no CHECK
  constraint, so this needs no migration. Before→after goes to the audit log and shows in
  Admin → Settings → Security activity. Allowed only while the stay is `active`; once checked out
  the advance is frozen inside a settled bill.

Room assignment filtering (`buildVisibilityFilter`) applies to every advance action, as it does to
check-in itself.

## Testing

**Pure unit tests** (`node --test`, zero runtime imports per the alias limitation):
`advancePaid`, `balanceDue`, `refundDue`, the floor at zero, a refund larger than one advance row
but not the sum, and rounding at the paisa.

**Database reconciliation on DEV** — the three assertions that prove the money model:

1. On advance day: cash rises by the advance, `sales_total` is unchanged.
2. On checkout day: sales book the full bill, cash rises by the balance only.
3. `finance_transactions`' final running total equals `finance_report`'s closing cash across both
   days, with a refund in the period.

**Regression:** a table bill, a walk-in bill and a room checkout with **no** advance must produce
byte-identical payments rows and printed output to today.

## Migration and rollout

One migration file: `room_advances`, `payments.advance_amount`, and the recreated
`finance_report`, `finance_transactions`, `check_in_room`, `check_out_room`,
`close_bill_with_credit`, `edit_payment_tender`.

`check_out_room` and `close_bill_with_credit` must be **dropped before recreation** when the
parameter list grows, and every call site must pass arguments **by name** — the positional
11-argument call is what broke every hotel credit checkout in `20260717140000`.

**DB before app.** This carries a write path: the app writing `advance_amount` to a column that
does not exist fails loudly on every room checkout.

## Out of scope

- Advances on tables, walk-ins or sessions. Rooms only.
- Advance bookings/reservations (a deposit against a stay that has not started). This feature
  attaches an advance to an existing stay; a reservations engine remains a roadmap item.
- Converting an unused advance into a customer credit balance instead of refunding it.
