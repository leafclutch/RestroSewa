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
