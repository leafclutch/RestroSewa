-- =============================================================
-- PURCHASES — unit cost precise enough to come from a line total
--
-- The purchase form now lets a line be entered as "5 kg for ₹1,500" (a TOTAL)
-- instead of only "₹300 per kg". The per-unit cost is then total ÷ quantity,
-- which is rarely a whole number of paise: ₹100 for 3 units is 33.3333…
--
-- At numeric(12,2) that stored 33.33, and the generated `line_total`
-- (round(quantity * unit_cost, 2)) became ₹99.99 — a paisa short of what was
-- typed, while `record_purchase` computes the BILL total from the unrounded
-- JSON value and gets ₹100.00. Lines that don't add up to their own bill.
--
-- Six decimals keeps round(quantity * unit_cost, 2) equal to the typed total
-- for any quantity under ~10,000 units (the error is at most qty × 5e-7).
-- Existing rows already hold 2-decimal values, so widening changes none of
-- them, and their recomputed line_total is identical.
--
-- `line_total` is generated FROM unit_cost, and Postgres refuses to change the
-- type of a column a generated column depends on — so it is dropped and
-- re-added with the exact same expression. Nothing else depends on it at the
-- schema level (the stock report reads it inside function bodies, which are
-- resolved at call time).
-- =============================================================

alter table purchase_items drop column line_total;

alter table purchase_items
  alter column unit_cost type numeric(18,6);

alter table purchase_items
  add column line_total numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored;
