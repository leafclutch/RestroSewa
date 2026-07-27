-- ── Delete a vendor (only when it has no history) ─────────────────────────────
-- Vendors have always been *deactivated*, never deleted, because purchases and
-- payments reference them and deleting a referenced vendor would tear a hole in
-- the purchase history. This adds a true delete for the one safe case: a vendor
-- created by mistake that nothing points at yet.
--
-- The reference checks run INSIDE this transaction, with the vendor row locked
-- `for update`, so a purchase recorded against the vendor between an app-level
-- check and this call cannot slip through — the lock serialises them and the
-- re-check here is the authority. Anything with history raises a coded error the
-- action turns into "deactivate instead".
create or replace function delete_vendor(
  p_restaurant_id uuid,
  p_vendor_id     uuid
) returns void
language plpgsql
as $$
declare
  v_vendor vendors;
begin
  select * into v_vendor
    from vendors
   where id = p_vendor_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'VENDOR_NOT_FOUND';
  end if;

  -- Any money history at all — carried-over dues, an outstanding balance, or a
  -- balance that was raised and then settled — means the account must be kept.
  if coalesce(v_vendor.opening_credit, 0) <> 0 or coalesce(v_vendor.credit_balance, 0) <> 0 then
    raise exception 'VENDOR_HAS_HISTORY';
  end if;

  if exists (select 1 from purchases where vendor_id = p_vendor_id) then
    raise exception 'VENDOR_HAS_PURCHASES';
  end if;

  if exists (select 1 from vendor_payments where vendor_id = p_vendor_id) then
    raise exception 'VENDOR_HAS_HISTORY';
  end if;

  delete from vendors where id = p_vendor_id and restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function delete_vendor(uuid, uuid) from public;
grant execute on function delete_vendor(uuid, uuid) to service_role;
