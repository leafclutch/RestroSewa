-- Order Tickets (OT): print only what has not already been sent to a station.
--
-- THE BUG. Printing an OT for a table printed EVERY live item on it, every time.
-- Order Momo + Coke, print, add Fried Rice, print again → the kitchen received Momo
-- and Fried Rice, and cooked the Momo twice. Nothing anywhere recorded that an item
-- had been sent, and printing was purely client-side (window.print()), so there was
-- no moment at which it COULD be recorded.
--
-- THE MODEL. An item belongs to exactly one ticket for its lifetime. Pressing Print
-- issues the next number for that station and stamps precisely the items on the paper.
--
--     new item (ticket_id null)  →  Print  →  ticket issued, ticket_id stamped
--                                              → never selected again
--
-- WHAT THIS REPLACES. `workstation_ticket_numbers` (20260716180000) stamped ONE number
-- per (session, workstation) FOREVER, claimed by a BEFORE INSERT trigger the moment an
-- item was added. A table's KOT number was therefore fixed for the life of the table and
-- existed whether or not anything was ever printed — the opposite premise to a ticket
-- being a batch of paper. That model is replaced here, not extended.

-- ── The ticket ────────────────────────────────────────────────────────────────
-- One row per ticket actually generated.
create table if not exists order_tickets (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id)     on delete cascade,
  session_id       uuid not null references sessions(id)        on delete cascade,
  -- Nullable so a ticket survives its station being deleted, and so items with no
  -- station at all (the "General"/OT bucket) can still be ticketed and de-duplicated.
  workstation_id   uuid references workstations(id)             on delete set null,
  workstation_name text,        -- snapshot; what the header printed
  -- Present from day one so a future cancellation ticket needs no migration.
  kind             text not null default 'order' check (kind in ('order', 'void')),
  ot_number        integer,     -- NULL = that station's numbering is switched off
  prefix           text,        -- effective workstations.ticket_code at issue time
  printed_at       timestamptz not null default now(),
  printed_by       uuid references restaurant_users(id)         on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists order_tickets_session_idx on order_tickets(session_id);
create index if not exists order_tickets_workstation_idx on order_tickets(workstation_id);

-- Two tickets from one station can never share a number. This is the invariant that
-- would catch a double-issue bug; see the guard added to updateWorkstationNumbering,
-- which stops an admin rewinding a counter into an already-issued number.
create unique index if not exists order_tickets_number_uq
  on order_tickets(workstation_id, ot_number) where ot_number is not null;

alter table order_tickets enable row level security;  -- no policies: service_role only
grant select, insert, update, delete on order_tickets to service_role;

-- ── The stamp ─────────────────────────────────────────────────────────────────
-- A nullable FK, deliberately NOT a boolean flag. It costs the same to store and buys
-- the audit trail ("which ticket did this item go out on"), exact reprints, and the
-- per-ticket item list — all without a second table.
alter table session_order_items
  add column if not exists ticket_id uuid references order_tickets(id) on delete set null;

-- The hot path is "what has this order not sent yet", so index exactly that.
create index if not exists session_order_items_unticketed_idx
  on session_order_items(order_id) where ticket_id is null and cancelled_at is null;

