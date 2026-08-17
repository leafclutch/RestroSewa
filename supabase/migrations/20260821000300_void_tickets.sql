-- =============================================================
-- VOID TICKETS — paper for the kitchen when units are cancelled
--
-- `order_tickets.kind` has carried `check (kind in ('order', 'void'))` since the
-- table was created, with the comment "Present from day one so a future
-- cancellation ticket needs no migration." Nothing has ever written 'void'. This
-- is that migration.
--
-- WHY PAPER AND NOT JUST THE PUSH.
-- Cancelling already sends a "stop cooking" push to the affected stations, but a
-- push is a notification on somebody's phone — it is not a record on the rail next
-- to the docket the cook is working from. Partial cancellation makes that gap
-- worse: "Chicken Momo ×3" is on the rail, one is cancelled, and the printed
-- ticket still says 3 with no way for the line to know otherwise.
--
-- THE TICKET IS A DELTA, NOT A REPLACEMENT.
-- An item belongs to ONE ticket for life — that is what makes reprints stable and
-- de-duplication work — so the original KOT is never reissued or amended. A void
-- ticket names only the units that came off.
--
-- IT BURNS AN OT NUMBER, deliberately. The same argument the original made for
-- never rewinding a counter on cancellation ("the ticket is already in the
-- kitchen's hand") applies to this ticket too: it is paper, it exists, and the
-- station's sequence must account for it.
-- =============================================================

create or replace function generate_void_ticket(
  p_session_id       uuid,
  p_workstation_id   uuid,
  p_cancellation_ids uuid[],
  p_printed_by       uuid default null
) returns order_tickets
language plpgsql
as $$
declare
  v_restaurant uuid;
  v_next       integer;
  v_number     integer;
  v_prefix     text;
  v_ws_name    text;
  v_ids        uuid[];
  v_ticket     order_tickets;
begin
  -- Same lock order as generate_order_ticket — session, then workstation. A
  -- consistent order across the two functions is what rules out a deadlock
  -- between a print and a void happening at the same moment.
  select restaurant_id into v_restaurant
    from sessions where id = p_session_id for update;
  if v_restaurant is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if p_workstation_id is not null then
    select ot_next, ticket_code, name into v_next, v_prefix, v_ws_name
      from workstations where id = p_workstation_id for update;
  end if;

  -- Eligible events: the client's list, intersected with a server-side
  -- re-derivation of session ownership and of the station. The client cannot void
  -- another restaurant's cancellation, cannot move a Bar cancellation onto the
  -- KOT, and cannot re-void an event that already has its ticket.
  --
  -- `soi.ticket_id is not null` is the point of the whole feature: a unit that was
  -- never printed does not need un-printing, so cancelling before the KOT goes out
  -- produces no paper at all.
  select array_agg(ev.id order by ev.cancelled_at)
    into v_ids
    from session_order_item_cancellations ev
    join session_order_items soi on soi.id = ev.order_item_id
    join session_orders so       on so.id = soi.order_id
   where ev.id = any(p_cancellation_ids)
     and so.session_id = p_session_id
     and soi.workstation_id is not distinct from p_workstation_id
     and soi.ticket_id is not null
     and ev.void_ticket_id is null;

  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'NO_VOID_ITEMS';
  end if;

  -- Numbering off (ot_next null) still issues the ticket and still stamps the
  -- events: de-duplication must never depend on numbering being switched on.
  if v_next is not null then
    v_number := v_next;
    update workstations set ot_next = v_next + 1 where id = p_workstation_id;
  end if;

  insert into order_tickets (
    restaurant_id, session_id, workstation_id, workstation_name,
    kind, ot_number, prefix, printed_by
  )
  values (
    v_restaurant, p_session_id, p_workstation_id, v_ws_name,
    'void', v_number, v_prefix, p_printed_by
  )
  returning * into v_ticket;

  -- Stamped back onto the EVENT, not onto the item: an item can be cancelled in
  -- several slices, and each slice gets its own paper. This is also what makes a
  -- void ticket reprintable — the same hole `session_order_items.ticket_id` was
  -- invented to close for the original.
  update session_order_item_cancellations
     set void_ticket_id = v_ticket.id
   where id = any(v_ids);

  return v_ticket;
end $$;

revoke all on function generate_void_ticket(uuid, uuid, uuid[], uuid) from public;
grant execute on function generate_void_ticket(uuid, uuid, uuid[], uuid) to service_role;

create index if not exists session_order_item_cancellations_void_idx
  on session_order_item_cancellations (void_ticket_id)
  where void_ticket_id is not null;


notify pgrst, 'reload schema';
