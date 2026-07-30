# Current Task

The single in-flight task. When it's done, move a summary to `completed.md`, note user-facing
changes in `changelog.md`, and reset this file to the template below.

---

## Current Feature
**Assignment-scoped Staff Dashboard.** Made table/room assignment the SINGLE source of truth for
dashboard visibility + actions. Built and verified on DEV (`tsc --noEmit` clean; read-only prod DB
check confirms no ungrouped tables + the 4 staff who flip ALL→NONE). No new migration. See the
`decisions.md` "Assignment is the SINGLE source of truth" entry + `modules/permissions.md`.

## Files involved
- `lib/assignments.ts` — core rule (`viewerSeesAllGroups` → admin-only) + new `resolveViewerScope`
  (ID-set scope for DB-level filtering; `includeWalkins` from walk-in perms).
- `app/actions/pos.ts` — `getTableStatusOverview` (`.in("group_id", groupIds)` when `!seesAll`);
  `getSalesReport`/`exportSalesCsv` (in-action row filter by assignment predicate — scopes every
  figure); `submitPayment`, `forceCloseSession`, `cancelOrder`, `cancelOrderItem` gated
  (`canAccessSession`); `getMyOrderQueue` left in-memory-scoped (shared with workstation staff).
- `app/actions/rooms.ts` — `getRoomsOverview` (`.or(id.in / room_type_id.in)`; empty ⇒ no rooms).
- `app/actions/{rooms,transfer}.ts` — audited, already pure assignment checks (no change).

## Completed
- All code edits applied; `tsc --noEmit` clean.
- Read-only prod verification: no ungrouped active tables anywhere; 4 non-admin `manage_tables`
  holders with zero assignments will see a blank board until assigned (Shining Crown `Cashier`;
  siddhatha `bijay`/`shivam`/`shubham`).
- Decisions locked with user: (a) ship strict model as-is platform-wide, admins assign those 4;
  (b) keep Sales in-action filtering (no `sales_report_scoped` RPC/migration).
- Memory Bank updated.

## Remaining
1. Deploy the app code (user drives git; nothing committed this session).
2. **User assigns the 4 affected staff** to their table-groups so they don't see a blank board.
3. Manual in-app QA once deployed: as an assigned cashier — Tables/Orders/Sessions/Sales show only
   assigned groups and Sales totals match only those tables; billing/closing an unassigned table is
   refused. As admin — everything still visible. Kitchen staff still see their station's orders;
   walk-in staff still see walk-ins.

## Risks
- Platform-wide behaviour change: any non-admin who relied on `manage_tables → sees everything` now
  sees nothing until assigned. Mitigated by (2) above; no ungrouped tables exist so nothing else
  regresses.

## Notes
- **Daily Finance Report scheduler — NOW LIVE in prod (2026-07-29).** Root cause of "automatic
  email never sent": the pg_cron scheduler was never provisioned in ANY environment (no pg_cron/
  pg_net extensions, no `cron.job`, no Vault secrets) — manual "Retry" worked only because it calls
  `sendDailySummary` directly, bypassing the whole scheduler. Fixed by installing `pg_cron`+`pg_net`,
  storing Vault `app_base_url`=https://hrestrosewa.leafclutch.com.np + `cron_secret`(=Vercel
  CRON_SECRET), and scheduling `daily-summary-emails` (`0 * * * *`). Verified: a live test POST sent
  the 2026-07-28 report to Sanjib's 3 recipients (`report_deliveries` status=sent). The code was
  never at fault. Business-day/timezone logic (`lib/business-day.ts`) is correct. NOTE: the enabled
  restaurant is **"Sanjib"** (id e1c3b58a, was briefly "Leaf Clutch"); "testSanjib" is an unrelated
  decoy that is NOT opted in.
- Still pending USER ops: **Security PIN** + **Custom items** prod migrations
  (`node scripts/migrate.mjs up --prod` — both pending) + in-app QA. See those module docs.

---

### Template (reset to this when idle)
```
## Current Feature
(none — idle)
## Files involved
## Completed
## Remaining
## Risks
## Notes
```
