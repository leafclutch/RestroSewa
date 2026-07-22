-- Session Transfer: move a live session to another table, or a live stay to another room.
--
-- THE PREMISE. Everything downstream of a session keys off `session_id`, never off
-- `table_id`: orders, items, order_tickets, payments, credits, the bill number. So a
-- table shift is ONE update — `sessions.table_id` — and the whole bill follows for free.
-- This migration exists not because that update is hard, but because doing it SAFELY is.
-- The old place has to be released, the new one has to be provably free at the instant
-- it is taken, and nothing may half-happen.
--
--     T1 (Momo, Coke, KOT-00125)  →  Shift  →  T5 (same session, same bill number,
--                                                  same tickets, same everything)
--
-- WHAT IS GENERIC. The function takes a session and a destination and derives the KIND
-- of move from the session itself. Walk-in transfer and table merge later add a branch
-- to the destination resolution and a `kind` value — the locking, the audit row, the
-- notification re-pointing and the release-the-old-place logic are written once here and
-- are already correct for those cases.

-- ── The invariant that should always have existed ─────────────────────────────
-- Nothing has ever stopped two open sessions sharing a table. It has not bitten only
-- because openTableSession looks before it leaps. Transfer makes that luck untenable: it
-- is a SECOND way to put a session on a table, so a look-then-leap check in each of them
-- races the other. An index is the only thing that cannot race.
--
-- `status <> 'closed'`, NOT `status = 'active'`: a `pending_activation` session is a
-- customer's un-approved QR order, and it holds real items. Letting a transfer land on
-- top of one splits that table's food across two bills — precisely the accident this
-- feature exists to prevent. Every predicate in this file uses `<> 'closed'` for the
-- same reason.
--
-- FIRST, remediation. openTableSession checks only `status='active'` while the customer
-- QR path writes `pending_activation`, so a guest who scans and orders, followed by a
-- waiter who opens the table properly, produces exactly the pair the index forbids.
-- Close the EMPTY shells: an abandoned QR tap that never became an order costs nothing
-- to lose and would otherwise block the index. Duplicates carrying live items are left
-- alone deliberately — the index then fails loudly rather than this migration silently
-- guessing which bill the food belongs on.
update sessions s
   set status = 'closed', closed_at = now()
 where s.status = 'pending_activation'
   and exists (
     select 1 from sessions o
      where o.id <> s.id
        and o.status = 'active'
        and (   (s.table_id is not null and o.table_id = s.table_id)
             or (s.room_id  is not null and o.room_id  = s.room_id)))
   and not exists (
     select 1 from session_orders so
       join session_order_items soi on soi.order_id = so.id
      where so.session_id = s.id
        and soi.cancelled_at is null);

create unique index if not exists sessions_one_open_per_table_idx
  on sessions (table_id) where table_id is not null and status <> 'closed';

-- Rooms need their own: `room_stays_one_active_per_room` stops two STAYS sharing a room,
-- but a session can exist without a stay (the legacy shape check_in_room still defends
-- against with ROOM_HAS_OPEN_SESSION), so the stay index does not cover this. And
-- getRoomFolio does `.maybeSingle()` on room_stay_id — a second session throws, it does
-- not pick.
create unique index if not exists sessions_one_open_per_room_idx
  on sessions (room_id) where room_id is not null and status <> 'closed';

-- ── The printed label, frozen ─────────────────────────────────────────────────
-- order_tickets snapshots `workstation_name` but has always taken the TABLE label live
-- from the session at print time. After a shift, reprinting an earlier KOT would print
-- the NEW table — a piece of paper that never existed, and a kitchen plating to the
-- wrong place. Where a ticket was issued is a fact about that moment, so it is stored
-- like one.
alter table order_tickets
  add column if not exists location_label text;

-- Backfill from where each session sits today. That is correct for every existing row,
-- because transfers did not exist until now.
update order_tickets ot
   set location_label = coalesce(t.number, r.number)
  from sessions s
  left join restaurant_tables t on t.id = s.table_id
  left join rooms r             on r.id = s.room_id
 where s.id = ot.session_id
   and ot.location_label is null;

