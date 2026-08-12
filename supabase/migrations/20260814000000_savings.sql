-- =============================================================
-- SAVINGS — money set aside, under named pots
--
-- A saving is an EXTRA EXPENSE with a title. That is the whole design, and it is
-- why this migration touches neither `finance_report` nor `finance_transactions`:
-- 'saving' is simply an eleventh category, so the period total, the cash/online
-- split, the ledger row, the CSV, the daily PDF and the estimated-profit
-- subtraction all pick it up with no code. `extra_expenses_by_category` groups by
-- category, so Finance shows ONE "Saving" line and never the per-title detail —
-- which is exactly what was asked for. The titles live on the Saving section of
-- the Extra Expenses page and nowhere else.
--
-- The alternative — a `savings` table of its own — would have meant a new leg in
-- BOTH finance functions. Those two are the pair that must always move together
-- (closing_cash lives in one, the running balance in the other), and a leg added
-- to one alone breaks `opening + Σ deltas == closing` with nothing else failing.
-- Not worth re-entering that risk for a row that behaves identically to rent.
-- =============================================================

-- ── The pots ──────────────────────────────────────────────────────────────────
-- A title is a real record rather than free text so that a pot can be RENAMED
-- without rewriting the history filed under it, and so its all-time total is
-- exact. Free text would let "Emergency Fund", "emergency fund" and "Emergency"
-- become three pots that never add up — the same reason vendors are a table.
create table if not exists saving_titles (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 60),
  created_by    uuid references restaurant_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Case-insensitive uniqueness per restaurant, as an expression index because a
-- table constraint cannot carry `lower()`. Mirrors `vendors`.
create unique index if not exists saving_titles_name_key
  on saving_titles(restaurant_id, lower(btrim(name)));

create index if not exists saving_titles_restaurant_idx
  on saving_titles(restaurant_id, created_at);

alter table saving_titles enable row level security;
grant select, insert, update, delete on table saving_titles to service_role;


-- ── Savings are extra_expenses rows ───────────────────────────────────────────
alter table extra_expenses
  add column if not exists saving_title_id uuid references saving_titles(id) on delete restrict;

-- `on delete restrict` above is deliberate: a title with money filed under it
-- must be impossible to delete, or the entries would be orphaned and the Saving
-- section would lose them while Finance still counted them. The UI only offers
-- deletion for an empty title; this makes the guarantee structural.

-- Add 'saving' to the allowed categories. Dropping and re-adding is the only way
-- to widen a CHECK.
alter table extra_expenses drop constraint if exists extra_expenses_category_check;
alter table extra_expenses add constraint extra_expenses_category_check
  check (category in (
    'rent','electricity','water','gas','internet',
    'maintenance','marketing','licenses','transport','other',
    -- Ordinary categories describe what money was spent ON. 'saving' describes
    -- money set ASIDE, and is the only category carrying a title.
    'saving'));

-- A saving has a title; nothing else may. Written as an equivalence so BOTH
-- mistakes are impossible: a saving with no pot to file it under, and a rent row
-- that somehow points at one. Without this the Saving section could silently
-- disagree with the Finance "Saving" line, because one reads titles and the
-- other reads the category.
alter table extra_expenses drop constraint if exists extra_expenses_saving_title_check;
alter table extra_expenses add constraint extra_expenses_saving_title_check
  check ((category = 'saving') = (saving_title_id is not null));

-- The Saving section's only query shape: this restaurant's savings, by pot,
-- newest first.
create index if not exists extra_expenses_saving_idx
  on extra_expenses(saving_title_id, created_at desc)
  where saving_title_id is not null;

notify pgrst, 'reload schema';
