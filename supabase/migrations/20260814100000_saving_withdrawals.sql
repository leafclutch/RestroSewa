-- =============================================================
-- WITHDRAWING FROM A SAVING
--
-- A withdrawal is a NEGATIVE saving row. That single decision is the whole
-- feature, and it is the same one `room_advances` made for refunds — for the
-- same reason: it removes a second table, a direction flag, a second code path,
-- and any withdrawal branch from the finance functions. Both stay untouched.
--
-- Every figure already sums these rows, so the signs do the work:
--
--   pot balance          sum(amount)          → deposits less withdrawals
--   extra_expenses_total sum(amount)          → NET set aside in the period
--   closing_cash         ... - sum(cash)      → minus a negative = cash returns
--   ledger cash_delta    -e.cash_amount       → -(-1000) = +1000, cash goes up
--   by-category jsonb    sum() group by       → one "Saving" line, netted
--
-- ⚠️ THE ACCOUNTING CONSEQUENCE, ACCEPTED DELIBERATELY.
-- Saving reduces estimated profit (the user's explicit call), so withdrawing
-- necessarily RAISES it — a month that empties a pot reads as a strong month.
-- That is not a bug in this migration: it is the exact mirror of the choice to
-- treat saving as an expense, and over any period containing both the deposit
-- and the withdrawal the two cancel to zero. Changing it means revisiting
-- whether saving should hit profit at all, not patching the withdrawal.
--
-- Withdrawing is NOT income. It is the restaurant's own money coming back.
-- =============================================================

-- ── Amounts may now be negative, but only for savings ─────────────────────────
-- A negative rent or a negative electricity bill is meaningless, so the sign is
-- unlocked for exactly one category. `amount <> 0` replaces `amount > 0`: a
-- zero-value row moves nothing and would just be noise on the ledger.
alter table extra_expenses drop constraint if exists extra_expenses_amount_check;
alter table extra_expenses add constraint extra_expenses_amount_check
  check (amount <> 0 and (category = 'saving' or amount > 0));

-- ── The legs must agree in sign with the amount ───────────────────────────────
-- `leg * amount >= 0` says: a positive row has non-negative legs, a negative row
-- has non-positive legs, and either may be zero. It replaces the old `>= 0`,
-- which would have rejected every withdrawal.
--
-- Without this a row could carry `amount = -5000` with `cash = +8000,
-- online = -13000` — it satisfies the split check, and it would credit the till
-- 8,000 that never existed. The split check alone is not enough.
alter table extra_expenses drop constraint if exists extra_expenses_cash_amount_check;
alter table extra_expenses add constraint extra_expenses_cash_amount_check
  check (cash_amount * amount >= 0);

alter table extra_expenses drop constraint if exists extra_expenses_online_amount_check;
alter table extra_expenses add constraint extra_expenses_online_amount_check
  check (online_amount * amount >= 0);

-- `extra_expenses_split_check` (cash + online = amount) is deliberately NOT
-- touched: it already holds for negative rows, and it is what guarantees the two
-- balances can never drift from the headline figure.

notify pgrst, 'reload schema';
