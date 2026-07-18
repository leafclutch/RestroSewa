-- Separate KOT (Kitchen Order Ticket) from BOT (Bar Order Ticket).
--
-- A workstation used to be only a free-form name, and Kitchen-vs-Bar was inferred
-- purely from which staff were assigned to it. That is enough for routing an order
-- to the person who makes it, but not for PRINTING: a ticket has to know whether the
-- items on it belong on a kitchen docket or a bar docket, and a printer has no
-- assignment to read. So a station now declares its own kind.
--
-- Defaults to 'kitchen' so every existing station keeps working unchanged; a
-- restaurant marks its bar station 'bar' from Admin -> Workstations.
alter table workstations
  add column if not exists kind text not null default 'kitchen';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workstations_kind_check'
  ) then
    alter table workstations
      add constraint workstations_kind_check check (kind in ('kitchen', 'bar'));
  end if;
end $$;
