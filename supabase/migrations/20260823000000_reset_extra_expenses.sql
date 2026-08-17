-- =============================================================
-- RESET MUST CLEAR EXTRA EXPENSES AND SAVINGS
--
-- THE BUG
-- "Reset Finance & Sales Data" left every extra expense and every saving behind.
-- `reset_restaurant_finance` deletes fifteen tables by name; `extra_expenses` and
-- `saving_titles` are not among them, and their only other route to deletion is
-- `restaurant_id → restaurants on delete cascade` — which never fires, because the
-- reset deliberately keeps the restaurant row. Both tables landed a month after the
-- function was written and the delete list was never revisited. So rent, electricity,
-- fuel, marketing and every saving movement survived a reset that claims to clear the
-- books, and the finance report kept summing money from before it.
--
-- `extra_expenses` was the ONLY genuinely-trading table with neither an explicit
-- delete nor a covering cascade. Everything else the reset omits is either setup data
-- kept on purpose, or is cleared by a cascade rooted in a table it does delete
-- (`room_advances` via `room_stays`; `order_tickets`, `session_transfers`,
-- `workstation_ticket_numbers` via `sessions`; `session_order_item_cancellations`
-- via `session_order_items`).
--
-- THE SHAPE OF THE FIX
-- The pots are KEPT and their balances folded onto them, because that is what this
-- function already does for every account it touches — `products.opening_stock`,
-- `vendors.opening_credit`, `credit_customers.opening_balance`. Wiping the pots would
-- make money still sitting in the safe disappear from the books.
--
-- A second, LATENT bug surfaced in the same audit and is fixed here too: see
-- `delete_restaurant_cascade` below.
--
-- ⚠️ All three are `create or replace`, never `drop function`. The ACLs from
-- 20260713300000 (revoke from public, grant to service_role) survive a replace and do
-- NOT survive a drop, and no signature changes here.
-- =============================================================


-- ── 1. The reset ──────────────────────────────────────────────────────────────

