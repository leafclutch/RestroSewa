# Staff

# Overview
The employee workspace at `app/(employee)/employee/*`. A single-page dashboard stacks every
section the staff member is permitted to see; a few thin sub-pages reuse admin clients. Built
around fast floor work and realtime.

# Responsibilities
- Take/serve orders, bill tables/rooms, take payments, manage credits.
- Surface tables, walk-ins, rooms, menu, stock, purchases, vendors per permission.

# Features
- **Dashboard** (`/employee/dashboard`) — sections stream in under their own `<Suspense>`
  (concurrent, not serial). Order: Orders → Tables → Walk-ins → Rooms → Sales → Credits → Menu →
  Stock → Purchases → Vendors. Quick-nav + `?focus=`/`?credit=` deep links.
- **Orders** (`/employee/queue`), **Sales** (`/employee/sales`), **Credits** (`/employee/credits`
  — needs process_payments + close_bills), **Menu** (reuses admin MenuClient).
- **Tables** & **Walk-ins** sections — see `modules/tables.md`, `modules/walkins.md`.
- **Rooms** section — see `modules/rooms.md`.
- **Stock / Purchases / Vendors** — summary cards → thin `/employee/{stock,purchases,vendors}`
  pages reusing admin clients. Stock section gates on `canViewStock`; **Purchases/Vendors gate on
  the MANAGE right** (`canManagePurchases`/`canManageVendors`) so a view-only storekeeper doesn't
  see action cards they can't use.

# Business Rules
- Section visibility is permission-derived (`getStaffNav` + direct `*_ACCESS` checks); each thin
  page re-checks server-side.
- Credits require BOTH billing perms; a reports-only viewer must not reach customer debt.

# Important Components
- `app/(employee)/employee/dashboard/page.tsx` + `_components/*` (staff-dashboard, orders/tables/
  walkins/rooms/stock/purchases/vendors sections).
- Thin pages: `employee/{stock,purchases,vendors,queue,sales,credits,menu,session}`.

# Database Relations
Sessions, orders, payments, credits, stock — see `database.md`.

# Realtime Behaviour
The dashboard holds an SSE stream; sections refresh on their channels (orders, tables, stock).
Because SSE stays open, tests use content waits, not `networkidle`. See `modules/realtime.md`.

# Permissions
Per-section, via `lib/permissions.ts`. See `modules/permissions.md`.

# Known Limitations
- One dashboard for all roles (sections simply hide) — no role-specific landing.

# Future Improvements
- Remember collapsed/expanded sections per staffer; role-based default focus.
