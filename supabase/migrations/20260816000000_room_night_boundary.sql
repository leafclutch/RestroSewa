-- Room nights end at CHECKOUT TIME, not 24 hours after the guest walked in.
--
-- Until now a room charge stepped up on a rolling 24-hour clock from check-in,
-- so two guests in identical rooms who arrived three hours apart crossed into
-- night two three hours apart. No front desk works that way: the next night
-- starts at the same wall-clock hour for everybody.
--
-- Two per-restaurant hours define the rule (both live in `restaurants.settings`,
-- which is jsonb — so they need no migration of their own):
--
--   room_new_day_hour       (default 6)  which DAY an arrival belongs to
--   room_price_double_hour  (default 12) when the next night begins
--
-- The arithmetic itself is in lib/business-day.ts and stays there. This file
-- only stores what that arithmetic needs.
--
-- ── WHY THE HOURS ARE SNAPSHOTTED ONTO THE STAY ──────────────────────────────
-- `room_rate` has always been snapshotted at check-in so that an admin raising
-- the Deluxe price on Tuesday cannot re-bill the guest who arrived on Monday.
-- The boundary hours need the identical guarantee for a stronger reason: paid
-- room bills are REBUILT from the frozen stay when reprinted from Sales
-- (app/actions/pos.ts), so without a snapshot an admin changing the checkout
-- hour next March would silently re-price every historical bill in the system.
--
-- NULL means "no snapshot" and falls back to the restaurant's live setting.
-- That is what lets stays already in progress adopt the rule the day it ships,
-- and it is why these two columns are nullable rather than defaulted.

alter table room_stays
  -- Per-stay courtesy: push this stay's boundaries later. Capped at 12 because
  -- 24 would step clean over a boundary — "a few more hours" would quietly
  -- become "a free night". lib/business-day.ts normalizeShiftHours agrees.
  add column if not exists price_shift_hours smallint not null default 0,
  add column if not exists price_shift_by uuid references restaurant_users(id) on delete set null,
  add column if not exists price_shift_at timestamptz,
  -- The check-in snapshot. Nullable on purpose — see the note above.
  add column if not exists new_day_hour smallint,
  add column if not exists double_hour smallint;

alter table room_stays drop constraint if exists room_stays_price_shift_hours_check;
alter table room_stays add constraint room_stays_price_shift_hours_check
  check (price_shift_hours >= 0 and price_shift_hours <= 12);

alter table room_stays drop constraint if exists room_stays_new_day_hour_check;
alter table room_stays add constraint room_stays_new_day_hour_check
  check (new_day_hour is null or (new_day_hour >= 0 and new_day_hour <= 23));

alter table room_stays drop constraint if exists room_stays_double_hour_check;
alter table room_stays add constraint room_stays_double_hour_check
  check (double_hour is null or (double_hour >= 0 and double_hour <= 23));

-- ─────────────────────────────────────────────────────────────────────────────
-- check_in_room: stamp the snapshot.
--
-- DROP before CREATE, even though the return type is unchanged. Two appended
-- DEFAULTED parameters make a new SIGNATURE, so `create or replace` alone would
-- leave the old 17-argument function in place beside the new 19-argument one —
-- and a 17-argument call would then match both, raising `42725 … is not
-- unique`. Dropping first is what keeps the deploy window safe: the currently
-- deployed app calls with 17 arguments and still resolves, through the defaults.
--
-- The hours are PASSED IN rather than read from `restaurants.settings` here on
-- purpose. Normalising a free-form jsonb value into a usable hour is already
-- implemented once, in lib/business-day.ts; doing it again in plpgsql would be
-- a second implementation of the same rule, and the two would eventually
-- disagree about what a bad value means. A caller that passes nothing stamps
-- NULL, which degrades to the live setting — a safe failure, not a wrong bill.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.check_in_room(
  uuid, uuid, text, text, integer, text, text, uuid,
  text, text, text, numeric, numeric, numeric, numeric, text, text
);

create or replace function public.check_in_room(
  p_restaurant_id    uuid,
  p_room_id          uuid,
  p_guest_name       text,
  p_guest_phone      text,
  p_guest_count      integer,
  p_notes            text,
  p_customer_pin     text,
  p_created_by       uuid,
  p_guest_id_type    text default null::text,
  p_guest_id_number  text default null::text,
  p_guest_address    text default null::text,
  p_advance_amount   numeric default 0,
  p_advance_cash     numeric default 0,
  p_advance_online   numeric default 0,
  p_advance_card     numeric default 0,
  p_advance_method   text default null::text,
  p_advance_note     text default null::text,
  p_new_day_hour     smallint default null,
  p_double_hour      smallint default null
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
    guest_id_type, guest_id_number, guest_address,
    new_day_hour, double_hour
  ) values (
    p_restaurant_id, p_room_id, btrim(p_guest_name),
    nullif(btrim(coalesce(p_guest_phone, '')), ''),
    greatest(coalesce(p_guest_count, 1), 1),
    coalesce(v_rate, 0),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_guest_id_type, '')), ''),
    nullif(btrim(coalesce(p_guest_id_number, '')), ''),
    nullif(btrim(coalesce(p_guest_address, '')), ''),
    p_new_day_hour,
    p_double_hour
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

grant execute on function public.check_in_room(
  uuid, uuid, text, text, integer, text, text, uuid,
  text, text, text, numeric, numeric, numeric, numeric, text, text,
  smallint, smallint
) to service_role;
