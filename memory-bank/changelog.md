# Changelog

Human-readable release notes. Newest first. Group entries by Added / Changed / Fixed / Removed.
Versioning is informal (the app ships continuously); dates anchor the entries.

## [Unreleased] — 2026-07
### Added
- **Walk-in permission** (`view_walkins` / `manage_walkins`) — the Walk-ins section now needs its
  own permission (View = read-only, Manage = operate); enforced front and back. Cashier /
  Receptionist / Manager presets include Manage; Waiter does not.
- **Room credit — Mixed down-payment**: on a credit checkout the "Paid now" amount can be split
  Cash + Online (parity with the table/walk-in bill).
- **Business-type awareness**: Restaurant-only clients no longer see the **Rooms** module anywhere
  (sidebar, staff dashboard, `/admin/rooms`, the permission editor); a forged room-create POST is
  refused too. Driven by `restaurants.type` via `lib/business-type.ts`.
- **Daily Finance Report**: automatic per-business-day PDF (logo, name, business date, opening/
  closing balances, cash/online/mixed/credit sales, discounts, purchases, vendor payments, new
  vendor credit, customer-credit collected, estimated profit, total bills/orders, inventory
  value, low/out-of-stock, outstanding credit) emailed from HRestroSewa Gmail; admin recipients
  editor (≤3) + delivery **history with Retry**.
- **`manage_purchases`** and **`manage_vendors`** permissions (split from `manage_stock`).
- **Purchases** and **Vendors** sections on the staff dashboard (for staff with the manage
  right), plus `/employee/purchases` and `/employee/vendors`.
- **Vendor delete** and **Product delete** (guarded hard-delete; else Deactivate).
- **"Assign all"** shortcut when assigning staff to a table group (Admin → Tables).
- Three-tier room permissions (`view_rooms` / `check_in` / `manage_rooms`) + Stock summary on the
  staff dashboard + `/employee/stock`.
- `/api/_perf` layered latency probe (secret-gated).

### Changed
- Report email transport → **Gmail SMTP** (nodemailer) with retry; the email body is a short
  cover note and the PDF carries the detail.
- Vendor/purchase read + product-picker gating widened so a pure purchaser/vendor-clerk works
  without `view_stock` (write-implies-read).
- Admin sidebar Stock group gated per-lane (stock / purchases / vendors / finance) so no link
  bounces.

### Fixed
- Closed a real security hole: `app/actions/staff.ts` had **no** auth guards (now super-admin
  gated).
- Dashboard action abort race (via the latency/round-trip model).

### Removed
- 4 dead permissions (`view_customers`, `manage_customers`, `view_settings`, `manage_settings`).
- Payment/close push notifications (kept new-order rings only).

---
_Earlier foundational work (stock & finance module, OT batching + printing, mixed payments,
customer credit, walk-ins, cleaning status, business day, bill numbering, discounts, branding,
customer dark theme, session transfer) predates this changelog — see `completed.md` and git._
