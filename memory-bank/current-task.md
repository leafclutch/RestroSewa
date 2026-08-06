# Current Task

The single in-flight task. When it's done, move a summary to `completed.md`, note user-facing
changes in `changelog.md`, and reset this file to the template below.

---

## Current Feature
**Workstation reporting: Purchases by station + a new Deduction Report (2026-08-06) — CODE COMPLETE,
verified on DEV.** The follow-on the mapping's analysis pointed at: purchases and waste were the two
things the POS could never answer by station.

**A wrong premise, corrected before building.** The request was "add the workstation filter to
purchase and waste reports". There WAS no waste report — `stock_adjustments` rows were written by
the Manual Deduction form and then only ever read one product at a time inside `product_history`.
So that half was building a report, not filtering one.

**Purchases filter at the LINE, not the bill.** One supplier bill routinely mixes 4kg of chicken
(Kitchen) with two crates of beer (Bar), and `purchases.total_amount` is the sum of both — so
filtering bills would have reported the chicken as bar spend. Picking a station switches the list to
purchase LINES with their own total; "All" is the familiar bill list, untouched. Verified with a
deliberately mixed ₹9,060 bill: Bar took 8848 + CocaCola, Kitchen took 8848 + Chicken, neither saw
the other's lines. Note Bar + Kitchen can EXCEED the bill total when a product is on both stations —
the banner says so rather than hiding it.

**Deduction Report** (`/admin/deductions`, `/employee/deductions`, `view_stock`, read-only) — named
"Waste report" when first built, then renamed **throughout**: label, heading, routes, files
(`app/actions/deductions.ts`, `lib/deductions.ts`) and identifiers (`DeductionRow`,
`getDeductionReport`, `summariseDeductions`, `deductionsHref`). The reason label **"Waste"** was
deliberately left alone — it is one of the six deduction reasons and `stock_adjustments.kind` still
stores `waste`. Period picker reusing
`businessPeriodBounds`, station + reason filters, value-removed total and a by-reason breakdown.
Corrections that ADD stock are counted separately and never netted against the loss. Value uses each
product's CURRENT `last_unit_cost` — an estimate the screen states, and one my own test proved:
recording a purchase moved the value of that product's earlier waste (₹5,952 → ₹5,953).

**Shared, not copied three times:** `lib/workstations/stations.ts` holds the one definition of the
filter rule (`matchesStation`, the `all`/`none` sentinels, `filterableStations`) and
`components/station-chips.tsx` the one chip row; Stock was refactored onto both. `lib/deductions.ts`
holds `summariseDeductions` so the action and the screen total identically — the screen re-totals after a
station filter with no round trip. (A first draft had that as a server action; pure arithmetic over
a round trip is exactly wrong in a latency-bound app.)

Files: `app/actions/deductions.ts`, `lib/deductions.ts`, `lib/workstations/stations.ts`,
`components/station-chips.tsx`, `app/(admin)/admin/deductions/*`,
`app/(employee)/employee/deductions/*` (new); `app/actions/purchases.ts` (`getPurchaseLines`), both
purchases pages + client, both stock pages + client.

**Verified on DEV in a browser:** waste totals reconcile (3337.47 + 1304.97 + 710 + 600 = 5952.44,
with a +₹330 correction excluded); the kitchen filter re-totals to ₹5,292 and drops the Bar-only
product and its correction; station switches fire **0 fetch calls** on all three screens; "All"
restores the bill list; 375px has no horizontal overflow; the employee routes render on employee
chrome. Fixed one real defect found this way: JSX ate the space before an em dash, rendering
"purchases— other". `tsc` and `build` clean. Dev data restored (seeded waste rows and the test
purchase deleted, `last_unit_cost` recomputed from remaining purchases, assignments cleared).

**Remaining — ops only:** unchanged from below — apply `20260806000000` to production. No new
migration: both features read tables that already exist.

---

## Previous feature — shipped
**Product ↔ Workstation mapping (2026-08-06) — CODE COMPLETE, verified on DEV.**
Products had no station while menu items always have had one, so Stock was a single
undifferentiated list. Added `product_workstations` (M2M, `restaurant_id` carried) +
`set_product_workstations` (whole-set replace, cross-tenant station ids filtered out), a
multi-select on the product form, station-grouped listing and a **client-side** station filter
(zero round trips — `rows` already holds every product).

