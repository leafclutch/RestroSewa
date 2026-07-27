-- Purchasing becomes its own permission, split out of `manage_stock`.
--
-- Recording a supplier bill and paying a vendor SPEND the restaurant's money; that
-- is a different trust level from counting stock or logging wastage. The app now
-- gates those actions (record purchase, pay vendor, vendor create/edit/deactivate/
-- delete) on a new `manage_purchases` right instead of `manage_stock`.
--
-- WITHOUT this backfill, everyone who could previously buy would lose the ability
-- the moment the new code deploys — they hold `manage_stock`, which no longer
-- grants purchasing. So grant `manage_purchases` to every staff member who already
-- holds `manage_stock`. No one is downgraded; a pure buyer (purchasing but not
-- stock) becomes a new role the owner can grant deliberately.
--
-- `permissions` is text[] (default '{}', per 20260721000000). Idempotent: the
-- `not (... = any ...)` guard means re-running changes nothing.
update restaurant_users
   set permissions = array_append(permissions, 'manage_purchases')
 where 'manage_stock' = any(permissions)
   and not ('manage_purchases' = any(permissions));
