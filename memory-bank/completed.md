# Completed

Chronological log of meaningful shipped features (newest first). Not every commit — only
features worth remembering. Dates are approximate to the work, not necessarily merge dates.

## 2026-08 — Thermal print: the page is the PRINT HEAD (72mm), not the roll (80mm)
Receipts printed at 100% lost their right-hand column — `BOT-0002…`, `4 Aug 202…`,
`Diwakar Gupt…` all truncated on real paper — and printing at 80-85% "fixed" it.
**Root cause:** an "80mm printer" takes an 80mm roll but its head covers only **72mm** (576 dots
at 203dpi); ~4mm each side is physically unprintable, and a thermal driver advertises its paper
as that printable width ("80(72.1) x 297mm"). We authored the page at the ROLL width, so an 80mm
layout was rendered into a 72mm sheet and the right 8mm fell off. 80mm × 0.85 ≈ 68mm is simply
the first scale that fits inside 72mm — which is why manual scaling looked like a cure.
Fix: `PRINTABLE_MM = { 58: 48, 80: 72 }`; the `@page` size, the ticket width, the measurement and
the on-screen preview all use the printable width now (the preview was lying about what fits on a
line). Side padding 2mm → 1mm, since the page no longer contains the dead zone.
Also **`TAIL_MM` 4 → 10**: blank feed after the last line so the cutter doesn't come down through
the footer. Verified in-browser on a real bill and a real reprint: `@page { size: 72mm 115mm }`
and `72mm 73mm`, ticket 72mm wide, zero horizontal overflow, and the short ticket still clears
the portrait clamp (73 = 72+1) so nothing rotates to landscape.
*Files:* `app/(employee)/employee/_components/bill-ticket.tsx`.
*Untested on hardware:* the 58mm path (48mm) — same lookup, but no 58mm printer here.

## 2026-08 — Pull-to-refresh: bounded spinner, and the pull now actually updates the dashboard
Two separate faults behind "the loader spins too long".
**(1) The arrow was tied to the whole route render.** `startTransition(() => router.refresh())` +
`isPending` means the spinner waits on the SLOWEST of the dashboard's ten sections. It now reports
"a refresh is running": 400ms floor (below that a refresh reads as "nothing happened"), stops when
the transition lands, 1.5s hard cap.
**(2) The refresh updated almost nothing.** Tables/Walk-ins/Rooms/Orders are client components
seeded from `initial*` props, and React never re-seeds `useState` from props — so the pull re-ran
every query and discarded it (the trap already noted in `tables-grid.tsx:174-178`). Each now
adopts fresh props via `useEffect(() => setX(initial), [initial])`. **Proven A/B** with the SSE
stream blocked so only the pull could surface a change: renamed a table in the DB with the page
open → old code still showed the stale name after pulling; new code picked it up.
**MEASURED, and it killed the obvious design:** the tempting fix is per-section refetch
(`resyncAll()` waking every `useRealtime` subscriber). **Next.js serialises server actions** — one
in flight at a time — so that fired 13 QUEUED round trips, each starting the millisecond the last
ended: **~3.9s vs ~0.85s** for one `router.refresh()`, which renders its sections concurrently
server-side. Built it, measured it, threw it away. Do not re-propose the fan-out.
**Also found and reverted:** the realtime contract is ONE CALL PER TOPIC, not per subscriber.
Collapsing a batch per subscriber looks free (finance-client listens for six topics and refetches
six times) but `customer-menu.tsx:1451` branches on the topic — re-reading the session only on
`"tables"` is how a guest's header follows a table shift.
*Files:* `components/pwa/pull-to-refresh.tsx`, `app/(employee)/employee/dashboard/_components/
{tables,walkins,rooms}-grid.tsx`, `app/(employee)/employee/queue/_components/orders-queue.tsx`.
*Not covered:* Sales/Credits keep their own filter state deliberately, so they refresh on the
realtime stream rather than on a pull.

## 2026-08 — Daily Finance Report: 45-minute delay fixed (pg_cron runs in GMT)
Reports were arriving **exactly 45 minutes** after closing. Root cause was the schedule, not the
code: **pg_cron schedules in GMT** (`cron.timezone`) and **Nepal is UTC+05:45**, so `0 * * * *`
fired at **:45 past every Nepal hour** — every `report_deliveries.sent_at` was `19:00 UTC` =
00:45 NPT for a midnight close. Every whole Nepal hour is UTC `HH:15`, so the schedule is now
`*/15 * * * *`: a tick lands exactly ON each restaurant's closing instant (mail out in seconds),
worst case after a missed tick is 15 min. Applied to prod and verified (tick at 03:15:00 UTC).
The quarter-hour cadence forces an auto-retry backoff — a `failed` row is now re-attempted
unattended at most every 30 min (`RETRY_BACKOFF_MS`), else one broken config would open ~288 SMTP
connections/day on the shared Gmail; the admin **Retry** button passes `force` and skips it.
The cron route also logs the resolved recipient list per restaurant per run.
*Also investigated:* "a removed recipient still gets the report" — the app was cleared by the
data: the delivery row for that day recorded ONLY the new address with `attempts = 1` (attempts
accumulates per send, so exactly one email left), prod has a single cron job, there is no
`vercel.json` cron, and the DigitalOcean clone has no `cron` schema. The duplicate is mail-level
(forward/POP/delegation between the two Gmail accounts), not a stale recipient list.
*Files:* `supabase/cron/daily-summary-cron.sql`, `lib/reports/daily-summary-send.ts`,
`app/api/cron/daily-summary/route.ts`, `docs/daily-summary-setup.md`.

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
