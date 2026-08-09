# Current Task

The single in-flight task. When it's done, move a summary to `completed.md`, note user-facing
changes in `changelog.md`, and reset this file to the template below.

---

## Current Feature
**Mock Bill / Demo Bill (2026-08-07) — CODE COMPLETE, not yet exercised in a browser.**
A Security-PIN-gated workspace at `/employee/mock-bill`, reached from a small **M** button on the
staff dashboard, that composes and prints a bill **identical on paper** to a real one while writing
nothing anywhere. For demos, customer previews, training and print-alignment testing.

**The isolation guarantee is structural, not policed** — the reason this design was chosen over the
brief's own suggestion of `mock_bills` / `mock_bill_items` tables. Every figure in this app is
DERIVED from `payments` / `session_order_items` / `purchases` / `stock_adjustments`, so a row that
is never written is invisible to stock, finance, sales, analytics, credits, vendor balances, bill
and OT numbers, push and the daily email — by construction. Mirror tables would instead have
created a permanent "and exclude the mock ones" clause for every future report author. Nothing is
persisted: the draft is React state and dies with the tab.

**The feature's entire server surface is one function that checks a PIN** (`unlockMockBill`). It
constructs no Supabase client, calls no RPC, and imports nothing from
`actions/pos|stock|finance|purchases|credits|notifications|push`. `lib/mock-bill/draft.ts` has zero
runtime imports. `lib/mock-bill/isolation.test.ts` asserts both against the SOURCE (15 tests, all
passing) rather than against behaviour — a write that fires on only one path is what a behavioural
test misses.

**Printing is the SAME component, not a copy.** `BillTicket` + `PrintModal` are purely
presentational, so the mock screen produces props and never renders a ticket line itself. That is
what makes "identical" true by construction and keeps it true when the real bill next changes. The
one distinguishing mark is a trailing **"· M"** on the bill number ("1024 · M"), applied by the
CALLER as a plain string — `BillTicket` never learns mock bills exist. No watermark, no
MOCK/DEMO/TEST anywhere.

**Migration: none.** `security_audit_log.operation` is plain `text` with no CHECK constraint, so
`open_mock_bill` was a one-line addition to the `SecurityOperation` union.

**Files:** `lib/mock-bill/draft.ts`, `lib/mock-bill/isolation.test.ts`, `app/actions/mock-bill.ts`,
`app/(employee)/employee/mock-bill/{page.tsx,_components/mock-bill-client.tsx,_components/mock-bill-editor.tsx}`
(new); `lib/security/authorize.ts` (+1 operation), `_components/bill-ticket.tsx` (+
`grandTotalOverride`, mock-only, undefined for every real caller so real bills are byte-identical),
`dashboard/page.tsx` + `dashboard/_components/staff-dashboard.tsx` (the M button).

**Its own permission: `print_mock_bills`** (group "Mock Billing", label "Print Mock Bills"), ticked
per staff member in the super-admin restaurant detail screen. NOT a rider on `close_bills` — a
receipt indistinguishable from a real one is a distinct act from settling a real table, and a
demo/sales account should be grantable with this and nothing else. **Off every job preset**, like
Payroll. Needed no UI work: `PermissionPicker` renders `PERMISSION_GROUPS` verbatim and
`parsePermissions` validates against `Object.values(PERMISSIONS)`, so `lib/permissions.ts` is the
single source. ⚠️ **Deploy consequence — the gate got NARROWER:** every cashier/receptionist who
could reach mock billing loses the M button until an admin ticks the new box. Owners
(`restaurant_admin`) bypass all checks and are unaffected.

**Six bill states, because "unpaid" is two different documents.** Cash / online / card / mixed /
**unpaid** (the PRE-payment bill, "Status: UNPAID") / **credit** — the latter being an *unpaid bill*
in this app's own vocabulary: closed with money still owed, printing Credit ID, "Credit a/c",
ON CREDIT or PARTIALLY PAID, and BALANCE DUE, with an optional down payment (cash / online /
cash+online). The credit `tendered` is DERIVED from the tender split, exactly as `paid-bill.tsx`
does it, so a mixed down payment can never disagree with the amounts printed beside it; the balance
floors at zero.

**Verified so far:** `npx tsc --noEmit` clean; `npm run build` clean with `/employee/mock-bill`
registered; `node --test lib/mock-bill/isolation.test.ts` 23/23; only the mock editor passes
`grandTotalOverride` (the folio, Sales reprint and session preview pass nothing); an
unauthenticated GET of the route returns `307 → /login`.

**Remaining — in-app QA (needs a login and a Security PIN set on DEV):**
1. **Print parity.** Print a real pre-payment bill to PDF, rebuild it on the mock page, print to
   PDF, diff. The only difference must be the " · M". Repeat at 58mm and 80mm.
2. **Isolation by measurement.** Record `dashboard_stats` / `finance_report` / `stock_report` /
   `restaurants.bill_number_next` / `workstations.ot_next`, run a full mock session with several
   prints, re-read and assert every value is unchanged; check Sales, Credits and the bell.
3. **Access control.** No `print_mock_bills` ⇒ no button and the route redirects; PIN cleared ⇒ same;
   direct URL ⇒ locked shell only; wrong PIN denied; both outcomes visible in Admin → Settings →
   Security activity.
