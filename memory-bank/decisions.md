# Decisions

Append-only log of architectural decisions and **why**. Never delete an entry — refine or add a
follow-up. This exists so future work doesn't re-propose things already chosen or rejected.

- **Derived stock, not cached.** No `current_stock` column; `stock_report` computes it from
  source rows. *Reason:* a cache drifts from the POS; a derived figure can't. Corollary: no
  nightly rollover job (today's opening = yesterday's closing by construction).

- **Cancellation is a dated release, not a compensating adjustment.** `session_order_items`
  carries `cancelled_at`. *Reason:* the item row IS the stock reservation; a second "release"
  row would let reject-then-force-close double-restore. Served items are never released.

- **Four derived balances.** Finance tracks cash, online/bank, credit-to-us (receivable),
  credit-by-us (payable); all derived by `finance_report`; only the opening seed is stored
  (`finance_openings`). *Reason:* closing = opening + in − out and a period's opening is the same
  sum at its start, so carry-forward can never drift. Credit moves no cash the day it's created.

- **Estimated profit is optimistic and MUST say so.** Cost is only known for menu items linked
  to a product, so unlinked dishes contribute revenue with zero cost. `dashboard_stats` returns
  `tracked_revenue` alongside `cogs`; the UI shows "₹X of sales have no cost data". Daily report
  profit = sales − purchases − salaries (purchases bought, not consumed) — labelled an estimate.

- **Business day = configurable closing time, pinned to Nepal.** Per-restaurant
  `business_closing_hour`; all date maths in `lib/business-day.ts` only; Nepal is a fixed
  UTC+05:45 (no DST). *Reason:* restaurants trade past midnight; those sales belong to the
  previous night. Anchor every period on `businessDate(now)`, never `now`'s calendar date.

- **Table/Room Cleaning status.** Tables/rooms park in "Cleaning" on close/checkout; only
  `cleaning_since` is stored, state stays derived. *Reason:* reflects the real turn-over workflow.

- **Session transfer is ONE column; the customer follows the session, not the QR.** Plus a
  one-open-per-table/room unique index. *Reason:* shifting a table must carry bill/orders/tickets
  atomically without duplicating a session.

- **Order-Ticket (OT) batching.** An item belongs to one ticket for life; OT numbers assigned at
  **print time** (commit-on-Print) with reprint history. *Reason:* stable kitchen references; a
  reprint must not renumber history, and a number must never be reused.

- **Mixed payments move cash+online in lockstep.** Every reader/writer moves both halves
  together. *Reason:* a one-sided update corrupts cash-in-hand.

- **Discounts are PIN-gated; the net amount IS the sale.** No PIN ⇒ discounts impossible. No
  gross/net split anywhere. *Reason:* one authorised number, no reconciliation ambiguity.

- **Bill numbers: sequential, trigger-stamped, history-preserving.** A DB trigger assigns the
  number on payment; changing the sequence only affects future bills; unused numbers roll back on
  cancel/abandon (latest only). *Reason:* legal/tax numbering must be gap-aware and immutable
  once issued.

- **Permission model.** `restaurant_admin` bypasses all checks; employees hold `permissions[]`;
  tiers use write-implies-read. Rooms are three tiers (`view_rooms` | `check_in` | `manage_rooms`
  via `ROOM_ACCESS`). Purchasing was split out of `manage_stock` into **`manage_purchases`**
  (record bills) and **`manage_vendors`** (vendor CRUD + pay). Staff CRUD is **super-admin
  authority** (not restaurant perms). Nav is derived from perms so it can't diverge from route
  guards. *Reason:* least privilege that matches real roles; a storekeeper isn't a buyer.

- **Latency-bound, not query-bound.** Optimise by removing round trips (batch, embed, cache),
  never by adding indexes; auth verified locally (no auth round trip). *Reason:* every query is
  <1ms; the cost is the ~130ms trip. (Dashboard action abort race fixed this way, not with
  optimistic UI — see `bugs.md`.)

- **Daily Finance Report design.** PDF via **pdf-lib** (not pdfkit — pdfkit reads font files via
  `fs` and won't bundle in Next). Sent from ONE HRestroSewa **Gmail SMTP** account (app
  password, server-only) — restaurants never configure SMTP, only recipients. Scheduled by
  Supabase **pg_cron** → secret-gated route targeting the **previous** business day; exactly-once
  via `report_deliveries`; retry on failure + manual retry. Built as a **reusable reporting
  service** (PDF chrome + mailer + orchestrator) so weekly/monthly reuse it. *Reason:* central,
  reliable, low-maintenance, extensible.

