-- ── A room discount that was applied but never recorded ──────────────────────
--
-- `checkOutRoom` reads a discount, checks APPLY_DISCOUNTS, and feeds it to buildFolio, so
-- the guest is charged the reduced amount. But `check_out_room` had no p_discount
-- parameter, so `payments.discount_amount` stayed 0 on every room checkout: the discount
-- vanished from the Sales bill and the Finance discount total under-reported by exactly the
-- amount given away. The cash was right; the books were not.
--
-- `close_bill_with_credit` has accepted p_discount (default 0) since 20260717140000 and
-- already writes discount_amount — the room path simply never passed it. That call is also
-- converted to NAMED arguments here: it was the positional 11-argument call that broke every
-- hotel credit checkout when that parameter was added.
--
-- DROP FIRST, then create. `create or replace` with a longer parameter list does NOT
-- replace — Postgres keys a function on its argument types, so it would leave an OVERLOAD
-- behind, and the deployed app's 12-argument call would match both candidates and fail with
-- `42725 ... is not unique`.
drop function if exists public.check_out_room(
  uuid, uuid, numeric, numeric, numeric, numeric, text, uuid, text, text, text, uuid
);

create or replace function public.check_out_room(
  p_restaurant_id  uuid,
  p_stay_id        uuid,
  p_total          numeric,
  p_cash           numeric,
  p_online         numeric,
  p_card           numeric,
  p_method         text,
  p_customer_id    uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_notes          text,
  p_created_by     uuid,
  p_discount       numeric default 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_stay    room_stays;
  v_session sessions;
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0);
  v_now     timestamptz := now();
begin
  select * into v_stay
    from room_stays
   where id = p_stay_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'STAY_NOT_FOUND';
  end if;
  if v_stay.status <> 'active' then
    raise exception 'STAY_ALREADY_CLOSED';
  end if;

  if p_total is null or p_total < 0 then
    raise exception 'INVALID_TOTAL';
  end if;

  -- Any status, not just open: a force-closed room session still needs its stay
  -- settled, and the payment still has to hang off something.
  select * into v_session
    from sessions
   where room_stay_id = p_stay_id
   order by opened_at
   limit 1
   for update;

  if v_session.id is null then
    raise exception 'NO_SESSION_FOR_STAY';
  end if;

  -- Close the stay FIRST. check_out_at is an input to the folio, so writing it
  -- before the payment is what stops the bill from moving underneath the amount
  -- we are about to charge.
  update room_stays
     set check_out_at = v_now,
         status       = 'checked_out'
   where id = p_stay_id;

  if v_paid + 0.005 < p_total then
    -- Something is still owed → the shared credit path, which writes the payment,
    -- the credit and the session close together. One credit ledger, not two.
    --
    -- NAMED arguments. This call was positional with 11 arguments, which is precisely
    -- what stopped resolving when p_discount was added to close_bill_with_credit and
    -- rolled back every hotel credit checkout (see 20260717140000).
    perform close_bill_with_credit(
      p_restaurant_id  => p_restaurant_id,
      p_session_id     => v_session.id,
      p_total          => p_total,
      p_cash           => coalesce(p_cash, 0),
      p_online         => coalesce(p_online, 0),
      p_card           => coalesce(p_card, 0),
      p_customer_id    => p_customer_id,
      p_customer_name  => p_customer_name,
      p_customer_phone => p_customer_phone,
      p_notes          => p_notes,
      p_created_by     => p_created_by,
      p_discount       => coalesce(p_discount, 0)
    );
  else
    -- The payment hangs off the SESSION, not the stay.
    --
    -- `payments_source_check` is an XOR — session_id or room_stay_id, never both —
    -- so this is a real fork. Session wins for three reasons: it is what
    -- close_bill_with_credit above already does (so a room bill has ONE shape
    -- whether or not it went on credit); sessions.room_stay_id still reaches the
    -- stay, so nothing is lost; and the sales report already embeds
    -- `sessions → rooms`, so a room bill labels itself "Room 101" with no change.
    --
    -- p_total is ALREADY NET of the discount (buildFolio subtracts it before returning
    -- grandTotal). discount_amount records what was given away; it is never subtracted
    -- again here, or the guest would be credited twice. Net IS the sale.
    insert into payments (
      restaurant_id, session_id, amount,
      cash_amount, online_amount, card_amount, total_amount,
      payment_method, created_by, discount_amount
    ) values (
      p_restaurant_id, v_session.id, p_total,
      coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0), p_total,
      p_method::payment_method, p_created_by, coalesce(p_discount, 0)
    );

    if v_session.status <> 'closed' then
      update sessions set status = 'closed', closed_at = v_now where id = v_session.id;
    end if;
  end if;

  -- The guest is gone but the room isn't sellable yet — housekeeping has to make it up
  -- first. Parking it in 'cleaning' is what stops reception handing it to the next arrival
  -- with the last guest's towels still in it. "Mark as Clean" releases it to 'available'.
  update rooms set status = 'cleaning' where id = v_stay.room_id;

  return jsonb_build_object(
    'stay_id',      p_stay_id,
    'session_id',   v_session.id,
    'check_out_at', v_now,
    'total',        p_total
  );
end;
$function$;
