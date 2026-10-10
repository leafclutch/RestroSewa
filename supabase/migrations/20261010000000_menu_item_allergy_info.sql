-- =============================================================
-- MENU ITEM ALLERGY INFO
--
-- Free text the restaurant writes per item ("Contains peanuts, dairy, gluten").
-- Shown on the customer QR menu, and the guest must confirm they are not
-- allergic before an order containing the item is placed.
--
-- Nullable, no default: an item with no allergy note behaves exactly as before.
-- =============================================================

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS allergy_info text;

COMMENT ON COLUMN public.menu_items.allergy_info IS
  'Allergens in this item, written by the restaurant. Shown to customers and confirmed before ordering.';
