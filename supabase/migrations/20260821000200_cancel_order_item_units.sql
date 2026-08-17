-- =============================================================
-- UNIT-WISE CANCELLATION — the write paths
--
-- Four RPCs cancel items today, and every one of them is all-or-nothing. This
-- file gives them a unit-level implementation, and fixes two defects they share.
--
-- DEFECT 1 — the bulk paths over-restore SERVED food.
-- `cancel_order` and `force_close_session` filter `item_status <> 'served'`, which
-- is a LINE-level test. Under the new model a line with 2 of 5 served reads
-- 'pending' (deliberately — that is what makes "serve 2, cancel the last 3" work),
-- so the old filter would let them cancel all 5 and put two eaten momos back on
-- the shelf. They now cancel `quantity − cancelled − served` units instead.
--
-- DEFECT 2 — cancellation was never blocked after payment.
-- No cancel path checks the session's payment state. Since `getPaidBill` re-queries
-- the item list LIVE at reprint time, cancelling after payment silently changes a
-- printed bill's lines while `payments.total_amount` stays frozen — the two can
-- then never reconcile, with nothing in any log to say why.
--
-- IDEMPOTENCY, AND WHY IT IS NOT FREE ANY MORE.
-- The old model got it for nothing: `where cancelled_at is null` meant a row could
-- only be cancelled once, so a double-tap or a retry was structurally a no-op. With
-- per-unit events that proof is gone — a retry of "cancel 2" would cancel 2 MORE.
-- The CHECK constraint stops over-cancellation but cannot tell a retry from a
-- second genuine request. Two guards replace it:
--
--   * COMPARE-AND-SWAP on the remaining count (`p_expected_remaining`). Chosen over
--     an idempotency key because it needs no client state and it ALSO covers the
--     case a key cannot: two cashiers cancelling the same line at the same time.
--     It is this repo's existing idiom — see reject_table_activation below.
--   * `p_request_id`, unique per item, as belt and braces.
-- =============================================================


-- ── The payment gate ──────────────────────────────────────────────────────────
--
-- One helper called by every path, so the four cannot drift apart. `payments` is
-- indexed on session_id (payments_session_id_idx), so this is a cheap lookup.

create or replace function assert_session_unpaid(p_session_id uuid)
returns void
language plpgsql
stable
as $$
begin
  if p_session_id is not null and exists (
    select 1 from payments where session_id = p_session_id
  ) then
    raise exception 'SESSION_ALREADY_PAID';
  end if;
end;
$$;

revoke all on function assert_session_unpaid(uuid) from public;
grant execute on function assert_session_unpaid(uuid) to service_role;


-- ── The one real implementation ───────────────────────────────────────────────
--
-- `p_qty null` means "everything still cancellable", which is what the whole-line
-- wrapper below and the bulk paths want.
--
-- Returns the number of units actually cancelled. 0 means "nothing was left to
-- cancel" — the same signal the old function gave, so existing callers that treat
-- 0 as "already served or cancelled" keep working unchanged.

create or replace function cancel_order_item_units(
  p_restaurant_id      uuid,
  p_item_id            uuid,
  p_qty                int,
  p_by                 uuid,
  p_reason             text default 'item_cancelled',
  p_expected_remaining int  default null,
  p_request_id         uuid default null
)
returns integer
language plpgsql
as $$
declare
  v_quantity   int;
  v_cancelled  int;
  v_served     int;
  v_remaining  int;
  v_take       int;
  v_order      uuid;
  v_session    uuid;
