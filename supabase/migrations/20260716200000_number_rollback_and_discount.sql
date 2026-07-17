-- Two billing improvements:
--   1. Release the LATEST unused bill/OT number when an order is cancelled or a session is
--      force-closed without paying — so sequences stay gap-free without ever renumbering a
--      completed bill. Mirrors how cancelled items release their stock.
--   2. A payment-time discount: the net (post-discount) amount is what's recorded as the sale.

-- ── Discount ──────────────────────────────────────────────────────────────────
alter table payments add column if not exists discount_amount numeric not null default 0;

-- ── Rollback rule ─────────────────────────────────────────────────────────────
-- "Latest-only": a claimed number can be reclaimed only if it's still the last one issued
-- (counter = number + 1). The conditional UPDATE takes the parent row lock, so two cashiers
-- can't both roll back or roll back over a newer claim — a superseded number just stays a gap.

-- Release a session's bill number (roll the restaurant counter back if it was the latest,
-- then clear the stamp). No-op when the session has no number.
create or replace function release_session_bill_number(p_session_id uuid) returns void
language plpgsql as $$
declare v_num integer; v_rest uuid;
begin
  select bill_number, restaurant_id into v_num, v_rest
    from sessions where id = p_session_id;
  if v_num is null then return; end if;
  update restaurants set bill_number_next = v_num
    where id = v_rest and bill_number_next = v_num + 1;
  update sessions set bill_number = null where id = p_session_id;
end $$;

-- Release one (session, workstation) OT number the same way.
create or replace function release_workstation_ot_number(p_session_id uuid, p_workstation_id uuid) returns void
language plpgsql as $$
declare v_num integer;
begin
  select ot_number into v_num
    from workstation_ticket_numbers
   where session_id = p_session_id and workstation_id = p_workstation_id;
  if v_num is null then return; end if;
  update workstations set ot_next = v_num
    where id = p_workstation_id and ot_next = v_num + 1;
  delete from workstation_ticket_numbers
   where session_id = p_session_id and workstation_id = p_workstation_id;
end $$;

-- Trigger A: on item cancellation, release numbers that no longer have anything on them.
-- A served item can never be cancelled (cancel_order_item refuses it), so "no active items
-- left for this station" means the ticket was never processed → its number is free to reuse.
create or replace function release_ticket_numbers_on_item_cancel() returns trigger
language plpgsql as $$
declare v_session uuid;
begin
  if new.cancelled_at is null or old.cancelled_at is not null then return new; end if;

  select session_id into v_session from session_orders where id = new.order_id;
  if v_session is null then return new; end if;

  -- This workstation's OT: release if none of its items remain active in the session.
  if new.workstation_id is not null
     and not exists (
       select 1 from session_order_items soi
         join session_orders so on so.id = soi.order_id
        where so.session_id = v_session
          and soi.workstation_id = new.workstation_id
          and soi.cancelled_at is null
     ) then
    perform release_workstation_ot_number(v_session, new.workstation_id);
  end if;

  -- The bill number: release if the WHOLE order is now empty (every item cancelled).
  if not exists (
       select 1 from session_order_items soi
         join session_orders so on so.id = soi.order_id
        where so.session_id = v_session
          and soi.cancelled_at is null
     ) then
    perform release_session_bill_number(v_session);
  end if;

  return new;
end $$;

drop trigger if exists trg_release_ticket_numbers_on_item_cancel on session_order_items;
create trigger trg_release_ticket_numbers_on_item_cancel
  after update on session_order_items
  for each row execute function release_ticket_numbers_on_item_cancel();

-- Trigger B: a session closed WITHOUT a payment (force-closed / abandoned) releases its bill
-- number too — this catches the walked-out case where food was served (so Trigger A kept it).
-- A normal paid/credit close inserts the payment first, so its number is preserved.
create or replace function release_bill_number_on_abandon() returns trigger
language plpgsql as $$
begin
  if new.status = 'closed' and old.status <> 'closed'
     and new.bill_number is not null
     and not exists (select 1 from payments where session_id = new.id) then
    perform release_session_bill_number(new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_release_bill_number_on_abandon on sessions;
create trigger trg_release_bill_number_on_abandon
  after update on sessions
  for each row execute function release_bill_number_on_abandon();

-- ── Credit close: carry the discount ──────────────────────────────────────────
-- Replace the 11-arg function with a 12-arg one that stores discount_amount. p_total is the
-- already-discounted (payable) bill value, so the credit + recorded sale are both net.
drop function if exists close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text, text, uuid);

create function close_bill_with_credit(
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
  p_discount       numeric
) returns credit_customers
language plpgsql
as $$
declare
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0);
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
    cash_amount, online_amount, card_amount,
    payment_method, created_by
  )
  values (
    p_restaurant_id, p_session_id, p_total, p_total, coalesce(p_discount, 0),
    coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0),
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
$$;

revoke all on function close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text, text, uuid, numeric) from public;
grant execute on function close_bill_with_credit(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text, text, uuid, numeric) to service_role;