-- ── The audit row ─────────────────────────────────────────────────────────────
-- "8:15 PM · Table Shift · A1 → B4 · by Cashier John". There is no audit table anywhere
-- in this schema and this is not the migration to invent a generic one — a generic audit
-- table stores its subjects as loose json and loses every foreign key. This is a domain
-- table with the house shape (created_by + created_at) that happens to be append-only.
--
-- The LABELS are snapshotted alongside the FKs on purpose: tables get renamed and
-- deleted (hence `on delete set null`), and the history must still read "A1 → B4" in a
-- year. The FKs are for joining; the labels are for reading.
create table if not exists session_transfers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  session_id     uuid not null references sessions(id)    on delete cascade,
  -- Text check rather than separate tables, so walk-in and merge need no migration.
  kind           text not null check (kind in ('table', 'room')),
  from_table_id  uuid references restaurant_tables(id) on delete set null,
  to_table_id    uuid references restaurant_tables(id) on delete set null,
  from_room_id   uuid references rooms(id)             on delete set null,
  to_room_id     uuid references rooms(id)             on delete set null,
  room_stay_id   uuid references room_stays(id)        on delete set null,
  from_label     text not null,
  to_label       text not null,
  reason         text,
  created_by     uuid references restaurant_users(id)  on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists session_transfers_session_idx
  on session_transfers (session_id, created_at);
create index if not exists session_transfers_restaurant_idx
  on session_transfers (restaurant_id, created_at desc);

alter table session_transfers enable row level security;  -- no policies: service_role only
grant select, insert on session_transfers to service_role;

-- ── A dirty table cannot be seated — by ARRIVING either ───────────────────────
-- The original fired BEFORE INSERT only, because opening was the only way onto a table.
-- Transfer is the second way and it is an UPDATE, so without this the friendly check
-- inside transfer_session would be the only guard — i.e. exactly the look-then-leap the
-- index above was added to eliminate.
--
-- Two things it must not do. It must not refuse the transfer's own write: it cannot,
-- because it only ever inspects NEW.table_id and the transfer dirties the OLD table.
-- And it must not fire on the close path: it doesn't, because `update of table_id`
-- restricts it to statements naming that column, and closing never does.
create or replace function refuse_session_on_dirty_table() returns trigger
language plpgsql as $$
begin
  -- `update of <col>` fires when the column is merely PRESENT in the SET list, even when
  -- assigned its own value. An unchanged table_id is not an arrival.
  if tg_op = 'UPDATE' and new.table_id is not distinct from old.table_id then
    return new;
  end if;

  -- Detaching a closed session from its table is bookkeeping, not seating. Refusing it
  -- would make dirty tables un-editable by admin tooling.
  if new.status = 'closed' then
    return new;
  end if;

  if new.table_id is not null
     and exists (select 1 from restaurant_tables
                  where id = new.table_id and cleaning_since is not null) then
    raise exception 'TABLE_NEEDS_CLEANING';
  end if;
  return new;
end $$;

drop trigger if exists trg_refuse_session_on_dirty_table on sessions;
create trigger trg_refuse_session_on_dirty_table
  before insert or update of table_id on sessions
  for each row execute function refuse_session_on_dirty_table();

-- ── The transfer ──────────────────────────────────────────────────────────────
-- LOCK ORDER — the whole reason this is one function and not four statements in a
-- server action. The rule, matching check_out_room and generate_order_ticket:
--
--     room_stays  →  sessions  →  rooms / restaurant_tables (BY ID ASCENDING)
--     and every lock is taken BEFORE any row is written.
--
-- Each clause earns its place:
--
--   * BY ID ASCENDING is load-bearing, not decoration. Locking source-then-destination
--     deadlocks the instant two cashiers swap two tables (A→B while B→A): txn1 holds A
--     and wants B, txn2 holds B and wants A. Sorting the two ids gives every transaction
--     in the system the same acquisition order, which is what makes a wait-for cycle
--     unconstructible. least()/greatest() rather than `order by ... for update` so the
--     ordering is a property of this code, not of a plan that might place LockRows
--     differently.
--
--   * LOCKS BEFORE WRITES defeats check_in_room, which locks the ROOM first and only
--     then inserts a stay and a session. If we moved the session before holding the
--     destination's row lock, check_in_room would block on our uncommitted unique-index
--     entry while holding the very room we are about to ask for. The same trap exists
--     for tables via sessions_one_open_per_table_idx and openTableSession. Acquiring
--     first collapses that cycle into a plain wait.
--
--   * SESSION BEFORE TABLE is already the house order — closing a bill updates the
--     session row and then touches the table via trg_park_table_for_cleaning — so a
--     transfer racing a bill-close queues rather than cycling.
create or replace function transfer_session(
  p_restaurant_id       uuid,
  p_session_id          uuid,
  p_dest_table_id       uuid    default null,
  p_dest_room_id        uuid    default null,
  p_created_by          uuid    default null,
  p_reason              text    default null,
  -- The upgrade charge lives INSIDE this transaction on purpose. A charge for a move
  -- that rolled back, and a free upgrade for a move that stuck, are each worse than
  -- either failure alone. Optional, and room moves only.
  p_upgrade_amount      numeric default null,
  p_upgrade_description text    default null
) returns session_transfers
language plpgsql
as $$
declare
  v_session   sessions;
  v_stay      room_stays;
  v_kind      text;
  v_src       uuid;
  v_dst       uuid;
  v_first     uuid;
  v_second    uuid;
  v_src_label text;
  v_dst_label text;
  v_room      rooms;
  v_tbl       restaurant_tables;
  v_out       session_transfers;
