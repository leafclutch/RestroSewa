-- =============================================================
-- IMPORT AN EXISTING CUSTOMER CREDIT (debt that predates HRestroSewa)
--
-- Restaurants arrive with a paper book of who owes what. Those debts are real
-- and must be chaseable here — but they are NOT sales this system made.
--
-- SO THIS DELIBERATELY WRITES NO `credits` BILL AND NO `payments` ROW.
-- The whole thing is one `credit_customers.opening_balance`, which already
-- exists (added with the four-balance finance work for exactly this "the debt is
-- real but its bills don't exist here" case). That single choice buys:
--
--   • Sales / revenue figures are untouched — counting a pre-system debt as
--     today's takings would inflate reported revenue, which is the one thing an
--     owner must be able to trust.
--   • `finance_report`'s credit-to-us legs already read `opening_balance`, dated
--     by the account's `created_at`, so the debt appears on the day it was
--     actually incurred — not the day it was typed in.
--   • `finance_transactions` already emits a `customer_opening` movement for it,
--     so the ledger explains why the receivable jumped.
--   • The account shows up in admin Finance AND the staff Credits screen, and
--     repayments go through `record_credit_payment` unchanged — because it is an
--     ordinary credit account, not a parallel "imported" one.
--
-- The alternative — synthesising a bill so it looks like a normal credit — was
-- rejected: it would put money into Sales that this restaurant never took here.
-- =============================================================

create or replace function import_credit_customer(
  p_restaurant_id uuid,
  p_name          text,
  p_phone         text,
  p_amount        numeric,
  p_created_at    timestamptz,
  p_notes         text,
  p_created_by    uuid
) returns credit_customers
language plpgsql
as $$
declare
  v_cust credit_customers;
  v_when timestamptz := coalesce(p_created_at, now());
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  -- A future date would park the debt outside every report until that day
  -- arrives, which looks exactly like the import having silently failed.
  if v_when > now() then
    raise exception 'FUTURE_DATE';
  end if;

  -- Reuse the ordinary account lookup: a customer who ALREADY has an account
  -- here (phone first, then name) must not be given a second Credit ID just
  -- because some of their debt predates the system.
  v_cust := find_or_create_credit_customer(p_restaurant_id, p_name, p_phone, p_created_by);

  -- Re-read under a lock; two admins importing the same paper book at once must
  -- not both add the balance from the same starting figure.
  select * into v_cust
    from credit_customers
   where id = v_cust.id
     for update;

  -- The double-import guard. An account may legitimately carry BOTH real bills
  -- raised here and older paper debt, so the test is specifically "has an
  -- opening balance already", not "has any balance".
  if v_cust.opening_balance > 0 then
    raise exception 'ALREADY_IMPORTED';
  end if;

  update credit_customers
     set opening_balance = p_amount,
         balance         = balance + p_amount,
         -- Backdate so the debt lands on the day it was incurred. `least` keeps
         -- an existing account from being pushed FORWARD if it was created here
         -- before the imported debt was dated.
         created_at      = least(created_at, v_when),
         notes           = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes),
         is_active       = true
   where id = v_cust.id
  returning * into v_cust;

  return v_cust;
end;
$$;

revoke all on function import_credit_customer(uuid, text, text, numeric, timestamptz, text, uuid) from public;
grant execute on function import_credit_customer(uuid, text, text, numeric, timestamptz, text, uuid) to service_role;
