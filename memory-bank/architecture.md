# Architecture

System-level structure and flows. Update only when architecture changes.

## Folder structure

```
app/
  (admin)/admin/*        Admin surface (owner + permitted staff). layout.tsx allows ANY active
                         staff; each page guards its own permission. Sidebar in
                         admin/_components/admin-sidebar.tsx.
  (employee)/employee/*  Single-page staff dashboard + thin pages (stock, purchases, vendors,
                         queue, sales, credits, session) reusing admin clients.
  (superadmin)/superadmin/*  Platform operator surface.
  c/[slug]/*             Customer QR ordering (no auth).
  actions/*              Server Actions — the real API. Self-authing, tenant-scoped.
  api/realtime           SSE stream.  api/push/action  web-push.  api/cron/daily-summary  report.
  api/_perf              layered latency probe (secret-gated).
lib/
  permissions.ts         SINGLE source of truth for perms (constants, groups, *_ACCESS, presets).
  business-day.ts        The ONLY place day maths lives (Nepal offset, closing hour).
  auth/*                 guards, current-user (local JWT), get-restaurant-user.
  supabase/*             service (service_role) + server (ssr) clients.
  cache/tenant-cache.ts  the only cross-request cache (tenantCache/revalidateTenant).
  reports/*              daily-summary (model+email), daily-summary-pdf, pdf/report-document,
                         daily-summary-send (orchestrator).
  email/mailer.ts        Gmail SMTP (nodemailer).
  stock.ts, finance.ts, payment-split.ts, billing/*, workstations/*, realtime/*
components/*             UI primitives, branding, pwa.
supabase/migrations/*    Ordered SQL (YYYYMMDDHHMMSS_name.sql). Run via scripts/migrate.mjs.
supabase/cron/*          Manual, per-env SQL (pg_cron) — kept OUT of migrations/ on purpose.
scripts/migrate.mjs      Migration runner (status/up, --prod, --yes).
```

## Module relationships
Pages (Server Components) fetch via **Server Actions** in `app/actions/*`, which call the
**service client** (bypasses RLS) and/or **Postgres RPCs**. Client components handle
interaction and re-call actions (self-auth) on change; `useRealtime` pushes refreshes. `lib/*`
holds shared pure logic (permissions, business-day, splits) and the cache. Admin & employee
surfaces **reuse the same client components** (e.g. `StockClient`, `VendorsClient`,
`PurchasesClient`) — no duplicate UIs.

## Authentication flow
Admins/staff log in with a **synthetic email + 4-digit PIN** → Supabase Auth session (JWT).
Requests verify the JWT **locally** via `getClaims()` (cached JWKS, WebCrypto) — no network
`getUser()` on the hot path; fall back to `getUser()` on verify error, never return null.
`lib/auth/guards.ts` resolves the caller once per request (memoised) into a
`RestaurantUserContext` (id, restaurant_id, role, permissions, closingHour). Super admins are a
separate authority (`isSuperAdmin`), NOT a `restaurant_user`.

## Permission flow
`lib/permissions.ts` is authoritative. `restaurant_admin` bypasses all checks; employees hold a
`permissions text[]`. Helpers group tiers with **write-implies-read** (`ROOM_ACCESS`,
`STOCK_ACCESS`, `PAYROLL_ACCESS`). Nav (`getStaffNav`, sidebar) is **derived from permissions**
so visible items always match what route guards allow; each page AND each action re-checks
server-side. Staff CRUD is **super-admin authority** (`app/actions/staff.ts`), not restaurant
permissions. See `decisions.md` for the room three-tier and the stock/purchases/vendors split.

## Session flow
A **session** is one open visit at a table or room (`sessions`, unique index = one open per
table/room). Customers attach to the session, not the QR. Orders (`session_orders` +
`session_order_items`) accrue under it; the bill (`payments`) settles it. **Session transfer**
moves the whole session (bill, orders, tickets, customer) to another table/room via ONE column
(`transfer_session` RPC + `session_transfers` audit). On close/checkout the table/room parks in
**Cleaning**.

## Billing flow
Items → a bill. **Mixed payments** split cash+online in lockstep (`payment-split.ts`); readers
must move both together or cash-in-hand corrupts. **Discounts** are PIN-gated (no PIN ⇒ no
discounts); the **net** amount IS the sale everywhere (no gross/net split). **Credit / unpaid
bills** use an **accrual** model: the sale counts at billing time; money moves later via credit
functions. **Bill numbers** are sequential, stamped by a DB trigger on payment, history-
preserving; unused numbers roll back on cancel/abandon (latest only).

## Stock flow
Stock is **DERIVED**, never stored (no `current_stock` column). `stock_report(restaurant,from,to)`
computes opening/purchased/used/adjusted/closing from `products.opening_stock` + purchases −
POS usage (`session_order_items` × `menu_item_products`, a M2M recipe) ± `stock_adjustments`.
Today's opening = yesterday's closing by construction (no nightly job). A sale's item row IS the
deduction; **cancellation is a dated release** (`cancelled_at`) so rejects/force-closes give
stock back without double-restoring. Purchases (`record_purchase` RPC) are the single source of
stock-in, vendor debt, and expense.

## Finance flow
`finance_report(restaurant,from,to)` derives everything from `payments`, credits, purchases,
vendor_payments — nothing stored except the one **opening-balance seed** (`finance_openings`).
Four balances tracked: **cash, online/bank, credit-to-us (receivable), credit-by-us (payable)**;
closing = opening + in − out, and a period's opening is the same sum at its start (carry-forward
cannot drift). Credit moves no cash on the day it's created.

## Printing flow
Each **workstation** owns an independent Order-Ticket sequence (prefix = `ticket_code`). An item
belongs to **one ticket for life** (`order_tickets.ticket_id`); OT numbers are assigned at
**print time** (commit-on-Print), with reprint history. Thermal layout (58/80mm) from
`settings.print_paper_width`; modal portals to body; gated on billing perms. Category→item
workstation is **trigger-enforced** in the DB (the "variant bug" was never about variants).

## Notification flow
web-push (VAPID). A new order computes the recipients = the order's workstations **∪** the
table-group's assigned staff, **disjoint** (no double-ring). Push is for signalling; the in-app
panel is the record. Payment/close pushes were removed deliberately.

## Realtime flow
`/api/realtime` holds an **SSE** stream per client; server writes broadcast channel events;
`useRealtime(channels, cb)` re-fetches on the client. Because the dashboard keeps an open SSE,
`networkidle` never settles — tests use content waits (login page has no SSE and is safe for
`networkidle`).

## PWA flow
Manifest + service worker make the app installable/offline-capable. `OfflineGate` blocks WRITE
actions while offline (both floor and admin) instead of queueing — money/stock mutations must
not be applied against stale state.

## Performance model
**Latency-bound, not query-bound**: every query is <1ms server-side; the cost is ~130ms per
round trip. Optimise by **removing round trips** (batch queries, `Promise.all`, nested embeds,
cache config) — **never** by adding indexes. Auth is local (no auth round trip). `tenantCache`
(restaurant_id in key AND tag) caches config with `updateTag` (read-your-own-writes) for
money-sensitive data. `/api/_perf` measures layers from inside prod.
