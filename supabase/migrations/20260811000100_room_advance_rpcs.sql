-- =============================================================
-- ROOM ADVANCES — write paths
--
-- Three RPCs plus check_in_room, so that a deposit taken at the desk is written
-- in the SAME transaction as the stay it belongs to. A guest checked in with
-- their deposit lost is not a state this app is allowed to reach.
-- =============================================================

-- ── Record one advance (or a refund, via a negative p_amount) ─────────────────
create or replace function record_room_advance(
  p_restaurant_id uuid,
  p_stay_id       uuid,
  p_amount        numeric,
  p_cash          numeric,
  p_online        numeric,
  p_card          numeric,
  p_method        text,
  p_note          text,
  p_created_by    uuid
) returns uuid
language plpgsql
as $$
declare
  v_stay room_stays;
  v_id   uuid;
begin
  select * into v_stay
    from room_stays
   where id = p_stay_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'STAY_NOT_FOUND';
  end if;

  -- A settled stay's advances are frozen inside a closed bill. The ONE exception
  -- is the refund written by check_out_room, which runs before the stay is
  -- closed in that same transaction, so it never reaches this branch.
  if v_stay.status <> 'active' then
    raise exception 'STAY_CLOSED';
  end if;

  if coalesce(p_amount, 0) = 0
     or abs(coalesce(p_cash,0) + coalesce(p_online,0) + coalesce(p_card,0) - p_amount) > 0.005 then
    raise exception 'INVALID_ADVANCE';
  end if;

  insert into room_advances (
    restaurant_id, stay_id, amount, cash_amount, online_amount, card_amount,
    method, note, created_by
  ) values (
    p_restaurant_id, p_stay_id, p_amount,
    coalesce(p_cash,0), coalesce(p_online,0), coalesce(p_card,0),
    p_method, nullif(btrim(coalesce(p_note,'')), ''), p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_room_advance(uuid, uuid, numeric, numeric, numeric, numeric, text, text, uuid) from public;
grant execute on function record_room_advance(uuid, uuid, numeric, numeric, numeric, numeric, text, text, uuid) to service_role;


-- ── Correct a mistyped advance ────────────────────────────────────────────────
-- Money already counted into the day's cash is being rewritten, so this writes
-- the before→after to the security audit log itself. The Security PIN is checked
-- in the server action BEFORE this is called (lib/security/authorize.ts); this
-- function records what happened, exactly as edit_payment_tender does.
--
-- log_security_event takes p_target_id as a UUID, not text — verified against the
-- live signature rather than assumed.
create or replace function edit_room_advance(
  p_restaurant_id uuid,
  p_actor_id      uuid,
  p_actor_name    text,
  p_advance_id    uuid,
  p_amount        numeric,
  p_cash          numeric,
  p_online        numeric,
  p_card          numeric,
  p_method        text
) returns void
language plpgsql
as $$
declare
  v_old  room_advances;
  v_stay room_stays;
begin
  select * into v_old
    from room_advances
   where id = p_advance_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'ADVANCE_NOT_FOUND';
  end if;

  select * into v_stay from room_stays where id = v_old.stay_id for update;
  if v_stay.status <> 'active' then
    raise exception 'ADVANCE_STAY_CLOSED';
  end if;

  if coalesce(p_amount, 0) = 0
     or abs(coalesce(p_cash,0) + coalesce(p_online,0) + coalesce(p_card,0) - p_amount) > 0.005 then
    raise exception 'INVALID_ADVANCE';
  end if;

  update room_advances
     set amount        = p_amount,
         cash_amount   = coalesce(p_cash,0),
         online_amount = coalesce(p_online,0),
         card_amount   = coalesce(p_card,0),
         method        = p_method
   where id = p_advance_id;

  perform log_security_event(
    p_restaurant_id => p_restaurant_id,
    p_actor_id      => p_actor_id,
    p_actor_name    => p_actor_name,
    p_operation     => 'edit_room_advance',
    p_target_type   => 'room_advance',
    p_target_id     => p_advance_id,
    p_outcome       => 'success',
    p_detail        => jsonb_build_object(
      'before', jsonb_build_object(
        'amount', v_old.amount, 'cash_amount', v_old.cash_amount,
        'online_amount', v_old.online_amount, 'card_amount', v_old.card_amount,
        'method', v_old.method),
      'after', jsonb_build_object(
        'amount', p_amount, 'cash_amount', coalesce(p_cash,0),
        'online_amount', coalesce(p_online,0), 'card_amount', coalesce(p_card,0),
        'method', p_method)
    )
  );
end;
$$;

revoke all on function edit_room_advance(uuid, uuid, text, uuid, numeric, numeric, numeric, numeric, text) from public;
grant execute on function edit_room_advance(uuid, uuid, text, uuid, numeric, numeric, numeric, numeric, text) to service_role;


-- ── Remove an advance entered in error ────────────────────────────────────────
create or replace function delete_room_advance(
  p_restaurant_id uuid,
  p_actor_id      uuid,
  p_actor_name    text,
  p_advance_id    uuid
) returns void
language plpgsql
as $$
declare
  v_old  room_advances;
  v_stay room_stays;
begin
  select * into v_old
    from room_advances
   where id = p_advance_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'ADVANCE_NOT_FOUND';
  end if;

  select * into v_stay from room_stays where id = v_old.stay_id for update;
  if v_stay.status <> 'active' then
    raise exception 'ADVANCE_STAY_CLOSED';
  end if;

  delete from room_advances where id = p_advance_id;

  perform log_security_event(
    p_restaurant_id => p_restaurant_id,
    p_actor_id      => p_actor_id,
    p_actor_name    => p_actor_name,
    p_operation     => 'edit_room_advance',
    p_target_type   => 'room_advance',
    p_target_id     => p_advance_id,
    p_outcome       => 'success',
    p_detail        => jsonb_build_object(
      'action', 'delete',
      'before', jsonb_build_object(
        'amount', v_old.amount, 'cash_amount', v_old.cash_amount,
        'online_amount', v_old.online_amount, 'card_amount', v_old.card_amount,
        'method', v_old.method)
    )
  );
end;
$$;

revoke all on function delete_room_advance(uuid, uuid, text, uuid) from public;
grant execute on function delete_room_advance(uuid, uuid, text, uuid) to service_role;


-- ── check_in_room: take the deposit in the SAME transaction as the stay ───────
--
-- DROP THE OLD 11-ARGUMENT SIGNATURE FIRST. `create or replace` with a longer
-- parameter list creates an OVERLOAD, and the deployed app's call then matches
-- both candidates and fails `42725 function check_in_room(...) is not unique`.
-- That was measured, not theorised, when 20260804000000 added guest identity.
--
-- All six new parameters DEFAULT, so the currently-deployed 11-name call keeps
-- resolving through the deploy window and simply records no advance.
drop function if exists public.check_in_room(
  uuid, uuid, text, text, integer, text, text, uuid, text, text, text
);

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
  p_guest_address   text default null,
  p_advance_amount  numeric default 0,
  p_advance_cash    numeric default 0,
  p_advance_online  numeric default 0,
  p_advance_card    numeric default 0,
  p_advance_method  text default null,
  p_advance_note    text default null
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
  -- `openRoomSession` produced before check-in existed.
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

  -- The session is what the ordering flow already understands.
  insert into sessions (restaurant_id, type, room_id, room_stay_id, customer_pin)
  values (p_restaurant_id, 'room_service', p_room_id, v_stay.id, p_customer_pin)
  returning * into v_session;

  -- The deposit, if one was handed over. Inside this transaction on purpose: a
  -- stay that exists without the money the guest just paid is worse than a
  -- check-in that failed outright and can be retried.
  if coalesce(p_advance_amount, 0) > 0 then
    perform record_room_advance(
      p_restaurant_id => p_restaurant_id,
      p_stay_id       => v_stay.id,
      p_amount        => p_advance_amount,
      p_cash          => coalesce(p_advance_cash, 0),
      p_online        => coalesce(p_advance_online, 0),
      p_card          => coalesce(p_advance_card, 0),
      p_method        => coalesce(p_advance_method, 'cash'),
      p_note          => p_advance_note,
      p_created_by    => p_created_by
    );
  end if;

  return jsonb_build_object(
    'stay_id',    v_stay.id,
    'session_id', v_session.id,
    'room_rate',  v_stay.room_rate
  );
end;
$function$;

notify pgrst, 'reload schema';