- **Two Supabase projects (dev/prod).** `.env.local` = DEV, `.env.production` = prod (local
  tooling only — Vercel runtime uses dashboard env). *Reason:* isolate real data. Never `>>` an
  env file without a trailing newline (it once corrupted `VAPID_SUBJECT`).

- **CSS traps to never reintroduce.** (1) Never re-add `inline` to the `@theme` in globals.css —
  it froze utilities to literal hex and made `.dark` inert. (2) Keep animation `fill-mode:
  backwards`, not `both` — `both` left an identity-matrix transform that trapped `position:fixed`
  modals off-screen on mobile (`.rs-page`).

- **Walk-ins are their own permission, enforced type-aware in shared actions.** `view_walkins` /
  `manage_walkins` (write-implies-read). Because walk-ins and tables share the session actions
  (`pos.ts`), a walk-in session (`type='walk_in'`) is guarded by `walkInWriteBlocked` INSIDE the
  mutating actions — so a staffer with dine-in order/billing perms but only `view_walkins` can't
  operate a walk-in. *Reason:* least privilege for a takeaway/delivery desk without duplicating
  the whole session pipeline. Backfill went to `close_bills` holders only.

- **Module visibility follows `restaurants.type`, not just permissions.** `lib/business-type.ts`
  (`hasRooms`/`hasRestaurant`) gates whole modules; a restaurant-only client hides Rooms
  everywhere (UI + permission editor + room-create actions), not just visually. *Reason:* a
  module that doesn't exist for a business type must not be navigable, grantable, or POST-able.
  `type` is exposed once via `getRestaurantConfig.businessType`. Hotel-only hiding of restaurant
  modules is deferred (helper ready).

- **Don't export sync helpers from a `"use server"` module.** It typechecks but 500s the route
  at runtime. Keep pure helpers in plain modules; import them into actions.

- **Assignment is the SINGLE source of truth for dashboard visibility — strict, admin-only bypass.**
  `viewerSeesAllGroups` (`lib/assignments.ts`) now returns true ONLY for `restaurant_admin`; the old
  `manage_tables → seesAll` blanket bypass is gone. Every other staff member — managers included —
  sees and can act on ONLY their assigned table-groups / room-types / pinned rooms, nothing until
  assigned. This single rule re-scopes every surface already using the predicate (Tables, Orders,
  Sessions, Rooms display + the order/billing write-gates). *Reason:* the requirement "a cashier/
  manager assigned to one floor sees only that floor" must hold for ANY permission combo, not be
  defeated by holding `manage_tables`. Capability perms (`close_bills`, `process_payments`) still
  gate WHAT you may do, but no longer WIDEN what you can see/touch. **Reads enforced at the DB:**
  `getTableStatusOverview` (`.in("group_id", groupIds)`) and `getRoomsOverview` (`.or(id.in /
  room_type_id.in)`); a viewer with no assignment matches nothing. `getMyOrderQueue` stays
  in-memory-scoped (its query is shared with workstation staff who need all active sessions; the
  non-workstation branch drops unseen sessions server-side before the result is built). **Sales
  scoped in the server action, not via an RPC** — `getSalesReport`/`exportSalesCsv` load the
  restaurant's payments (with `sessions(table_id,room_id)` + `room_stays(room_id)` embeds) and filter
  rows by the assignment predicate before deriving ANY figure; chosen over a `sales_report_scoped`
  SQL function to reuse the existing aggregation and ship no migration, still fully server-enforced.
  **Write-bypass removed:** `forceCloseSession` no longer lets `close_bills||manage_tables` skip the
  assignment check; `submitPayment`/`cancelOrder`/`cancelOrderItem` gate on the predicate
  (`canAccessSession`). **Walk-ins stay restaurant-wide** among walk-in-permitted staff (no group to
  scope by). *Deploy note:* a non-admin with `manage_tables` but no assignments now sees a blank
  board until assigned (4 such staff existed platform-wide at rollout — chosen: ship as-is, admins
  assign them). See `modules/permissions.md`.

