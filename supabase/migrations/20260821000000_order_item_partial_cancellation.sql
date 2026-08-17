-- =============================================================
-- UNIT-WISE ORDER ITEM CANCELLATION — the schema
--
-- THE BUG
-- `session_order_items` is an ALL-OR-NOTHING line model. `quantity` is written
-- once at insert and no code path anywhere updates it; cancellation is a
-- whole-row stamp (`cancelled_at`). So every consumer downstream — the bill, the
-- kitchen queue, stock, COGS, the folio, the guest's screen — asks one binary
-- question, `cancelled_at is null`, and then takes the FULL quantity.
--
-- "Cancel 1 of 3" is therefore not merely unimplemented, it is unrepresentable:
-- the request can only be executed as "cancel the line". Staff either overcharge
-- the guest for the two they still want, or write off all three.
--
-- THE MODEL
-- Counters on the line, plus an append-only EVENT LOG:
--
--   session_order_items.cancelled_quantity   units cancelled   (derived, by trigger)
--   session_order_items.served_quantity      units served
--   session_order_items.active_quantity      quantity - cancelled_quantity  (generated)
--   session_order_item_cancellations         one row PER CANCELLATION EVENT
--
-- Why both, when either alone looks sufficient:
--
--   * The COUNTER exists because PostgREST cannot aggregate a child table into an
--     embed. `active_quantity` being a real, selectable column is what keeps the
--     ~10 app-side reader changes mechanical and greppable.
--
--   * The EVENT LOG exists because `stock_report` dates a stock release by
--     `cancelled_at`, and ONE timestamp cannot date TWO partial cancellations.
--     Cancel 1 today and 2 tomorrow and the shelf must gain 1 today and 2
--     tomorrow. A single column would have to pick one day and be wrong about
--     the other — silently, since both numbers are positive.
--
-- WHAT IS DELIBERATELY PRESERVED
-- `cancelled_at` keeps its EXACT current meaning: "this whole line is gone". It
-- is stamped only when `cancelled_quantity = quantity`. That is what lets every
-- existing `cancelled_at is null` reader stay correct at the extremes while the
-- readers are migrated one at a time — including
-- `trg_release_ticket_numbers_on_item_cancel`, which releases the session's bill
-- number and must keep firing on the last unit.
--
-- ⚠️ Do NOT be tempted to redefine "fully done" as `cancelled + served = quantity`.
-- A fully SERVED line is not a cancelled one, and bill numbers would stop being
-- released.
--
-- THIS FILE CHANGES NO BEHAVIOUR. It adds columns, backfills them to match what
-- the whole-row model already says, and installs the triggers that will maintain
-- them. Every existing query returns exactly what it returned before.
-- =============================================================


-- ── 1. The counters ───────────────────────────────────────────────────────────

alter table session_order_items
  add column if not exists cancelled_quantity int not null default 0,
  add column if not exists served_quantity    int not null default 0;


-- ── 2. Backfill, and the ORDER MATTERS ────────────────────────────────────────
--
-- Cancelled first, unconditionally: a cancelled row cancelled all of its units.

update session_order_items
   set cancelled_quantity = quantity
 where cancelled_at is not null
   and cancelled_quantity <> quantity;

-- Served second, and ONLY for rows that are not also cancelled.
--
-- ⚠️ The `cancelled_at is null` guard is load-bearing, not defensive noise.
-- `reject_table_activation` cancels every live item WITHOUT filtering
-- `item_status <> 'served'` (the other three cancel paths do filter it), so a row
-- that is both served and cancelled is reachable. Backfilling both counters to
-- `quantity` on such a row would make `served + cancelled = 2 × quantity` and the
-- CHECK below would refuse to be created — on production, mid-migration.
-- Measured 0 such rows on dev and prod today; the guard is what keeps that from
-- being a fact we merely got lucky on.

update session_order_items
   set served_quantity = quantity
 where item_status = 'served'
   and cancelled_at is null
   and served_quantity <> quantity;


