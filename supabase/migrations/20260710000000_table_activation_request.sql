-- Menu + Ordering (Without PIN): staff-approved table activation.
--
-- In no-PIN mode a customer's first order must NOT activate the table straight
-- away. Instead we open the session in a new `pending_activation` state that is
-- invisible to the kitchen queue and the table overview (both filter on
-- status = 'active'), persist the order against it, and raise a
-- `table_activation_request` notification to the front-of-house staff who can
-- see that table. Accepting flips the session to 'active' and emits the normal
-- `new_order` alert; rejecting closes the session.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'table_activation_request';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'pending_activation';