create or replace function reset_restaurant_finance(p_restaurant_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_before jsonb;
begin
  perform 1 from restaurants where id = p_restaurant_id;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  v_before := restaurant_data_summary(p_restaurant_id);

  update products p
     set opening_stock = s.closing
    from stock_report(p_restaurant_id, '-infinity'::timestamptz, 'infinity'::timestamptz) s
   where s.product_id = p.id
     and p.restaurant_id = p_restaurant_id;

  update vendors
     set opening_credit = credit_balance
   where restaurant_id = p_restaurant_id;

  -- credit_customers.balance is already the outstanding figure and is not
  -- cleared below — but the bills that PROVE it are, so it now also has to be
  -- planted as the account's opening term or the derived balance loses it.
  update credit_customers
     set opening_balance = balance
   where restaurant_id = p_restaurant_id;

  -- Savings: the POT survives, its entries do not — the same shape as products,
  -- vendors and customers above. A pot's balance is
  -- `opening_amount + Σ its extra_expenses rows` (20260817000000), so folding those
  -- rows into the opening term leaves the balance identical across the reset. It
  -- moves no cash and writes no ledger row, exactly as an opening figure never does.
  -- Money physically set aside in the safe therefore stays on the books instead of
  -- vanishing with its evidence.
  --
  -- Must run BEFORE the delete below, while the rows are still there to sum.
  -- Idempotent: a second reset sums an empty set.
  --
  -- ⚠️ `greatest(…, 0)` is load-bearing, not defensive noise.
  -- `saving_titles_opening_amount_check` (20260817000000) forbids a negative opening,
  -- and a pot CAN be negative today: the balance guard in app/actions/security.ts runs
  -- only `if (wasWithdrawal)`, so editing a DEPOSIT downward is unchecked. Without the
  -- clamp, one such row anywhere in the restaurant aborts the ENTIRE reset with a
  -- constraint violation the super admin can neither see nor fix. The fold is
  -- otherwise exactly balance-preserving; this is the one case where it is not.
  update saving_titles t
     set opening_amount = greatest(
           t.opening_amount + coalesce((
             select sum(e.amount)
               from extra_expenses e
              where e.saving_title_id = t.id
                and e.restaurant_id   = p_restaurant_id
           ), 0), 0)
   where t.restaurant_id = p_restaurant_id;

  delete from notifications       where restaurant_id = p_restaurant_id;
  delete from credit_payments     where restaurant_id = p_restaurant_id;
  delete from credits             where restaurant_id = p_restaurant_id;
  delete from payments            where restaurant_id = p_restaurant_id;
  delete from session_order_items
        where order_id in (select id from session_orders where restaurant_id = p_restaurant_id);
  delete from session_orders      where restaurant_id = p_restaurant_id;
  delete from sessions            where restaurant_id = p_restaurant_id;
  delete from room_charges        where restaurant_id = p_restaurant_id;
  delete from room_stays          where restaurant_id = p_restaurant_id;
  delete from purchase_items      where restaurant_id = p_restaurant_id;
  delete from purchases           where restaurant_id = p_restaurant_id;
  delete from vendor_payments     where restaurant_id = p_restaurant_id;
  delete from stock_adjustments   where restaurant_id = p_restaurant_id;
  delete from salary_payments     where restaurant_id = p_restaurant_id;
  -- THE BUG THIS MIGRATION EXISTS FOR. Rent, electricity, fuel, internet — and every
  -- saving deposit and withdrawal — used to survive a reset entirely. `extra_expenses`
  -- reaches `restaurants` only by `on delete cascade`, and the reset deliberately does
  -- NOT delete the restaurant row, so that cascade never fired. The table was created a
  -- month after this function and the delete list was never revisited.
  --
  -- `saving_titles` is deliberately NOT deleted: a pot is an ACCOUNT, like a vendor or
  -- a credit customer, and its balance was just folded onto it above. A pot closed under
  -- 20260822000000 ends up with no rows and a zero opening, so the Saving screen will
  -- then offer to delete it outright — the reset tidies it rather than stranding it.
  delete from extra_expenses      where restaurant_id = p_restaurant_id;
  delete from finance_openings    where restaurant_id = p_restaurant_id;

  update rooms
     set status = 'available'
   where restaurant_id = p_restaurant_id
     and status <> 'available';

  return v_before;
end;
$$;


-- ── 2. The full delete ────────────────────────────────────────────────────────

create or replace function delete_restaurant_cascade(p_restaurant_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_out jsonb;
begin
  select jsonb_build_object(
           'name',     r.name,
           'slug',     r.slug,
           'logo_url', r.logo_url,
           'summary',  restaurant_data_summary(p_restaurant_id),
           'auth_user_ids', (
             select coalesce(jsonb_agg(ru.auth_user_id), '[]'::jsonb)
               from restaurant_users ru
              where ru.restaurant_id = p_restaurant_id
                and ru.auth_user_id is not null
           )
         )
    into v_out
    from restaurants r
   where r.id = p_restaurant_id;

  if v_out is null then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  -- Transactions
  delete from notifications      where restaurant_id = p_restaurant_id;
  delete from credit_payments    where restaurant_id = p_restaurant_id;
  delete from credits            where restaurant_id = p_restaurant_id;
  delete from payments           where restaurant_id = p_restaurant_id;
  delete from session_order_items
        where order_id in (select id from session_orders where restaurant_id = p_restaurant_id);
  delete from session_orders     where restaurant_id = p_restaurant_id;
  delete from sessions           where restaurant_id = p_restaurant_id;

  -- Rooms: stays reference rooms with RESTRICT, rooms reference room_types with
  -- RESTRICT. Strictly bottom-up.
  delete from room_charges       where restaurant_id = p_restaurant_id;
  delete from room_stays         where restaurant_id = p_restaurant_id;
  delete from rooms              where restaurant_id = p_restaurant_id;
  delete from room_types         where restaurant_id = p_restaurant_id;

  -- Stock & suppliers: purchase_items → products is RESTRICT, purchases →
  -- vendors is RESTRICT.
  delete from purchase_items     where restaurant_id = p_restaurant_id;
  delete from purchases          where restaurant_id = p_restaurant_id;
  delete from vendor_payments    where restaurant_id = p_restaurant_id;
  delete from vendors            where restaurant_id = p_restaurant_id;
  delete from stock_adjustments  where restaurant_id = p_restaurant_id;

  -- Menu: recipe links and variants hang off menu_items; menu_items → categories
  -- and → workstations are both RESTRICT.
  delete from menu_item_products where restaurant_id = p_restaurant_id;
  delete from menu_item_addons
        where menu_item_id in (select id from menu_items where restaurant_id = p_restaurant_id);
  delete from menu_item_variants
        where menu_item_id in (select id from menu_items where restaurant_id = p_restaurant_id);
  delete from menu_items         where restaurant_id = p_restaurant_id;
  delete from menu_categories    where restaurant_id = p_restaurant_id;
  delete from products           where restaurant_id = p_restaurant_id;

  -- Credit accounts: credits/credit_payments reference these with RESTRICT and
  -- are already gone.
  delete from credit_customers   where restaurant_id = p_restaurant_id;

  -- Employment
  delete from salary_payments    where restaurant_id = p_restaurant_id;
  delete from staff_salaries     where restaurant_id = p_restaurant_id;
  delete from staff_payroll      where restaurant_id = p_restaurant_id;

  -- Staff scoping join tables, then the floor plan they scope to.
  delete from restaurant_user_tables
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);
  delete from restaurant_user_table_groups
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);
  delete from restaurant_user_workstations
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);
  delete from restaurant_user_rooms
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);
  delete from restaurant_user_room_types
        where restaurant_user_id in (select id from restaurant_users where restaurant_id = p_restaurant_id);

  delete from restaurant_tables  where restaurant_id = p_restaurant_id;
  delete from table_groups       where restaurant_id = p_restaurant_id;
  delete from workstations       where restaurant_id = p_restaurant_id;
  -- Extra expenses & savings, spelled out for the reason the header above gives.
  -- `extra_expenses.saving_title_id → saving_titles` is ON DELETE RESTRICT
  -- (20260814000000), and BOTH tables reach `restaurants` only by cascade — so
  -- `delete from restaurants` below fires two cascades whose relative order Postgres
  -- does not promise, and the wrong order aborts the whole delete.
  --
  -- It happens to work today only because RI trigger names sort as STRINGS over
  -- constraint OIDs and `extra_expenses`' FK was created first. That breaks the moment
  -- the OIDs straddle a digit-length boundary — i.e. on any database rebuilt from
  -- scratch, which is exactly what scripts/clone-db.mjs produces. "It would work until
  -- the day it didn't", verbatim.
  delete from extra_expenses     where restaurant_id = p_restaurant_id;
  delete from saving_titles      where restaurant_id = p_restaurant_id;

  delete from finance_openings   where restaurant_id = p_restaurant_id;

  delete from restaurant_users   where restaurant_id = p_restaurant_id;
  delete from restaurants        where id = p_restaurant_id;

  return v_out;
