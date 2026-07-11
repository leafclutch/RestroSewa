-- =============================================================
-- STOCK & FINANCE — PHASE 1: SELLER FUNCTIONS
--
-- Same reasoning as the customer-credit functions: money moves in one
-- transaction, and `for update` serialises two admins paying down the same
-- seller at once (an app-level read-modify-write would let both write from the
-- same stale balance).
-- =============================================================

-- ── Create a seller (once) ────────────────────────────────────────────────────
-- Allocates the per-restaurant SLR-xxxxx code and seeds the credit account with
-- any dues carried over. Rejects a duplicate name rather than making a second
-- account for the same supplier.
create or replace function create_seller(
  p_restaurant_id  uuid,
  p_name           text,
  p_phone          text,
  p_address        text,
  p_notes          text,
  p_opening_credit numeric,
  p_created_by     uuid
) returns sellers
language plpgsql
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_open   numeric := coalesce(p_opening_credit, 0);
  v_seq    int;
  v_seller sellers;
begin
  if v_name = '' then
    raise exception 'NAME_REQUIRED';
  end if;
  if v_open < 0 then
    raise exception 'INVALID_OPENING_CREDIT';
  end if;

  -- Serialise numbering per restaurant; released at commit.
  perform pg_advisory_xact_lock(hashtext('seller_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from sellers
   where restaurant_id = p_restaurant_id;

  begin
    insert into sellers (
      restaurant_id, seq_no, name, phone, address, notes,
      opening_credit, credit_balance, created_by
    )
    values (
      p_restaurant_id, v_seq, v_name,
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      v_open, v_open, p_created_by
    )
    returning * into v_seller;
  exception
    when unique_violation then
      -- The partial-unique index on lower(btrim(name)) fired: this supplier
      -- already has an account, and must be reused rather than duplicated.
      raise exception 'SELLER_EXISTS';
  end;

  return v_seller;
end;
$$;

-- ── Pay a seller ──────────────────────────────────────────────────────────────
-- Appends to the ledger and draws the credit balance down in one transaction.
create or replace function record_seller_payment(
  p_restaurant_id uuid,
  p_seller_id     uuid,
  p_amount        numeric,
  p_method        text,
  p_notes         text,
  p_paid_by       uuid
) returns sellers
language plpgsql
as $$
declare
  v_seller  sellers;
  v_applied numeric;
begin
  select * into v_seller
    from sellers
   where id = p_seller_id
     and restaurant_id = p_restaurant_id
     for update;
  if not found then
    raise exception 'SELLER_NOT_FOUND';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if v_seller.credit_balance <= 0 then
    raise exception 'NOTHING_OWED';
  end if;

  -- Never overpay a seller. A hair over the balance settles it exactly
  -- (rounding on the admin's side); anything more is a mistake.
  if p_amount > v_seller.credit_balance + 0.005 then
    raise exception 'AMOUNT_EXCEEDS_BALANCE';
  end if;
  v_applied := least(p_amount, v_seller.credit_balance);

  insert into seller_payments (seller_id, restaurant_id, amount, method, notes, paid_by)
  values (
    p_seller_id, p_restaurant_id, v_applied, p_method::payment_method,
    nullif(btrim(coalesce(p_notes, '')), ''), p_paid_by
  );

  update sellers
     set credit_balance = credit_balance - v_applied
   where id = p_seller_id
  returning * into v_seller;

  return v_seller;
end;
$$;

-- PostgREST publishes every public function as an RPC endpoint, so lock these to
-- the service role — only the server actions (which check permissions) may call them.
revoke all on function create_seller(uuid, text, text, text, text, numeric, uuid) from public;
revoke all on function record_seller_payment(uuid, uuid, numeric, text, text, uuid) from public;
grant execute on function create_seller(uuid, text, text, text, text, numeric, uuid) to service_role;
grant execute on function record_seller_payment(uuid, uuid, numeric, text, text, uuid) to service_role;
