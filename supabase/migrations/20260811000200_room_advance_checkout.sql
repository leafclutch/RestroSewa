-- =============================================================
-- ADVANCES AT CHECKOUT
--
-- THE INVARIANT. Everywhere in this app, what is left on credit has been:
--
--   total_amount − (cash + online + card)
--
-- With a deposit it becomes:
--
--   total_amount − (cash + online + card + advance_amount)
--
-- All three functions here move together. One of them left behind turns an
-- 8,000 bill settled by a 5,000 deposit and 3,000 cash into 5,000 of customer
-- debt that nobody owes — silently, and only visible weeks later on a statement.
--
-- `credits.down_payment` INCLUDES the advance, because it is money received
-- against that bill. finance_report derives customer credit created as
-- `bill_amount − down_payment`, so that leg then needs no change at all.
-- =============================================================


-- ── close_bill_with_credit ────────────────────────────────────────────────────
-- DROP FIRST: the parameter list grows, and `create or replace` would leave the
-- 12-argument version behind as an overload.
drop function if exists public.close_bill_with_credit(
  uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text, text, uuid, numeric
);

create or replace function close_bill_with_credit(
  p_restaurant_id  uuid,
  p_session_id     uuid,
  p_total          numeric,
  p_cash           numeric,
  p_online         numeric,
  p_card           numeric,
  p_customer_id    uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_notes          text,
  p_created_by     uuid,
  p_discount       numeric default 0,
  p_advance        numeric default 0
)
returns credit_customers
language plpgsql
as $function$
declare
  -- Money received against this bill by the time it closed: what was handed over
  -- now, PLUS what was handed over earlier as a deposit. Counting the advance here
  -- is what stops a prepaid stay raising debt the guest does not owe.
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0)
                       + coalesce(p_advance, 0);
  v_owed    numeric;
  v_payment payments;
  v_cust    credit_customers;
  v_seq     int;