begin
  -- Lock first, exactly as generate_order_ticket does. Without the row lock two
  -- concurrent cancels both read remaining = 5 and both insert 3; the CHECK then
  -- fires, which is a loud failure rather than corruption — but serialising here
  -- turns it into the correct answer instead of an error one cashier has to retry.
  select soi.quantity, soi.cancelled_quantity, soi.served_quantity, so.id, so.session_id
    into v_quantity, v_cancelled, v_served, v_order, v_session
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
   where soi.id = p_item_id
     and so.restaurant_id = p_restaurant_id
   for update of soi;

  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  perform assert_session_unpaid(v_session);

  -- Already applied? Report it as a no-op rather than cancelling a second time.
  if p_request_id is not null and exists (
    select 1 from session_order_item_cancellations
     where order_item_id = p_item_id and request_id = p_request_id
  ) then
    return 0;
  end if;

  -- A SERVED unit was genuinely eaten: it stays on the bill and its stock stays
  -- deducted. Only unserved units are cancellable.
  v_remaining := v_quantity - v_cancelled - v_served;

  -- Compare-and-swap. The caller tells us what it believed was left; if the line
  -- moved under it, refuse rather than act on a stale screen.
  if p_expected_remaining is not null and p_expected_remaining <> v_remaining then
    raise exception 'STALE_REMAINING:%', v_remaining;
  end if;

  v_take := coalesce(p_qty, v_remaining);

  if v_take <= 0 or v_remaining <= 0 then
    return 0;
  end if;

  -- Refused, never clamped. "Cancel 4" and "cancel 3" are different amounts of
  -- money; silently doing the smaller one is how a bill quietly disagrees with
  -- what the cashier thought they did.
  if v_take > v_remaining then
    raise exception 'ONLY_N_UNSERVED:%', v_remaining;
  end if;

  -- The event is the truth. A trigger recomputes session_order_items.cancelled_quantity
  -- from it and stamps the whole-line `cancelled_at` if this took the last unit.
  insert into session_order_item_cancellations
    (order_item_id, restaurant_id, qty, reason, cancelled_by, request_id)
  values
    (p_item_id, p_restaurant_id, v_take, p_reason, p_by, p_request_id);

  -- Cancelling the last live item cancels the order it belonged to. The trigger
  -- above has already run (it is AFTER INSERT on the child, in this transaction),
  -- so `cancelled_at` is set by the time this reads it.
  update session_orders so
     set status = 'cancelled'
   where so.id = v_order
     and so.status <> 'cancelled'
     and not exists (
       select 1 from session_order_items soi
        where soi.order_id = so.id and soi.cancelled_at is null
     );

  return v_take;
end;
$$;

revoke all on function cancel_order_item_units(uuid, uuid, int, uuid, text, int, uuid) from public;
grant execute on function cancel_order_item_units(uuid, uuid, int, uuid, text, int, uuid) to service_role;


-- ── The old entry point, now a wrapper ────────────────────────────────────────
--
-- Deliberately NOT re-signatured. `create or replace` cannot change a return type
-- (42P13) and a `drop` on a hot path during a deploy window is the fragile step
-- this repo's runbook exists to avoid. Keeping the 3-arg form means the currently
-- deployed build's calls keep resolving and keep meaning exactly what they meant:
-- "cancel this whole line".

create or replace function cancel_order_item(
  p_restaurant_id uuid, p_item_id uuid, p_by uuid
)
returns integer
language plpgsql
as $$
begin
  -- null qty = every unit still cancellable.
  return cancel_order_item_units(p_restaurant_id, p_item_id, null, p_by, 'item_cancelled', null, null);
exception
  -- The old contract was "0 rows means it was already served or cancelled", not
  -- an exception. ITEM_NOT_FOUND keeps that shape for the deployed build.
  when others then
    if sqlerrm = 'ITEM_NOT_FOUND' then
      return 0;
    end if;
    raise;
end;
$$;

revoke all on function cancel_order_item(uuid, uuid, uuid) from public;
grant execute on function cancel_order_item(uuid, uuid, uuid) to service_role;


-- ── Bulk: the whole order ─────────────────────────────────────────────────────

create or replace function cancel_order(
  p_restaurant_id uuid, p_order_id uuid, p_by uuid
)
returns integer
language plpgsql
as $$
declare
  v_item    record;
  v_count   integer := 0;
  v_session uuid;
begin
  select so.session_id into v_session
    from session_orders so
   where so.id = p_order_id and so.restaurant_id = p_restaurant_id;

  perform assert_session_unpaid(v_session);

  -- Unserved units only. The old `item_status <> 'served'` was a LINE test and
  -- would have released the served units of a partly-served line.
  for v_item in
    select soi.id, (soi.quantity - soi.cancelled_quantity - soi.served_quantity) as remaining
      from session_order_items soi
      join session_orders so on so.id = soi.order_id
     where so.id = p_order_id
       and so.restaurant_id = p_restaurant_id
       and soi.quantity - soi.cancelled_quantity - soi.served_quantity > 0
     for update of soi
  loop
    insert into session_order_item_cancellations
      (order_item_id, restaurant_id, qty, reason, cancelled_by)
    values
      (v_item.id, p_restaurant_id, v_item.remaining, 'order_cancelled', p_by);
    v_count := v_count + 1;
  end loop;

  update session_orders so
     set status = 'cancelled'
   where so.id = p_order_id
     and so.restaurant_id = p_restaurant_id
     and not exists (
       select 1 from session_order_items soi
        where soi.order_id = so.id and soi.cancelled_at is null
     );

  -- Row count of LINES touched, matching the old contract.
  return v_count;
end;
$$;

revoke all on function cancel_order(uuid, uuid, uuid) from public;
grant execute on function cancel_order(uuid, uuid, uuid) to service_role;


