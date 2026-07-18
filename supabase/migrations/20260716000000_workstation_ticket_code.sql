-- Every workstation prints its OWN order ticket, named by a short code (Kitchen→KOT,
-- Bar→BOT, Bakery→BAOT, Grill→GOT, Coffee→COT, …). The code is derived from the name
-- by default (first letter + "OT"); this column stores an admin override for the cases
-- where the auto code collides (Bar→BOT and Bakery→BOT both want "B") — e.g. Bakery→BAOT.
-- Null means "use the derived default".
alter table workstations add column if not exists ticket_code text;
