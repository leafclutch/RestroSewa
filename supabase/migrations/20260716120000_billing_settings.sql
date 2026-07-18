-- Per-restaurant billing settings: a resettable sequential bill number.
--
-- `restaurants.bill_number_next` holds the number the NEXT bill will use. NULL means the
-- restaurant hasn't configured custom numbering, so bills keep the legacy derived ref.
-- Each finalized bill (a `payments` row) is stamped with its own number by a trigger, so the
-- number lives with the bill forever — changing the sequence later never rewrites history.
alter table payments     add column if not exists bill_number       integer;
alter table restaurants  add column if not exists bill_number_next  integer;

-- Claim-and-increment in ONE statement so two bills closed at the same instant can never get
-- the same number: the UPDATE takes a row lock on the restaurant, returns the pre-increment
-- value for this bill, and leaves the counter pointing at the next one. When numbering isn't
-- configured (bill_number_next IS NULL) the UPDATE matches nothing and bill_number stays NULL.
create or replace function assign_bill_number() returns trigger
language plpgsql as $$
declare claimed integer;
begin
  if new.bill_number is null then
    update restaurants
       set bill_number_next = bill_number_next + 1
     where id = new.restaurant_id
       and bill_number_next is not null
    returning bill_number_next - 1 into claimed;
    new.bill_number := claimed;
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_bill_number on payments;
create trigger trg_assign_bill_number
  before insert on payments
  for each row execute function assign_bill_number();
