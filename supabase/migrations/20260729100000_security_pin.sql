-- =============================================================
-- SECURITY PIN — admin-only authorization for sensitive financial edits
--
-- Independent of the discount PIN. It gates editing completed payments (re-tender)
-- and purchases (amount/qty/product/vendor/method), and is designed as a reusable
-- authorization service: future ops (refunds, stock reset, finance reset) verify with
-- verify_security_pin and log with log_security_event under a new `operation` string,
-- with no new plumbing.
--
-- Storage mirrors the discount PIN exactly (20260717120000_discount_pin.sql): a bcrypt
-- hash only, hashing AND comparison inside these functions, so the plaintext never
-- round-trips through the app and the hash is never selectable into app code by accident.
-- pgcrypto is installed (see 20260614000000_initial_schema.sql).
-- =============================================================

-- ── The PIN ────────────────────────────────────────────────────────────────────
alter table restaurants add column if not exists security_pin_hash text;  -- NULL = no PIN

comment on column restaurants.security_pin_hash is
  'bcrypt hash of the admin Security PIN. NULL = no PIN set (sensitive edits disabled). Set/checked only via set_security_pin/verify_security_pin. Independent of discount_pin_hash.';

-- Sets, changes, or clears (p_pin NULL/blank) the restaurant's Security PIN.
create or replace function set_security_pin(p_restaurant_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_pin is null or btrim(p_pin) = '' then
    update restaurants set security_pin_hash = null where id = p_restaurant_id;
  else
    update restaurants
       set security_pin_hash = crypt(btrim(p_pin), gen_salt('bf'))
     where id = p_restaurant_id;
  end if;
end $$;

-- True only when this restaurant HAS a PIN and p_pin matches it. No PIN => false,
-- which is what makes "no PIN configured" mean "sensitive edits are off".
create or replace function verify_security_pin(p_restaurant_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_hash text;
begin
  if p_pin is null or btrim(p_pin) = '' then return false; end if;

  select security_pin_hash into v_hash from restaurants where id = p_restaurant_id;
  if v_hash is null then return false; end if;

  return v_hash = crypt(btrim(p_pin), v_hash);
end $$;

revoke all on function set_security_pin(uuid, text)    from public, anon, authenticated;
revoke all on function verify_security_pin(uuid, text) from public, anon, authenticated;
grant execute on function set_security_pin(uuid, text)    to service_role;
grant execute on function verify_security_pin(uuid, text) to service_role;

-- ── The audit log ────────────────────────────────────────────────────────────
-- Every attempt at a sensitive op: success, failure (wrong/absent PIN), or blocked
-- (PIN was right but the op was refused, e.g. a purchase edit that would corrupt a
-- vendor balance). `detail` holds a before->after snapshot for successful edits.
create table if not exists security_audit_log (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  actor_user_id uuid references restaurant_users(id) on delete set null,
  actor_name    text,
  operation     text not null,              -- e.g. 'edit_payment_tender', 'edit_purchase'
  target_type   text,                       -- e.g. 'payment', 'purchase'
  target_id     uuid,
  outcome       text not null check (outcome in ('success', 'failure', 'blocked')),
  detail        jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists security_audit_log_restaurant_idx
  on security_audit_log (restaurant_id, created_at desc);

alter table security_audit_log enable row level security;  -- backstop; reached via service_role
revoke all on table security_audit_log from public, anon, authenticated;
grant all  on table security_audit_log to service_role;

-- One insert path for every caller (the TS layer logs failure/blocked; the edit RPCs
-- log success atomically inside their own transaction).
create or replace function log_security_event(
  p_restaurant_id uuid,
  p_actor_id      uuid,
  p_actor_name    text,
  p_operation     text,
  p_target_type   text,
  p_target_id     uuid,
  p_outcome       text,
  p_detail        jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into security_audit_log (
    restaurant_id, actor_user_id, actor_name, operation, target_type, target_id, outcome, detail
  ) values (
    p_restaurant_id, p_actor_id, p_actor_name, p_operation, p_target_type, p_target_id, p_outcome, p_detail
  );
end $$;

revoke all on function log_security_event(uuid, uuid, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function log_security_event(uuid, uuid, text, text, text, uuid, text, jsonb) to service_role;

-- ── Edit a completed payment's tender ────────────────────────────────────────
-- Re-splits how a bill was paid (cash/online/card) WITHOUT changing the amount. The
-- split is the source of truth; payment_method is DERIVED (one non-zero tender => that
-- method, several => 'mixed'). Total, discount and bill number are frozen. Credit bills
-- are not editable here (they live in the credits module). Logs success atomically.
create or replace function edit_payment_tender(
  p_restaurant_id uuid,
  p_actor_id      uuid,
  p_actor_name    text,
  p_payment_id    uuid,
  p_cash          numeric,
  p_online        numeric,
  p_card          numeric
) returns payments
language plpgsql
as $$
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

  -- The frozen amount the bill was for. total_amount is the net (after discount); older
  -- rows may only carry `amount`.
  v_total := coalesce(v_pay.total_amount, v_pay.amount);
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
    'card_amount',    v_pay.card_amount
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
        'card_amount',    v_card
      )
    )
  );

  return v_pay;
end $$;

revoke all on function edit_payment_tender(uuid, uuid, text, uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function edit_payment_tender(uuid, uuid, text, uuid, numeric, numeric, numeric) to service_role;

-- ── Edit a purchase ──────────────────────────────────────────────────────────
-- Rewrites the bill from new lines (like record_purchase), moves the vendor credit
-- from the OLD vendor to the NEW one, and recomputes each affected product's latest
-- cost — all atomically. Refuses (VENDOR_BALANCE_NEGATIVE) if reversing the old debt
-- would push a vendor's balance below zero because payments already exceed it. Keeps
-- seq_no / purchase_code / created_at / created_by. Logs success atomically.
create or replace function edit_purchase(
  p_restaurant_id uuid,
  p_actor_id      uuid,
  p_actor_name    text,
  p_purchase_id   uuid,
  p_vendor_id     uuid,
  p_method        text,
  p_cash          numeric,
  p_online        numeric,
  p_items         jsonb,
  p_notes         text
) returns purchases
language plpgsql
as $$
declare
  v_old        purchases;
  v_new        purchases;
  v_old_vendor vendors;
  v_new_vendor vendors;
  v_old_items  jsonb;
  v_before     jsonb;
  v_total      numeric := 0;
  v_paid       numeric := coalesce(p_cash, 0) + coalesce(p_online, 0);
  v_cash       numeric := coalesce(p_cash, 0);
  v_online     numeric := coalesce(p_online, 0);
  v_credit     numeric := 0;
  v_item       jsonb;
  v_count      int;
  v_old_bal    numeric;
  v_new_bal    numeric;
  v_affected   uuid[];
begin
  if p_method not in ('cash', 'online', 'credit', 'mixed') then raise exception 'INVALID_METHOD'; end if;
  if v_cash < 0 or v_online < 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_old
    from purchases
   where id = p_purchase_id and restaurant_id = p_restaurant_id
   for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND'; end if;

  -- Lock the old vendor, then the new one (only if different). Ordering keeps two
  -- concurrent edits from deadlocking; in practice these are admin-only and serial.
  select * into v_old_vendor from vendors where id = v_old.vendor_id for update;

  if p_vendor_id = v_old.vendor_id then
    v_new_vendor := v_old_vendor;
  else
    select * into v_new_vendor
      from vendors
     where id = p_vendor_id and restaurant_id = p_restaurant_id
     for update;
    if not found then raise exception 'VENDOR_NOT_FOUND'; end if;
    if not v_new_vendor.is_active then raise exception 'VENDOR_INACTIVE'; end if;
  end if;

  -- Validate lines and total (computed here, never trusted from the client).
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'quantity')::numeric <= 0 then raise exception 'INVALID_QUANTITY'; end if;
    if (v_item->>'unit_cost')::numeric < 0 then raise exception 'INVALID_UNIT_COST'; end if;
    select count(*) into v_count
      from products
     where id = (v_item->>'product_id')::uuid and restaurant_id = p_restaurant_id and is_active;
    if v_count = 0 then raise exception 'PRODUCT_NOT_FOUND'; end if;
    v_total := v_total + round((v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric, 2);
  end loop;
  if v_total <= 0 then raise exception 'INVALID_TOTAL'; end if;

  if p_method = 'credit' then
    if v_paid >= v_total then raise exception 'NOTHING_ON_CREDIT'; end if;
    v_credit := v_total - v_paid;
  else
    v_credit := 0;
    if p_method = 'mixed' then
      -- A fully-paid bill split cash + online (parity with record_purchase). Must
      -- reconcile to the total; absorb sub-paisa into cash so cash+online = total EXACTLY
      -- and the purchases_amounts_balance CHECK holds.
      if abs((v_cash + v_online) - v_total) > 0.005 then raise exception 'SPLIT_MISMATCH'; end if;
      v_cash := round(v_total - v_online, 2);
      if v_cash < 0 then v_cash := 0; end if;
    elsif p_method = 'cash' then v_cash := v_total; v_online := 0;
    else v_cash := 0; v_online := v_total; end if;
  end if;

  -- Reconcile vendor credit. Pre-check the resulting balances BEFORE writing, so a
  -- refusal is a clean coded error rather than a raw CHECK violation.
  if p_vendor_id = v_old.vendor_id then
    v_new_bal := v_old_vendor.credit_balance - v_old.credit_amount + v_credit;
    if v_new_bal < -0.005 then raise exception 'VENDOR_BALANCE_NEGATIVE'; end if;
    update vendors set credit_balance = greatest(v_new_bal, 0) where id = p_vendor_id;
  else
    v_old_bal := v_old_vendor.credit_balance - v_old.credit_amount;
    if v_old_bal < -0.005 then raise exception 'VENDOR_BALANCE_NEGATIVE'; end if;
    update vendors set credit_balance = greatest(v_old_bal, 0) where id = v_old.vendor_id;
    update vendors set credit_balance = credit_balance + v_credit where id = p_vendor_id;
  end if;

  -- Snapshot the old state, then gather every product touched by the old OR new lines
  -- (their last_unit_cost may need recomputing).
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id, 'quantity', quantity, 'unit_cost', unit_cost
         ) order by product_id), '[]'::jsonb)
    into v_old_items
    from purchase_items where purchase_id = p_purchase_id;

  select array_agg(distinct pid) into v_affected from (
    select product_id as pid from purchase_items where purchase_id = p_purchase_id
    union
    select (i->>'product_id')::uuid from jsonb_array_elements(p_items) i
  ) _;

  v_before := jsonb_build_object(
    'vendor_id',      v_old.vendor_id,
    'payment_method', v_old.payment_method,
    'total_amount',   v_old.total_amount,
    'cash_amount',    v_old.cash_amount,
    'online_amount',  v_old.online_amount,
    'credit_amount',  v_old.credit_amount,
    'notes',          v_old.notes,
    'items',          v_old_items
  );

  -- Replace the lines.
  delete from purchase_items where purchase_id = p_purchase_id;
  insert into purchase_items (purchase_id, restaurant_id, product_id, quantity, unit_cost)
  select p_purchase_id, p_restaurant_id,
         (i->>'product_id')::uuid, (i->>'quantity')::numeric, (i->>'unit_cost')::numeric
    from jsonb_array_elements(p_items) i;

  -- Rewrite the bill head (seq_no / purchase_code / created_at / created_by untouched).
  update purchases
     set vendor_id      = p_vendor_id,
         payment_method = p_method::payment_method,
         total_amount   = v_total,
         cash_amount    = v_cash,
         online_amount  = v_online,
         credit_amount  = v_credit,
         notes          = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_purchase_id
  returning * into v_new;

  -- Recompute last_unit_cost for every affected product to its most recent purchase.
  update products p
     set last_unit_cost = lu.unit_cost
    from (
      select distinct on (pi.product_id) pi.product_id, pi.unit_cost
        from purchase_items pi
        join purchases pu on pu.id = pi.purchase_id
       where pu.restaurant_id = p_restaurant_id
         and pi.product_id = any(v_affected)
       order by pi.product_id, pu.created_at desc, pi.id desc
    ) lu
   where p.id = lu.product_id and p.restaurant_id = p_restaurant_id;

  perform log_security_event(
    p_restaurant_id, p_actor_id, p_actor_name,
    'edit_purchase', 'purchase', p_purchase_id, 'success',
    jsonb_build_object(
      'before', v_before,
      'after', jsonb_build_object(
        'vendor_id',      p_vendor_id,
        'payment_method', p_method,
        'total_amount',   v_total,
        'cash_amount',    v_cash,
        'online_amount',  v_online,
        'credit_amount',  v_credit,
        'notes',          nullif(btrim(coalesce(p_notes, '')), ''),
        'items',          p_items
      )
    )
  );

  return v_new;
end $$;

revoke all on function edit_purchase(uuid, uuid, text, uuid, uuid, text, numeric, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function edit_purchase(uuid, uuid, text, uuid, uuid, text, numeric, numeric, jsonb, text) to service_role;

-- New functions are invisible to PostgREST until its schema cache is reloaded.
notify pgrst, 'reload schema';