**The load-bearing claim, and how it was proved:** this is metadata, not mechanism.
`set_product_workstations` is the ONLY DB object referencing the table (checked via `prosrc`), and
`stock_report` returns byte-identical output with stations cleared, set, and reassigned. Nothing in
the deduction path changed.

**Design rule recorded in `modules/stock.md`:** station-level POS consumption was *already*
derivable from `session_order_items.workstation_id`, so this mapping's real value is purchases and
waste (which had no path to a station at all). Usage reports must key on the MENU ITEM's station,
purchases/waste/holding on the PRODUCT's station — they can disagree.

Files: `supabase/migrations/20260806000000_product_workstations.sql` (new), `app/actions/stock.ts`,
`app/(admin)/admin/stock/_components/stock-client.tsx`, both stock pages, `types/database.ts`.

**Verified on DEV in a browser:** legacy products render under Unassigned with unchanged figures;
create with two stations lists under both; edit assigns and clears; the filter fires **0 fetch
calls**; a group split across a page boundary repeats its header on page 2; mobile (375px) and the
employee surface both correct; a `view_stock`-only user sees grouping + filter but no write
controls. DB-level: cross-tenant station id dropped, workstation delete cascades instead of
blocking, `delete_product` still works on a product that has stations. `tsc` and `build` clean.
Dev data was restored afterwards (test product deleted, all assignments cleared).

**Remaining — ops only:** apply `20260806000000` to production (`node scripts/migrate.mjs up --prod
--yes`). Purely additive; the app tolerates the table being absent only insofar as the query would
error, so **DB before app**.

⚠️ `npm run lint` is misleading in this repo: the flat config has no `files` key, so ESLint 10 skips
every `.ts`/`.tsx` file and only lints `.next/` build output (~2000 pre-existing errors). Unrelated
to this change, but don't read it as coverage.

---

## Earlier feature — shipped
**Room billing unification (2026-08-04 → 05) — CODE COMPLETE.** Guest identity at check-in, and the
room bill rendered through the shared `BillTicket` so the document is the same before and after
payment. Full write-up in `completed.md`; design + plan in
`docs/superpowers/{specs,plans}/2026-08-04-room-billing-unification*`.
**Remaining — ops only:**
1. `node scripts/migrate.mjs up --prod --yes` (migrations `20260804000000`, `20260804010000`).
   Additive, every new RPC parameter defaults, so the DB can go **before** the app; rolling the app
   back alone is safe because the old argument lists still resolve.
2. Deploy, then on the live hotel client ("Sanjib") check one guest in with an ID, check them out
   with a small discount, and confirm `payments.discount_amount` and the Sales bill.
**Verified on DEV end to end:** check-in → room-service order → extra charge → unpaid bill →
mixed checkout with a ₹180 discount → the same bill in Sales. Lines 1500 + 300 + 380 = 2180,
less 180 = **2000 = `payments.total_amount`**. A pre-existing stay with null identity columns still
renders (no ID line, no crash) and now shows its room charge for the first time. A paid **table**
bill is unchanged. `tsc`, `lint`, `build`, `node --test` all clean.
Follow-up in the same batch: the folio now prints a **receipt** after checkout (PAID + tender +
cashier, or PARTIALLY PAID + BALANCE DUE on credit) instead of "Status: UNPAID", and its panel
totals include the recorded discount. Verified across cash, mixed and credit; a live stay still
prints BILL / UNPAID. Then: the room discount now requires the **same** discount PIN as a table
(it had only the permission check), the Cash + Online split auto-fills, and the room page reads the
cached `getRestaurantConfig` instead of its own `restaurants` select.

---

## Earlier feature — shipped
**Thermal printing fixes (2026-08-03).** Six reported defects in printed KOT/BOT/bill output reduced
to **three** real causes. Every receipt in the app goes through one `PrintModal`, so the fixes land
on the session bill, station tickets, room folio bill and credit receipt at once.