- **Security PIN & sensitive edits: in-place edit + audit, not reversal.** A separate admin-only
  4-digit PIN (mirrors the Discount PIN's in-DB bcrypt storage) gates editing completed payments
  (re-tender) and purchases. Chosen **in-place mutation + a before→after audit row** over
  reversal/void entries. *Reason:* finance & stock are already DERIVED from `payments`/
  `purchase_items`, so an edited row simply re-derives correctly — the audit log is the
  immutability guarantee, and void semantics would have meant new bill/void numbers and teaching
  every report to net voids. It's built as a **reusable authorization service**
  (`verifySecurityPin` + `log_security_event` + a new `operation` string) so refunds/stock-reset/
  finance-reset reuse it. Purchase edits reconcile vendor credit in-transaction and **block**
  (`VENDOR_BALANCE_NEGATIVE`) rather than let a balance go negative; payment edits keep the
  amount/bill-number frozen and only re-split the tender (method is derived from the split). No
  PIN ⇒ these edits are OFF (no un-gated path). See `modules/security-pin.md`.

- **Self-hosted migration: replay migrations, copy data over Kong, never touch a password.**
  Moving to self-hosted Supabase on DigitalOcean/Coolify (2026-08-01). Four decisions worth keeping.
  **(1) Reach the database through `postgres-meta` at Kong's `/pg/query`, not SSH or an exposed
  port.** The container's Postgres has no published port and a Docker-internal hostname
  (`supabase-db-<id>`), so the obvious routes are an SSH tunnel or publishing 5432. Kong is already
  public, already authenticates the service-role key, and reaches the DB as `supabase_admin`
  (superuser) — so `scripts/lib/pg-http.mjs` wraps it in a `pg.Client` shape and nothing else had to
  change. No key on anyone's laptop, no database on the internet. *Its one constraint:* `/pg/query`
  takes a SQL string with **no bind parameters**, and one request is one connection (so a
  transaction cannot span requests — migrations and insert-chunks each carry their own
  `begin…commit`). **(2) Bulk rows travel as dollar-quoted JSON through
  `jsonb_populate_recordset`, not as escaped literals.** Hand-rendering ~7k rows into SQL is exactly
  where a data migration corrupts itself; instead Postgres parses the JSON and coerces from the
  table's own row type, so quotes, backslashes, newlines, emoji and Devanagari all survive
  untouched, `text[]` vs `jsonb` stops being a guess, and the 7 `GENERATED ALWAYS` columns are
  simply excluded from the column list. **(3) Schema comes from replaying the 72 migrations, not a
  dump** — so the new server's `supabase_migrations` ledger is truthful, and `pg_dump` version
  skew (source 17.6, destination 15.8) never enters the picture. **(4) Superadmin and every staff
  login migrate by COPYING THE BCRYPT HASH** from `auth.users`. Hashes are portable between
  servers, so the exact live password keeps working and no one — including whoever runs the
  migration — ever sees or resets it. Verified by comparing `md5(encrypted_password)` on both sides.
  *Proof of faithfulness is derived values, not row counts:* `dashboard_stats`/`finance_report`/
  `finance_transactions`/`stock_report` recomputed independently for all 7 restaurants return
  identical output (`scripts/verify-parity.mjs`) — counts agree perfectly on a database whose
  foreign keys all point at the wrong parents.

- **Enum ADD VALUE and its first use cannot share a migration.** `20260721000000` added
  `restaurant_hotel` to `restaurant_type` AND a CHECK constraint using it; Postgres rejects that
  (`55P04 unsafe use of new value … HINT: New enum values must be committed before they can be
  used`) because each migration runs in one transaction. It had never surfaced because that file was
  **baselined** — recorded as applied without ever running — on both existing projects, which had
  been changed by hand; a genuinely empty database was the first thing to execute it. Fixed by
  splitting the constraint into `20260721000001`, which keeps BOTH migrations atomic. Rejected the
  alternative (running the file outside a transaction) because it trades a real guarantee for
  nothing. **Baselining hides bugs — a baselined migration is untested SQL.**

- **Grants and the anon lockdown belong in migrations, not in the platform.** Two gaps that only a
  from-scratch build could expose. **(a)** No migration ever granted anything: hosted Supabase's
  default privileges silently supplied them, so a fresh database came out complete and unusable
  (`permission denied for table finance_openings`). Now `20260801000000` grants `service_role`
  explicitly, including `alter default privileges` so the next new table cannot reintroduce it.
  **(b)** The self-hosted image does the opposite — it grants `anon` and `authenticated` **full CRUD
  on every table**, from two grantor roles (`postgres` and `supabase_admin`), where hosted
  production grants them nothing. Three tables (`restaurant_user_rooms`, `restaurant_user_room_types`,
  `restaurant_user_table_groups`) had also never been RLS-enabled — the repo could not reproduce
  what production had set by hand. Since **the anon key ships inside the client bundle**, those two
  together meant a public key could read and rewrite staff-to-table assignment. `20260801000001`
  enables RLS on the three and revokes anon/authenticated, iterating `pg_default_acl` under
  `pg_has_role` so it also works where the migration runs as `postgres` (which is not a member of
  `supabase_admin`). Safe to revoke because there is **no client-side table access anywhere** —
  every server path uses the service-role client.

- **The self-hosted stack's "unhealthy" status was a data bug in Coolify, so we fixed Coolify's
  records — not the symptom.** Ten rows in Coolify's `local_file_volumes` table carried
  `is_directory = true` for bind-mount paths that must be files (`volumes/api/kong.yml`, the seven
  `volumes/db/*.sql`, both `volumes/functions/*/index.ts`). Docker creates a **directory** when a
  bind-mount source is missing, and once a directory occupies the path a file can never be written
  there — so the deploy was permanently broken and *no redeploy could fix it*. The proof was the
  sibling Supabase stack on the same droplet with the identical rows set to `false`. We rejected the
  tempting local fixes — patching the running database by hand (leaves a permanently
  half-initialised cluster, because `/docker-entrypoint-initdb.d` only ever runs on an empty
  PGDATA) and editing the compose to `entrypoint: ["/bin/sh", …]` (treats the symptom and leaves
  `kong.yml` and the init SQL still missing). Instead: restore the ten templates from the healthy
  stack — they are pure `$VAR` templates carrying no secrets and no stack-specific values, verified
  before copying — then delete the half-initialised volume so initdb re-runs correctly, and correct
  the `is_directory` flags so redeploys stop recreating the fault. **The lesson worth keeping: when
  a managed platform's output is wrong, look for the platform's own record of what it intended to
  build — and diff it against a working instance.**

- **A product's workstation is metadata, not mechanism — and a join table, not a column
  (2026-08-06).** Menu items have carried `workstation_id` (NOT NULL, `on delete restrict`) since
  the start because a dish that cannot be routed to a station cannot print. Products got the
  opposite treatment: `product_workstations` is a **nullable M2M** with `on delete cascade` on the
  station, so deleting a station **unassigns** its products instead of being refused. That
  asymmetry is deliberate — a product with no station is an ordinary product, so its tag carries no
  integrity meaning and must never block an operation. It is enforced by omission too: nothing in
  the deduction path reads the table, and `set_product_workstations` is the only DB object that
  mentions it (verified by scanning `pg_proc.prosrc`), so `stock_report` returns identical output
  with stations cleared, set or reassigned.

  **What the mapping does and does not buy, because it changes what is worth building next.**
  Station-level POS consumption was *already* derivable without it: `session_order_items` stamps
  `workstation_id` on every sold line, and `menu_item_products` leads from that line to the product.
  The mapping's real value is the things the POS never touches — **purchases** (`purchase_items`
  points at a product, full stop) and **waste/manual deductions** (same). So any future report must
  pick a side and say so: **usage keys on the MENU ITEM's station** (who physically made it),
  **purchases, waste and inventory-holding key on the PRODUCT's station** (who buys and keeps it).
  These legitimately disagree — coffee beans are tagged Bar + Kitchen while the *Coffee* menu item
  is Bar only — and averaging them produces a figure nobody can reconcile. Two standing constraints:
  a shared product double-counts under `group by station`, and unassigned products need a stated
  home in every such report rather than a silent omission.

  Rejected: extending `create_product`'s signature (it is live on three databases; a second call for
  a screen used a few times a year is not worth dropping and recreating a function), and a `primary
  station` column (adds a concept the requirement never asked for purely to make counts add up).