4. **Devices** — phone portrait, tablet, installed PWA: item add/delete/reorder, the print modal
   opening on-screen (not trapped off-viewport), the sticky totals rail.
5. Nothing committed — user drives git.

---

## Parallel track — self-hosted stack (ops, 2026-08-09)
**Outage fixed + made self-healing; cutover gaps partly closed.** The DigitalOcean/Coolify stack
(`lvs0ylfrwhzhnrsinuobbqt8`) served nothing externally while all 14 containers were healthy:
`coolify-proxy` was not attached to the stack's Docker network, so Traefik had a router but no path
to Kong. Root cause was the proxy container being **recreated 2026-08-06 / started 2026-08-07** and
coming back without this network. Full write-up in `decisions.md`.

**Done:** reconciler installed (`/usr/local/bin/coolify-proxy-net-reconcile.sh` +
`coolify-proxy-net.timer`, boot + 5 min, only networks with a `traefik.enable=true` container,
idempotent) — **verified by detaching the proxy and watching it self-heal**, `/pg/query` back to
`200`. Migration `20260806000000` applied (ledger 76/76, RLS on, anon/authenticated zero).
`pg_cron` 1.6 extension installed.

`pg_cron` 1.6 extension installed, and the **daily-summary job is wired and PARKED**: vault secrets
set, `daily-summary-emails` scheduled `*/15 * * * *`, `active = false`, with `app_base_url` deliberately
pointed at `https://REPLACE-AT-CUTOVER.invalid`. Two interlocks on purpose — the droplet's
`report_deliveries` dedupe is per-database, so a job aimed at the live app would **re-send daily
reports real owners already had**. At cutover: set the real URL, then `cron.alter_job(…, active := true)`
(a plain `update cron.job` is permission-denied as `postgres`).

**Structure parity is 100% clean** against production — 46 tables, 452 columns, 65 enum labels, 57
functions, 223 constraints, 158 indexes, 33 triggers, 322 grants. The 18 parity failures are purely
DATA (stale snapshot), so a re-clone is sufficient; `clone-db --dry-run` resolves 15,139 rows.

**Open before cutover:**
1. ~~NO TLS~~ — **FIXED 2026-08-10.** Let's Encrypt cert via Traefik's file provider
   (`/data/coolify/proxy/dynamic/lvs0-supabase-tls.yaml`), zero downtime, no containers recreated;
   `.env.production001` moved to `https://`. Remaining: pick the **production domain** (sslip.io is
   fine for a migration target, not for production) and optionally add an http→https redirect.
2. ~~Realtime / `SUPABASE_DB_URL` gate~~ — **CLOSED: not an issue.** App and database move to DO
   together, so the Docker-internal hostname resolves and `lib/realtime/bus.ts` works untouched. Only
   a hybrid (Vercel app + DO database) would have broken it.
3. ~~Data re-clone~~ — **DONE 2026-08-10.** 15,139 rows cloned + 4 storage objects with `logo_url`
   repointed; `verify-parity` returns **ALL CHECKS PASSED**, including all 24 derived-value checks
   (6 restaurants × dashboard_stats/finance_report/finance_transactions/stock_report) — the only
   check that catches a mangled relationship. Droplet now reads restaurants 6 / payments 848 /
   users 42, matching production. ⚠️ **Do not run `clone-db --reset` again once the trial customer
   is onboarded — it empties the destination.**
4. **Nightly backups now exist** (`restrosewa-db-backup.timer`, 21:15 UTC = 03:00 Nepal, 14 kept,
   each dump verified with `pg_restore --list` before rotation). Previously the ONLY backup on the
   droplet was Coolify's own database. **Same-disk only** — pair with DigitalOcean snapshots.
5. **Sizing** — user chose to keep 3.9 GB / 2 vCPU despite 3.7 GB swap and load ~5.5. Note this will
   make a trial customer's performance look worse than DO really is (two Supabase stacks + Coolify).
6. **Rotate `GMAIL_APP_PASSWORD`** — exposed in a diff during the TLS work on 2026-08-10.

*Skipped by decision:* the Coolify UI redeploy (1a) — superseded by the reconciler; fold into cutover.

⚠️ **Do not diagnose the next "degraded" from the symptom.** A bare `404 page not found` is
Traefik's default body and matched two completely different causes on 2026-08-03 and 2026-08-09.
Triage order is in `decisions.md`.

---

## Previous feature — shipped
**Workstation reporting: Purchases by station + a new Deduction Report (2026-08-06).**
Shipped to production 2026-08-07 (`d59af56`); full write-up moved to `completed.md`. Nothing left.

---

## Earlier feature — shipped
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

**Remaining — ops only:** none. `20260806000000` was applied to production on 2026-08-07 (see the
current feature above for the verification). Note for next time: the app shipped BEFORE the
migration for about a day, and it degraded quietly everywhere that only READS the mapping
(`?? []` → everything reads as Unassigned) but not on `updateProduct`, which always calls
`set_product_workstations` and so showed "Saved the product, but its workstations didn't change" on
every product edit. **DB before app** for anything with a write path.

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