-- ── 3. The invariant ──────────────────────────────────────────────────────────
--
-- This is the constraint the whole design rests on. It is what replaces the old
-- "a row can only be cancelled once" proof: with per-event releases, nothing
-- structural stops a second event, so over-cancellation has to be refused here.
--
-- It is also what makes the stock arithmetic provably non-negative downstream —
-- `stock_report` relies on the released quantity being a subset of the reserved
-- quantity, and `Σ events ≤ quantity` is exactly that claim.

alter table session_order_items
  drop constraint if exists session_order_items_unit_counts_check;
alter table session_order_items
  add  constraint session_order_items_unit_counts_check
  check (
    served_quantity    >= 0
    and cancelled_quantity >= 0
    and served_quantity + cancelled_quantity <= quantity
  );


-- ── 4. active_quantity ────────────────────────────────────────────────────────
--
-- Generated + STORED rather than computed at every call site, so that a reader
-- which forgets to subtract is a compile/query error rather than a quiet
-- overcharge. STORED rewrites the table; measured 221 rows on dev and 5,111 on
-- production, so the rewrite is trivial. Re-measure before assuming that holds.
--
-- It is NOT `quantity - cancelled - served`: a served unit is still sold, still
-- billed and still consumed from stock. Only a cancelled unit leaves the bill.

alter table session_order_items
  add column if not exists active_quantity int
  generated always as (quantity - cancelled_quantity) stored;


-- ── 5. The event log ──────────────────────────────────────────────────────────

create table if not exists session_order_item_cancellations (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references session_order_items(id) on delete cascade,
  -- Denormalised so the stock views and every tenant filter can scope without a
  -- two-hop join back through session_orders. Same trade the rest of the schema makes.
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  qty            int  not null check (qty > 0),
  reason         text not null,
  cancelled_by   uuid,
  cancelled_at   timestamptz not null default now(),
  -- Belt-and-braces idempotency. The RPC's real guard is a compare-and-swap on
  -- the remaining count; this stops an exactly-repeated request from landing twice
  -- even if the caller retries with a stale expectation it happens to still match.
  request_id     uuid,
  -- Set once a void ticket has been printed for this event, so "reprint the void
  -- KOT" has a source of truth — the same hole `session_order_items.ticket_id`
  -- was invented to close for the original ticket.
  void_ticket_id uuid references order_tickets(id) on delete set null
);

-- Same value list as session_order_items_cancel_reason_check. Kept as its own
-- constraint rather than an enum for the same reason the original was: adding a
-- value to an enum needs its own migration and its own deploy window.
alter table session_order_item_cancellations
  drop constraint if exists session_order_item_cancellations_reason_check;
alter table session_order_item_cancellations
  add  constraint session_order_item_cancellations_reason_check
  check (reason in ('order_rejected', 'session_closed', 'order_cancelled', 'item_cancelled'));

create unique index if not exists session_order_item_cancellations_request_uq
  on session_order_item_cancellations (order_item_id, request_id)
  where request_id is not null;

create index if not exists session_order_item_cancellations_item_idx
  on session_order_item_cancellations (order_item_id);

-- Dated lookups drive every stock release leg.
create index if not exists session_order_item_cancellations_at_idx
  on session_order_item_cancellations (restaurant_id, cancelled_at);

alter table session_order_item_cancellations enable row level security;
revoke all on session_order_item_cancellations from anon, authenticated;
grant all on session_order_item_cancellations to service_role;


-- ── 6. Backfill the log from the whole-row cancellations ──────────────────────
--
-- This is what makes the NEXT migration numerically a no-op: once every existing
-- cancellation has an event row carrying the same qty and the same timestamp,
-- rewriting the stock readers to sum events returns byte-identical figures.
-- Verify exactly that way — snapshot stock_report before and after and diff.

insert into session_order_item_cancellations
  (order_item_id, restaurant_id, qty, reason, cancelled_by, cancelled_at)
select soi.id, so.restaurant_id, soi.quantity,
       soi.cancel_reason, soi.cancelled_by, soi.cancelled_at
  from session_order_items soi
  join session_orders so on so.id = soi.order_id
 where soi.cancelled_at is not null
   and not exists (
     select 1 from session_order_item_cancellations ev
      where ev.order_item_id = soi.id
   );