-- ── Bulk: force close ─────────────────────────────────────────────────────────
--
-- Served items stay deducted: they were genuinely consumed. Everything still
-- pending never reached the customer, so it goes back on the shelf.
--
-- ⚠️ The payment gate here SKIPS the release rather than raising. Force close must
-- always be able to close a session — that is its whole job, and it is the escape
-- hatch when something else has gone wrong. What it must not do is put stock back
-- for food that has already been paid for.

create or replace function force_close_session(
  p_restaurant_id uuid,
  p_session_id    uuid,
  p_by            uuid
)
returns integer
language plpgsql
as $$
declare
  v_table uuid;
  v_room  uuid;
  v_paid  boolean;
  v_item  record;
  v_count integer := 0;
begin
  select table_id, room_id into v_table, v_room
    from sessions
   where id = p_session_id and restaurant_id = p_restaurant_id;

  select exists (select 1 from payments where session_id = p_session_id) into v_paid;

  if not v_paid then
    for v_item in
      select soi.id, (soi.quantity - soi.cancelled_quantity - soi.served_quantity) as remaining
        from session_order_items soi
        join session_orders so on so.id = soi.order_id
       where so.session_id = p_session_id
         and so.restaurant_id = p_restaurant_id
         and soi.quantity - soi.cancelled_quantity - soi.served_quantity > 0
       for update of soi
    loop
      insert into session_order_item_cancellations
        (order_item_id, restaurant_id, qty, reason, cancelled_by)
      values
        (v_item.id, p_restaurant_id, v_item.remaining, 'session_closed', p_by);
      v_count := v_count + 1;
    end loop;

    update session_orders so
       set status = 'cancelled'
     where so.session_id = p_session_id
       and so.restaurant_id = p_restaurant_id
       and so.status <> 'cancelled'
       and not exists (
         select 1 from session_order_items soi
          where soi.order_id = so.id and soi.cancelled_at is null
       );
  end if;

  update notifications
     set status = 'completed'
   where restaurant_id = p_restaurant_id
     and status in ('new', 'acknowledged')
     and (
       (v_table is not null and table_id = v_table) or
       (v_table is null and v_room is not null and room_id = v_room)
     );

  update sessions
     set status = 'closed', closed_at = now()
   where id = p_session_id and restaurant_id = p_restaurant_id;

  return v_count;
end;
$$;

revoke all on function force_close_session(uuid, uuid, uuid) from public;
grant execute on function force_close_session(uuid, uuid, uuid) to service_role;


-- ── Bulk: reject a table activation ───────────────────────────────────────────
--
-- The compare-and-swap on `status = 'pending_activation'` is the original idiom
-- this file's idempotency design is modelled on: only the call that actually
-- closed the session releases anything, so a double-tap cannot release twice.
--
-- No payment can exist on a pending_activation session, so the gate is free
-- insurance rather than a behaviour change. The unserved-units formula likewise
-- reduces to "all of them" here, since nothing can have been served yet — it is
-- used anyway so all four paths compute cancellable units the same way.

create or replace function reject_table_activation(
  p_restaurant_id   uuid,
  p_session_id      uuid,
  p_notification_id uuid,
  p_by              uuid
)
returns integer
language plpgsql
as $$
declare
  v_closed uuid;
  v_item   record;
  v_count  integer := 0;
begin
  if p_session_id is not null then
    update sessions
       set status = 'closed', closed_at = now()
     where id = p_session_id
       and restaurant_id = p_restaurant_id
       and status = 'pending_activation'
    returning id into v_closed;

    if v_closed is not null then
      perform assert_session_unpaid(p_session_id);

      for v_item in
        select soi.id, (soi.quantity - soi.cancelled_quantity - soi.served_quantity) as remaining
          from session_order_items soi
          join session_orders so on so.id = soi.order_id
         where so.session_id = p_session_id
           and so.restaurant_id = p_restaurant_id
           and soi.quantity - soi.cancelled_quantity - soi.served_quantity > 0
         for update of soi
      loop
        insert into session_order_item_cancellations
          (order_item_id, restaurant_id, qty, reason, cancelled_by)
        values
          (v_item.id, p_restaurant_id, v_item.remaining, 'order_rejected', p_by);
        v_count := v_count + 1;
      end loop;

      update session_orders
         set status = 'cancelled'
       where session_id = p_session_id
         and restaurant_id = p_restaurant_id
         and status <> 'cancelled';
    end if;
  end if;

  update notifications
     set status = 'resolved', acknowledged_at = now()
   where id = p_notification_id
     and restaurant_id = p_restaurant_id;

  return v_count;
end;
$$;

revoke all on function reject_table_activation(uuid, uuid, uuid, uuid) from public;
grant execute on function reject_table_activation(uuid, uuid, uuid, uuid) to service_role;


notify pgrst, 'reload schema';