begin
  if p_total is null or p_total <= 0 then
    raise exception 'INVALID_TOTAL';
  end if;

  if v_paid < 0 or v_paid >= p_total then
    raise exception 'INVALID_DOWN_PAYMENT';
  end if;
  v_owed := p_total - v_paid;

  perform 1
     from sessions
    where id = p_session_id
      and restaurant_id = p_restaurant_id
      and status <> 'closed'
      for update;
  if not found then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  if p_customer_id is not null then
    select * into v_cust
      from credit_customers
     where id = p_customer_id
       and restaurant_id = p_restaurant_id
       for update;
    if not found then
      raise exception 'CUSTOMER_NOT_FOUND';
    end if;
  else
    v_cust := find_or_create_credit_customer(
      p_restaurant_id, p_customer_name, p_customer_phone, p_created_by
    );
    select * into v_cust from credit_customers where id = v_cust.id for update;
  end if;

  insert into payments (
    restaurant_id, session_id, amount, total_amount, discount_amount,
    cash_amount, online_amount, card_amount, advance_amount,
    payment_method, created_by
  )
  values (
    p_restaurant_id, p_session_id, p_total, p_total, coalesce(p_discount, 0),
    coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0), coalesce(p_advance, 0),
    'credit', p_created_by
  )
  returning * into v_payment;

  perform pg_advisory_xact_lock(hashtext('credit_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from credits
   where restaurant_id = p_restaurant_id;

  insert into credits (
    restaurant_id, seq_no, session_id, payment_id, customer_id,
    customer_name, customer_phone,
    bill_amount, down_payment, paid_amount,
    status, notes, created_by
  )
  values (
    p_restaurant_id, v_seq, p_session_id, v_payment.id, v_cust.id,
    v_cust.name, v_cust.phone,
    -- v_paid already includes the advance, which is what keeps
    -- `bill_amount - down_payment` a true statement of what is still owed — and
    -- what lets finance_report's customer-credit leg stay untouched.
    p_total, v_paid, v_paid,
    case when v_paid > 0 then 'partially_paid' else 'pending' end,
    nullif(btrim(coalesce(p_notes, '')), ''), p_created_by
  );

  update credit_customers
     set balance = balance + v_owed,
         is_active = true
   where id = v_cust.id
  returning * into v_cust;

  update sessions
     set status = 'closed', closed_at = now()
   where id = p_session_id;

  return v_cust;
end;
$function$;


-- ── check_out_room ────────────────────────────────────────────────────────────
drop function if exists public.check_out_room(
  uuid, uuid, numeric, numeric, numeric, numeric, text, uuid, text, text, text, uuid, numeric
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
  p_discount       numeric default 0,
  p_refund_cash    numeric default 0,
  p_refund_online  numeric default 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_stay    room_stays;
  v_session sessions;
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0);
  -- Read INSIDE the transaction, never taken from the client. Same principle as
  -- the total itself: the browser says what it thinks is held, we look.
  v_held    numeric;
  v_applied numeric;
  v_refund  numeric := coalesce(p_refund_cash, 0) + coalesce(p_refund_online, 0);
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

  select coalesce(sum(amount), 0) into v_held
    from room_advances
   where stay_id = p_stay_id;

  -- A deposit can only pay off this bill up to the bill. Anything above it is
  -- the guest's money and goes back to them, which is what the refund is.
  v_applied := greatest(least(v_held, p_total), 0);

  if abs(v_refund - greatest(v_held - p_total, 0)) > 0.005 then
    raise exception 'REFUND_MISMATCH';
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

  -- The refund goes in BEFORE the stay is closed: record_room_advance refuses to
  -- write against a settled stay, and rightly so.
  if v_refund > 0.005 then
    perform record_room_advance(
      p_restaurant_id => p_restaurant_id,
      p_stay_id       => p_stay_id,
      p_amount        => -v_refund,
      p_cash          => -coalesce(p_refund_cash, 0),
      p_online        => -coalesce(p_refund_online, 0),
      p_card          => 0,
      p_method        => case
                           when coalesce(p_refund_cash,0) > 0.005 and coalesce(p_refund_online,0) > 0.005 then 'mixed'
                           when coalesce(p_refund_online,0) > 0.005 then 'online'
                           else 'cash'
                         end,
      p_note          => 'Refund of unused advance at checkout',
      p_created_by    => p_created_by
    );
  end if;

  -- Close the stay FIRST (after the refund). check_out_at is an input to the
  -- folio, so writing it before the payment is what stops the bill from moving
  -- underneath the amount we are about to charge.
  update room_stays
     set check_out_at = v_now,
         status       = 'checked_out'
   where id = p_stay_id;

  -- THE FORK, now counting the deposit as money received. Without `+ v_applied`
  -- a fully-prepaid stay would be sent down the credit path and open a credit
  -- account for a guest who owes nothing.
  if v_paid + v_applied + 0.005 < p_total then
    -- NAMED arguments. This call was positional with 11 arguments, which is
    -- precisely what stopped resolving when p_discount was added and rolled back
    -- every hotel credit checkout (see 20260717140000).
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
      p_discount       => coalesce(p_discount, 0),
      p_advance        => v_applied
    );
  else
    -- p_total is ALREADY NET of the discount (buildFolio subtracts it before
    -- returning grandTotal). discount_amount records what was given away; it is
    -- never subtracted again here. Net IS the sale — and the advance is a payment
    -- against that sale, not a reduction of it.
    insert into payments (
      restaurant_id, session_id, amount,
      cash_amount, online_amount, card_amount, advance_amount, total_amount,
      payment_method, created_by, discount_amount
    ) values (
      p_restaurant_id, v_session.id, p_total,
      coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0), v_applied, p_total,
      p_method::payment_method, p_created_by, coalesce(p_discount, 0)
    );

    if v_session.status <> 'closed' then
      update sessions set status = 'closed', closed_at = v_now where id = v_session.id;
    end if;
  end if;

  update rooms set status = 'cleaning' where id = v_stay.room_id;

  return jsonb_build_object(
    'stay_id',      p_stay_id,
    'session_id',   v_session.id,
    'check_out_at', v_now,
    'total',        p_total,
    'advance',      v_applied,
    'refund',       v_refund
  );