begin
  -- Exactly one destination. Neither means nothing to do; both would make `kind`
  -- ambiguous and is only ever a caller bug.
  if (p_dest_table_id is null) = (p_dest_room_id is null) then
    raise exception 'TRANSFER_TARGET_REQUIRED';
  end if;
  v_kind := case when p_dest_table_id is not null then 'table' else 'room' end;

  -- An unlocked peek, used ONLY to learn which stay to lock. Everything decided below is
  -- re-read under the session lock.
  select s.* into v_session
    from sessions s
   where s.id = p_session_id and s.restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  -- ── Lock 1: the stay (room moves only) ──────────────────────────────────────
  -- Before the session, because check_out_room takes them in that order and one of the
  -- two orders had to give way.
  if v_session.room_stay_id is not null then
    select * into v_stay from room_stays
     where id = v_session.room_stay_id for update;
    if not found then
      raise exception 'STAY_NOT_FOUND';
    end if;
    if v_stay.status <> 'active' then
      raise exception 'STAY_ALREADY_CLOSED';
    end if;
  end if;

  -- ── Lock 2: the session ─────────────────────────────────────────────────────
  select s.* into v_session
    from sessions s
   where s.id = p_session_id and s.restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_session.status = 'closed' then
    raise exception 'SESSION_CLOSED';
  end if;

  -- A scope guard, not a limitation of the machinery below: a walk-in has no source
  -- place to release, and its slot would have to be handed over through the partial
  -- unique index on walk_in_no.
  if v_session.walk_in_no is not null then
    raise exception 'WALK_IN_TRANSFER_UNSUPPORTED';
  end if;

  if v_kind = 'table' then
    if v_session.table_id is null then raise exception 'TRANSFER_KIND_MISMATCH'; end if;
    v_src := v_session.table_id;
    v_dst := p_dest_table_id;
  else
    if v_session.room_id is null      then raise exception 'TRANSFER_KIND_MISMATCH'; end if;
    if v_session.room_stay_id is null then raise exception 'SESSION_HAS_NO_STAY';    end if;
    v_src := v_session.room_id;
    v_dst := p_dest_room_id;
  end if;

  if v_src = v_dst then
    raise exception 'SAME_LOCATION';
  end if;

  -- ── Lock 3: both places, id-ascending ───────────────────────────────────────
  v_first  := least(v_src, v_dst);
  v_second := greatest(v_src, v_dst);

  if v_kind = 'table' then
    perform 1 from restaurant_tables where id = v_first  for update;
    perform 1 from restaurant_tables where id = v_second for update;
  else
    perform 1 from rooms where id = v_first  for update;
    perform 1 from rooms where id = v_second for update;
  end if;

  -- ── Destination checks, now that it cannot move under us ────────────────────
  -- Every one of these is the friendly-error version of a constraint that would fire
  -- anyway. The constraints are the guarantee; these are the sentences.
  if v_kind = 'table' then
    select * into v_tbl from restaurant_tables
     where id = v_dst and restaurant_id = p_restaurant_id;
    if not found                        then raise exception 'TABLE_NOT_FOUND';     end if;
    if not v_tbl.is_active              then raise exception 'TABLE_INACTIVE';      end if;
    if v_tbl.cleaning_since is not null then raise exception 'TABLE_NEEDS_CLEANING'; end if;

    -- `<> 'closed'`, so a table carrying nothing but HISTORY is free — which is the
    -- normal state of every table that has ever been used.
    if exists (select 1 from sessions where table_id = v_dst and status <> 'closed') then
      raise exception 'TABLE_OCCUPIED';
    end if;

    select number into v_src_label from restaurant_tables where id = v_src;
    v_dst_label := v_tbl.number;
  else
    select * into v_room from rooms
     where id = v_dst and restaurant_id = p_restaurant_id;
    if not found                     then raise exception 'ROOM_NOT_FOUND';      end if;
    if v_room.status = 'maintenance' then raise exception 'ROOM_UNAVAILABLE';    end if;
    if v_room.status = 'cleaning'    then raise exception 'ROOM_NEEDS_CLEANING'; end if;
    if exists (select 1 from room_stays where room_id = v_dst and status = 'active') then
      raise exception 'ROOM_OCCUPIED';
    end if;
    if exists (select 1 from sessions where room_id = v_dst and status <> 'closed') then
      raise exception 'ROOM_OCCUPIED';
    end if;

    select number into v_src_label from rooms where id = v_src;
    v_dst_label := v_room.number;
  end if;

  -- ── Writes ──────────────────────────────────────────────────────────────────
  -- Freeze the OLD label onto every ticket already printed for this session, BEFORE the
  -- session moves, so a reprint of the last hour's KOT still says T1. Only rows not
  -- already frozen by an earlier transfer.
  update order_tickets
     set location_label = v_src_label
   where session_id = v_session.id
     and location_label is null;

  if v_kind = 'table' then
    update sessions set table_id = v_dst where id = v_session.id;

    -- The old table is not free, it is dirty — the party was physically sitting there.
    -- Same rule and same idempotence as park_table_for_cleaning; written here rather
    -- than shared with that trigger because the trigger keys off a status change and
    -- nothing here changes status.
    --
    -- Worth knowing: this also makes the OLD table's QR refuse to open a fresh session
    -- for a customer still holding the old link, via trg_refuse_session_on_dirty_table.
    update restaurant_tables
       set cleaning_since = now()
     where id = v_src and cleaning_since is null;
  else
    -- The stay moves IN PLACE. A second stay would mean a second session, and
    -- getRoomFolio does `.maybeSingle()` on room_stay_id — it would throw, not choose.
    -- room_charges hang off room_stay_id, so the whole folio follows with no work, and
    -- nights keep counting from the original check_in_at.
    update room_stays set room_id = v_dst where id = v_session.room_stay_id;
    update sessions    set room_id = v_dst where id = v_session.id;

    -- Rooms carry a STORED status (unlike tables, whose state is derived), so both ends
    -- must be written by hand.
    update rooms set status = 'occupied' where id = v_dst;
    update rooms set status = 'cleaning' where id = v_src;

    -- The rate on the stay is deliberately NOT changed: the folio computes
    -- rate × total nights from one snapshot, so raising it would retroactively re-bill
    -- nights already spent in the old room. An upgrade is a separate line instead.
    if p_upgrade_amount is not null and p_upgrade_amount <> 0 then
      insert into room_charges (room_stay_id, restaurant_id, type, description, amount, created_by)
      values (v_session.room_stay_id, p_restaurant_id, 'room_rate',
              coalesce(nullif(btrim(p_upgrade_description), ''),
                       'Room change ' || v_src_label || ' → ' || v_dst_label),
              p_upgrade_amount, p_created_by);
    end if;
  end if;

  -- An unanswered waiter-call still points at the place the guest has just left. Left
  -- alone it summons a waiter to an empty table and the guest's real call is invisible.
  -- PENDING only: rewriting resolved rows would corrupt the record of where a call
  -- actually came from.
  update notifications
     set table_id = case when v_kind = 'table' then v_dst else table_id end,
         room_id  = case when v_kind = 'room'  then v_dst else room_id  end
   where session_id = v_session.id
     and status = 'pending';

  insert into session_transfers (
    restaurant_id, session_id, kind,
    from_table_id, to_table_id, from_room_id, to_room_id,
    room_stay_id, from_label, to_label, reason, created_by
  ) values (
    p_restaurant_id, v_session.id, v_kind,
    case when v_kind = 'table' then v_src end, case when v_kind = 'table' then v_dst end,
    case when v_kind = 'room'  then v_src end, case when v_kind = 'room'  then v_dst end,
    v_session.room_stay_id, v_src_label, v_dst_label,
    nullif(btrim(coalesce(p_reason, '')), ''), p_created_by
  )
  returning * into v_out;

  -- No explicit notify needed: the writes to sessions, restaurant_tables and rooms each
  -- fire their own rs_ev_* trigger on the 'tables' topic, so every dashboard repaints.
  return v_out;
end $$;

revoke all on function transfer_session(uuid, uuid, uuid, uuid, uuid, text, numeric, text) from public;
grant execute on function transfer_session(uuid, uuid, uuid, uuid, uuid, text, numeric, text) to service_role;

notify pgrst, 'reload schema';
