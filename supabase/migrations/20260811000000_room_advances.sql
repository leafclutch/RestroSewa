-- =============================================================
-- ROOM ADVANCE PAYMENTS — the deposit a hotel takes at check-in
--
-- A deposit is money received BEFORE there is a sale. The app's accrual rule
-- already handles the opposite case (a credit bill is a sale before there is
-- money); this is the same rule pointed the other way. The cash lands in the
-- day's balance the moment it is taken, and the SALE still books in full at
-- checkout.
--
-- SIGNED ROWS. A refund is a negative row, not a second table and not a flag:
--   * advance held on a stay = sum(amount) — one number, one convention;
--   * the refund lands in the ledger on the day it is physically handed back;
--   * the finance cash/bank legs need no refund branch at all, because the signs
--     already do the work.
-- =============================================================

create table if not exists room_advances (
  id            uuid primary key default gen_random_uuid(),
  -- Carried like every other tenant table, so the finance legs can sum this
  -- table without joining back through room_stays.
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  stay_id       uuid not null references room_stays(id)  on delete cascade,
  -- SIGNED. Positive = deposit taken from the guest. Negative = refund returned.
  amount        numeric(12,2) not null,
  cash_amount   numeric(12,2) not null default 0,
  online_amount numeric(12,2) not null default 0,
  card_amount   numeric(12,2) not null default 0,
  method        text not null,
  note          text,
  created_by    uuid references restaurant_users(id),
  created_at    timestamptz not null default now(),

  -- A zero-value advance is not a record of anything; it is a mis-submitted form.
  constraint room_advances_amount_nonzero
    check (amount <> 0),
  -- The split IS the amount. Without this the cash legs and the held total can
  -- disagree, and the disagreement would only show up as a till that will not
  -- reconcile weeks later.
  constraint room_advances_split_check
    check (cash_amount + online_amount + card_amount = amount),
  constraint room_advances_method_check
    check (method in ('cash','online','card','mixed'))
);

-- The finance legs scan by restaurant and date; the folio reads by stay.
create index if not exists room_advances_restaurant_created_idx
  on room_advances (restaurant_id, created_at);
create index if not exists room_advances_stay_idx
  on room_advances (stay_id);

-- Deny by default, like every other table: reached only through the service role.
alter table room_advances enable row level security;

-- Explicit, even though 20260801000000 sets default privileges for future tables:
-- those defaults belong to the role that declared them, and this migration may be
-- replayed by a different one when a database is built from scratch.
grant select, insert, update, delete on table room_advances to service_role;


-- ── How much of a bill was settled by money already received ──────────────────
--
-- `total_amount` is still the SALE and does not move. This column says how much
-- of it arrived before today.
--
-- THE INVARIANT THIS CHANGES, and the one dangerous thing in the feature:
--
--   left on credit = total_amount − (cash + online + card + advance_amount)
--
-- Every reader of that expression must gain the `+ advance_amount` term in the
-- same deployment, or an 8,000 bill settled with a 5,000 deposit and 3,000 cash
-- silently raises 5,000 of customer debt that nobody owes. The readers are
-- finance_transactions' sale branch, check_out_room, close_bill_with_credit and
-- edit_payment_tender (migrations 20260811000200 and 20260811000300), plus
-- lib/credits.ts on the app side.
--
-- DEFAULT 0 is what makes every existing row and every table bill correct
-- without a backfill: no advance means the old expression and the new one are
-- the same expression.
alter table payments
  add column if not exists advance_amount numeric(12,2) not null default 0;

notify pgrst, 'reload schema';
