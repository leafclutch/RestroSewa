-- =============================================================
-- CREDIT FUNCTIONS
--
-- Money-moving steps that must not tear: closing a bill on credit writes a
-- payment, a credit and the session close together, and a repayment writes a
-- ledger row and moves the balance together. Doing these in the database keeps
-- them in one transaction and lets `for update` serialise two cashiers acting on
-- the same credit at the same time — which app-level read-modify-write cannot.
--
-- Separate migration from the table DDL: `alter type … add value` and the first
-- *use* of that value cannot share a transaction.
-- =============================================================

-- ── Close a bill with an outstanding balance ──────────────────────────────────
-- Writes ONE payments row for the full bill (so sales still see the whole bill,
-- and no duplicate bill is ever created), records what was actually handed over
-- in the cash/online/card split, opens the credit for the remainder, and closes
-- the session.
create or replace function close_bill_with_credit(
  p_restaurant_id  uuid,
  p_session_id     uuid,
  p_total          numeric,
  p_cash           numeric,
  p_online         numeric,
  p_card           numeric,
  p_customer_name  text,
  p_customer_phone text,
  p_notes          text,
  p_created_by     uuid
) returns credits
language plpgsql
as $$
declare
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0);
  v_payment payments;
  v_seq     int;
  v_credit  credits;
begin
  if p_total is null or p_total <= 0 then
    raise exception 'INVALID_TOTAL';
  end if;

  -- A credit only exists when something is left unpaid. Paying the whole bill is
  -- an ordinary payment, not a credit.
  if v_paid < 0 or v_paid >= p_total then
    raise exception 'INVALID_DOWN_PAYMENT';
  end if;

  if coalesce(btrim(p_customer_name), '') = '' then
    raise exception 'CUSTOMER_NAME_REQUIRED';
  end if;

  -- The session must still be open and belong to this restaurant. `for update`
  -- means a double-submit (or two cashiers) can't bill the same table twice.
  perform 1
     from sessions
    where id = p_session_id
      and restaurant_id = p_restaurant_id
      and status <> 'closed'
      for update;
  if not found then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  insert into payments (
    restaurant_id, session_id, amount, total_amount,
    cash_amount, online_amount, card_amount,
    payment_method, created_by
  )
  values (
    p_restaurant_id, p_session_id, p_total, p_total,
    coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0),
    'credit', p_created_by
  )
  returning * into v_payment;

  -- Per-restaurant credit numbering (CR-00001…). The advisory lock serialises
  -- concurrent cashiers so two credits can never take the same number; it is
  -- released automatically at commit.
  perform pg_advisory_xact_lock(hashtext('credit_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from credits
   where restaurant_id = p_restaurant_id;

  insert into credits (
    restaurant_id, seq_no, session_id, payment_id,
    customer_name, customer_phone,
    bill_amount, down_payment, paid_amount,
    status, notes, created_by
  )
  values (
    p_restaurant_id, v_seq, p_session_id, v_payment.id,
    btrim(p_customer_name), nullif(btrim(coalesce(p_customer_phone, '')), ''),
    p_total, v_paid, v_paid,
    case when v_paid > 0 then 'partially_paid' else 'pending' end,
    nullif(btrim(coalesce(p_notes, '')), ''), p_created_by
  )
  returning * into v_credit;

  update sessions
     set status = 'closed', closed_at = now()
   where id = p_session_id;

  return v_credit;
end;
$$;

-- ── Record a repayment against an open credit ─────────────────────────────────
-- Appends to the ledger and moves the balance in one transaction, auto-settling
-- the credit when the balance reaches zero.
create or replace function record_credit_payment(
  p_restaurant_id uuid,
  p_credit_id     uuid,
  p_amount        numeric,
  p_method        text,
  p_notes         text,
  p_received_by   uuid
) returns credits
language plpgsql
as $$
declare
  v_credit  credits;
  v_balance numeric;
  v_applied numeric;
  v_paid    numeric;
begin
  -- `for update` holds the row for the whole transaction, so two cashiers taking
  -- money for the same credit at once can't both read the same stale balance.
  select * into v_credit
    from credits
   where id = p_credit_id
     and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'CREDIT_NOT_FOUND';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  v_balance := v_credit.bill_amount - v_credit.paid_amount;
  if v_balance <= 0 then
    raise exception 'ALREADY_SETTLED';
  end if;

  -- Never let a credit be overpaid. A hair over the balance is treated as
  -- settling it exactly (rounding on the cashier's side), anything more is an error.
  if p_amount > v_balance + 0.005 then
    raise exception 'AMOUNT_EXCEEDS_BALANCE';
  end if;
  v_applied := least(p_amount, v_balance);
  v_paid    := v_credit.paid_amount + v_applied;

  insert into credit_payments (credit_id, restaurant_id, amount, method, notes, received_by)
  values (
    p_credit_id, p_restaurant_id, v_applied, p_method::payment_method,
    nullif(btrim(coalesce(p_notes, '')), ''), p_received_by
  );

  update credits
     set paid_amount = v_paid,
         status      = case when v_credit.bill_amount - v_paid <= 0 then 'fully_paid'
                            else 'partially_paid' end,
         settled_at  = case when v_credit.bill_amount - v_paid <= 0 then now()
                            else null end
   where id = p_credit_id
  returning * into v_credit;

  return v_credit;
end;
$$;

-- These functions move money. PostgREST exposes every public function as an RPC
-- endpoint, so lock them to the service role — only the server actions (which
-- check permissions first) may call them. anon/authenticated must not.
revoke all on function close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, text, text, text, uuid) from public;
revoke all on function record_credit_payment(uuid, uuid, numeric, text, text, uuid) from public;
grant execute on function close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, text, text, text, uuid) to service_role;
grant execute on function record_credit_payment(uuid, uuid, numeric, text, text, uuid) to service_role;
