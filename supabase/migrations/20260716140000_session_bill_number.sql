-- Move the sequential bill/order number from the PAYMENT to the ORDER (session), so the
-- SAME number is available the moment the first item is ordered — and is therefore shared
-- by the KOT, the BOT, every other workstation ticket, and the final customer bill. One
-- number per order, reused across every document in that order's lifecycle.
alter table sessions add column if not exists bill_number integer;

-- Claimed lazily at the FIRST order of a session (not at session creation), so an empty
-- table or a bare QR scan never burns a number. Locks the session row so two orders placed
-- at the same instant can't both claim; the first claims, the rest see the number already set.
-- When the restaurant hasn't configured numbering (bill_number_next IS NULL) nothing is
-- claimed and the session keeps a NULL number (legacy derived refs on its documents).
create or replace function assign_session_bill_number() returns trigger
language plpgsql as $$
declare claimed integer; rest_id uuid; existing integer;
begin
  select bill_number, restaurant_id into existing, rest_id
    from sessions where id = new.session_id for update;
  if existing is null then
    update restaurants
       set bill_number_next = bill_number_next + 1
     where id = rest_id and bill_number_next is not null
    returning bill_number_next - 1 into claimed;
    if claimed is not null then
      update sessions set bill_number = claimed where id = new.session_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_session_bill_number on session_orders;
create trigger trg_assign_session_bill_number
  before insert on session_orders
  for each row execute function assign_session_bill_number();

-- Retire payment-time numbering: the number is now the session's, claimed at the first
-- order, so a payment must NOT consume a second one. (payments.bill_number stays for the
-- bills already stamped under the old model — history is read back from it as a fallback.)
drop trigger if exists trg_assign_bill_number on payments;
