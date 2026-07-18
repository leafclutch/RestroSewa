-- Discount authorization PIN: a discount is money leaving the till, so applying one now
-- requires a PIN that only the restaurant's admin sets (Admin → Settings). No PIN
-- configured = discounts are OFF for that restaurant; there is no un-gated path.
--
-- The PIN is stored ONLY as a bcrypt hash, and both hashing and comparison happen inside
-- these functions, so the plaintext never round-trips through the app and the hash is never
-- selectable into application code by accident. pgcrypto is already installed (see
-- 20260614000000_initial_schema.sql).

alter table restaurants add column if not exists discount_pin_hash text;  -- NULL = discounts off

comment on column restaurants.discount_pin_hash is
  'bcrypt hash of the discount authorization PIN. NULL = discounts disabled for this restaurant. Set/checked only via set_discount_pin/verify_discount_pin.';

-- Sets, changes, or clears (p_pin NULL/blank) the restaurant's discount PIN.
create or replace function set_discount_pin(p_restaurant_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_pin is null or btrim(p_pin) = '' then
    update restaurants set discount_pin_hash = null where id = p_restaurant_id;
  else
    update restaurants
       set discount_pin_hash = crypt(btrim(p_pin), gen_salt('bf'))
     where id = p_restaurant_id;
  end if;
end $$;

-- True only when this restaurant HAS a PIN and p_pin matches it. A restaurant with no PIN
-- returns false, which is what makes "no PIN configured" mean "no discount" rather than
-- "discount unguarded".
create or replace function verify_discount_pin(p_restaurant_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_hash text;
begin
  if p_pin is null or btrim(p_pin) = '' then return false; end if;

  select discount_pin_hash into v_hash from restaurants where id = p_restaurant_id;
  if v_hash is null then return false; end if;

  return v_hash = crypt(btrim(p_pin), v_hash);
end $$;

-- Reachable ONLY by the server (service role). Revoking from PUBLIC also strips the
-- implicit grant service_role inherits, so it must be granted back explicitly — otherwise
-- the app's own RPC fails with "permission denied" and no discount could ever be applied.
revoke all on function set_discount_pin(uuid, text)    from public, anon, authenticated;
revoke all on function verify_discount_pin(uuid, text) from public, anon, authenticated;
grant execute on function set_discount_pin(uuid, text)    to service_role;
grant execute on function verify_discount_pin(uuid, text) to service_role;

-- New functions are invisible to PostgREST until its schema cache is reloaded.
notify pgrst, 'reload schema';
