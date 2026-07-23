-- Room check-in becomes its own permission.
--
-- Until now, checking a guest in only needed `view_rooms` — the code literally said "a
-- Receptionist is just a Cashier with view_rooms; no new permission had to be added." The
-- app now splits that apart: `view_rooms` is strictly read-only, and a new `check_in`
-- right is required to start a stay. `manage_rooms` implies it in code, so managers need
-- no change.
--
-- WITHOUT this backfill, every existing receptionist would lose check-in the moment the
-- new code deploys — they hold `view_rooms`, which no longer grants it. So grant `check_in`
-- to the staff who were ACTING as reception: those who can already both see rooms and
-- close bills. A plain waiter (view_rooms only) is intentionally NOT included — they become
-- view-only, which is the new intended behaviour.
--
-- `permissions` is text[] (default '{}', per 20260721000000). Idempotent: the
-- `not (... = any ...)` guard means re-running changes nothing.
update restaurant_users
   set permissions = array_append(permissions, 'check_in')
 where 'view_rooms'  = any(permissions)
   and 'close_bills' = any(permissions)
   and not ('check_in' = any(permissions));
