# Permissions (master)

# Overview
The complete permission architecture. `lib/permissions.ts` is the **single source of truth** —
constants, `ACCESS_SECTIONS` (the super-admin editor is data-driven off them), `*_ACCESS`
helpers, and job presets. See `decisions.md` → "Permission model" for the *why*; this file is
the reference for *what* and *how*.

# Responsibilities
- Define every permission and how they group.
- Decide who can see/do what across admin, staff, finance, rooms, stock, purchasing, payroll.
- Keep nav visibility and route/action guards in lockstep.

# Role hierarchy
1. **super_admin** — platform operator; separate authority (`isSuperAdmin`), NOT a
   `restaurant_user`. Owns staff CRUD across restaurants.
2. **restaurant_admin** — owner; `hasPermission` returns **true** for everything (bypass). Owns
   Settings + Finance regardless of the permission list.
3. **restaurant_employee** — gated by `permissions text[]`.
4. **customer** — no account (see `modules/qr.md`).

# The editor: sections × levels (2026-11-03)
The super-admin staff editor is ONE row per section, each with a single LEVEL (None / View /
Full, or the section's own steps) plus optional EXTRAS. `ACCESS_SECTIONS` defines them; a level
is just a named, CUMULATIVE set of keys (Full includes the view key) so a stored list reads back
as exactly one level (`detectLevel`). A list matching no level shows **Custom** and is left
untouched until a level is picked (`applyLevel`; picking None also clears that section's extras).
Enforcement still checks the same keys — the sections are only how they are granted.

| Section | Levels | Extras |
|---|---|---|
| Tables | View `view_tables` · Full +`manage_tables` | |
| Orders | View `view_orders` · Take orders +`create_orders` · Kitchen +`manage_orders` · Full (both) | `cancel_orders`, `manage_custom_items` |
| Walk-ins | View `view_walkins` · Full +`manage_walkins` | |
| Rooms | View `view_rooms` · Front desk +`check_in` · Full +`manage_rooms` | `cancel_room_stay` (PIN) |
| Billing | Take payments `close_bills`+`process_payments` | `apply_discounts`, `print_mock_bills` (PIN, no preset) |
| Sales | Today only `view_sales_today` · All days `view_sales` (alternatives, not cumulative) | |
| Credits | Full `manage_credits` | |
| Menu | Full `manage_menu` | |
| Stock | View `view_stock` (also opens Purchases/Vendors lists) · Full +`manage_stock` | |
| Purchases / Vendors | Full `manage_purchases` / `manage_vendors` | |
| Extra expenses | Add only `add_expenses` · Full +`manage_expenses` | |
| Finance report / Item sales / Staff | View `view_finance` / `view_item_sales` / `view_staff` | |
| Payroll | View `view_payroll` · Full +`manage_payroll` | |

**Sales and Credits have their own permissions** (they used to ride on billing: Sales on any of
process_payments/close_bills/view_reports, Credits on both of the first two).
**Removed** (20261103100000_simplify_staff_permissions.sql, which rewrote every stored list with
access unchanged): `view_menu`, `refund_bills`, `create/edit/delete_staff` (checked nowhere);
`view_dashboard`→`view_tables`, `edit_orders`→`manage_orders`, `view_reports`→`view_sales`.
The Tables section of the dashboard is `NAV_ACCESS.canSeeTables`; the dashboard home and
Notifications open for anyone on tables, orders, rooms or walk-ins.

# Permission inheritance (write-implies-read)
Helpers encode tiers so a manager needn't tick a read box under a write box:
- **ROOM_ACCESS**: `canViewRooms` (view|check_in|manage) · `canCheckIn` (check_in|manage) ·
  `canManageRooms` (manage). Three tiers — view is read-only, check_in starts stays, manage is CRUD.
  ⚠️ **`canCancelStay` is a FOURTH lane, deliberately outside that ladder** — implied by none of
  the three, and granting it implies none of them either. Writing off a guest's bill is not a
  bigger version of configuring rooms, and a receptionist checking guests in all day should not
  acquire it by default. Always ALSO gated on the Security PIN, for the owner too.
- **STOCK_ACCESS**: `canViewStock` (view|manage_stock) · `canManageStock` · `canViewPurchases`
  (view_stock|manage_stock|manage_purchases) · `canManagePurchases` · `canViewVendors`
  (…|manage_vendors) · `canManageVendors` · `canViewExpenses` (manage_expenses|view_finance) ·
  `canManageExpenses` · `canViewFinance` · `canSeeModule`.
  ⚠️ `canViewExpenses` deliberately does **NOT** pass on a stock right, unlike Purchases and
  Vendors: those are the buying workflow a storekeeper lives in, whereas the overheads list is the
  landlord and the power bill — closer to the Finance report than the store room.
  **`canAddExpenses`** (manage_expenses|add_expenses) is the write gate on the two ADD actions
  only; withdrawals and pot CRUD stay on `canManageExpenses`. **`expensesTodayOnly`** is the one
  predicate that decides the restricted view (`add && !manage && !view_finance`) — it drives the
  server-forced period, whether pot balances are computed at all, and the UI controls. Never
  re-derive that expression at a call site. `lib/permissions.test.ts` covers the matrix, including
  that a wider right cancels the restriction rather than the narrow one subtracting from it.
- **WALKIN_ACCESS**: `canViewWalkins` (view|manage — read-only section) · `canManageWalkins`
  (open/edit/order/bill/close). Enforced type-aware in shared session actions (`pos.ts`
  `walkInWriteBlocked`) since walk-ins reuse the table session pipeline.
- **PAYROLL_ACCESS**: `canViewPayroll` (view|manage) · `canManagePayroll`.
- **NAV_ACCESS**: `canSeeOrders`, `canManageOrders` (`manage_orders`), `canSeeTables`,
  `canSeeSales` (`view_sales`), `canManageCredits` (`manage_credits`).

# Assignment scoping (who sees WHICH tables/rooms) — distinct from permissions
Permissions decide WHAT you may do; **assignment** decides WHICH tables/rooms you may do it to.
`lib/assignments.ts` is the single source of truth. Staff are assigned to **table-groups**
(`restaurant_user_table_groups`), **room-types** (`restaurant_user_room_types`), **pinned rooms**
(`restaurant_user_rooms`), or **workstations** (`restaurant_user_workstations`).
- `viewerSeesAllGroups` → **true ONLY for `restaurant_admin`**. Every other staff member (managers
  included) is scoped to their assignments, nothing until assigned. `manage_tables` no longer grants
  blanket visibility (that bypass was removed — see `decisions.md`).
- `buildVisibilityFilter(restaurantId, viewer)` → `{ seesAll, canSeeTable(id), canSeeRoom(id) }` —
  the predicate every screen + write-action uses. `resolveViewerScope(...)` → the same rules as ID
  arrays (`groupIds`/`roomTypeIds`/`roomIds`/`includeWalkins`) for **DB-level** filtering.
- Reads enforced at the DB: `getTableStatusOverview` (`.in("group_id", groupIds)`), `getRoomsOverview`
  (`.or(id.in / room_type_id.in)`). `getMyOrderQueue` filters in memory (its query is shared with
  workstation staff who need all active sessions). **Sales** (`getSalesReport`/`exportSalesCsv`) filter
  payment rows by the predicate in the server action before deriving any figure — no RPC.
- Writes: `submitPayment`, `forceCloseSession`, `cancelOrder`, `cancelOrderItem` gate on the predicate
  (`canAccessSession`); room + transfer actions already do.
- **Walk-ins** (no table/room) have no group boundary → **restaurant-wide** among staff with
  `view_walkins`/`manage_walkins`. **Workstation staff** (kitchen/bar) route by station, not group.

# Enforcement
- **Backend (the security boundary):** every Server Action re-checks via `hasPermission` /
  the `*_ACCESS` helpers; admin bypasses. Staff CRUD actions (`app/actions/staff.ts`) are gated
  on `isSuperAdmin` (super-admin authority), NOT restaurant perms.
- **Frontend (convenience only):** nav is DERIVED from perms (`getStaffNav`, admin sidebar) so a
  link never appears that the guard would bounce; pages redirect if the guard fails.
- Client gating is never trusted — the action is the boundary.

# Presets (job templates)
`STAFF_PRESETS`: waiter, cashier, **receptionist** (front desk incl. `check_in`), chef,
manager, host. Written as section levels (`preset(...)`), so every preset reads back as clean
levels — a test enforces it. Front of house is a **ladder** (tested): Waiter (sees tables,
walk-ins, rooms; adds items; no payment) → Cashier (+billing, Sales, Credits, discounts, custom
items) → Receptionist (+rooms front desk) → Manager (+full tables/rooms/menu, cancel orders,
staff list). A preset only pre-fills the editor; the stored value is the resulting
list, not the preset. `matchPreset` labels a selection (shown on the staff list badge).

# Known Limitations
- Staff CRUD is super-admin only; there is no create/edit/delete-staff permission (removed
  2026-11-03 — they were never checked). Add one when an in-admin staff surface exists.
- Orphan permission strings on old rows are inert (nothing reads removed perms).

# Future Improvements
- An admin staff-management screen (would need a new staff-management section).
- Optional per-permission audit log of grants/changes.

# Sales: Today only (2026-11-03)
`view_sales_today` opens Sales restricted to the current business day. `NAV_ACCESS.salesTodayOnly`
(`today && !view_sales`; never true for the owner) is the ONE predicate, applied server-side in
`getSalesReport` and `exportSalesCsv` (params forced to `today`, week/month/year/all overview
zeroed) and `getPaidBill` (only today's bills, except a credit bill opened by a Credits holder).
`SalesReport.todayOnly` tells `SalesView` to hide the period tiles and custom range. No migration:
existing `view_sales` holders are unaffected.
