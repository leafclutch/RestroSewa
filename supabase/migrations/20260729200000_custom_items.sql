-- =============================================================
-- CUSTOM ITEMS (manual order lines)
--
-- Staff with `manage_custom_items` can add an off-menu line while taking an order:
-- a name, a price they type, a quantity and an optional note, optionally routed to a
-- workstation. It reuses session_order_items wholesale — the row already snapshots
-- item_name/item_price/quantity/notes and its menu_item_id/variant_id/workstation_id are
-- nullable — so a custom line is simply a row with no menu_item_id.
--
-- The ONLY thing the row can't already express is "this is deliberately custom" vs "this
-- was a menu item whose menu_item_id later went NULL because the item was deleted". This
-- explicit flag disambiguates the two, so bills/KOTs/reports can mark custom lines without
-- guessing. Everything else (totals, discounts, sales, finance, no-stock) falls out for free.
-- =============================================================

alter table session_order_items
  add column if not exists is_custom boolean not null default false;

comment on column session_order_items.is_custom is
  'True for a manual/off-menu line added by staff (no menu_item_id, staff-typed price). Distinguishes a genuine custom item from a former menu item whose menu_item_id was nulled on delete.';