end;
$$;


-- ── 3. What the confirmation dialogs are built from ──────────────────────────
--
-- Both dialogs count the damage live. Until now they counted nothing about
-- expenses or savings, so a super admin was never told that either existed.

create or replace function restaurant_data_summary(p_restaurant_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'restaurant', (
      select jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug,
                                'logo_url', r.logo_url)
        from restaurants r where r.id = p_restaurant_id
    ),

    -- Cleared by BOTH operations.
    'financial', jsonb_build_object(
      'sessions',        (select count(*) from sessions          where restaurant_id = p_restaurant_id),
      'orders',          (select count(*) from session_orders    where restaurant_id = p_restaurant_id),
      'order_items',     (select count(*) from session_order_items soi
                            join session_orders so on so.id = soi.order_id
                           where so.restaurant_id = p_restaurant_id),
      'payments',        (select count(*) from payments          where restaurant_id = p_restaurant_id),
      'revenue',         (select coalesce(sum(amount), 0) from payments where restaurant_id = p_restaurant_id),
      'credits',         (select count(*) from credits           where restaurant_id = p_restaurant_id),
      'credit_payments', (select count(*) from credit_payments   where restaurant_id = p_restaurant_id),
      'purchases',       (select count(*) from purchases         where restaurant_id = p_restaurant_id),
      'vendor_payments', (select count(*) from vendor_payments   where restaurant_id = p_restaurant_id),
      'salary_payments', (select count(*) from salary_payments   where restaurant_id = p_restaurant_id),
      'stock_moves',     (select count(*) from stock_adjustments where restaurant_id = p_restaurant_id),
      -- Cleared by both operations since 20260823000000. Split so the dialog can say
      -- "12 expenses · ₹38,000" separately from the saving movements, which are the
      -- same table but are money set ASIDE rather than spent.
      'extra_expenses',       (select count(*) from extra_expenses
                                where restaurant_id = p_restaurant_id and category <> 'saving'),
      'extra_expenses_total', (select coalesce(sum(amount),0) from extra_expenses
                                where restaurant_id = p_restaurant_id and category <> 'saving'),
      'saving_entries',       (select count(*) from extra_expenses
                                where restaurant_id = p_restaurant_id and category = 'saving'),
      'room_stays',      (select count(*) from room_stays        where restaurant_id = p_restaurant_id),
      'notifications',   (select count(*) from notifications     where restaurant_id = p_restaurant_id),
      'has_opening',     (select exists (select 1 from finance_openings where restaurant_id = p_restaurant_id))
    ),

    -- Money that OUTLIVES a finance reset, because it is carried forward onto
    -- the accounts rather than forgiven. Shown so the super admin can see that
    -- it survives — and, on a full delete, that it does not.
    'carried', jsonb_build_object(
      'customer_debt',   (select coalesce(sum(balance), 0) from credit_customers
                           where restaurant_id = p_restaurant_id and balance > 0),
      'debtors',         (select count(*) from credit_customers
                           where restaurant_id = p_restaurant_id and balance > 0),
      'vendor_payable',  (select coalesce(sum(credit_balance), 0) from vendors
                           where restaurant_id = p_restaurant_id and credit_balance > 0),
      'creditors',       (select count(*) from vendors
                           where restaurant_id = p_restaurant_id and credit_balance > 0),
      -- What the savings pots hold. ⚠️ The two-term shape is not optional: a pot's
      -- balance is `opening_amount + Σ its rows` (20260817000000), and this must match
      -- app/actions/expenses.ts exactly or the danger-zone dialog and the Expenses
      -- screen would disagree about how much is set aside. Counts ALL pots, closed
      -- ones included, as that code does.
      'savings_held',    (select coalesce(sum(opening_amount),0) from saving_titles
                           where restaurant_id = p_restaurant_id)
                       + (select coalesce(sum(amount),0) from extra_expenses
                           where restaurant_id = p_restaurant_id and category = 'saving'),
      'saving_pots',     (select count(*) from saving_titles
                           where restaurant_id = p_restaurant_id and closed_at is null)
    ),

    -- Survives a finance reset. Destroyed by a full delete.
    'setup', jsonb_build_object(
      'staff',            (select count(*) from restaurant_users  where restaurant_id = p_restaurant_id),
      'menu_items',       (select count(*) from menu_items        where restaurant_id = p_restaurant_id),
      'menu_categories',  (select count(*) from menu_categories   where restaurant_id = p_restaurant_id),
      'variants',         (select count(*) from menu_item_variants v
                             join menu_items mi on mi.id = v.menu_item_id
                            where mi.restaurant_id = p_restaurant_id),
      'tables',           (select count(*) from restaurant_tables where restaurant_id = p_restaurant_id),
      'table_groups',     (select count(*) from table_groups      where restaurant_id = p_restaurant_id),
      'rooms',            (select count(*) from rooms             where restaurant_id = p_restaurant_id),
      'workstations',     (select count(*) from workstations      where restaurant_id = p_restaurant_id),
      'products',         (select count(*) from products          where restaurant_id = p_restaurant_id),
      'vendors',          (select count(*) from vendors           where restaurant_id = p_restaurant_id),
      'credit_customers', (select count(*) from credit_customers  where restaurant_id = p_restaurant_id)
    )
  );
$$;

notify pgrst, 'reload schema';