- **A purchase's station question is answered at the LINE, not the bill (2026-08-06).** One supplier
  bill routinely mixes 4kg of chicken (Kitchen) with two crates of beer (Bar), and
  `purchases.total_amount` is the sum of both. Filtering BILLS by station — the cheap
  implementation, one extra condition, summary cards untouched — would have reported the chicken as
  bar spend. So selecting a station switches the Purchases list from bills to purchase LINES with
  their own total, and "All" keeps the familiar bill list unchanged. Two consequences stated on the
  screen rather than hidden: Bar + Kitchen can EXCEED a bill's total when a product belongs to both
  stations, and the "today" stat cards stay whole-restaurant because cash/online/credit are facts
  about a whole bill and cannot be honestly apportioned across its lines.

- **Waste needed a REPORT before it could have a filter (2026-08-06).** `stock_adjustments` had been
  written since the stock module shipped and was only ever read back one product at a time, inside
  `product_history` — there was no way to ask what was thrown away this month. The new report is
  read-only, gated on `view_stock` (seeing what was lost is a stock read, not a finance one), and
  adds no table and no migration. Two rules it encodes: a correction that ADDS stock is counted
  separately and never nets against the loss (otherwise a +5 correction cancels a −5 wastage and the
  month reports nothing lost); and value is each product's CURRENT `last_unit_cost`, an estimate the
  screen states on its face, because no historical cost per movement is recorded anywhere —
  recording a purchase visibly moves the value of that product's earlier waste.