**A. Short tickets printed SIDEWAYS.** `@page { size: <w> <h> }` takes no orientation keyword — the
larger value decides. `measureAndSetPage` emitted the paper width × *measured content height*, so a
one-item KOT produced `80mm × 62mm`, i.e. **landscape**, and the browser rotated it 90°. A bill
measured `80mm × 93mm` and came out upright **from the same line of code**. Verified by rendering
both tickets in a real browser: KOT 216px→62mm, bill 335px→93mm. Fixed by clamping
`heightMm = Math.max(contentMm, paperWidthMm + 1)`. Cost: a tiny ticket now feeds ~81mm. There is no
way to ask for "portrait, shorter than wide", and `size: 80mm auto` is invalid CSS that is dropped
wholesale (the Letter fallback the old comment describes).

**B. The "duplicate date/time/branding" and the URL + `1/1` are the BROWSER's print header/footer.**
`app/layout.tsx:20` sets `title: "HRestroSewa"`; Chrome prints date+title at the top and URL+page
number at the bottom. **No stylesheet can remove them.** Code-side lever: the `@page` rule (with
`margin: 0`) now lives in a `<style>` created via `document.createElement` in `<head>` instead of a
React-rendered one inside the portal — React can never reconcile it away, and a zero page margin makes
Chrome default Margins to "None". The rest is a one-time dialog setting, now surfaced as an
`rs-no-print` hint beside the Print button.

**C. Wasted height** was partly ours (logo, 8px divider margins, line-height 1.45, and a preview
padding that differed from print padding so preview ≠ print) and partly the printer's paper size.
Ours is fixed: one-item bill 93mm → **85mm**.

Also removed the logo from all printed receipts (thermal heads are one-bit — a logo smears), split
`Date` into `Date` + `Time`, moved `PoweredBy` under a divider as a footer block, and fixed a real
data bug: `getCreditReceipt` ran its own 4-column query and so never read
`settings.print_paper_width`, silently printing credit receipts at 80mm for 58mm restaurants. It now
uses the shared cached `getRestaurantConfig`.

Files: `app/(employee)/employee/_components/bill-ticket.tsx` (engine + bill + credit ticket),
`session/[id]/_components/print-tickets.tsx`, `room/[stayId]/_components/folio-client.tsx`,
`credits/_components/credit-receipt.tsx`, `app/actions/credits.ts`.

**Remaining:** in-app QA on a real thermal printer at both 58mm and 80mm — especially that a
one-item KOT now comes out portrait. `tsc --noEmit` is clean.

---

