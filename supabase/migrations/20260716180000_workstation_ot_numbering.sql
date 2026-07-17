-- Per-workstation Order-Ticket numbering: each workstation (Kitchen→KOT, Bar→BOT, …) keeps
-- its OWN independent running number, separate from every other workstation and from the
-- bill number. Mirrors the bill-number design (see 20260716140000): a counter on the parent
-- row + a stamped value that lives with the record forever.
--
-- The prefix reuses the existing `workstations.ticket_code` (the same code that names the
-- "Print KOT" button and the ticket header). Only the counter is new here.
alter table workstations add column if not exists ot_next integer;  -- NULL = OT numbering off

-- One OT number per (session, workstation), claimed at the FIRST item routed to that
-- workstation, kept forever so reprints and history keep the original number. The PK makes
-- it exactly-once per session+workstation.
create table if not exists workstation_ticket_numbers (
  session_id     uuid    not null references sessions(id)      on delete cascade,
  workstation_id uuid    not null references workstations(id)  on delete cascade,
  ot_number      integer not null,
  prefix         text,   -- effective prefix at stamp time (workstations.ticket_code)
  created_at     timestamptz not null default now(),
  primary key (session_id, workstation_id)
);

-- Claim-and-increment for the item's workstation, locking the workstation row so two items
-- for the same station can't double-claim or leave a gap. Independent per workstation: the
-- lock is on that station's row only, so Kitchen and Bar advance separately. Does nothing
-- when the item has no station or that station's numbering is off (ot_next IS NULL).
create or replace function assign_workstation_ot_number() returns trigger
language plpgsql as $$
declare v_session uuid; v_next integer; v_prefix text;
begin
  if new.workstation_id is null then return new; end if;

  select session_id into v_session from session_orders where id = new.order_id;
  if v_session is null then return new; end if;

  select ot_next, ticket_code into v_next, v_prefix
    from workstations where id = new.workstation_id for update;

  if v_next is not null
     and not exists (
       select 1 from workstation_ticket_numbers
        where session_id = v_session and workstation_id = new.workstation_id
     ) then
    update workstations set ot_next = v_next + 1 where id = new.workstation_id;
    insert into workstation_ticket_numbers (session_id, workstation_id, ot_number, prefix)
      values (v_session, new.workstation_id, v_next, v_prefix);
  end if;

  return new;
end $$;

drop trigger if exists trg_assign_workstation_ot on session_order_items;
create trigger trg_assign_workstation_ot
  before insert on session_order_items
  for each row execute function assign_workstation_ot_number();