- **The station filter is one rule in one file, used by three screens.** `matchesStation` and the
  `all`/`none` sentinels live in `lib/workstations/stations.ts`, the chip row in
  `components/station-chips.tsx`; Stock was refactored onto both when Purchases and Waste arrived.
  Three copies of "does this belong to the Bar" is three chances for one screen to treat a
  multi-station product, or the Unassigned bucket, differently from the others. Likewise
  `summariseWaste` lives in `lib/waste.ts`, called by the action for the period and by the screen
  after a station filter — the same totals function either way. It is NOT a server action: pure
  arithmetic behind a ~130ms round trip is precisely the mistake the performance model warns about.

- **Mock bills write NOTHING, and that is enforced structurally rather than by convention
  (2026-08-07).** The Mock Bill feature had to print a document indistinguishable from a real
  receipt while touching no stock, sale, finance figure, credit, vendor balance, bill number, OT
  number, push or email. Two decisions carry the whole guarantee.

  **(1) No `mock_bills` / `mock_bill_items` tables — nothing is persisted at all.** The obvious
  design (mirror tables, filtered out of every report) was rejected because it inverts the safety
  property. Every figure in this app is DERIVED from `payments`, `session_order_items`, `purchases`
  and `stock_adjustments`; a mock row that is never written is invisible to all of them by
  construction, whereas mirror tables would create a standing "and exclude the mock ones" clause
  that some future `finance_report` or waste report author has to remember. Isolation you cannot
  forget beats isolation you must maintain. The cost is real and accepted: a mock bill cannot be
  saved or reused, and dies with the tab.

  **(2) The feature's entire server surface is ONE function that checks a PIN.**
  `app/actions/mock-bill.ts` exports only `unlockMockBill`; it constructs no Supabase client, calls
  no RPC, and imports nothing from `actions/pos|stock|finance|purchases|credits|notifications|push`.
  `lib/mock-bill/draft.ts` has zero runtime imports. There is no code that COULD write. That claim
  is asserted against the SOURCE by `lib/mock-bill/isolation.test.ts` rather than against behaviour,
  because a write that only fires on one path is exactly what a behavioural test misses. The one row
  the feature ever writes is a `security_audit_log` entry, which no money or stock report reads.

  **The mark is a caller-supplied STRING, not a prop on the shared component.** A mock bill differs
  from a real one by a trailing "· M" on the number ("1024 · M"). The editor passes
  `billNo={markBillNumber(n)}`, so `BillTicket` never learns mock bills exist — the alternative (a
  `isMock` prop) would put mock-awareness inside the component that prints every real receipt in the
  business. The single shared-component concession is `grandTotalOverride?: number`, undefined for
  every real caller, so real output is byte-identical; it exists because a demonstrator must be able
  to type a total rather than back-solve it out of prices.

  **The PIN gate lives ON the page, not behind a token.** `/employee/mock-bill` renders a locked
  shell; the editor component is not mounted until `unlockMockBill` returns ok. Rejected a
  short-lived signed cookie (needs a new secret, and a cookie is a second thing that can be wrong)
  and a dashboard-only overlay (no deep link, no PWA back button). Because the editor's existence —
  not merely its visibility — depends on a verified server response, there is no URL that reaches
  it. Gated on `close_bills`: someone who cannot settle a bill has no business printing something
  that looks like one. See `modules/mock-bill.md`.

