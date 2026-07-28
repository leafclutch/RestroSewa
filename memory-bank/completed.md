# Completed

Chronological log of meaningful shipped features (newest first). Not every commit — only
features worth remembering. Dates are approximate to the work, not necessarily merge dates.

## 2026-07 — Walk-in permission · Room mixed down-payment · Business-type Rooms gating
Three changes. **(1) Walk-in permission** — new `view_walkins`/`manage_walkins` (`WALKIN_ACCESS`);
the dashboard section + open action gate on it, and a type-aware backend guard
(`walkInWriteBlocked`, pos.ts) refuses walk-in writes (add order / close / force-close / cancel)
from order/billing staff holding only `view_walkins`. Presets (cashier/receptionist/manager) +
backfill to `close_bills` holders (migration `20260727600000`). **(2) Room credit Mixed
down-payment** — the folio-client credit "Paid now" now supports a Cash+Online split, matching the
table checkout (server already accepted the split). **(3) Business-type Rooms gating** —
`lib/business-type.ts` (`hasRooms`/`hasRestaurant`) + `getRestaurantConfig.businessType`;
**restaurant-only clients hide Rooms** in the admin sidebar, staff dashboard, `/admin/rooms`
(redirect), the Super Admin permission editor (Rooms group hidden), and room-create actions
(defense-in-depth). Hotel-only module hiding deferred.
*Files:* `lib/{permissions,business-type,restaurant-info}.ts`, `app/actions/{pos,rooms-admin}.ts`,
folio-client, walkins-grid/section, employee dashboard, admin layout + sidebar, superadmin staff
forms + `permission-picker.tsx`.

## 2026-07 — Daily Finance Report (PDF via Gmail SMTP)
Automatic per-business-day PDF financial report emailed from the HRestroSewa Gmail. Reusable
report service: `ReportPdf` chrome (logo/header, sections, page numbers, footer), Gmail SMTP
mailer with retry, orchestrator shared by cron + manual retry, `report_deliveries` exactly-once
+ admin history/retry UI. Model adds mixed payments + inventory value.
*Files:* `lib/reports/*`, `lib/email/mailer.ts`, `app/api/cron/daily-summary/route.ts`,
`app/actions/settings.ts`, settings client, migrations `20260727300000` + `20260727500000`,
`supabase/cron/daily-summary-cron.sql`. *Note:* prod rollout is ops-only (see current-task).

## 2026-07 — Purchases/Vendors permission split + staff-dashboard sections
`manage_stock` split into `manage_stock` + `manage_purchases` + `manage_vendors` (write-implies-
read). Purchases & Vendors surfaced on the staff dashboard (after Stock, gated on the *manage*
right) via thin `/employee/purchases` + `/employee/vendors` pages reusing admin clients. Sidebar
per-lane gating. Backfills grant both new perms to existing `manage_stock` holders.
*Files:* `lib/permissions.ts`, `app/actions/{vendors,purchases,stock}.ts`, admin pages + sidebar,
employee dashboard + section components, migrations `20260727000000` + `20260727400000`.

## 2026-07 — Vendor & Product delete
Guarded hard-delete only when unreferenced (RPCs `delete_vendor`/`delete_product` re-check inside
the tx); otherwise refused with a coded error and the UI offers Deactivate.
*Files:* `app/actions/{vendors,stock}.ts`, vendors/stock clients, migrations `20260727100000` +
`20260727200000`.

## 2026-07 — Granular staff permissions + Stock on staff dashboard
Three-tier rooms (`view_rooms`/`check_in`/`manage_rooms`), Stock summary card on the staff
dashboard + `/employee/stock`, audit that removed 4 dead perms, and **closed a real hole**:
`app/actions/staff.ts` had zero auth guards (now super-admin gated).
*Files:* `lib/permissions.ts`, `app/actions/{rooms,staff}.ts`, employee dashboard, migration
`20260724000000`.

## 2026-07 — Performance pass
Reframed as latency-bound: removed round trips (local JWT verify, batched queries, `tenantCache`,
`getRestaurantConfig`). Dashboard action abort race fixed (see bugs.md). Added `/api/_perf`.
*Files:* `lib/auth/*`, `lib/cache/tenant-cache.ts`, `lib/restaurant-info.ts`, `app/api/_perf`.

## 2026-07 — Table/Room shifting (session transfer)
Move a live session to another table/room keeping bill/orders/tickets/customer intact.
*Files:* `app/actions/transfer.ts`, `transfer_session` RPC, migration `20260723000000`.

## 2026-07 (earlier) — Foundational modules
Stock & Finance module (5 phases: vendors, stock, purchases, daily finance report, dashboard
analytics), OT batching + per-workstation printing, mixed payments, customer credit / unpaid
bills, walk-ins, cleaning status, configurable business day, sequential bill numbering,
payment discounts, branding, customer dark theme. See git history + `decisions.md`.
