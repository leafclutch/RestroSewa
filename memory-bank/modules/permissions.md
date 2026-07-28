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
- Menu: `view_menu`, `manage_menu`
- Tables: `view_tables`, `manage_tables`
- Walk-ins: `view_walkins`, `manage_walkins`
- Rooms: `view_rooms`, `check_in`, `manage_rooms`
- Billing: `process_payments`, `apply_discounts`, `refund_bills`
- Stock: `view_stock`, `manage_stock`
- Purchases: `manage_purchases` · Vendors: `manage_vendors` · Finance: `view_finance`
- Reports: `view_reports`
- Staff: `view_staff`, `create_staff`, `edit_staff`, `delete_staff`
- Payroll: `view_payroll`, `manage_payroll`

# Permission inheritance (write-implies-read)
Helpers encode tiers so a manager needn't tick a read box under a write box:
- **ROOM_ACCESS**: `canViewRooms` (view|check_in|manage) · `canCheckIn` (check_in|manage) ·
  `canManageRooms` (manage). Three tiers — view is read-only, check_in starts stays, manage is CRUD.
- **STOCK_ACCESS**: `canViewStock` (view|manage_stock) · `canManageStock` · `canViewPurchases`
  (view_stock|manage_stock|manage_purchases) · `canManagePurchases` · `canViewVendors`
  (…|manage_vendors) · `canManageVendors` · `canViewFinance` · `canSeeModule`.
- **WALKIN_ACCESS**: `canViewWalkins` (view|manage — read-only section) · `canManageWalkins`
  (open/edit/order/bill/close). Enforced type-aware in shared session actions (`pos.ts`
  `walkInWriteBlocked`) since walk-ins reuse the table session pipeline.
- **PAYROLL_ACCESS**: `canViewPayroll` (view|manage) · `canManagePayroll`.
- **NAV_ACCESS**: `canSeeOrders`, `canManageOrders`, `canSeeSales`, `canManageCredits`
  (credits require BOTH `process_payments` + `close_bills`).

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
