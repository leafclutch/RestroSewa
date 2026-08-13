# Permissions (master)

# Overview
The complete permission architecture. `lib/permissions.ts` is the **single source of truth** —
constants, groups (the super-admin checkbox editor is data-driven off them), `*_ACCESS`
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

# Permission groups (constants)
- Dashboard: `view_dashboard`
- Orders: `view_orders`, `manage_orders`, `create_orders`, `edit_orders`, `cancel_orders`, `close_bills`
- Custom items: `manage_custom_items` (own group) — add an off-menu line with a STAFF-TYPED price.
  Held apart from `create_orders` because a normal order can never set its own price
  (`lib/order-items.ts`); Cashier + Manager presets include it. See `modules/custom-items.md`.
- Mock Billing: `print_mock_bills` (own group, 2026-08-07) — opens the PIN-gated mock billing
  screen. Standalone, NOT a rider on `close_bills`, and **on NO preset** (like Payroll): a mock bill
  prints indistinguishably from a real one, so it is only ever granted deliberately. Being holdable
  alone is the point — that is how you make a demo/sales account with no other access. See
  `modules/mock-bill.md`.
- Menu: `view_menu`, `manage_menu`
- Tables: `view_tables`, `manage_tables`
- Walk-ins: `view_walkins`, `manage_walkins`
- Rooms: `view_rooms`, `check_in`, `manage_rooms`
- Billing: `process_payments`, `apply_discounts`, `refund_bills`
- Stock: `view_stock`, `manage_stock`
- Purchases: `manage_purchases` · Vendors: `manage_vendors` · Extra Expenses: `manage_expenses`,
  `add_expenses` · Finance: `view_finance`
- Reports: `view_reports`
- Staff: `view_staff`, `create_staff`, `edit_staff`, `delete_staff`
- Payroll: `view_payroll`, `manage_payroll`

# Permission inheritance (write-implies-read)
Helpers encode tiers so a manager needn't tick a read box under a write box:
- **ROOM_ACCESS**: `canViewRooms` (view|check_in|manage) · `canCheckIn` (check_in|manage) ·
  `canManageRooms` (manage). Three tiers — view is read-only, check_in starts stays, manage is CRUD.
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
- **NAV_ACCESS**: `canSeeOrders`, `canManageOrders`, `canSeeSales`, `canManageCredits`
  (credits require BOTH `process_payments` + `close_bills`).

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
manager, host. A preset only pre-fills checkboxes; the stored value is the resulting list, not
the preset. `matchPreset` labels a selection.

# Known Limitations
- `create_staff` / `edit_staff` / `delete_staff` exist but are **unused** — staff CRUD is
  super-admin only today. Reserved for a future in-admin staff surface (see `roadmap.md`).
- Orphan permission strings on old rows are inert (nothing reads removed perms).

# Future Improvements
- Wire `create/edit/delete_staff` to an admin staff-management screen.
- Optional per-permission audit log of grants/changes.
