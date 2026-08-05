-- ── Guest identity on a room stay ────────────────────────────────────────────
--
-- A hotel register needs an identity document and a permanent address. These live on
-- room_stays, NOT on sessions.customer_address: that column belongs to the walk-in
-- customer-details feature and dies with the session, while this has to stay attached to
-- the booking history and to every bill derived from the stay.
--
-- NULLABLE ON PURPOSE. Production holds stays that predate this column and cannot be
-- backfilled with documents nobody recorded. `checkInRoom` enforces presence for every NEW
-- check-in; an old bill simply renders without the block.
alter table room_stays
  add column if not exists guest_id_type   text,
  add column if not exists guest_id_number text,
  add column if not exists guest_address   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'room_stays_guest_id_type_check') then
    alter table room_stays
      add constraint room_stays_guest_id_type_check
      check (guest_id_type is null or guest_id_type in ('citizenship','nid'));
  end if;
end $$;

-- ── check_in_room: three new parameters, all DEFAULT NULL ─────────────────────
--
-- The defaults are not tidiness. Migration 20260717140000 records what happened the last
-- time a parameter was added to a room RPC without one: `close_bill_with_credit` stopped
-- resolving for its 11-argument positional caller and every hotel credit checkout rolled
-- back. Defaults keep the currently-deployed 8-argument call working while the app ships.
--
-- DROP THE OLD 8-ARGUMENT SIGNATURE FIRST. `create or replace` with a longer parameter list
-- does NOT replace — Postgres keys a function on its argument types, so it creates an
-- OVERLOAD. With both live, the deployed app's 8-argument call matches BOTH candidates and
-- fails with `42725 function check_in_room(...) is not unique`. Measured, not theorised: the
-- first version of this migration did exactly that.
--
-- Dropping it is safe for the deploy window because PostgREST calls RPCs with NAMED
-- arguments, so an 8-name call resolves against the 11-parameter function and the three new
-- parameters take their defaults.
drop function if exists public.check_in_room(uuid, uuid, text, text, integer, text, text, uuid);

-- The body below is the CURRENT live definition, reproduced verbatim. The ONLY changes are
-- the three parameters and the three columns they write.
create or replace function public.check_in_room(
  p_restaurant_id   uuid,
  p_room_id         uuid,
  p_guest_name      text,
  p_guest_phone     text,
  p_guest_count     integer,
  p_notes           text,
  p_customer_pin    text,
  p_created_by      uuid,
  p_guest_id_type   text default null,
  p_guest_id_number text default null,
  p_guest_address   text default null
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_room    rooms;
  v_rate    numeric;
  v_stay    room_stays;
  v_session sessions;
begin
  if coalesce(btrim(p_guest_name), '') = '' then
    raise exception 'GUEST_NAME_REQUIRED';
  end if;

  -- `for update` serialises two receptionists checking in to the same room.
  select * into v_room
    from rooms
   where id = p_room_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_room.status = 'maintenance' then
    raise exception 'ROOM_UNAVAILABLE';
  end if;

  -- The last guest has gone but housekeeping hasn't made the room up yet.
  if v_room.status = 'cleaning' then
    raise exception 'ROOM_NEEDS_CLEANING';
  end if;

  if exists (select 1 from room_stays where room_id = p_room_id and status = 'active') then
    raise exception 'ROOM_OCCUPIED';
  end if;

  -- A room can also carry a live session with NO stay: that is what the old
  -- `openRoomSession` produced before check-in existed. Checking in over the top
  -- of one would leave two open sessions on the room and split the guest's food
  -- across two bills. Make the receptionist settle the old one first.
  if exists (
    select 1 from sessions
     where room_id = p_room_id and status <> 'closed' and room_stay_id is null
  ) then
    raise exception 'ROOM_HAS_OPEN_SESSION';
  end if;

  select base_price into v_rate from room_types where id = v_room.room_type_id;

  insert into room_stays (
    restaurant_id, room_id, guest_name, guest_phone, guest_count, room_rate, notes,
    guest_id_type, guest_id_number, guest_address
  ) values (
    p_restaurant_id, p_room_id, btrim(p_guest_name),
    nullif(btrim(coalesce(p_guest_phone, '')), ''),
    greatest(coalesce(p_guest_count, 1), 1),
    coalesce(v_rate, 0),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_guest_id_type, '')), ''),
    nullif(btrim(coalesce(p_guest_id_number, '')), ''),
    nullif(btrim(coalesce(p_guest_address, '')), '')
  )
  returning * into v_stay;

  update rooms set status = 'occupied' where id = p_room_id;

  -- The session is what the ordering flow already understands. Tying it to the
  -- stay is what makes a room-service order land on the room bill rather than
  -- becoming a separate ticket someone has to remember to merge.
  insert into sessions (restaurant_id, type, room_id, room_stay_id, customer_pin)
  values (p_restaurant_id, 'room_service', p_room_id, v_stay.id, p_customer_pin)
  returning * into v_session;

  return jsonb_build_object(
    'stay_id',    v_stay.id,
    'session_id', v_session.id,
    'room_rate',  v_stay.room_rate
  );
end;
$function$;
