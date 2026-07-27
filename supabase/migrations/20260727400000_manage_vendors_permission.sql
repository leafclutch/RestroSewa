-- Vendor management splits away from purchases.
--
-- 20260727000000 split purchasing out of `manage_stock` as `manage_purchases`.
-- This splits it once more: `manage_purchases` now records supplier bills only,
-- and a new `manage_vendors` covers the vendor accounts — create/edit/delete a
-- vendor and pay what they're owed.
--
-- To preserve full pre-split capability, grant `manage_vendors` to everyone who
-- originally held `manage_stock` (the same population 20260727000000 gave
-- `manage_purchases`). No one is downgraded; a pure buyer vs a pure vendor-clerk
-- becomes a role the owner can now grant deliberately.
--
-- `permissions` is text[] (default '{}'). Idempotent via the `not (... = any ...)` guard.
update restaurant_users
   set permissions = array_append(permissions, 'manage_vendors')
 where 'manage_stock' = any(permissions)
   and not ('manage_vendors' = any(permissions));
