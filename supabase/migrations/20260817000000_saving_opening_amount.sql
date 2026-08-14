-- A saving pot's balance from BEFORE the app was tracking it.
--
-- A restaurant that has been putting money aside for two years does not want its
-- "House Fund" pot to read ₹0 on the day it starts using RestroSewa. This is the
-- figure that was already collected when the pot was created.
--
-- ── IT IS NOT A PAYMENT, AND THAT IS THE WHOLE POINT ─────────────────────────
-- The obvious implementation — write it as a `saving` row in extra_expenses — is
-- WRONG, and expensively so. Every finance figure sums those rows, so a ₹50,000
-- opening balance would:
--   • take ₹50,000 out of cash-in-hand today, money that never left the till
--   • appear in the ledger as an outflow that never happened
--   • cut estimated profit by ₹50,000 in the month the pot was created
-- The money was set aside months ago. Recording it as movement today would be a
-- lie about today.
--
-- So it lives on the TITLE as a plain opening figure, exactly as
-- `finance_openings` carries the one balance the app cannot derive. It has no
-- cash/online split because it is not a tender — nothing moved. It touches
-- neither finance function, and `extra_expenses_total`, the four balances, the
-- ledger and the daily PDF are all unaffected by design.
--
-- Consequence worth stating: a pot's displayed balance is
-- `opening_amount + Σ its extra_expenses rows`, while its cash/online breakdown
-- describes ONLY the rows. Those two will not add up, and must not — the
-- breakdown answers "how did the money we tracked arrive", not "what is in here".

alter table saving_titles
  add column if not exists opening_amount numeric(12,2) not null default 0;

-- Never negative: a pot cannot start out overdrawn. Withdrawals are signed rows
-- in extra_expenses and can take the running balance down; this figure is a
-- starting point, not a movement.
alter table saving_titles drop constraint if exists saving_titles_opening_amount_check;
alter table saving_titles add constraint saving_titles_opening_amount_check
  check (opening_amount >= 0);