- **Mock billing got its OWN permission rather than riding on `close_bills` (2026-08-07).**
  `print_mock_bills` (group "Mock Billing"), granted per staff member in the super-admin editor.
  *Reason:* producing a receipt indistinguishable from a real one is a distinct act from settling a
  real table — the same reasoning that split `manage_custom_items` out of `create_orders`. It also
  makes the useful case expressible: a demo or sales account can hold this and **nothing else**, no
  tables, no orders, no money. **Off every job preset**, like `view_payroll`, so nobody acquires the
  ability by inheriting a Cashier template. The Security PIN stays on top: the permission says
  *who*, the PIN says *prove it*. **Deploy consequence:** the gate got narrower, so every cashier
  who could reach mock billing loses the M button until an admin ticks the new box.

  *No plumbing was needed to make the checkbox appear*, and that is worth knowing before anyone goes
  looking for a UI to edit: `PermissionPicker` renders `PERMISSION_GROUPS` verbatim and
  `parsePermissions` (`app/actions/staff.ts`) validates against `Object.values(PERMISSIONS)`, so
  `lib/permissions.ts` is the single source for the editor, the presets and the server-side
  whitelist alike. Adding a permission anywhere else is a mistake.

  *A guard bug worth remembering, found by this change.* `isolation.test.ts` strips comments before
  searching source, and it stripped BLOCK comments first. `dashboard/page.tsx` contains the line
  comment `// ?focus=<section> — … a redirected legacy /employee/* page`, whose `/*` opened a match
  that ran to the next `*/` in the file and swallowed 3,689 characters — including the permission
  check being asserted. Line comments must be stripped FIRST. The guard had been passing for the
  wrong reason; a naive regex over source is fine as a tripwire but is not a parser, and its failure
  mode is silence.

- **The self-hosted stack's proxy attachment is now self-healing, and "degraded" has TWO causes —
  check the proxy network FIRST (2026-08-09).** The stack served nothing externally (bare
  `404 page not found`, `503 no available server`) while **all 14 containers were healthy** and Kong
  answered correctly on its own container IP from inside the droplet. Cause: `coolify-proxy` was not
  attached to the stack's Docker network, so Traefik built the router from Kong's labels but had no
  path to the backend. The proxy container had been **recreated 2026-08-06 18:09 / started
  2026-08-07 12:09** and came back attached to `coolify` and the sibling stack but not this one; the
  stack network itself was never recreated (`created 2026-07-30`, same id).

  **Why this is worth recording as a decision:** the 2026-08-03 outage had the *same external
  symptom* and a completely different cause (the Coolify `is_directory` data bug). Assuming the old
  cause cost half a session. A bare `404 page not found` is **Traefik's default body**, not evidence
  of anything specific. **Triage order:** `df -h` + `free -m` → `docker ps -a` (all healthy?) → curl
  Kong on its **container IP from the droplet** → **diff `docker inspect coolify-proxy` networks
  against the stack network** → only then the `is_directory` check.

  **Fixed durably rather than by hand.** `docker network connect` is runtime state: it survives a
  proxy *restart* but not a *recreation*, so the manual fix would have failed the same way at the
  next Coolify upgrade. Installed `/usr/local/bin/coolify-proxy-net-reconcile.sh` +
  `coolify-proxy-net.timer` (boot + every 5 min). It joins **only** networks containing a
  `traefik.enable=true` container — so it cannot wire the proxy into an unrelated network — and is
  idempotent, needing no edit when new stacks appear. Verified by deliberately detaching the proxy
  and watching the reconciler restore it and `/pg/query` return `200`. This converts a total outage
  into a ≤5-minute blip; it does not replace fixing a cause, it bounds the blast radius.

  Also corrected in the same session: the `is_directory` landmine is **already defused** (all 20
  rows correct, verified on disk too), the stack **is** a registered Coolify service (`services.id
  = 3` — the "hand-run outside Coolify" theory was wrong), and the droplet was **one migration
  behind** (`20260806000000`, since applied) with **`pg_cron` missing** (since installed; the JOB is
  still deliberately deferred to cutover). Droplet data is stale (payments 469 vs prod 847), so the
  cutover re-clone is mandatory regardless.
