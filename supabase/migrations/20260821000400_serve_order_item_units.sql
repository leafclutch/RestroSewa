-- =============================================================
-- SERVING BY THE UNIT
--
-- Last of the five deliberately. Until this file lands, `served_quantity` only
-- ever holds 0 or `quantity` (the compatibility trigger derives it from the
-- `item_status` the deployed build writes), so every constraint added by the
-- earlier migrations has already been exercised at its extremes on real traffic
-- before anything starts writing intermediate values.
--
-- WHY THIS IS NEEDED AT ALL.
-- "Order 3, serve 2, cancel the last 1" cannot be expressed while serving is a
-- single flag on the line: marking the line served blocks cancellation of the
-- unit that never arrived, and leaving it pending misrepresents the two that did.
--
-- `updateOrderItemStatus(id, 'served')` keeps meaning "serve everything still on
-- this line", so the one-tap flow in the queue is unchanged — it just routes here
-- with a null quantity.
-- =============================================================

create or replace function serve_order_item_units(
  p_restaurant_id uuid,
  p_item_id       uuid,
  p_qty           int,
  p_by            uuid default null
)
returns integer
language plpgsql
as $$
declare
  v_quantity  int;
  v_cancelled int;
  v_served    int;
  v_servable  int;
  v_take      int;
begin
  -- Lock first, same discipline as cancel_order_item_units: two waiters marking
  -- the same line served must serialise rather than race the CHECK.
  select soi.quantity, soi.cancelled_quantity, soi.served_quantity
    into v_quantity, v_cancelled, v_served
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
   where soi.id = p_item_id
     and so.restaurant_id = p_restaurant_id
   for update of soi;

  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  -- A cancelled unit cannot be served: it never existed as food.
  v_servable := v_quantity - v_cancelled - v_served;
  v_take := coalesce(p_qty, v_servable);

  if v_take <= 0 or v_servable <= 0 then
    return 0;
  end if;

  -- Refused rather than clamped, for the same reason cancellation is: "serve 4"
  -- and "serve 3" are different claims about what reached the customer, and the
  -- difference decides whether the fourth unit can still be cancelled.
  if v_take > v_servable then
    raise exception 'ONLY_N_SERVABLE:%', v_servable;
  end if;

  -- item_status is derived from this by trg_sync_order_item_served — do not set
  -- it here, or the two writes race and the flag wins over the count.
  update session_order_items
     set served_quantity = v_served + v_take
   where id = p_item_id;

  return v_take;
end;
$$;

revoke all on function serve_order_item_units(uuid, uuid, int, uuid) from public;
grant execute on function serve_order_item_units(uuid, uuid, int, uuid) to service_role;


-- Un-serving, for the mis-tap. The existing UI can already flip 'served' back to
-- 'pending'; that path now has to zero the count too, and the compatibility
-- trigger does exactly that when item_status is written directly. This is the
-- explicit form for the new UI.
create or replace function unserve_order_item_units(
  p_restaurant_id uuid,
  p_item_id       uuid,
  p_qty           int default null
)
returns integer
language plpgsql
as $$
declare
  v_served int;
  v_take   int;
begin
  select soi.served_quantity into v_served
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
   where soi.id = p_item_id
     and so.restaurant_id = p_restaurant_id
   for update of soi;

  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  v_take := least(coalesce(p_qty, v_served), v_served);
  if v_take <= 0 then
    return 0;
  end if;

  update session_order_items
     set served_quantity = v_served - v_take
   where id = p_item_id;

  return v_take;
end;
$$;

revoke all on function unserve_order_item_units(uuid, uuid, int) from public;
grant execute on function unserve_order_item_units(uuid, uuid, int) to service_role;


notify pgrst, 'reload schema';