## Previous task — awaiting cutover
**Migration to self-hosted Supabase on DigitalOcean (Coolify).** Schema, all production data and the
superadmin login now exist on the new stack
(`supabasekong-lvs0ylfrwhzhnrsinuobbqt8.139.59.237.233.sslip.io`, `.env.production001`,
**PostgreSQL 15.8** vs production's 17.6). Schema is built by replaying the repo's 72 migrations
rather than restoring a dump, so the new server's ledger is truthful from day one.
**Nothing is cut over yet** — production is still live and still taking orders.

## Files involved
- `scripts/lib/pg-http.mjs` — NEW. A `pg.Client`-shaped transport over Kong's `/pg/query`
  (postgres-meta, connects as `supabase_admin`/superuser). The self-hosted Postgres has no published
  port and a Docker-internal hostname, so this is how *everything* reaches it — no SSH, no exposed
  database port. Its one constraint: **no bind parameters**.
- `scripts/migrate.mjs` — added `--env <file>`, `--http`, `--no-ssl`. Each migration + its ledger row
  now go in ONE statement string, because under `--http` a transaction cannot span requests.
- `scripts/clone-db.mjs` — NEW. Data copier: FK-topological order, `session_replication_role =
  replica`, rows travel as dollar-quoted JSON through `jsonb_populate_recordset`. `--reset --yes`
  empties the destination for a retry.
- `scripts/copy-storage.mjs` — NEW. Moves Storage *bytes* (copying `storage.objects` rows alone
  yields broken links) and repoints `restaurants.logo_url`.
- `scripts/verify-parity.mjs` — NEW. Structure + row counts + derived values, both sides.
- `supabase/migrations/20260721000001_restaurants_type_check.sql` — NEW (split out of `…000000`).
- `supabase/migrations/20260801000000_service_role_grants.sql` — NEW.
- `supabase/migrations/20260801000001_lock_down_anon_access.sql` — NEW.
- `next.config.ts` — image `protocol` now derived from the URL (the new host is `http://`).
- `lib/realtime/bus.ts` — TLS now comes from the connection string (`?sslmode=disable`) instead of
  being hardcoded on, because the self-hosted Postgres runs with `ssl = off`.
- `.env.example` — documents quoting + `sslmode`.

## Completed
- **Repaired the Coolify stack and REBUILT the database from scratch (2026-08-03).** A redeploy had
  re-initialised the Postgres volume and destroyed the first copy; see Notes for the root cause. The
  stack now runs all 15 containers healthy, and the database was rebuilt and re-verified end to end.
- 73 migrations applied to the new server. `20260801000000` + `20260801000001` also applied to DEV.
- **Verified identical to production**: 45 relations, 445 columns, 65 enum labels, 56 functions,
  218 constraints, 156 indexes, 33 triggers, 315 grants — and all **28 derived-value checks**
  (`dashboard_stats`/`finance_report`/`finance_transactions`/`stock_report` × 7 restaurants) return
  identical output. Derived values are the check that proves relationships survived; row counts
  alone would not.
- 8,935 rows copied (42 `auth.users`, 42 `auth.identities`, 8,851 public across 44 tables) — the
  count grew because production kept trading; it is a fresh snapshot, not the earlier one.
- Superadmin `admin@restrosewa.com` present with the **same user id and a byte-identical bcrypt
  hash** — the existing password works, and it was never seen, typed or reset. All 42 logins carried
  over, so every staff PIN is unchanged too.
- 4 logos copied, `logo_url` repointed, verified served from the new host (200, correct bytes).
- `anon` verified BLOCKED (`42501 permission denied`) where the self-hosted image had given it full
  CRUD on every table.
- `tsc --noEmit` and `eslint` clean.

## Remaining
0. **DO NOT REDEPLOY THE STACK FROM COOLIFY until the `is_directory` flags are fixed.** Ten rows in
   Coolify's own `local_file_volumes` table still say `is_directory = true` for paths that must be
   FILES; a redeploy will try to recreate them as directories and re-break the stack. The one
   statement that fixes it permanently is in Notes.
1. **Delta re-sync at cutover.** Production is LIVE and still trading. The copy is a point-in-time
   snapshot. At cutover: freeze production, re-run
   `clone-db.mjs --env .env.production001 --http --reset --yes`, then `verify-parity.mjs`.
2. **`pg_cron` daily-summary job is NOT recreated on the new server.** Needs `pg_cron` + `pg_net` +
   `supabase_vault`, vault secrets `app_base_url` (new URL) and `cron_secret` (`CRON_SECRET` is
   unchanged between the env files), then the `daily-summary-emails` job — schedule `*/15 * * * *`,
   NOT hourly (pg_cron runs in GMT; see the Daily Finance Report entry in completed.md). Do it only
   once the app is deployed at the new base URL, or it fires into nothing.
3. **`lib/realtime/bus.ts` — SSL fault FIXED, hostname fault REMAINS.** The droplet's Postgres
   reports **`ssl = off`** (measured), and the file used to hardcode
   `ssl: { rejectUnauthorized: false }`, so node-postgres would have thrown *"The server does not
   support SSL connections"*. TLS is now read from the connection string via libpq's `sslmode`:
   default stays ON (hosted Supabase requires it and carries no sslmode), `?sslmode=disable` turns
   it off. Still open: `SUPABASE_DB_URL` is a **Docker-internal hostname**, so the listener only
   resolves if the Next.js app runs inside that same Docker network. Failure mode is SILENT — live
   updates stop, dashboards fall back to slow polls, nothing on screen says so. (The SSE `ready`
   event already carries `listening: false`, but no client consumes it yet.)
4. `.env.production001` now quotes `SUPABASE_DB_URL` and carries `?sslmode=disable`. DONE.
5. Nothing committed this session; user drives git.

## Risks
- **Two live databases.** Until the old project is frozen/decommissioned, writes can land in both.
- The new server is *ahead* of hosted production by two migrations (`20260729100000_security_pin`,
  `20260729200000_custom_items`) which were still pending there. Cut over rather than running both.
- PG 15.8 vs 17.6. No migration uses 16/17-only syntax (checked), and every parity check passes, but
  the version gap is real and worth remembering.

## Notes
- **"Degraded (unhealthy)" was a DATA BUG INSIDE COOLIFY, and no redeploy could ever have fixed it.**
  Ten rows in Coolify's `local_file_volumes` table carried `is_directory = true` for paths that must
  be files (`volumes/api/kong.yml`, the seven `volumes/db/*.sql`, both `volumes/functions/*/index.ts`).
  Coolify therefore created **directories** at those paths — and once a directory occupies a path,
  writing a file there fails forever, so the stack could never self-heal. The sibling stack
  `dv5eg4tzjaj4nhimc315gypj` on the same droplet has the identical rows set to `false`, which is what
  made the diagnosis certain. Consequences chained: `_supabase.sql` never ran → no `_supabase`
  database → Logflare crashed (`3D000 invalid_catalog_name`) → `analytics` never healthy → every
  service gated behind it sat in `Created`; `kong.yml` as a directory → Kong had no routes → the bare
  `404 page not found` on every endpoint; `functions/*/index.ts` as directories → edge functions dead.
  Two more files (`entrypoint.sh`, `volumes/api/kong-entrypoint.sh`) were written without the execute
  bit, which is the `exec: "/entrypoint.sh": permission denied` the user saw.
  **Fixed by** copying the ten templates from the healthy stack (they are pure `$VAR` templates — no
  secrets, no stack-specific values, verified), `chmod +x` on the two scripts, deleting the
  half-initialised DB volume so initdb re-ran properly, and `docker compose up -d`.
  **STILL TO DO — the durable half.** The ten flags are unchanged, so the next Coolify redeploy
  re-breaks it. Run on the droplet:
  ```
  docker exec coolify-db psql -U coolify -d coolify -c "update local_file_volumes set is_directory=false where is_directory and fs_path like '/data/coolify/services/lvs0ylfrwhzhnrsinuobbqt8/%' and fs_path ~ '\.(yml|sql|ts)$'"
  ```
  Post-deploy sanity check, since this failure looks exactly like a health-check flake — any mounted
  path that is a directory but should be a file:
  `find /data/coolify/services/<id> \( -name '*.yml' -o -name '*.sql' -o -name '*.ts' \) -type d`
- `cron.database_name = postgres` and the scheduler is running, but `pg_cron` is **not yet created**
  in that database — so Remaining #2 starts with `create extension pg_cron`.
- **`anon` had full CRUD on every table on the self-hosted stack.** Hosted Supabase grants it
  nothing; the self-hosted image ships `alter default privileges` granting `arwdDxt` to
  anon/authenticated from TWO grantor roles. Three tables also had no RLS. Since the anon key ships
  in the client bundle, that combination was exploitable — closed by `20260801000001`.
- Superadmin passwords were migrated by **copying the bcrypt hash**, which is portable between
  servers. Never ask for or reset a password when the hash can move.
- Previous task (**Assignment-scoped Staff Dashboard**) is code-complete and moved to
  `completed.md`; its outstanding user actions were: deploy, assign the 4 affected staff
  (Shining Crown `Cashier`; siddhatha `bijay`/`shivam`/`shubham`), and in-app QA.
- ~~Still pending USER ops on HOSTED production: **Security PIN** + **Custom items** migrations~~
  **DONE** — verified 2026-08-03: production has 70 of 73 applied; the only 3 pending are
  `20260721000001`, `20260801000000`, `20260801000001`, and all three were measured to be **no-ops
  against production's current state** (constraint present, service_role already on 45/45 relations,
  RLS already on all three tables, anon/authenticated hold no privileges). Superseded line kept for
  history:
  (`node scripts/migrate.mjs up --prod`) — moot if cutover happens first.

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
