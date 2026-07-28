-- Walk-ins get their own permission group (view_walkins / manage_walkins).
--
-- Until now the Walk-ins section rode on the dine-in "tables" nav, so anyone who
-- could see tables could operate walk-ins. It's now gated on view_walkins (read)
-- and manage_walkins (open/edit/order/bill/close). WITHOUT this backfill, every
-- staffer would lose walk-in access the moment the new code deploys.
--
-- Grant manage_walkins to the staff who actually run the counter: those who can
-- close bills (cashiers / receptionists / managers). Manage implies view. Plain
-- waiters (no close_bills) intentionally become no-walk-in unless an admin grants
-- it — the new intended behaviour ("Waiter: not unless explicitly granted").
--
-- `permissions` is text[] (default '{}'). Idempotent via the `not (... = any ...)` guard.
update restaurant_users
   set permissions = array_append(permissions, 'manage_walkins')
 where 'close_bills' = any(permissions)
   and not ('manage_walkins' = any(permissions));
