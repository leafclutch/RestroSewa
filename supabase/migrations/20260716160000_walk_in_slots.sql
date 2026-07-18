-- Walk-ins become permanent workspaces (W1, W2, W3 …) that behave like tables, instead
-- of throwaway sessions that vanished from the dashboard the moment the cashier left.
--
-- `walk_in_no` ties a walk-in session to a fixed slot, so the dashboard can show that slot
-- as occupied and the cashier can reopen it later — exactly like a table's number. It stays
-- NULL for table/room sessions.
alter table sessions add column if not exists walk_in_no smallint;

-- Optional customer details for takeaway / phone / online-delivery walk-ins. All nullable;
-- editable any time before the bill is closed.
alter table sessions add column if not exists customer_name    text;
alter table sessions add column if not exists customer_phone   text;
alter table sessions add column if not exists customer_address text;

-- One live session per walk-in slot per restaurant — the same guarantee a table has (a
-- table can't hold two open sessions). Partial unique index so it only applies to ACTIVE
-- walk-in sessions; closed ones don't collide, and table/room sessions (walk_in_no NULL)
-- are unaffected.
create unique index if not exists sessions_active_walk_in_slot_idx
  on sessions (restaurant_id, walk_in_no)
  where status = 'active' and walk_in_no is not null;
