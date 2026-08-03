# Current Task

The single in-flight task. When it's done, move a summary to `completed.md`, note user-facing
changes in `changelog.md`, and reset this file to the template below.

---

## Current Feature
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
   unchanged between the env files), then the hourly `daily-summary-emails` job. Do it only once the
   app is deployed at the new base URL, or it fires hourly into nothing.
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