-- ── 7. Maintaining the counter ────────────────────────────────────────────────
--
-- The event log is the truth; the counter is a cache of it. Recompute from the
-- log rather than incrementing, so a replayed or deleted event can never leave
-- the two disagreeing.
--
-- ⚠️ The parent UPDATE is unconditional on purpose. `rs_ev_order_items` fires on
-- session_order_items, not on this child table, so a write that touched only the
-- child would notify nothing and every other device would keep showing the old
-- quantity with no error and no way to notice.

create or replace function apply_order_item_cancellation()
returns trigger
language plpgsql
as $$
declare
  v_total int;
  v_qty   int;
begin
  select coalesce(sum(ev.qty), 0) into v_total
    from session_order_item_cancellations ev
   where ev.order_item_id = new.order_item_id;

  select soi.quantity into v_qty
    from session_order_items soi
   where soi.id = new.order_item_id;

  update session_order_items soi
     set cancelled_quantity = v_total,
         -- The whole-line stamp, and ONLY on the last unit. cancelled_at and
         -- cancel_reason move together or session_order_items_cancel_consistency
         -- refuses the write.
         cancelled_at  = case when v_total >= v_qty
                              then coalesce(soi.cancelled_at, new.cancelled_at)
                              else null end,
         cancel_reason = case when v_total >= v_qty
                              then coalesce(soi.cancel_reason, new.reason)
                              else null end,
         cancelled_by  = case when v_total >= v_qty
                              then coalesce(soi.cancelled_by, new.cancelled_by)
                              else soi.cancelled_by end
   where soi.id = new.order_item_id;

  return new;
end;
$$;

drop trigger if exists trg_apply_order_item_cancellation on session_order_item_cancellations;
create trigger trg_apply_order_item_cancellation
  after insert on session_order_item_cancellations
  for each row execute function apply_order_item_cancellation();


-- ── 8. Keeping item_status and served_quantity in step ────────────────────────
--
-- These two describe the same fact at different resolutions, and BOTH are written
-- during the rollout: the currently deployed build writes `item_status` directly
-- (`updateOrderItemStatus`), while the new one will write `served_quantity` via
-- an RPC. A trigger that only derived one from the other would break whichever
-- side it wasn't watching — so this syncs in whichever direction was written.
--
-- That is what makes this file safe to apply BEFORE the app deploy, which is this
-- repo's standing rule.
--
-- The derivation: a line is 'served' once every unit still on the bill has been
-- served. A PARTIALLY served line therefore reads 'pending' and stays reachable by
-- the cancel RPCs' `item_status <> 'served'` filter — which is precisely what
-- lets "serve 2 of 3, then cancel the last 1" work.

create or replace function sync_order_item_served()
returns trigger
language plpgsql
as $$
declare
  v_active int := new.quantity - new.cancelled_quantity;
begin
  if new.served_quantity is distinct from old.served_quantity then
    -- The new app wrote units; derive the flag.
    new.item_status := case
      when new.served_quantity > 0 and new.served_quantity >= v_active then 'served'
      else 'pending'
    end;
  elsif new.item_status is distinct from old.item_status then
    -- The old app wrote the flag; derive the units.
    new.served_quantity := case
      when new.item_status = 'served' then greatest(v_active, 0)
      else 0
    end;
  elsif new.cancelled_quantity is distinct from old.cancelled_quantity then
    -- Cancelling the last UNSERVED units completes the line, so re-derive the flag.
    -- Serve 2 of 3 then cancel the 1 remaining ⇒ active 2, served 2 ⇒ 'served'.
    --
    -- ⚠️ served_quantity is deliberately NOT clamped here. Cancellation may only
    -- ever consume unserved units, so `served > active` means something upstream
    -- is wrong — and clamping would turn that into silent data loss (served units
    -- quietly forgotten, their stock quietly restored) instead of the loud
    -- session_order_items_unit_counts_check failure it should be.
    new.item_status := case
      when new.served_quantity > 0 and new.served_quantity >= v_active then 'served'
      else 'pending'
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_order_item_served on session_order_items;
create trigger trg_sync_order_item_served
  before update on session_order_items
  for each row execute function sync_order_item_served();


notify pgrst, 'reload schema';
