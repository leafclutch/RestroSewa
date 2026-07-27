# Stock

# Overview
Inventory, purchases, vendors — the Stock & Finance module's operational half. Stock is always
**derived**, never stored. See `architecture.md` → "Stock flow" and `decisions.md` → "Derived
stock".

# Responsibilities
- Products & inventory levels, purchases, vendor accounts (payables).
- Product↔menu-item recipe links, manual adjustments, stock history, low/out alerts.

# Features
- **Inventory** (`/admin/stock`, `/employee/stock`) — per-product opening/purchased/used/
  adjusted/closing for a chosen business day via `stock_report`; low/out status; inventory value.
- **Purchases** (`/admin/purchases`, `/employee/purchases`) — record supplier bills
  (`record_purchase` — one tx writes bill + lines, raises vendor credit, sets last cost).
- **Vendors** (`/admin/vendors`, `/employee/vendors`) — CRUD + pay (`create_vendor`,
  `record_vendor_payment`), deactivate, or hard-delete when unreferenced (`delete_vendor`).
- **Product links** (recipe/BOM) — attach a product to a menu item or one variant, `qty_per_unit`.
- **Manual deductions** — wastage/damage/kitchen/correction (`stock_adjustments`).
- **History** — `product_history` (running balance that equals `stock_report`'s closing).
- **Delete product** — hard-delete when unreferenced (`delete_product`), else Deactivate.

# Business Rules
- Stock deducts when an order line is placed (the row IS the reservation); **restores** on
  reject/force-close/cancel via a dated `cancelled_at` (never compensating rows → no double
  restore). Served items are never restored.
- Manual deductions count as used stock; only an explicit "add" correction returns stock.
- Inventory always derived; `opening_stock` set once (not editable — corrections go through
  adjustments). Value negative stock at 0.
- Recipe usage counts only for sales at/after the link's `created_at` (retro-deduction filter).

# Important Components
- `app/actions/{stock,purchases,vendors}.ts`; RPCs `stock_report`, `record_purchase`,
  `create_product`, `create_vendor`, `record_vendor_payment`, `product_history`,
  `delete_product`, `delete_vendor`.
- `lib/stock.ts`; admin/employee `stock-client`, `purchases-client`, `vendors-client`.

# Database Relations
`products`, `menu_item_products` (M2M recipe), `stock_adjustments`, `purchases`/`purchase_items`,
`vendors`/`vendor_payments` — see `database.md`.

# Realtime Behaviour
Stock/purchases/vendors lists refresh on the `stock`/`purchases`/`orders` channels (a POS sale, a
purchase, or a manual deduction all move stock). See `modules/realtime.md`.

# Permissions
`view_stock` (read), `manage_stock` (products/adjustments/recipes), `manage_purchases` (record
purchases), `manage_vendors` (vendor CRUD + pay). Write-implies-read. See `modules/permissions.md`.

# Known Limitations
- 1 unit per product; recipe is per (item/variant, product) pair — no nested sub-recipes.
- COGS/profit only for linked items (see `modules/finance.md`).

# Future Improvements
- Multi-unit / unit conversions; supplier price history; reorder suggestions.
