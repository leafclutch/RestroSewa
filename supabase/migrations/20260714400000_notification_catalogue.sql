-- =============================================================
-- NOTIFICATION CATALOGUE — new event types
--
-- Until now the only alerts that existed were the three a GUEST could raise: call a
-- waiter, ask for the bill, ask to open a table. Which means the two people who most
-- need a phone in their pocket to buzz — the chef and the bartender — received
-- nothing at all, and the cashier learned about a payment by looking.
--
-- These are the events the staff side of the house actually turns on.
--
-- `new_order` already exists in the enum (it was written, then deliberately excluded
-- from the notifications PANEL, because an order belongs in the Orders queue rather
-- than a list of things to acknowledge). That reasoning still holds for the panel and
-- it stays excluded there. But it does NOT hold for PUSH: a chef whose phone is in
-- their apron cannot see a queue on a screen they are not looking at. Same row, two
-- different questions — "should this appear in a list?" and "is this worth waking
-- someone for?" — and they are allowed to have different answers.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that then USES the
-- new value, so each is its own statement and nothing here depends on them.
-- =============================================================

alter type notification_type add value if not exists 'order_cancelled';
alter type notification_type add value if not exists 'payment_received';