end;
$function$;


-- ── edit_payment_tender ───────────────────────────────────────────────────────
-- A bill part-settled by a deposit can only have the REMAINDER re-split. Editing
-- 3,000 of cash into 8,000 on a bill carrying a 5,000 advance would count that
-- deposit twice and invent 5,000 of cash that never entered the drawer.
--
-- The body below is the CURRENT live definition, reproduced verbatim. The ONLY
-- changes are the `- coalesce(v_pay.advance_amount, 0)` on v_total and the
-- advance figure added to the audit record. The parameter list is unchanged, so
-- no drop is needed.
create or replace function public.edit_payment_tender(
  p_restaurant_id uuid, p_actor_id uuid, p_actor_name text, p_payment_id uuid,
  p_cash numeric, p_online numeric, p_card numeric
)
 RETURNS payments
 LANGUAGE plpgsql
AS $function$
declare
  v_pay     payments;
  v_before  jsonb;
  v_cash    numeric := round(coalesce(p_cash, 0), 2);
  v_online  numeric := round(coalesce(p_online, 0), 2);
  v_card    numeric := round(coalesce(p_card, 0), 2);
  v_total   numeric;
  v_method  payment_method;
  v_nonzero int;
begin
  select * into v_pay
    from payments
   where id = p_payment_id and restaurant_id = p_restaurant_id
   for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  -- Credit settlements aren't a simple tender split — they're settled through the
  -- credits module, so editing their split here would desync the receivable.
  if v_pay.payment_method = 'credit' then raise exception 'CANNOT_EDIT_CREDIT_PAYMENT'; end if;

  if v_cash < 0 or v_online < 0 or v_card < 0 then raise exception 'INVALID_AMOUNT'; end if;

  -- The frozen amount the bill was for, LESS anything already settled by an
  -- advance. total_amount is the net (after discount); older rows may only carry
  -- `amount`. What remains is the only part a tender edit may redistribute.
  v_total := coalesce(v_pay.total_amount, v_pay.amount) - coalesce(v_pay.advance_amount, 0);
  if abs((v_cash + v_online + v_card) - v_total) > 0.005 then
    raise exception 'SPLIT_MISMATCH';
  end if;
  -- Absorb sub-paisa rounding into cash so the split sums to the total EXACTLY.
  v_cash := round(v_total - v_online - v_card, 2);
  if v_cash < -0.005 then raise exception 'SPLIT_MISMATCH'; end if;
  if v_cash < 0 then v_cash := 0; end if;

  v_nonzero := (case when v_cash   > 0 then 1 else 0 end)
             + (case when v_online > 0 then 1 else 0 end)
             + (case when v_card   > 0 then 1 else 0 end);
  if    v_nonzero > 1  then v_method := 'mixed';
  elsif v_online  > 0  then v_method := 'online';
  elsif v_card    > 0  then v_method := 'card';
  else                      v_method := 'cash';   -- includes a zero-total bill
  end if;

  v_before := jsonb_build_object(
    'payment_method', v_pay.payment_method,
    'cash_amount',    v_pay.cash_amount,
    'online_amount',  v_pay.online_amount,
    'card_amount',    v_pay.card_amount,
    'advance_amount', v_pay.advance_amount
  );

  update payments
     set cash_amount    = v_cash,
         online_amount  = v_online,
         card_amount    = v_card,
         payment_method = v_method
   where id = p_payment_id
  returning * into v_pay;

  perform log_security_event(
    p_restaurant_id, p_actor_id, p_actor_name,
    'edit_payment_tender', 'payment', p_payment_id, 'success',
    jsonb_build_object(
      'before', v_before,
      'after', jsonb_build_object(
        'payment_method', v_method,
        'cash_amount',    v_cash,
        'online_amount',  v_online,
        'card_amount',    v_card,
        'advance_amount', v_pay.advance_amount
      )
    )
  );

  return v_pay;
end $function$;

notify pgrst, 'reload schema';
