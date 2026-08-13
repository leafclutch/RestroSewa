# Extra Expenses — design

## Context

The Finance report already has an **Expenses** section, but everything in it is bought
*stock* or *people*: purchases, vendor credit repayments and salary. A restaurant's
overheads — rent, electricity, water, internet, gas — have nowhere to go.

Today that money leaves the till and the books never learn about it. Closing cash is wrong
by exactly the rent, and the only way to reconcile is to remember. This adds the missing
category and wires it into the same four derived balances as everything else.

## Decisions taken

- **Category list is fixed**, with a free-text note on every entry. Stable categories make
  "how much on electricity this year" answerable; the note carries the specifics ("July
  bill, NEA"). A CHECK constraint rather than a bare text column, following the rule
  `staff_payroll` states outright: adding one later should be a deliberate migration, not
  a typo.
- **An expense is always money that has already left.** No payable state, no settle-later
  screen. Cash, online or mixed, on the day it was paid. A pending bill is logged the day
  it is paid.
- **No back-dating.** The expense lands on the business day it is recorded. Back-dating
  would silently rewrite a day whose PDF has already been emailed and marked delivered in
  `report_deliveries` — the report and the books would disagree with each other and there
  would be no trace of why. Recorded as a known limitation, not an oversight.
- **No new RPCs for the CRUD.** `resolveSplit()` already validates a mixed split for every
  other tender in the app, and the CHECK constraint is the backstop. Purchases needed an
  RPC because they move stock; an expense moves nothing but its own row.
- **Own page, own permission.** `/admin/expenses` in the Stock & Finance nav group, gated
  on a new `manage_expenses`. Paying rent is a different trust level from counting stock,
  and the owner must be able to grant it without also handing over the Finance report.
- **Edit and delete sit behind the Security PIN**, audited as `edit_extra_expense` /
  `delete_extra_expense` — the same guard as payment and purchase corrections, for the same
  reason: it moves a cash balance that has already been counted.

## Data model

```sql
create table extra_expenses (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  category       text not null check (category in ('rent','electricity','water','gas',
                   'internet','maintenance','marketing','licenses','transport','other')),
  note           text,
  amount         numeric(12,2) not null check (amount > 0),
  payment_method payment_method not null check (payment_method in ('cash','online','mixed')),
  cash_amount    numeric(12,2) not null default 0 check (cash_amount   >= 0),
  online_amount  numeric(12,2) not null default 0 check (online_amount >= 0),
  constraint extra_expenses_split_check check (cash_amount + online_amount = amount),
  created_by     uuid references restaurant_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
```

The shape of `purchases` minus the credit leg, so the split reads identically everywhere.
RLS on with no policies — deny by default, service role only, like every other table here.

There is deliberately **no `status`, no `paid` column and no derived total**: an expense row
IS the payment. Nothing here can disagree with itself.

## Finance integration

`finance_report` gains four appended columns. Appending (never reordering) keeps every
positional reader working — the same discipline the room-advance work followed.

| column | meaning |
| --- | --- |
| `extra_expenses_cash` / `extra_expenses_online` | the period's spend, split by tender |
| `extra_expenses_total` | the headline |
| `extra_expenses_by_category` | `jsonb` — `[{category, cash, online, total}]`, biggest first, categories with no spend absent |

The breakdown rides as jsonb rather than a second RPC because this app is latency-bound,
not query-bound: a round trip costs more than the payload.

Both **opening and closing** cash/online must subtract expenses. The opening legs are
floored at the `finance_openings` effective date exactly like `pur`, `vp` and `sal` — the
cash seed replaces pre-books movement, so an expense paid before the books opened must not
be counted twice.

`finance_transactions` gains an `extra_expense` kind: `cash_delta −cash`,
`online_delta −online`, no credit leg, reference = the category label.

**Both functions must change together.** `closing_cash` in `finance_report` and the running
balance in `finance_transactions` are computed separately, and the ledger only reconciles if
the expense leg lands in both. This is the failure the room-advance work hit; it is the
first thing verified.

## Surfaces

- **`lib/expenses.ts`** — the category vocabulary (keys, labels, display order), shared by
  the form, the report, the CSV and the PDF so no two can disagree.
- **`/admin/expenses`** — add form (category → note → amount → Cash/Online/Mixed, reusing
  the shared auto-filling split field) and the period's list. Edit/delete prompt for the PIN.
- **`/admin/finance`** — the Expenses block gains "Extra expenses" with its split and the
  per-category lines beneath, and joins `totalExpenses`.
- **Daily PDF** — the same figures, the same wording. A PDF that disagrees with the screen
  is a support call.
- **Estimated profit** becomes `sales − purchases − salaries − extra expenses`, and its
  label changes with it.

Deliberately **not** changed: the dashboard's "Today's profit (est.)" tile, which uses a
different formula (`sales − COGS`) from `dashboard_stats`. Aligning the two is a separate
decision.

## Verification

DEV only — `node scripts/migrate.mjs up --yes`, never `--prod`.

1. **Identities**, per restaurant, over today and all history:
   - `extra_expenses_cash + extra_expenses_online = extra_expenses_total`
   - `sum(extra_expenses_by_category[].total) = extra_expenses_total`
   - each category row's `cash + online = total`
2. **Ledger reconciliation**: `opening + Σ deltas == closing` on cash and bank, which is the
   only check that catches the leg landing in one function but not the other.
3. **Carry-forward**: one period's closing cash IS the next period's opening cash with an
   expense in between.
4. **Opening floor**: an expense dated before `finance_openings.effective_from` must not
   move the opening balance.
5. **Regression**: a restaurant with no expenses reports four zeros and an empty array, and
   every existing figure is unchanged.
6. `npx tsc --noEmit`, `npm run build`, `node --test`. `npm run lint` proves nothing here —
   it skips every `.ts`/`.tsx`.

## Addendum — Savings (2026-08-13)

Money set aside, under named pots ("Emergency Fund", "New Oven").

**A saving is an extra expense with a title.** That is the whole design. `saving` becomes an
eleventh category, so the period total, the cash/online split, the ledger row, the CSV, the
daily PDF and the estimated-profit subtraction all pick it up **with no code and no change to
either finance function**. `extra_expenses_by_category` groups by category, so Finance shows one
"Saving" line and never the per-title detail — which is what was asked for. The pots live on the
Saving section of `/admin/expenses` and nowhere else.

A separate `savings` table was rejected: it would have meant a new leg in **both** finance
functions, and those are the pair that must always move together. Not worth re-entering that risk
for a row that behaves identically to rent.

**Pots are a table, not free text** (`saving_titles`), so a pot can be renamed without rewriting
the history filed under it and its all-time total is exact. Unique per restaurant,
case-insensitively — free text would let "Emergency Fund", "emergency fund" and "Emergency" become
three pots that never add up.

Two constraints carry the guarantees:

- `check ((category = 'saving') = (saving_title_id is not null))` — an equivalence, so **both**
  mistakes are unrepresentable: a saving with no pot, and a rent row pointing at one. Without it
  the Saving section could silently disagree with the Finance "Saving" line, since one reads
  titles and the other reads the category.
- `saving_title_id ... on delete restrict` — a pot holding money **cannot** be deleted, so entries
  can never be stranded while Finance still counts them. Verified: the API returns 409.

**Savings DO reduce estimated profit** (user's explicit call) — treated exactly like any other
expense. The trade-off is stated and accepted: a month with heavy saving reads as a weaker month.

**A pot's total is ALL-TIME, and the period picker is hidden on the Saving tab.** "How much is in
the emergency fund" has one answer; showing a month's worth under the same heading would invite a
misreading. Savings are also excluded from the Expenses list, because they appear under their pot
— listing both would show the same money twice.

### Withdrawing (added same day)

**A withdrawal is a NEGATIVE saving row** — the shape `room_advances` uses for a refund, chosen
for the same reason: it removes a second table, a direction flag, a second code path, and any
withdrawal branch from the finance functions. Both stay untouched again.

Every figure already sums these rows, so the signs do the work:

| | |
| --- | --- |
| pot balance | `sum(amount)` → deposits less withdrawals |
| `extra_expenses_total` | `sum(amount)` → **net** set aside in the period |
| `closing_cash` | `... − sum(cash)` → minus a negative = cash returns |
| ledger `cash_delta` | `−e.cash_amount` → `−(−1000) = +1000`, cash goes up |
| by-category jsonb | one "Saving" line, netted |

Three constraints changed, and the third is the one that matters:

- `amount <> 0 and (category = 'saving' or amount > 0)` — the sign is unlocked for exactly one
  category. A negative rent is meaningless.
- `cash_amount * amount >= 0` and the same for online — each leg must agree in sign with the
  amount. **Without this**, a row could carry `amount = −5000` with `cash = +8000,
  online = −13000`: it satisfies the split check, and it would credit the till 8,000 that never
  existed. The split check alone is not enough.

`extra_expenses_split_check` is untouched — it already holds for negative rows.

**Guards:** you cannot withdraw more than a pot holds (checked in `withdrawSaving` against the
summed balance), and an *edit* that would grow a withdrawal past the pot's balance is refused too,
measured excluding the row being replaced. The form is entirely in positive numbers; the sign is
applied once, at the server boundary, and on edit is re-applied from the row being edited — so a
deposit can never be flipped into a withdrawal from the client.

**⚠️ The accepted accounting consequence.** Saving reduces estimated profit, so withdrawing
necessarily RAISES it — a month that empties a pot reads as a strong month. That is the exact
mirror of the choice to treat saving as an expense, and over any period containing both the
deposit and the withdrawal the two cancel to zero. If it ever needs changing, the question to
revisit is whether saving should hit profit at all — not how withdrawals are recorded.

## Known limitations

- No back-dating (above). If a bill is paid on the 1st and logged on the 3rd, it lands on
  the 3rd.
- No recurring/reminder support: rent is re-entered each month.
- Categories are schema-level, so a restaurant wanting its own needs a migration.
