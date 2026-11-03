-- Simplified staff access: one control per section (see ACCESS_SECTIONS in
-- lib/permissions.ts). This rewrites every stored permission list into the new model
-- WITHOUT changing what anyone can do today. Each step below is either a rename of a
-- key with identical effect, the new own-permission for a section that used to ride
-- on others, or an implied key made explicit. Nothing is granted that the old rules
-- did not already grant.
--
-- `permissions` is text[] (default '{}'). Every step is idempotent via the
-- `not (... = any ...)` guard, the same shape as 20260727600000_walkin_permission.sql.
-- Plain statements only (no helper function): prod applies migrations over HTTP.

-- ── 1. Sections that now have their own permission ───────────────────────────
-- Sales used to open on ANY of process_payments / close_bills / view_reports.
update restaurant_users set permissions = array_append(permissions, 'view_sales')
 where permissions && array['process_payments', 'close_bills', 'view_reports']
   and not ('view_sales' = any(permissions));

-- Credits used to need BOTH process_payments AND close_bills.
update restaurant_users set permissions = array_append(permissions, 'manage_credits')
 where permissions @> array['process_payments', 'close_bills']
   and not ('manage_credits' = any(permissions));

-- ── 2. Duplicates folded into the key with the identical effect ───────────────
-- view_dashboard and view_tables both opened the dashboard's Tables section.
update restaurant_users set permissions = array_append(permissions, 'view_tables')
 where 'view_dashboard' = any(permissions)
   and not ('view_tables' = any(permissions));

-- edit_orders and manage_orders were interchangeable in NAV_ACCESS.canManageOrders.
update restaurant_users set permissions = array_append(permissions, 'manage_orders')
 where 'edit_orders' = any(permissions)
   and not ('manage_orders' = any(permissions));

-- ── 3. Implied keys made explicit ─────────────────────────────────────────────
-- Levels are stored as cumulative sets ("Full" includes the view key), so the editor
-- can read every list back as exactly one level. Each of these is already implied by
-- the access rules, so adding it changes nothing a person can do.
update restaurant_users set permissions = array_append(permissions, 'view_tables')
 where 'manage_tables' = any(permissions)
   and not ('view_tables' = any(permissions));
update restaurant_users set permissions = array_append(permissions, 'view_orders')
 where permissions && array['create_orders', 'manage_orders']
   and not ('view_orders' = any(permissions));
update restaurant_users set permissions = array_append(permissions, 'view_walkins')
 where 'manage_walkins' = any(permissions)
   and not ('view_walkins' = any(permissions));
update restaurant_users set permissions = array_append(permissions, 'check_in')
 where 'manage_rooms' = any(permissions)
   and not ('check_in' = any(permissions));
update restaurant_users set permissions = array_append(permissions, 'view_rooms')
 where permissions && array['check_in', 'manage_rooms']
   and not ('view_rooms' = any(permissions));
update restaurant_users set permissions = array_append(permissions, 'view_stock')
 where 'manage_stock' = any(permissions)
   and not ('view_stock' = any(permissions));
update restaurant_users set permissions = array_append(permissions, 'add_expenses')
 where 'manage_expenses' = any(permissions)
   and not ('add_expenses' = any(permissions));
update restaurant_users set permissions = array_append(permissions, 'view_payroll')
 where 'manage_payroll' = any(permissions)
   and not ('view_payroll' = any(permissions));

-- ── 4. Keys that no longer exist ──────────────────────────────────────────────
-- view_menu, refund_bills, create_staff, edit_staff, delete_staff were checked nowhere;
-- the other three were folded above.
update restaurant_users
   set permissions = array(
         select p from unnest(permissions) as p
          where p not in ('view_dashboard', 'edit_orders', 'view_reports', 'view_menu',
                          'refund_bills', 'create_staff', 'edit_staff', 'delete_staff')
       )
 where permissions && array['view_dashboard', 'edit_orders', 'view_reports', 'view_menu',
                            'refund_bills', 'create_staff', 'edit_staff', 'delete_staff'];
