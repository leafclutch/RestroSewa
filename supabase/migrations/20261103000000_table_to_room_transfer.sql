-- Table → Room transfer: put a table's food on an in-house guest's room bill.
--
-- WHY THIS IS NOT transfer_session. A table shift moves the SESSION, because the
-- destination table is empty. A room that can take a table's bill is the opposite: it
-- is OCCUPIED — a checked-in guest with a live stay and its own open session — and
-- sessions_one_open_per_room_idx forbids a second. So this is a merge, not a move: the
-- table's orders and tickets are re-pointed at the room's session, and the emptied table
-- session is closed.
--
--     T4 (Momo, Coke, KOT-00125)  →  Room 101 (guest's session, same folio)
--     T4's session is closed, the table goes for cleaning.
--
-- Everything downstream keys off session_id, so re-pointing session_orders is enough for
-- the food to land on the folio (loadFolioInputs reads items through
-- session_orders → sessions.room_stay_id). Items keep their status, served counts and
-- cancellations; stock is untouched because nothing was consumed or returned.

-- ── The audit row learns a third kind ─────────────────────────────────────────
-- session_id stays the TABLE session (the one that moved away), so its detail page reads
-- "T4 → 101 · Moved to room". The room's session is recorded for joining.
alter table session_transfers
  drop constraint if exists session_transfers_kind_check;
alter table session_transfers
  add constraint session_transfers_kind_check
  check (kind in ('table', 'room', 'table_to_room'));

alter table session_transfers
  add column if not exists to_session_id uuid references sessions(id) on delete set null;

-- ── The merge ─────────────────────────────────────────────────────────────────
-- LOCK ORDER, the house rule from transfer_session / check_out_room:
--     room_stays  →  sessions (BY ID ASCENDING)  →  restaurant_tables
-- and every lock taken before any row is written.
create or replace function transfer_table_to_room(
  p_restaurant_id uuid,
  p_session_id    uuid,
  p_dest_room_id  uuid,
  p_created_by    uuid default null,
  p_reason        text default null
) returns session_transfers
language plpgsql
as $$
declare
  v_src       sessions;
  v_dst       sessions;
  v_stay      room_stays;
  v_room      rooms;
  v_first     uuid;
  v_second    uuid;
  v_src_label text;
  v_out       session_transfers;
begin
  if p_dest_room_id is null then
    raise exception 'TRANSFER_TARGET_REQUIRED';
  end if;

  -- Unlocked peek: only to fail fast on the obvious. Re-read under lock below.
  select s.* into v_src
    from sessions s
   where s.id = p_session_id and s.restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  select * into v_room from rooms
   where id = p_dest_room_id and restaurant_id = p_restaurant_id;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  -- ── Lock 1: the guest's stay ────────────────────────────────────────────────
  select * into v_stay from room_stays
   where room_id = p_dest_room_id
     and restaurant_id = p_restaurant_id
     and status = 'active'
   for update;
  if not found then
    raise exception 'ROOM_NOT_OCCUPIED';
  end if;

  -- The guest's session. Peek for its id, then lock both sessions id-ascending.
  select s.* into v_dst
    from sessions s
   where s.room_stay_id = v_stay.id and s.status <> 'closed';
  if not found then
    raise exception 'ROOM_HAS_NO_SESSION';
  end if;

  -- ── Lock 2: both sessions, id-ascending ─────────────────────────────────────
  v_first  := least(v_src.id, v_dst.id);
  v_second := greatest(v_src.id, v_dst.id);
  perform 1 from sessions where id = v_first  for update;
  perform 1 from sessions where id = v_second for update;

  select * into v_src from sessions where id = p_session_id;
  select * into v_dst from sessions where id = v_dst.id;

  if v_src.status = 'closed' then
    raise exception 'SESSION_CLOSED';
  end if;
  if v_dst.status = 'closed' then
    raise exception 'ROOM_HAS_NO_SESSION';
  end if;
  -- A pending_activation session is a customer's un-approved QR order: approve or reject
  -- it first, rather than smuggling it onto someone's room bill.
  if v_src.status <> 'active' then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;
  if v_src.walk_in_no is not null then
    raise exception 'WALK_IN_TRANSFER_UNSUPPORTED';
  end if;
  if v_src.table_id is null then
    raise exception 'TRANSFER_KIND_MISMATCH';
  end if;

  -- Money already taken on the table would be on a closed-looking table and an open
  -- room at once. Refuse; there is no clean way to split a payment across two bills.
  perform assert_session_unpaid(v_src.id);

  -- An empty table has nothing to charge: moving it would only close the table and
  -- write a misleading "moved to room" line. Close it the normal way instead.
  if not exists (
    select 1 from session_order_items soi
      join session_orders so on so.id = soi.order_id
     where so.session_id = v_src.id
       and soi.cancelled_at is null
  ) then
    raise exception 'NOTHING_TO_MOVE';
  end if;

  -- ── Lock 3: the table ───────────────────────────────────────────────────────
  select number into v_src_label from restaurant_tables
   where id = v_src.table_id for update;

  -- ── Writes ──────────────────────────────────────────────────────────────────
  -- Freeze the table label onto tickets already printed, BEFORE they change session,
  -- so a reprint still says T4 — where the food actually went.
  update order_tickets
     set location_label = v_src_label
   where session_id = v_src.id
     and location_label is null;

  update order_tickets  set session_id = v_dst.id where session_id = v_src.id;
  update session_orders set session_id = v_dst.id where session_id = v_src.id;

  -- The bill number. A room that has not ordered yet has none, so it inherits the
  -- table's — every printed KOT already carries it. Otherwise the table's number goes
  -- back through the usual latest-only release when the session closes below.
  if v_dst.bill_number is null and v_src.bill_number is not null then
    update sessions set bill_number = null            where id = v_src.id;
    update sessions set bill_number = v_src.bill_number where id = v_dst.id;
  end if;

  -- An open waiter call from the table the guest has left would summon someone to an
  -- empty table. Same treatment as force_close_session.
  update notifications
     set status = 'completed'
   where restaurant_id = p_restaurant_id
     and session_id = v_src.id
     and status in ('pending', 'new', 'acknowledged');

  -- Close the emptied table session. trg_park_table_for_cleaning sends the table for
  -- cleaning; trg_release_bill_number_on_abandon releases any number still on it.
  update sessions
     set status = 'closed', closed_at = now()
   where id = v_src.id;

  insert into session_transfers (
    restaurant_id, session_id, kind,
    from_table_id, to_room_id, room_stay_id, to_session_id,
    from_label, to_label, reason, created_by
  ) values (
    p_restaurant_id, v_src.id, 'table_to_room',
    v_src.table_id, p_dest_room_id, v_stay.id, v_dst.id,
    coalesce(v_src_label, '—'), v_room.number,
    nullif(btrim(coalesce(p_reason, '')), ''), p_created_by
  )
  returning * into v_out;

  return v_out;
end $$;

revoke all on function transfer_table_to_room(uuid, uuid, uuid, uuid, text) from public;
grant execute on function transfer_table_to_room(uuid, uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
