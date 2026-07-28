# Admin

# Overview
The owner/admin surface at `app/(admin)/admin/*`. The layout admits any active staff member;
each page guards its own permission, so this is one surface serving both owners and permitted
staff. Settings + Finance are owner-only.

# Responsibilities
- Restaurant configuration, menu, tables/rooms, workstations.
- Stock, purchases, vendors, finance, payroll oversight.
- Reports config (daily finance email) and billing settings.
- (Staff management proper is super-admin; the admin staff page does workstation-assign +
  payroll only — see `modules/staff.md` / `modules/permissions.md`.)

# Features
- **Dashboard** (`/admin/dashboard`) — headline stats via `dashboard_stats` (inventory value,
  sales, purchases, COGS, tracked revenue, outstanding credits).
- **Restaurant configuration & Settings** (`/admin/settings`) — see `modules/settings.md`.
- **Menu** (`/admin/menu`), **Tables** (`/admin/tables` — see `modules/tables.md`), **Rooms**
  (`/admin/rooms` — see `modules/rooms.md`), **Workstations** (`/admin/workstations`).
- **Stock / Purchases / Vendors** — see `modules/stock.md`.
- **Finance** (`/admin/finance`) — see `modules/finance.md`.
- **Reports** — daily finance PDF config + history/retry inside Settings.

# Business Rules
- Sidebar links are gated per-lane so none bounce (`showStock`/`showPurchases`/`showVendors`/
  `showFinance`, `showSettings` = admin only). Settings/Finance are owner-only regardless.
- Every admin action re-checks permission server-side; admin role bypasses.

# Important Components
- `app/(admin)/layout.tsx`, `app/(admin)/admin/_components/admin-sidebar.tsx`.
- Per-section pages under `app/(admin)/admin/*` and their `_components/*-client.tsx`.
- `app/actions/*` back every page.

# Database Relations
Spans most tables (see `database.md`); nothing admin-specific of its own beyond `restaurants`
config.

# Realtime Behaviour
Admin lists refresh via `useRealtime` on the relevant channels (stock, purchases, vendors,
orders) — see `modules/realtime.md`.

# Permissions
Admin role bypasses; permitted staff reach individual pages via their perms. Full model in
`modules/permissions.md`.

# Known Limitations
- No in-admin staff CRUD yet (super-admin only).

# Future Improvements
- In-admin staff management (see `roadmap.md`); dashboard charts.