-- ── Issue a ticket ────────────────────────────────────────────────────────────
-- All of it in one transaction: claiming the number, creating the ticket and stamping
-- the items either all happen or none do. That is what makes two cashiers pressing
-- Print at the same instant safe — one gets the items, the other gets NO_NEW_ITEMS.
create or replace function generate_order_ticket(
  p_session_id     uuid,
  p_workstation_id uuid,
  p_item_ids       uuid[],
  p_printed_by     uuid default null
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
  -- Lock the SESSION first. This serialises every print for this table, and is the
  -- lock that still applies when the items have no workstation at all.
  select restaurant_id into v_restaurant
    from sessions where id = p_session_id for update;
  if v_restaurant is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  -- Then the station, which serialises its counter across DIFFERENT sessions. Always
  -- session-before-workstation: a consistent lock order is what rules out a deadlock.
  if p_workstation_id is not null then
    select ot_next, ticket_code, name into v_next, v_prefix, v_ws_name
      from workstations where id = p_workstation_id for update;
  end if;

  -- Eligible items: the client's list, intersected with a server-side re-derivation of
  -- the station and of session ownership. The client cannot strand a Bar item on the
  -- KOT, cannot reach another restaurant's session, and cannot re-send something that
  -- is already ticketed or has been cancelled.
  select array_agg(soi.id order by soi.created_at)
    into v_ids
    from session_order_items soi
    join session_orders so on so.id = soi.order_id
   where soi.id = any(p_item_ids)
     and so.session_id = p_session_id
     and soi.workstation_id is not distinct from p_workstation_id
     and soi.ticket_id is null
     and soi.cancelled_at is null;

  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'NO_NEW_ITEMS';
  end if;

  -- ot_next NULL means this station's numbering is switched off. The ticket is still
  -- issued and the items are still stamped — DE-DUPLICATION MUST NOT DEPEND ON
  -- NUMBERING BEING ON. The printed number line just falls back to the bill number.
  if v_next is not null then
    v_number := v_next;
    update workstations set ot_next = v_next + 1 where id = p_workstation_id;
  end if;

  insert into order_tickets (
    restaurant_id, session_id, workstation_id, workstation_name,
    ot_number, prefix, printed_by
  )
  values (
    v_restaurant, p_session_id, p_workstation_id, v_ws_name,
    v_number, v_prefix, p_printed_by
  )
  returning * into v_ticket;

  update session_order_items set ticket_id = v_ticket.id where id = any(v_ids);

  return v_ticket;
end $$;

revoke all on function generate_order_ticket(uuid, uuid, uuid[], uuid) from public;
grant execute on function generate_order_ticket(uuid, uuid, uuid[], uuid) to service_role;

-- ── Carry the old numbers forward ─────────────────────────────────────────────
-- Each old (session, workstation) row becomes one ticket, keeping its number so the
-- station's sequence continues rather than restarting.
insert into order_tickets (
  restaurant_id, session_id, workstation_id, workstation_name,
  ot_number, prefix, printed_at, created_at
)
select s.restaurant_id, wtn.session_id, wtn.workstation_id, w.name,
       wtn.ot_number, wtn.prefix, wtn.created_at, wtn.created_at
  from workstation_ticket_numbers wtn
  join sessions s     on s.id = wtn.session_id
  left join workstations w on w.id = wtn.workstation_id
 where not exists (
   select 1 from order_tickets ot
    where ot.workstation_id = wtn.workstation_id and ot.ot_number = wtn.ot_number
 );

-- Attach items to those tickets for CLOSED sessions only — archival history.
--
-- Sessions still OPEN are deliberately left unstamped, so the first OT printed after
-- this deploys reprints what is already on the table. Those old rows were created when
-- an item was ADDED, not when anything was printed, so trusting them would mark
-- genuinely un-printed food as sent and it would never reach the kitchen. One duplicate
-- ticket during the changeover is the cheaper mistake.
update session_order_items soi
   set ticket_id = ot.id
  from session_orders so
  join sessions s   on s.id = so.session_id
  join order_tickets ot on ot.session_id = s.id
 where soi.order_id = so.id
   and s.status = 'closed'
   and soi.workstation_id is not distinct from ot.workstation_id
   and soi.ticket_id is null;

drop table if exists workstation_ticket_numbers;

-- ── Retire the old numbering machinery ────────────────────────────────────────
-- Numbering now happens at PRINT time, not at item-insert time.
drop trigger if exists trg_assign_workstation_ot on session_order_items;
drop function if exists assign_workstation_ot_number();

-- A number is now claimed only when paper physically exists, so it can never be given
-- back. Cancelling a ticketed item must NOT rewind the station counter — the ticket is
-- already in the kitchen's hand. Cancelling an un-ticketed item needs no rollback
-- because nothing was ever claimed. So the OT half of this trigger goes; the
-- bill-number half (an order emptied by cancellation releases its bill number) stays.
create or replace function release_ticket_numbers_on_item_cancel() returns trigger
language plpgsql as $$
declare v_session uuid;
begin
  if new.cancelled_at is null or old.cancelled_at is not null then return new; end if;

  select session_id into v_session from session_orders where id = new.order_id;
  if v_session is null then return new; end if;

  -- The bill number: release it if the WHOLE order is now empty (every item cancelled).
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

drop function if exists release_workstation_ot_number(uuid, uuid);
