-- =============================================================
-- CLOSING AN EMPTIED SAVING POT
--
-- THE BUG
-- A pot could only be removed while it had ZERO entries. Deletability was gated on
-- the number of rows filed against it, not on what it holds — so a pot that had been
-- deposited into and then fully withdrawn was empty (balance 0.00) and yet
-- permanently stuck on the screen, with the refusal reading "This saving has money in
-- it", which was flatly untrue.
--
-- Measured on production: "Hotel GlasGow In & Restaurant" has a pot with an opening
-- of 50,000, two entries netting -50,000, a balance of 0.00, and no way to remove it.
--
-- WHY THIS IS NOT FIXED BY RELAXING THE DELETE
-- A saving row IS an `extra_expenses` row: filing 5,000 into a pot moved 5,000 of cash
-- on THAT day, and withdrawing it moved it back on ANOTHER day. Both are dated events
-- that `finance_report`, the ledger, the daily PDF and the profit line have already
-- counted, and one of those days may already have been emailed to an owner. Deleting
-- them to make the pot disappear would silently rewrite a settled day's closing cash.
-- That is what `on delete restrict` on `extra_expenses.saving_title_id` is there to
-- prevent, and it stays.
--
-- Nor can the rows simply be detached: `extra_expenses_saving_title_check` makes
-- `category = 'saving'` and `saving_title_id is not null` an equivalence, so a saving
-- row without a pot is not a representable state.
--
-- THE FIX
-- An emptied pot is CLOSED, not deleted. It leaves the Saving list and the "file into"
-- picker, its history stays exactly where it is, and Finance is untouched. A pot that
-- never held anything is still hard-deleted — there is no history to protect.
-- Closing is reversible, because a pot closed by mistake must not be a dead end.
-- =============================================================

alter table saving_titles
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references restaurant_users(id) on delete set null;

comment on column saving_titles.closed_at is
  'Set when an EMPTIED pot is retired. Its saving rows stay put — they are dated cash '
  'movements Finance has already counted. Null = active.';

-- Names are unique per restaurant, but only among OPEN pots. Without this, closing
-- "Festival Fund" would permanently reserve the name and next year's pot would have to
-- be called something else — which is the sort of small indignity that makes staff
-- stop closing them at all.
drop index if exists saving_titles_name_key;
create unique index if not exists saving_titles_name_key
  on saving_titles(restaurant_id, lower(btrim(name)))
  where closed_at is null;

-- The Saving screen's list query filters on this.
create index if not exists saving_titles_open_idx
  on saving_titles(restaurant_id, created_at)
  where closed_at is null;


notify pgrst, 'reload schema';
