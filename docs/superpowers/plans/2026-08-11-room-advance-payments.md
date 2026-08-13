# Room Advance Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a hotel take a deposit at check-in (and again mid-stay), deduct it from the final bill, and carry it correctly through cash-in-hand, the four derived balances and every report.

**Architecture:** One new table `room_advances` holding **signed** rows (positive = deposit, negative = refund), so "held on this stay" is `sum(amount)` and a refund needs no second table or second code path. `payments` gains `advance_amount`, recording how much of a bill was settled by money already received. Cash lands the day the advance is taken; the sale still books in full at checkout — the app's existing accrual rule, pointed the other way.

**Tech Stack:** Next.js 15 App Router (server actions), Supabase/PostgreSQL (all logic in RPCs called with **named** arguments), TypeScript, `node --test` for pure modules.

**Spec:** `docs/superpowers/specs/2026-08-11-room-advance-payments-design.md`

## Global Constraints

- **DEV database only.** Every migration is applied with `node scripts/migrate.mjs up --yes`. **Never** pass `--prod`, and never run `migrate:prod:up`. The user migrates production themselves later.
- **Never run `npm run migrate:up --yes`** — npm swallows the flag. Call `node scripts/migrate.mjs …` directly.
- **Git is the user's job.** Do not branch, commit, push or amend at any point. Where this plan's template would say "commit", it says "verify" instead.
- **`npm run lint` proves nothing here** — the flat config has no `files` key, so ESLint skips every `.ts`/`.tsx` and lints `.next/`. The real gates are `npx tsc --noEmit` and `npm run build`.
- **Every RPC call site passes arguments BY NAME.** A positional call is what broke every hotel credit checkout in migration `20260717140000`.
- **A Postgres function whose parameter list grows must be `drop`ped before `create`** — `create or replace` leaves an overload behind and the deployed call fails `42725 … is not unique`.
- Money columns are `numeric(12,2)`; money comparisons use a `0.005` tolerance, matching `check_out_room`.
- New tables: `enable row level security` + `grant select, insert, update, delete … to service_role`, explicitly, following `20260806000000_product_workstations.sql`.
- The deviation from the spec: **three** migration files instead of one, so each can be applied and verified on its own. All three are additive and ordered by timestamp.

---

### Task 1: Advance arithmetic in the folio calculator

`lib/room-billing.ts` is the one room-billing calculator — the folio panel, the printed bill, the recorded payment and the sales report all read its output. The advance maths goes here and nowhere else.

**Files:**
- Modify: `lib/room-billing.ts:102-133` (`FolioConfig`, `RoomFolio`), `lib/room-billing.ts:204-224` (the return)
- Test: `lib/room-billing.test.ts` (create)

**Interfaces:**
- Consumes: nothing (leaf module, zero runtime imports — keep it that way or `node --test` cannot load it)
- Produces: `FolioConfig.advancePaid?: number`; `RoomFolio.advancePaid`, `RoomFolio.balanceDue`, `RoomFolio.refundDue` — all `number`

- [ ] **Step 1: Write the failing test**

Create `lib/room-billing.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFolio } from "./room-billing.ts";

// 2 nights at 2,500 = 5,000. No extras, no food, no tax.
const stay = {
  check_in_at: "2026-08-01T06:00:00.000Z",
  check_out_at: "2026-08-03T06:00:00.000Z",
  room_rate: 2500,
};

test("no advance leaves the bill exactly as it was", () => {
  const f = buildFolio(stay, [], [], {});
  assert.equal(f.grandTotal, 5000);
  assert.equal(f.advancePaid, 0);
  assert.equal(f.balanceDue, 5000);
  assert.equal(f.refundDue, 0);
});

test("an advance reduces the balance due but never the grand total", () => {
  const f = buildFolio(stay, [], [], { advancePaid: 2000 });
  assert.equal(f.grandTotal, 5000, "the sale is still the whole bill");
  assert.equal(f.advancePaid, 2000);
  assert.equal(f.balanceDue, 3000);
  assert.equal(f.refundDue, 0);
});

test("an advance covering the bill exactly leaves nothing to pay and nothing to refund", () => {
  const f = buildFolio(stay, [], [], { advancePaid: 5000 });
  assert.equal(f.balanceDue, 0);
  assert.equal(f.refundDue, 0);
});

test("an advance larger than the bill produces a refund, and the balance floors at zero", () => {
  const f = buildFolio(stay, [], [], { advancePaid: 6500 });
  assert.equal(f.grandTotal, 5000);
  assert.equal(f.balanceDue, 0, "never negative — the guest does not owe minus money");
  assert.equal(f.refundDue, 1500);
});

test("the advance is measured against the DISCOUNTED total", () => {
  // 5,000 less a 1,000 discount = 4,000 payable; 3,000 held leaves 1,000.
  const f = buildFolio(stay, [], [], { discount: 1000, advancePaid: 3000 });
  assert.equal(f.grandTotal, 4000);
  assert.equal(f.balanceDue, 1000);
});

test("the advance is measured AFTER tax and service, not before", () => {
  // 5,000 + 10% tax = 5,500 payable; 5,200 held leaves 300.
  const f = buildFolio(stay, [], [], { taxPercent: 10, advancePaid: 5200 });
  assert.equal(f.grandTotal, 5500);
  assert.equal(f.balanceDue, 300);
});

test("a negative net advance is treated as none", () => {
  // Refunds are signed rows; over-refunding is a data error, not a surcharge.
  const f = buildFolio(stay, [], [], { advancePaid: -500 });
  assert.equal(f.advancePaid, 0);
  assert.equal(f.balanceDue, 5000);
});

test("balances land on the paisa", () => {
  const f = buildFolio(
    { ...stay, room_rate: 1666.67 },
    [],
    [],
    { advancePaid: 1000.005 }
  );
  assert.equal(f.grandTotal, 3333.34);
  assert.equal(f.balanceDue, 2333.33);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test lib/room-billing.test.ts`
Expected: FAIL — every assertion on `advancePaid` / `balanceDue` / `refundDue` reports `undefined`.

- [ ] **Step 3: Add the three fields**

In `lib/room-billing.ts`, extend `FolioConfig` (currently lines 102-106):

```ts
export type FolioConfig = {
  taxPercent?: number;
  servicePercent?: number;
  discount?: number;
  /**
   * Net advance already received against this stay — the sum of the stay's SIGNED
   * `room_advances` rows, so a refund has already been netted off by the caller.
   * It does not change what the stay COSTS, only what is left to hand over.
   */
  advancePaid?: number;
};
```

Extend `RoomFolio`, immediately after `grandTotal: number;` (line 132):

```ts
  /** Money already received against this bill before checkout. Never negative. */
  advancePaid: number;
  /** What the guest hands over at checkout: grandTotal − advancePaid, floored at 0. */
  balanceDue: number;
  /** What the HOTEL hands back when the deposit overshot the bill. Floored at 0. */
  refundDue: number;
```

In the body of `buildFolio`, replace the `grandTotal` line of the return object with the four lines below (the current return ends `grandTotal: money(taxable + tax + service),`):

```ts
    grandTotal,
    advancePaid,
    balanceDue: money(Math.max(0, grandTotal - advancePaid)),
    refundDue: money(Math.max(0, advancePaid - grandTotal)),
```

and just above the `return {` statement, add:

```ts
  // The advance is netted against the FINAL payable — after the discount, after tax and
  // service — because that is the number the guest is being asked for. Clamped at zero:
  // a negative net advance would otherwise read as a surcharge invented by arithmetic.
  const advancePaid = money(Math.max(config.advancePaid ?? 0, 0));
  const grandTotal = money(taxable + tax + service);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test lib/room-billing.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 5: Verify nothing downstream broke**

Run: `node --test lib/billing/room-bill.test.ts && npx tsc --noEmit`
Expected: room-bill tests still pass (the mapper is untouched); `tsc` clean. `folioToBill` builds a literal `RoomBillView`, so new *optional*-free fields on `RoomFolio` do not break it — but any test fixture typed as `RoomFolio` would. If `tsc` complains about the fixture in `lib/billing/room-bill.test.ts`, add `advancePaid: 0, balanceDue: 5000, refundDue: 0` to that literal.

---

### Task 2: The `room_advances` table and `payments.advance_amount`

**Files:**
- Create: `supabase/migrations/20260811000000_room_advances.sql`
- Modify: `types/database.ts`

**Interfaces:**
- Produces: table `room_advances`; column `payments.advance_amount numeric(12,2) not null default 0`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260811000000_room_advances.sql`:

```sql
-- =============================================================
-- ROOM ADVANCE PAYMENTS — the deposit a hotel takes at check-in
--
-- A deposit is money received BEFORE there is a sale. The app's accrual rule
-- already handles the opposite case (a credit bill is a sale before there is
-- money); this is the same rule pointed the other way. The cash lands in the
-- day's balance the moment it is taken, and the SALE still books in full at
-- checkout.
--
-- SIGNED ROWS. A refund is a negative row, not a second table and not a flag:
--   * advance held on a stay = sum(amount) — one number, one convention;
--   * the refund lands in the ledger on the day it is physically handed back;
--   * the finance cash/bank legs need no refund branch at all, because the signs
--     already do the work.
-- =============================================================

create table if not exists room_advances (
  id            uuid primary key default gen_random_uuid(),
  -- Carried like every other tenant table, so the finance legs can sum this
  -- table without joining back through room_stays.
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  stay_id       uuid not null references room_stays(id)  on delete cascade,
  -- SIGNED. Positive = deposit taken from the guest. Negative = refund returned.
  amount        numeric(12,2) not null,
  cash_amount   numeric(12,2) not null default 0,
  online_amount numeric(12,2) not null default 0,
  card_amount   numeric(12,2) not null default 0,
  method        text not null,
  note          text,
  created_by    uuid references restaurant_users(id),
  created_at    timestamptz not null default now(),

  -- A zero-value advance is not a record of anything; it is a mis-submitted form.
  constraint room_advances_amount_nonzero
    check (amount <> 0),
  -- The split IS the amount. Without this the cash legs and the held total can
  -- disagree, and the disagreement would only show up as a till that will not
  -- reconcile weeks later.
  constraint room_advances_split_check
    check (cash_amount + online_amount + card_amount = amount),
  constraint room_advances_method_check
    check (method in ('cash','online','card','mixed'))
);

-- The finance legs scan by restaurant and date; the folio reads by stay.
create index if not exists room_advances_restaurant_created_idx
  on room_advances (restaurant_id, created_at);
create index if not exists room_advances_stay_idx
  on room_advances (stay_id);

-- Deny by default, like every other table: reached only through the service role.
alter table room_advances enable row level security;

-- Explicit, even though 20260801000000 sets default privileges for future tables:
-- those defaults belong to the role that declared them, and this migration may be
-- replayed by a different one when a database is built from scratch.
grant select, insert, update, delete on table room_advances to service_role;


-- ── How much of a bill was settled by money already received ──────────────────
--
-- `total_amount` is still the SALE and does not move. This column says how much
-- of it arrived before today.
--
-- THE INVARIANT THIS CHANGES, and the one dangerous thing in the feature:
--
--   left on credit = total_amount − (cash + online + card + advance_amount)
--
-- Every reader of that expression must gain the `+ advance_amount` term in the
-- same deployment, or an 8,000 bill settled with a 5,000 deposit and 3,000 cash
-- silently raises 5,000 of customer debt that nobody owes. The readers are
-- finance_transactions' sale branch, check_out_room, close_bill_with_credit and
-- edit_payment_tender (migrations 20260811000100 and 20260811000200), plus
-- lib/credits.ts on the app side.
--
-- DEFAULT 0 is what makes every existing row and every table bill correct
-- without a backfill: no advance means the old expression and the new one are
-- the same expression.
alter table payments
  add column if not exists advance_amount numeric(12,2) not null default 0;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Check the migration is pending, then apply it to DEV**

Run: `node scripts/migrate.mjs status`
Expected: `20260811000000_room_advances` listed as pending.

Run: `node scripts/migrate.mjs up --yes`
Expected: applies 1 migration, no error.

> If `status` shows other unexpected pending migrations, **stop and report** — the DEV database has drifted from the repo (a known hazard in this project) and applying blind could break it.

- [ ] **Step 3: Verify the constraints actually bite**

Run this against DEV (a `psql` session on `SUPABASE_DB_URL`, or a scratch `node` script using `pg`):

```sql
-- Every one of these must FAIL.
insert into room_advances (restaurant_id, stay_id, amount, cash_amount, method)
select restaurant_id, id, 0, 0, 'cash' from room_stays limit 1;          -- amount_nonzero

insert into room_advances (restaurant_id, stay_id, amount, cash_amount, method)
select restaurant_id, id, 5000, 4000, 'cash' from room_stays limit 1;    -- split_check

insert into room_advances (restaurant_id, stay_id, amount, cash_amount, method)
select restaurant_id, id, 5000, 5000, 'credit' from room_stays limit 1;  -- method_check

-- This must SUCCEED, and then be deleted again.
insert into room_advances (restaurant_id, stay_id, amount, cash_amount, method)
select restaurant_id, id, 5000, 5000, 'cash' from room_stays limit 1;
delete from room_advances;
```

Expected: three errors naming `room_advances_amount_nonzero`, `room_advances_split_check`, `room_advances_method_check`; the fourth inserts one row; the table ends empty.

- [ ] **Step 4: Add the types**

In `types/database.ts`, add `advance_amount: number` to the `payments` Row/Insert/Update types (Insert and Update optional), and add a `room_advances` table entry following the shape of a neighbouring table such as `room_charges`:

```ts
      room_advances: {
        Row: {
          id: string;
          restaurant_id: string;
          stay_id: string;
          amount: number;
          cash_amount: number;
          online_amount: number;
          card_amount: number;
          method: string;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          restaurant_id: string;
          stay_id: string;
          amount: number;
          cash_amount?: number;
          online_amount?: number;
          card_amount?: number;
          method: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          amount?: number;
          cash_amount?: number;
          online_amount?: number;
          card_amount?: number;
          method?: string;
          note?: string | null;
        };
        Relationships: [];
      };
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

---

### Task 3: Recording, editing and deleting an advance (RPCs)

**Files:**
- Create: `supabase/migrations/20260811000100_room_advance_rpcs.sql`

**Interfaces:**
- Consumes: `room_advances` (Task 2)
- Produces:
  - `record_room_advance(p_restaurant_id uuid, p_stay_id uuid, p_amount numeric, p_cash numeric, p_online numeric, p_card numeric, p_method text, p_note text, p_created_by uuid) returns uuid`
  - `edit_room_advance(p_restaurant_id uuid, p_actor_id uuid, p_actor_name text, p_advance_id uuid, p_amount numeric, p_cash numeric, p_online numeric, p_card numeric, p_method text) returns void`
  - `delete_room_advance(p_restaurant_id uuid, p_actor_id uuid, p_actor_name text, p_advance_id uuid) returns void`
  - `check_in_room(…, p_advance_amount numeric default 0, p_advance_cash numeric default 0, p_advance_online numeric default 0, p_advance_card numeric default 0, p_advance_method text default null, p_advance_note text default null) returns jsonb`
  - Bare error codes: `STAY_NOT_FOUND`, `STAY_CLOSED`, `INVALID_ADVANCE`, `ADVANCE_NOT_FOUND`, `ADVANCE_STAY_CLOSED`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260811000100_room_advance_rpcs.sql`:

```sql
-- =============================================================
-- ROOM ADVANCES — write paths
--
-- Three RPCs plus check_in_room, so that a deposit taken at the desk is written
-- in the SAME transaction as the stay it belongs to. A guest checked in with
-- their deposit lost is not a state this app is allowed to reach.
-- =============================================================

-- ── Record one advance (or a refund, via a negative p_amount) ─────────────────
create or replace function record_room_advance(
  p_restaurant_id uuid,
  p_stay_id       uuid,
  p_amount        numeric,
  p_cash          numeric,
  p_online        numeric,
  p_card          numeric,
  p_method        text,
  p_note          text,
  p_created_by    uuid
) returns uuid
language plpgsql
as $$
declare
  v_stay room_stays;
  v_id   uuid;
begin
  select * into v_stay
    from room_stays
   where id = p_stay_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'STAY_NOT_FOUND';
  end if;

  -- A settled stay's advances are frozen inside a closed bill. The ONE exception
  -- is the refund written by check_out_room, which runs before the stay is
  -- closed in that same transaction, so it never reaches this branch.
  if v_stay.status <> 'active' then
    raise exception 'STAY_CLOSED';
  end if;

  if coalesce(p_amount, 0) = 0
     or abs(coalesce(p_cash,0) + coalesce(p_online,0) + coalesce(p_card,0) - p_amount) > 0.005 then
    raise exception 'INVALID_ADVANCE';
  end if;

  insert into room_advances (
    restaurant_id, stay_id, amount, cash_amount, online_amount, card_amount,
    method, note, created_by
  ) values (
    p_restaurant_id, p_stay_id, p_amount,
    coalesce(p_cash,0), coalesce(p_online,0), coalesce(p_card,0),
    p_method, nullif(btrim(coalesce(p_note,'')), ''), p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_room_advance(uuid, uuid, numeric, numeric, numeric, numeric, text, text, uuid) from public;
grant execute on function record_room_advance(uuid, uuid, numeric, numeric, numeric, numeric, text, text, uuid) to service_role;


-- ── Correct a mistyped advance ────────────────────────────────────────────────
-- Money already counted into the day's cash is being rewritten, so this writes
-- the before→after to the security audit log itself. The Security PIN is checked
-- in the server action BEFORE this is called (lib/security/authorize.ts); this
-- function records what happened, exactly as edit_payment_tender does.
create or replace function edit_room_advance(
  p_restaurant_id uuid,
  p_actor_id      uuid,
  p_actor_name    text,
  p_advance_id    uuid,
  p_amount        numeric,
  p_cash          numeric,
  p_online        numeric,
  p_card          numeric,
  p_method        text
) returns void
language plpgsql
as $$
declare
  v_old  room_advances;
  v_stay room_stays;
begin
  select * into v_old
    from room_advances
   where id = p_advance_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'ADVANCE_NOT_FOUND';
  end if;

  select * into v_stay from room_stays where id = v_old.stay_id for update;
  if v_stay.status <> 'active' then
    raise exception 'ADVANCE_STAY_CLOSED';
  end if;

  if coalesce(p_amount, 0) = 0
     or abs(coalesce(p_cash,0) + coalesce(p_online,0) + coalesce(p_card,0) - p_amount) > 0.005 then
    raise exception 'INVALID_ADVANCE';
  end if;

  update room_advances
     set amount        = p_amount,
         cash_amount   = coalesce(p_cash,0),
         online_amount = coalesce(p_online,0),
         card_amount   = coalesce(p_card,0),
         method        = p_method
   where id = p_advance_id;

  perform log_security_event(
    p_restaurant_id, p_actor_id, p_actor_name,
    'edit_room_advance', 'room_advance', p_advance_id::text, 'success',
    jsonb_build_object(
      'before', jsonb_build_object(
        'amount', v_old.amount, 'cash_amount', v_old.cash_amount,
        'online_amount', v_old.online_amount, 'card_amount', v_old.card_amount,
        'method', v_old.method),
      'after', jsonb_build_object(
        'amount', p_amount, 'cash_amount', coalesce(p_cash,0),
        'online_amount', coalesce(p_online,0), 'card_amount', coalesce(p_card,0),
        'method', p_method)
    )
  );
end;
$$;

revoke all on function edit_room_advance(uuid, uuid, text, uuid, numeric, numeric, numeric, numeric, text) from public;
grant execute on function edit_room_advance(uuid, uuid, text, uuid, numeric, numeric, numeric, numeric, text) to service_role;


-- ── Remove an advance entered in error ────────────────────────────────────────
create or replace function delete_room_advance(
  p_restaurant_id uuid,
  p_actor_id      uuid,
  p_actor_name    text,
  p_advance_id    uuid
) returns void
language plpgsql
as $$
declare
  v_old  room_advances;
  v_stay room_stays;
begin
  select * into v_old
    from room_advances
   where id = p_advance_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'ADVANCE_NOT_FOUND';
  end if;

  select * into v_stay from room_stays where id = v_old.stay_id for update;
  if v_stay.status <> 'active' then
    raise exception 'ADVANCE_STAY_CLOSED';
  end if;

  delete from room_advances where id = p_advance_id;

  perform log_security_event(
    p_restaurant_id, p_actor_id, p_actor_name,
    'edit_room_advance', 'room_advance', p_advance_id::text, 'success',
    jsonb_build_object(
      'action', 'delete',
      'before', jsonb_build_object(
        'amount', v_old.amount, 'cash_amount', v_old.cash_amount,
        'online_amount', v_old.online_amount, 'card_amount', v_old.card_amount,
        'method', v_old.method)
    )
  );
end;
$$;

revoke all on function delete_room_advance(uuid, uuid, text, uuid) from public;
grant execute on function delete_room_advance(uuid, uuid, text, uuid) to service_role;


-- ── check_in_room: take the deposit in the SAME transaction as the stay ───────
--
-- DROP THE OLD 11-ARGUMENT SIGNATURE FIRST. `create or replace` with a longer
-- parameter list creates an OVERLOAD, and the deployed app's call then matches
-- both candidates and fails `42725 function check_in_room(...) is not unique`.
-- That was measured, not theorised, when 20260804000000 added guest identity.
--
-- All six new parameters DEFAULT, so the currently-deployed 11-name call keeps
-- resolving through the deploy window and simply records no advance.
drop function if exists public.check_in_room(
  uuid, uuid, text, text, integer, text, text, uuid, text, text, text
);

create or replace function public.check_in_room(
  p_restaurant_id   uuid,
  p_room_id         uuid,
  p_guest_name      text,
  p_guest_phone     text,
  p_guest_count     integer,
  p_notes           text,
  p_customer_pin    text,
  p_created_by      uuid,
  p_guest_id_type   text default null,
  p_guest_id_number text default null,
  p_guest_address   text default null,
  p_advance_amount  numeric default 0,
  p_advance_cash    numeric default 0,
  p_advance_online  numeric default 0,
  p_advance_card    numeric default 0,
  p_advance_method  text default null,
  p_advance_note    text default null
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_room    rooms;
  v_rate    numeric;
  v_stay    room_stays;
  v_session sessions;
begin
  if coalesce(btrim(p_guest_name), '') = '' then
    raise exception 'GUEST_NAME_REQUIRED';
  end if;

  -- `for update` serialises two receptionists checking in to the same room.
  select * into v_room
    from rooms
   where id = p_room_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_room.status = 'maintenance' then
    raise exception 'ROOM_UNAVAILABLE';
  end if;

  if v_room.status = 'cleaning' then
    raise exception 'ROOM_NEEDS_CLEANING';
  end if;

  if exists (select 1 from room_stays where room_id = p_room_id and status = 'active') then
    raise exception 'ROOM_OCCUPIED';
  end if;

  if exists (
    select 1 from sessions
     where room_id = p_room_id and status <> 'closed' and room_stay_id is null
  ) then
    raise exception 'ROOM_HAS_OPEN_SESSION';
  end if;

  select base_price into v_rate from room_types where id = v_room.room_type_id;

  insert into room_stays (
    restaurant_id, room_id, guest_name, guest_phone, guest_count, room_rate, notes,
    guest_id_type, guest_id_number, guest_address
  ) values (
    p_restaurant_id, p_room_id, btrim(p_guest_name),
    nullif(btrim(coalesce(p_guest_phone, '')), ''),
    greatest(coalesce(p_guest_count, 1), 1),
    coalesce(v_rate, 0),
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_guest_id_type, '')), ''),
    nullif(btrim(coalesce(p_guest_id_number, '')), ''),
    nullif(btrim(coalesce(p_guest_address, '')), '')
  )
  returning * into v_stay;

  update rooms set status = 'occupied' where id = p_room_id;

  insert into sessions (restaurant_id, type, room_id, room_stay_id, customer_pin)
  values (p_restaurant_id, 'room_service', p_room_id, v_stay.id, p_customer_pin)
  returning * into v_session;

  -- The deposit, if one was handed over. Inside this transaction on purpose: a
  -- stay that exists without the money the guest just paid is worse than a
  -- check-in that failed outright and can be retried.
  if coalesce(p_advance_amount, 0) > 0 then
    perform record_room_advance(
      p_restaurant_id => p_restaurant_id,
      p_stay_id       => v_stay.id,
      p_amount        => p_advance_amount,
      p_cash          => coalesce(p_advance_cash, 0),
      p_online        => coalesce(p_advance_online, 0),
      p_card          => coalesce(p_advance_card, 0),
      p_method        => coalesce(p_advance_method, 'cash'),
      p_note          => p_advance_note,
      p_created_by    => p_created_by
    );
  end if;

  return jsonb_build_object(
    'stay_id',    v_stay.id,
    'session_id', v_session.id,
    'room_rate',  v_stay.room_rate
  );
end;
$function$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Confirm `log_security_event`'s signature matches the call above**

Run: `node scripts/migrate.mjs status` is *not* what checks this. Instead query DEV:

```sql
select pg_get_function_arguments(oid) from pg_proc where proname = 'log_security_event';
```

Expected: nine positional parameters in the order `(restaurant_id, actor_id, actor_name, operation, target_type, target_id, outcome, detail)` or similar. **If the argument list or order differs, adjust both `perform log_security_event(...)` calls to match before applying** — a wrong call here fails the whole edit transaction.

- [ ] **Step 3: Apply to DEV**

Run: `node scripts/migrate.mjs up --yes`
Expected: applies `20260811000100`, no error.

- [ ] **Step 4: Verify there is exactly one `check_in_room`**

```sql
select count(*), max(pg_get_function_identity_arguments(oid))
from pg_proc where proname = 'check_in_room';
```

Expected: `count = 1`, with 17 parameters. **A count of 2 means the drop did not match the live signature — stop and fix it**, or every check-in will fail `42725 … is not unique`.

- [ ] **Step 5: Verify the RPCs behave**

Against a real active stay on DEV (substitute ids):

```sql
-- Records, and reads back as held.
select record_room_advance(
  p_restaurant_id => '<rid>', p_stay_id => '<stay>', p_amount => 5000,
  p_cash => 5000, p_online => 0, p_card => 0, p_method => 'cash',
  p_note => 'test', p_created_by => null);
select sum(amount) from room_advances where stay_id = '<stay>';   -- 5000

-- A split that does not add up is refused.
select record_room_advance(
  p_restaurant_id => '<rid>', p_stay_id => '<stay>', p_amount => 5000,
  p_cash => 100, p_online => 0, p_card => 0, p_method => 'cash',
  p_note => null, p_created_by => null);                          -- INVALID_ADVANCE

-- Clean up.
delete from room_advances where stay_id = '<stay>';
```

Expected: first returns a uuid and the sum is 5000; second raises `INVALID_ADVANCE`; the table ends clean.

---

### Task 4: Checkout, credit and tender edits become advance-aware

This is the task that carries the dangerous invariant. All three functions change together in one migration, because a database where `check_out_room` knows about advances and `close_bill_with_credit` does not is a database that raises phantom debt.

**Files:**
- Create: `supabase/migrations/20260811000200_room_advance_checkout.sql`

**Interfaces:**
- Consumes: `room_advances`, `payments.advance_amount` (Task 2), `record_room_advance` (Task 3)
- Produces:
  - `check_out_room(…, p_refund_cash numeric default 0, p_refund_online numeric default 0)` — writes `payments.advance_amount`, writes the refund row
  - `close_bill_with_credit(…, p_advance numeric default 0)` — `advance_amount` on the payment, advance counted into `credits.down_payment`
  - `edit_payment_tender` — tender clamped to `total_amount − advance_amount`
  - Bare error codes: `REFUND_MISMATCH`, `INVALID_DOWN_PAYMENT` (existing)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260811000200_room_advance_checkout.sql`. Take the **current live bodies** of `close_bill_with_credit` (from `20260717140000_fix_credit_discount_default.sql`) and `check_out_room` (from `20260804010000_room_checkout_discount.sql`) and change only what is listed here.

```sql
-- =============================================================
-- ADVANCES AT CHECKOUT
--
-- THE INVARIANT. Everywhere in this app, what is left on credit has been:
--
--   total_amount − (cash + online + card)
--
-- With a deposit it becomes:
--
--   total_amount − (cash + online + card + advance_amount)
--
-- All three functions here move together. One of them left behind turns an
-- 8,000 bill settled by a 5,000 deposit and 3,000 cash into 5,000 of customer
-- debt that nobody owes — silently, and only visible weeks later on a statement.
--
-- `credits.down_payment` INCLUDES the advance, because it is money received
-- against that bill. finance_report derives customer credit created as
-- `bill_amount − down_payment`, so that leg then needs no change at all.
-- =============================================================

drop function if exists public.close_bill_with_credit(
  uuid, uuid, numeric, numeric, numeric, numeric, uuid, text, text, text, uuid, numeric
);

create or replace function close_bill_with_credit(
  p_restaurant_id  uuid,
  p_session_id     uuid,
  p_total          numeric,
  p_cash           numeric,
  p_online         numeric,
  p_card           numeric,
  p_customer_id    uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_notes          text,
  p_created_by     uuid,
  p_discount       numeric default 0,
  p_advance        numeric default 0
)
returns credit_customers
language plpgsql
as $function$
declare
  -- Money received against this bill by the time it closed: what was handed over
  -- now, PLUS what was handed over earlier as a deposit.
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0)
                       + coalesce(p_advance, 0);
  v_owed    numeric;
  v_payment payments;
  v_cust    credit_customers;
  v_seq     int;
begin
  if p_total is null or p_total <= 0 then
    raise exception 'INVALID_TOTAL';
  end if;

  if v_paid < 0 or v_paid >= p_total then
    raise exception 'INVALID_DOWN_PAYMENT';
  end if;
  v_owed := p_total - v_paid;

  perform 1
     from sessions
    where id = p_session_id
      and restaurant_id = p_restaurant_id
      and status <> 'closed'
      for update;
  if not found then
    raise exception 'SESSION_NOT_OPEN';
  end if;

  if p_customer_id is not null then
    select * into v_cust
      from credit_customers
     where id = p_customer_id
       and restaurant_id = p_restaurant_id
       for update;
    if not found then
      raise exception 'CUSTOMER_NOT_FOUND';
    end if;
  else
    v_cust := find_or_create_credit_customer(
      p_restaurant_id, p_customer_name, p_customer_phone, p_created_by
    );
    select * into v_cust from credit_customers where id = v_cust.id for update;
  end if;

  insert into payments (
    restaurant_id, session_id, amount, total_amount, discount_amount,
    cash_amount, online_amount, card_amount, advance_amount,
    payment_method, created_by
  )
  values (
    p_restaurant_id, p_session_id, p_total, p_total, coalesce(p_discount, 0),
    coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0), coalesce(p_advance, 0),
    'credit', p_created_by
  )
  returning * into v_payment;

  perform pg_advisory_xact_lock(hashtext('credit_seq:' || p_restaurant_id::text));
  select coalesce(max(seq_no), 0) + 1 into v_seq
    from credits
   where restaurant_id = p_restaurant_id;

  insert into credits (
    restaurant_id, seq_no, session_id, payment_id, customer_id,
    customer_name, customer_phone,
    bill_amount, down_payment, paid_amount,
    status, notes, created_by
  )
  values (
    p_restaurant_id, v_seq, p_session_id, v_payment.id, v_cust.id,
    v_cust.name, v_cust.phone,
    -- v_paid already includes the advance, which is what keeps
    -- `bill_amount - down_payment` a true statement of what is still owed.
    p_total, v_paid, v_paid,
    case when v_paid > 0 then 'partially_paid' else 'pending' end,
    nullif(btrim(coalesce(p_notes, '')), ''), p_created_by
  );

  update credit_customers
     set balance = balance + v_owed,
         is_active = true
   where id = v_cust.id
  returning * into v_cust;

  update sessions
     set status = 'closed', closed_at = now()
   where id = p_session_id;

  return v_cust;
end;
$function$;


-- ── check_out_room ────────────────────────────────────────────────────────────
drop function if exists public.check_out_room(
  uuid, uuid, numeric, numeric, numeric, numeric, text, uuid, text, text, text, uuid, numeric
);

create or replace function public.check_out_room(
  p_restaurant_id  uuid,
  p_stay_id        uuid,
  p_total          numeric,
  p_cash           numeric,
  p_online         numeric,
  p_card           numeric,
  p_method         text,
  p_customer_id    uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_notes          text,
  p_created_by     uuid,
  p_discount       numeric default 0,
  p_refund_cash    numeric default 0,
  p_refund_online  numeric default 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_stay    room_stays;
  v_session sessions;
  v_paid    numeric := coalesce(p_cash, 0) + coalesce(p_online, 0) + coalesce(p_card, 0);
  -- Read INSIDE the transaction, never taken from the client. Same principle as
  -- the total itself: the browser says what it thinks is held, we look.
  v_held    numeric;
  v_applied numeric;
  v_refund  numeric := coalesce(p_refund_cash, 0) + coalesce(p_refund_online, 0);
  v_now     timestamptz := now();
begin
  select * into v_stay
    from room_stays
   where id = p_stay_id and restaurant_id = p_restaurant_id
   for update;
  if not found then
    raise exception 'STAY_NOT_FOUND';
  end if;
  if v_stay.status <> 'active' then
    raise exception 'STAY_ALREADY_CLOSED';
  end if;

  if p_total is null or p_total < 0 then
    raise exception 'INVALID_TOTAL';
  end if;

  select coalesce(sum(amount), 0) into v_held
    from room_advances
   where stay_id = p_stay_id
   for update;

  -- A deposit can only pay off this bill up to the bill. Anything above it is
  -- the guest's money and goes back to them, which is what the refund is.
  v_applied := least(v_held, p_total);
  if v_applied < 0 then
    v_applied := 0;
  end if;

  if abs(v_refund - greatest(v_held - p_total, 0)) > 0.005 then
    raise exception 'REFUND_MISMATCH';
  end if;

  select * into v_session
    from sessions
   where room_stay_id = p_stay_id
   order by opened_at
   limit 1
   for update;

  if v_session.id is null then
    raise exception 'NO_SESSION_FOR_STAY';
  end if;

  -- The refund goes in BEFORE the stay is closed: record_room_advance refuses to
  -- write against a settled stay, and rightly so.
  if v_refund > 0.005 then
    perform record_room_advance(
      p_restaurant_id => p_restaurant_id,
      p_stay_id       => p_stay_id,
      p_amount        => -v_refund,
      p_cash          => -coalesce(p_refund_cash, 0),
      p_online        => -coalesce(p_refund_online, 0),
      p_card          => 0,
      p_method        => case
                           when coalesce(p_refund_cash,0) > 0.005 and coalesce(p_refund_online,0) > 0.005 then 'mixed'
                           when coalesce(p_refund_online,0) > 0.005 then 'online'
                           else 'cash'
                         end,
      p_note          => 'Refund of unused advance at checkout',
      p_created_by    => p_created_by
    );
  end if;

  update room_stays
     set check_out_at = v_now,
         status       = 'checked_out'
   where id = p_stay_id;

  -- THE FORK, now counting the deposit as money received. Without `+ v_applied`
  -- a fully-prepaid stay would be sent down the credit path and open a credit
  -- account for a guest who owes nothing.
  if v_paid + v_applied + 0.005 < p_total then
    perform close_bill_with_credit(
      p_restaurant_id  => p_restaurant_id,
      p_session_id     => v_session.id,
      p_total          => p_total,
      p_cash           => coalesce(p_cash, 0),
      p_online         => coalesce(p_online, 0),
      p_card           => coalesce(p_card, 0),
      p_customer_id    => p_customer_id,
      p_customer_name  => p_customer_name,
      p_customer_phone => p_customer_phone,
      p_notes          => p_notes,
      p_created_by     => p_created_by,
      p_discount       => coalesce(p_discount, 0),
      p_advance        => v_applied
    );
  else
    insert into payments (
      restaurant_id, session_id, amount,
      cash_amount, online_amount, card_amount, advance_amount, total_amount,
      payment_method, created_by, discount_amount
    ) values (
      p_restaurant_id, v_session.id, p_total,
      coalesce(p_cash, 0), coalesce(p_online, 0), coalesce(p_card, 0), v_applied, p_total,
      p_method::payment_method, p_created_by, coalesce(p_discount, 0)
    );

    if v_session.status <> 'closed' then
      update sessions set status = 'closed', closed_at = v_now where id = v_session.id;
    end if;
  end if;

  update rooms set status = 'cleaning' where id = v_stay.room_id;

  return jsonb_build_object(
    'stay_id',      p_stay_id,
    'session_id',   v_session.id,
    'check_out_at', v_now,
    'total',        p_total,
    'advance',      v_applied,
    'refund',       v_refund
  );
end;
$function$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Clamp the tender edit**

Append to the same migration file. Copy the **current live body** of `edit_payment_tender` out of `20260729100000_security_pin.sql` and change only its total check: where it compares the new split against `v_total`, it must compare against `v_total − coalesce(v_pay.advance_amount, 0)`.

```sql
-- edit_payment_tender: a bill part-settled by a deposit can only have the
-- REMAINDER re-split. Editing 3,000 of cash into 8,000 on a bill that already
-- carries a 5,000 advance would count that deposit twice.
--
-- Apply the same one-line change inside the live body: every comparison of the
-- new split against the bill total becomes a comparison against
--   v_total - coalesce(v_pay.advance_amount, 0)
-- and the audit `before`/`after` jsonb gains 'advance_amount', v_pay.advance_amount.
```

> **Do not hand-write a new body from memory.** Read the live definition first with
> `select pg_get_functiondef(oid) from pg_proc where proname = 'edit_payment_tender';`
> and reproduce it verbatim with only that change, exactly as `20260717140000` did.

- [ ] **Step 3: Apply to DEV**

Run: `node scripts/migrate.mjs up --yes`
Expected: applies `20260811000200`, no error.

- [ ] **Step 4: Verify there is exactly one of each function**

```sql
select proname, count(*)
from pg_proc
where proname in ('check_out_room','close_bill_with_credit','edit_payment_tender')
group by proname;
```

Expected: `1` for each. Anything else means a drop missed the live signature — **stop and fix before touching the app**.

- [ ] **Step 5: Verify the three checkout shapes on DEV**

Using a scratch stay per case (check in via the app, then call the RPC by name):

1. **Fully prepaid.** Bill 5,000, advance 5,000, `p_cash => 0`. Expect: `payments.total_amount = 5000`, `cash_amount = 0`, `advance_amount = 5000`, `payment_method` not `credit`, and **no** row in `credits`.
2. **Part prepaid.** Bill 8,000, advance 5,000, `p_cash => 3000`. Expect `total_amount = 8000`, `cash_amount = 3000`, `advance_amount = 5000`, no `credits` row.
3. **Overpaid.** Bill 3,500, advance 5,000, `p_cash => 0`, `p_refund_cash => 1500`. Expect `advance_amount = 3500`, a `room_advances` row of `-1500`, and `sum(amount) = 3500` for the stay.
4. **Credit with a deposit.** Bill 8,000, advance 5,000, `p_cash => 1000`, `p_method => 'credit'`. Expect `credits.bill_amount = 8000`, `down_payment = 6000`, and the customer balance up by **2,000** — not 7,000.

Case 4 is the phantom-debt regression test. If the balance moves by 7,000, a reader was missed.

---

### Task 5: Finance — the fifth balance and the ledger branch

**Files:**
- Create: `supabase/migrations/20260811000300_room_advance_finance.sql`

**Interfaces:**
- Consumes: `room_advances`, `payments.advance_amount`
- Produces: `finance_report` returning four new columns — `advances_received`, `advances_refunded`, `opening_advances_held`, `closing_advances_held`; `finance_transactions` emitting `kind = 'room_advance'`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260811000300_room_advance_finance.sql`. Start from the **live** `finance_report` and `finance_transactions` (`20260720000000_finance_credit_balances.sql`) and make exactly these changes.

```sql
-- =============================================================
-- FINANCE — ADVANCES HELD, THE FIFTH BALANCE
--
-- A deposit raises cash on the day it is taken while the SALE books later, so
-- without a term of its own the report shows cash appearing from nowhere. It is
-- a liability, and it is derived exactly like the two credit balances:
--
--   Advances held (T) = Σ room_advances.amount [< T] − Σ payments.advance_amount [< T]
--
-- Refunds need no term: they are negative rows and the sums already carry them.
--
-- SALES ARE UNTOUCHED. They read `payments`, and the whole bill still books at
-- checkout. Only the cash/bank legs gain a source.
-- =============================================================

drop function if exists finance_report(uuid, timestamptz, timestamptz);

create function finance_report(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  -- … every existing column, unchanged and in the same order …
  -- then, appended at the end so existing positional readers keep working:
  advances_received numeric, advances_refunded numeric,
  opening_advances_held numeric, closing_advances_held numeric
)
language sql stable as $$
  -- … every existing CTE, unchanged …
```

Add this CTE alongside `pay`, `crp`, `pur`:

```sql
  adv as (
    select
      -- Cash/bank legs, floored on the opening seed exactly like `pay`, because a
      -- deposit taken before the books opened is already inside the seed figure.
      sum(a.cash_amount) filter (where a.created_at >= (select eff from seed) and a.created_at < p_from) cash_before,
      sum(a.online_amount + a.card_amount) filter (where a.created_at >= (select eff from seed) and a.created_at < p_from) online_before,
      sum(a.cash_amount) filter (where a.created_at >= p_from and a.created_at < p_to) cash_in,
      sum(a.online_amount + a.card_amount) filter (where a.created_at >= p_from and a.created_at < p_to) online_in,
      -- Reported figures: what came in and what went back, in the period.
      sum(a.amount) filter (where a.amount > 0 and a.created_at >= p_from and a.created_at < p_to) received,
      sum(-a.amount) filter (where a.amount < 0 and a.created_at >= p_from and a.created_at < p_to) refunded,
      -- Liability legs. NO `eff` floor, for the same reason the credit legs have
      -- none: a deposit taken before the books opened is still owed to the guest.
      sum(a.amount) filter (where a.created_at < p_from) held_raised_before,
      sum(a.amount) filter (where a.created_at < p_to)   held_raised_to
    from room_advances a where a.restaurant_id = p_restaurant_id
  ),
  advuse as (
    select
      sum(p.advance_amount) filter (where p.created_at < p_from) applied_before,
      sum(p.advance_amount) filter (where p.created_at < p_to)   applied_to
    from payments p where p.restaurant_id = p_restaurant_id
  ),
```

In the `calc` CTE, add `+ coalesce((select cash_before from adv),0)` to `open_cash` and
`+ coalesce((select online_before from adv),0)` to `open_online`, then add two new terms:

```sql
      coalesce((select held_raised_before from adv),0)
        - coalesce((select applied_before from advuse),0) open_held,
      coalesce((select held_raised_to from adv),0)
        - coalesce((select applied_to from advuse),0)     close_held
```

In the final `select`, add `+ coalesce((select cash_in from adv),0)` to the **closing cash** expression and `+ coalesce((select online_in from adv),0)` to the **closing online** expression, then append the four new output columns:

```sql
    coalesce((select received from adv),0)::numeric,
    coalesce((select refunded from adv),0)::numeric,
    calc.open_held::numeric,
    calc.close_held::numeric
```

Then the ledger branch, added to `finance_transactions`' `moves` union:

```sql
    union all

    -- A deposit taken, or (negative) returned. Real money, no sale, no credit
    -- leg — the sale books in full when the guest checks out. The signs mean one
    -- branch serves both directions.
    select
      a.created_at, 'room_advance',
      rs.guest_name,
      a.method::text,
      a.amount,
      'Room ' || coalesce(r.number, '—'),
      a.cash_amount,
      (a.online_amount + a.card_amount),
      0::numeric,
      0::numeric
    from room_advances a
    join room_stays rs on rs.id = a.stay_id
    left join rooms r on r.id = rs.room_id
    where a.restaurant_id = p_restaurant_id
      and a.created_at >= p_from and a.created_at < p_to
```

and the one change inside the existing **sale** branch — its `credit_to_us_delta` and its `method` classifier both gain the advance term:

```sql
      -- was: coalesce(p.total_amount,p.amount) - (p.cash_amount + p.online_amount + coalesce(p.card_amount,0))
      (coalesce(p.total_amount,p.amount)
        - (p.cash_amount + p.online_amount + coalesce(p.card_amount,0) + coalesce(p.advance_amount,0))) credit_to_us_delta
```

Apply the identical `+ coalesce(p.advance_amount,0)` inside the `case` that picks `'partial'` / `'credit'`, so a prepaid bill is not labelled a credit sale.

Finish the file with the existing grants:

```sql
revoke all on function finance_report(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_report(uuid, timestamptz, timestamptz) to service_role;
revoke all on function finance_transactions(uuid, timestamptz, timestamptz) from public;
grant execute on function finance_transactions(uuid, timestamptz, timestamptz) to service_role;
notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply to DEV**

Run: `node scripts/migrate.mjs up --yes`
Expected: applies `20260811000300`, no error.

- [ ] **Step 3: Verify the report is unchanged where nothing changed**

Before creating any advance, for a restaurant with existing history:

```sql
select opening_cash, closing_cash, sales_total, closing_credit_to_us,
       advances_received, opening_advances_held, closing_advances_held
from finance_report('<rid>', '-infinity', 'infinity');
```

Expected: the first four match what they were before this migration (compare against a value recorded before Step 2); the three advance columns are `0`.

- [ ] **Step 4: Verify the money model — the three assertions from the spec**

Take a scratch stay on DEV. Record the day's `closing_cash` and `sales_total` first.

1. **Advance day.** Record a 5,000 cash advance. Re-read: `closing_cash` **+5,000**, `sales_total` **unchanged**, `closing_advances_held` **+5,000**.
2. **Checkout day.** Check out with a bill of 8,000 paying 3,000 cash. Re-read: `sales_total` **+8,000**, `closing_cash` **+3,000** (not 8,000), `closing_advances_held` back to **0**.
3. **Reconciliation.** Over a period covering both, the last row of `finance_transactions` must carry `cash_after` equal to `finance_report`'s `closing_cash`:

```sql
with t as (
  select cash_after from finance_transactions('<rid>', '<from>', '<to>')
  order by occurred_at asc, kind, reference
)
select (select cash_after from t offset (select count(*)-1 from t)) ledger_last,
       (select closing_cash from finance_report('<rid>', '<from>', '<to>')) report_closing;
```

Expected: the two figures are equal. **This is the assertion that catches a missed leg** — if a movement was added to one function and not the other, they differ here and nowhere else.

- [ ] **Step 5: Repeat assertion 3 with a refund in the period**

Run a stay with a 5,000 advance and a 3,500 bill, refunding 1,500 cash, then re-run the query from Step 4.
Expected: still equal, and `advances_refunded = 1500`.

---

### Task 6: Server actions

**Files:**
- Modify: `app/actions/rooms.ts` (`checkInRoom` ~line 277, `loadFolioInputs` ~line 462, `getRoomFolio` ~line 599, `checkOutRoom` ~line 734; add `addRoomAdvance`)
- Modify: `app/actions/security.ts` (add `updateRoomAdvance`, `removeRoomAdvance`)
- Modify: `lib/security/authorize.ts:16-22` (`SecurityOperation`)

**Interfaces:**
- Consumes: the RPCs from Tasks 3-4; `RoomFolio.advancePaid/balanceDue/refundDue` from Task 1
- Produces:
  - `RoomFolioView.advances: { id: string; amount: number; cash: number; online: number; card: number; method: string; note: string | null; created_at: string }[]`
  - `addRoomAdvance(prevState, formData): Promise<ActionResult>` — form fields `stay_id`, `advance_amount`, `advance_method`, `advance_cash`, `advance_online`, `advance_note`
  - `updateRoomAdvance(pin, advanceId, split): Promise<ActionResult>`, `removeRoomAdvance(pin, advanceId): Promise<ActionResult>`

- [ ] **Step 1: Add the security operation**

In `lib/security/authorize.ts`, extend the union (currently ends at `"open_mock_bill"`):

```ts
export type SecurityOperation =
  | "edit_payment_tender"
  | "edit_purchase"
  | "open_mock_bill"
  // Correcting or removing a room advance. Unlike a tender edit this rewrites money
  // that has ALREADY been counted into a day's cash balance, so a wrong figure left
  // standing corrupts a till reconciliation nobody can later explain.
  | "edit_room_advance";
```

No migration: `security_audit_log.operation` is plain `text` with no CHECK constraint.

- [ ] **Step 2: Parse and forward the advance at check-in**

In `app/actions/rooms.ts` `checkInRoom`, after the existing field reads (~line 291), add:

```ts
  // The deposit. Optional: blank or zero writes no row at all, so a check-in
  // without one is byte-identical to what this action did before.
  const advAmount = parseFloat(String(formData.get("advance_amount") ?? "0")) || 0;
  const advMethod = String(formData.get("advance_method") ?? "cash").toLowerCase();
  const advCashRaw = parseFloat(String(formData.get("advance_cash") ?? "0")) || 0;
  const advOnlineRaw = parseFloat(String(formData.get("advance_online") ?? "0")) || 0;
  const advNote = String(formData.get("advance_note") ?? "").trim();

  if (advAmount < 0) return { error: "The advance cannot be negative." };
  if (advAmount > 0 && !["cash", "online", "card", "mixed"].includes(advMethod)) {
    return { error: "Choose how the advance was paid." };
  }

  // The split is DERIVED here, not trusted from the form — the client sends what it
  // thinks, and a tampered form must not be able to book 5,000 of cash against a
  // 100 advance. Only `mixed` needs the two numbers, and they must add up.
  const adv =
    advAmount === 0
      ? { cash: 0, online: 0, card: 0 }
      : advMethod === "cash"
      ? { cash: advAmount, online: 0, card: 0 }
      : advMethod === "online"
      ? { cash: 0, online: advAmount, card: 0 }
      : advMethod === "card"
      ? { cash: 0, online: 0, card: advAmount }
      : { cash: advCashRaw, online: advOnlineRaw, card: 0 };

  if (advAmount > 0 && Math.abs(adv.cash + adv.online + adv.card - advAmount) > 0.005) {
    return { error: "The Cash and Online amounts must add up to the advance." };
  }
```

Then add to the existing `svc.rpc("check_in_room", { … })` call — **by name**, after `p_guest_address`:

```ts
    p_advance_amount: advAmount,
    p_advance_cash: adv.cash,
    p_advance_online: adv.online,
    p_advance_card: adv.card,
    p_advance_method: advAmount > 0 ? advMethod : null,
    p_advance_note: advNote || null,
```

and add to the error mapping block:

```ts
    if (msg.includes("INVALID_ADVANCE")) return { error: "The advance amount and its split don't match." };
```

- [ ] **Step 3: Load advances into the folio**

In `loadFolioInputs`, add a fourth query to the existing `Promise.all` (~line 484):

```ts
    svc
      .from("room_advances")
      .select("id, amount, cash_amount, online_amount, card_amount, method, note, created_at")
      .eq("stay_id", stayId)
      .order("created_at"),
```

Destructure it as `advancesRes`, and add to the returned object:

```ts
    advances: ((advancesRes.data ?? []) as RawAdvance[]).map((a) => ({
      id: a.id,
      amount: Number(a.amount),
      cash: Number(a.cash_amount),
      online: Number(a.online_amount),
      card: Number(a.card_amount),
      method: a.method,
      note: a.note,
      created_at: a.created_at,
    })),
```

with, near the other types in the file:

```ts
type RawAdvance = {
  id: string; amount: string | number;
  cash_amount: string | number; online_amount: string | number; card_amount: string | number;
  method: string; note: string | null; created_at: string;
};

export type RoomAdvance = {
  id: string; amount: number; cash: number; online: number; card: number;
  method: string; note: string | null; created_at: string;
};
```

Add `advances: RoomAdvance[];` to the `RoomFolioView` type (~line 447), and in `getRoomFolio` pass the net into the calculator and the list into the view:

```ts
  const advancePaid = input.advances.reduce((s, a) => s + a.amount, 0);
```

then in the returned object add `advances: input.advances,` and extend the `buildFolio` config argument:

```ts
      payment
        ? { ...config, discount: payment.discount, advancePaid }
        : { ...config, advancePaid }
```

- [ ] **Step 4: Add `addRoomAdvance`**

Add to `app/actions/rooms.ts`, next to `addRoomCharge`:

```ts
/**
 * A further deposit during the stay. Same right as checking the guest in — a
 * receptionist who can put a guest in the room takes their money at the desk, and
 * a second permission here would mean one unticked box silently breaks the front
 * desk. The room-assignment filter still applies.
 */
export async function addRoomAdvance(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!ROOM_ACCESS.canCheckIn(ru)) {
    return { error: "You don't have permission to take an advance." };
  }

  const stayId = String(formData.get("stay_id") ?? "");
  const amount = parseFloat(String(formData.get("advance_amount") ?? "0")) || 0;
  const method = String(formData.get("advance_method") ?? "cash").toLowerCase();
  const cashRaw = parseFloat(String(formData.get("advance_cash") ?? "0")) || 0;
  const onlineRaw = parseFloat(String(formData.get("advance_online") ?? "0")) || 0;
  const note = String(formData.get("advance_note") ?? "").trim();

  if (!stayId) return { error: "No stay selected." };
  if (amount <= 0) return { error: "Enter the advance amount." };
  if (!["cash", "online", "card", "mixed"].includes(method)) {
    return { error: "Choose how the advance was paid." };
  }

  const input = await loadFolioInputs(stayId);
  if (!input) return { error: "That stay no longer exists." };
  if (input.stay.status !== "active") {
    return { error: "This guest has already checked out." };
  }

  const split =
    method === "cash"
      ? { cash: amount, online: 0, card: 0 }
      : method === "online"
      ? { cash: 0, online: amount, card: 0 }
      : method === "card"
      ? { cash: 0, online: 0, card: amount }
      : { cash: cashRaw, online: onlineRaw, card: 0 };

  if (Math.abs(split.cash + split.online + split.card - amount) > 0.005) {
    return { error: "The Cash and Online amounts must add up to the advance." };
  }

  const { error } = await input.svc.rpc("record_room_advance", {
    p_restaurant_id: ru.restaurant_id,
    p_stay_id: stayId,
    p_amount: amount,
    p_cash: split.cash,
    p_online: split.online,
    p_card: split.card,
    p_method: method,
    p_note: note || null,
    p_created_by: ru.id,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("STAY_CLOSED")) return { error: "This guest has already checked out." };
    if (msg.includes("INVALID_ADVANCE")) return { error: "The advance amount and its split don't match." };
    return { error: "Could not record the advance. Please try again." };
  }

  revalidatePath(`/employee/room/${stayId}`);
  revalidatePath("/employee/dashboard");
  return { ok: true };
}
```

- [ ] **Step 5: Make checkout advance-aware**

In `checkOutRoom`, after `const folio = buildFolio(…)`, the total must stay the **grand total** (the sale) while the tender is validated against the **balance**. Load the advances through `loadFolioInputs` (Step 3 already returns them) and change the block that currently reads `const total = folio.grandTotal; const paid = cash + online + card;`:

```ts
  const total = folio.grandTotal;
  const paid = cash + online + card;
  // Read from the database, never from the form — the same reason the total is
  // rebuilt here rather than trusted.
  const held = input.advances.reduce((s, a) => s + a.amount, 0);
  const applied = Math.min(Math.max(held, 0), total);
  const balance = Math.max(0, total - applied);
  const refundDue = Math.max(0, held - total);

  const refundCash = parseFloat(String(formData.get("refund_cash") ?? "0")) || 0;
  const refundOnline = parseFloat(String(formData.get("refund_online") ?? "0")) || 0;
  if (Math.abs(refundCash + refundOnline - refundDue) > 0.01) {
    return { error: `₹${refundDue.toFixed(2)} of unused advance must be refunded to the guest.` };
  }
```

Then, in the validation below it, replace every comparison against `total` with `balance`:

```ts
  if (method === "mixed" && Math.abs(cash + online - balance) > 0.01) {
    return { error: "The combined Cash and Online amounts must equal the balance payable." };
  }
```

and in the credit branch:

```ts
    if (paid >= balance) {
      return { error: "Nothing would be left on credit. Settle it in full instead." };
    }
  } else if (Math.abs(paid - balance) > 0.01) {
    return { error: `The amount tendered must equal the balance of ₹${balance.toFixed(2)}.` };
  }
```

Add the two refund arguments to the `check_out_room` call — **by name**:

```ts
    p_refund_cash: refundCash,
    p_refund_online: refundOnline,
```

and to the error mapping:

```ts
    if (msg.includes("REFUND_MISMATCH")) {
      return { error: "The refund amount no longer matches the advance held. Reload and try again." };
    }
```

> `p_total` still receives `total`, not `balance`. The **sale is the whole bill**; the advance is how part of it was paid.

- [ ] **Step 6: Add the PIN-gated correction actions**

Add to `app/actions/security.ts`, following `updatePaymentTender` exactly:

```ts
// Correcting a room advance. Money already counted into a day's cash balance is being
// rewritten, so this is admin-only AND behind the Security PIN, and every attempt —
// including a wrong PIN — is logged with the actor.
export async function updateRoomAdvance(
  pin: string,
  advanceId: string,
  split: { amount: number; cash: number; online: number; card: number; method: string }
): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantStaff();
  if (!isRestaurantAdmin(restaurantUser)) {
    return { error: "Only an admin can correct an advance." };
  }

  const authorized = await verifySecurityPin(restaurantUser, "edit_room_advance", pin, {
    type: "room_advance",
    id: advanceId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("edit_room_advance", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_actor_id: restaurantUser.id,
    p_actor_name: restaurantUser.display_name ?? null,
    p_advance_id: advanceId,
    p_amount: split.amount,
    p_cash: split.cash,
    p_online: split.online,
    p_card: split.card,
    p_method: split.method,
  });

  if (error) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_room_advance",
      targetType: "room_advance",
      targetId: advanceId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    const msg = error.message ?? "";
    if (msg.includes("ADVANCE_STAY_CLOSED")) {
      return { error: "This stay has been settled — its advances can no longer be changed." };
    }
    if (msg.includes("ADVANCE_NOT_FOUND")) return { error: "That advance no longer exists." };
    if (msg.includes("INVALID_ADVANCE")) return { error: "The amount and its split don't match." };
    return { error: "Could not update the advance." };
  }

  for (const p of ["/admin/finance", "/employee/dashboard"]) revalidatePath(p);
  return { ok: true };
}

export async function removeRoomAdvance(pin: string, advanceId: string): Promise<ActionResult> {
  const { restaurantUser } = await requireRestaurantStaff();
  if (!isRestaurantAdmin(restaurantUser)) {
    return { error: "Only an admin can remove an advance." };
  }

  const authorized = await verifySecurityPin(restaurantUser, "edit_room_advance", pin, {
    type: "room_advance",
    id: advanceId,
  });
  if (!authorized) return { error: "Incorrect Security PIN." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("delete_room_advance", {
    p_restaurant_id: restaurantUser.restaurant_id,
    p_actor_id: restaurantUser.id,
    p_actor_name: restaurantUser.display_name ?? null,
    p_advance_id: advanceId,
  });

  if (error) {
    await logSecurityEvent({
      restaurantId: restaurantUser.restaurant_id,
      actor: restaurantUser,
      operation: "edit_room_advance",
      targetType: "room_advance",
      targetId: advanceId,
      outcome: "blocked",
      detail: { code: error.message },
    });
    const msg = error.message ?? "";
    if (msg.includes("ADVANCE_STAY_CLOSED")) {
      return { error: "This stay has been settled — its advances can no longer be changed." };
    }
    return { error: "Could not remove the advance." };
  }

  for (const p of ["/admin/finance", "/employee/dashboard"]) revalidatePath(p);
  return { ok: true };
}
```

> Check how `security.ts` already identifies an admin. If there is no `isRestaurantAdmin` helper in scope, use the same expression the file's other owner-only code uses (search for `restaurant_admin` in `lib/permissions.ts`) rather than inventing one.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

---

### Task 7: The bill shows the deduction

**Files:**
- Modify: `lib/billing/room-bill.ts` (`RoomBillView`, `folioToBill`)
- Modify: `lib/billing/room-bill.test.ts`
- Modify: `app/(employee)/employee/_components/bill-ticket.tsx:464-508` (props), `:653-659` (the totals block)

**Interfaces:**
- Consumes: `RoomFolio.advancePaid` / `balanceDue` (Task 1)
- Produces: `RoomBillView.advancePaid`, `RoomBillView.balanceDue`; `BillTicket` props `advancePaid?: number`, `balanceDue?: number`

- [ ] **Step 1: Write the failing test**

Add to `lib/billing/room-bill.test.ts` (the fixture at the top of that file needs `advancePaid`, `balanceDue`, `refundDue` added — see Task 1 Step 5):

```ts
test("carries the advance and balance through to the bill view", () => {
  const bill = folioToBill({
    folio: { ...folio, advancePaid: 2000, balanceDue: 3000, refundDue: 0 },
    roomType: "Deluxe",
  });
  assert.equal(bill.grandTotal, 5000, "the sale is still the whole bill");
  assert.equal(bill.advancePaid, 2000);
  assert.equal(bill.balanceDue, 3000);
});

test("a bill with no advance carries zeroes, not undefined", () => {
  const bill = folioToBill({ folio, roomType: "Deluxe" });
  assert.equal(bill.advancePaid, 0);
  assert.equal(bill.balanceDue, bill.grandTotal);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test lib/billing/room-bill.test.ts`
Expected: FAIL — `bill.advancePaid` is `undefined`.

- [ ] **Step 3: Map the two fields**

In `lib/billing/room-bill.ts`, add to `RoomBillView`:

```ts
  /** Received before checkout. 0 on every table bill and on a stay with no deposit. */
  advancePaid: number;
  /** What is handed over at checkout: grandTotal − advancePaid. */
  balanceDue: number;
```

and to the object `folioToBill` returns:

```ts
    advancePaid: folio.advancePaid,
    balanceDue: folio.balanceDue,
```

Still a pure mapper — both numbers come from `buildFolio` and nothing is recomputed here.

- [ ] **Step 4: Render them**

In `bill-ticket.tsx`, add two props beside `grandTotalOverride`:

```ts
  /**
   * A deposit already received against this bill, and what is left to hand over.
   * Printed ONLY when `advancePaid > 0`, which is never for a table bill, a walk-in
   * or the mock screen — so their output is byte-identical to before.
   *
   * The GRAND TOTAL line does not move: the bill is still for the whole stay, and
   * the advance is a payment against it, not a reduction of it.
   */
  advancePaid?: number;
  balanceDue?: number;
```

and, in the totals block, immediately after the existing `TOTAL PAYABLE` / `GRAND TOTAL` line:

```tsx
      {(advancePaid ?? 0) > 0 && (
        <>
          <Line label="Advance received" value={`- ${rupee(advancePaid!)}`} />
          <div style={{ borderTop: "1px solid #000", margin: "6px 0" }} />
          <Line label="BALANCE PAYABLE" value={rupee(balanceDue ?? 0)} bold />
        </>
      )}
```

- [ ] **Step 5: Run the tests and verify**

Run: `node --test lib/billing/room-bill.test.ts && node --test lib/room-billing.test.ts && npx tsc --noEmit`
Expected: all pass, `tsc` clean.

- [ ] **Step 6: Verify the mock bill is untouched**

Run: `node --test lib/mock-bill/isolation.test.ts`
Expected: all pass. The mock editor passes neither new prop, so its output is unchanged.

---

### Task 8: The three screens

**Files:**
- Modify: `app/(employee)/employee/dashboard/_components/rooms-grid.tsx:54-219` (`CheckInModal`)
- Modify: `app/(employee)/employee/room/[stayId]/_components/folio-client.tsx:149-460` (`CheckOutForm`) and its folio panel
- Modify: the folio page that renders `folio-client.tsx`, to pass `canManageAdvances` (admin) through

**Interfaces:**
- Consumes: `addRoomAdvance`, `updateRoomAdvance`, `removeRoomAdvance`, `RoomFolioView.advances` (Task 6)
- Produces: no exports

- [ ] **Step 1: Add the check-in section**

In `CheckInModal`, between the Notes field and the rate note, add:

```tsx
          {/* Advance. Entirely optional — leaving it blank writes no record at all,
              which is why there is no "no advance" choice to make. */}
          <div className="rounded-lg border px-3 py-3 flex flex-col gap-3"
               style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--color-ink)" }}>
              Advance payment <span style={{ color: "var(--color-ink-mute)" }}>(optional)</span>
            </p>
            <input
              name="advance_amount"
              type="number" min="0" step="0.01" inputMode="decimal"
              value={advance}
              onChange={(e) => { setAdvance(e.target.value); setAdvCash(""); setAdvOnline(""); }}
              placeholder="0.00"
              className="w-full h-10 rounded-sm border px-3 text-sm tabular"
              style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
            />
            {advNum > 0 && (
              <>
                <input type="hidden" name="advance_method" value={advMethod} />
                <div className="flex flex-wrap gap-1.5">
                  {ADVANCE_METHODS.map((m) => (
                    <button
                      key={m.key} type="button" onClick={() => setAdvMethod(m.key)}
                      className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                      style={{
                        borderColor: advMethod === m.key ? "var(--color-primary)" : "var(--color-hairline)",
                        background: advMethod === m.key ? "var(--color-primary)" : "var(--color-canvas)",
                        color: advMethod === m.key ? "#fff" : "var(--color-ink)",
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {advMethod === "mixed" && (
                  <div className="grid grid-cols-2 gap-3">
                    {([["Cash", advCash, handleAdvCash], ["Online", advOnline, handleAdvOnline]] as const).map(
                      ([label, val, set]) => (
                        <div key={label}>
                          <label className="text-xs block mb-1.5" style={{ color: "var(--color-ink-mute)" }}>{label}</label>
                          <input
                            name={label === "Cash" ? "advance_cash" : "advance_online"}
                            type="number" min="0" step="0.01" inputMode="decimal"
                            value={val} onChange={(e) => set(e.target.value)}
                            className="w-full h-10 rounded-sm border px-3 text-sm tabular"
                            style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                          />
                        </div>
                      )
                    )}
                    {!advMixedOk && (
                      <p className="col-span-2 text-xs" style={{ color: "var(--color-ruby)" }}>
                        Cash and Online must add up to {rupee(advNum)}.
                      </p>
                    )}
                  </div>
                )}
                <input
                  name="advance_note" placeholder="Note (optional)"
                  className="w-full h-10 rounded-sm border px-3 text-sm"
                  style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
                />
              </>
            )}
          </div>
```

with this state at the top of `CheckInModal` (after `useActionState`):

```tsx
  const [advance, setAdvance] = useState("");
  const [advMethod, setAdvMethod] = useState<"cash" | "online" | "card" | "mixed">("cash");
  const [advCash, setAdvCash] = useState("");
  const [advOnline, setAdvOnline] = useState("");

  const advNum = parseFloat(advance) || 0;
  const advCashNum = parseFloat(advCash) || 0;
  const advOnlineNum = parseFloat(advOnline) || 0;
  // Typing one half fills the other, exactly as the checkout split does.
  function handleAdvCash(v: string) {
    setAdvCash(v);
    const n = parseFloat(v);
    setAdvOnline(!isNaN(n) && n >= 0 ? Math.max(0, Math.round((advNum - n) * 100) / 100).toFixed(2) : "");
  }
  function handleAdvOnline(v: string) {
    setAdvOnline(v);
    const n = parseFloat(v);
    setAdvCash(!isNaN(n) && n >= 0 ? Math.max(0, Math.round((advNum - n) * 100) / 100).toFixed(2) : "");
  }
  const advMixedOk =
    advNum === 0 || advMethod !== "mixed" || Math.abs(advCashNum + advOnlineNum - advNum) < 0.01;
```

and this module constant beside `STATUS`:

```tsx
const ADVANCE_METHODS = [
  { key: "cash" as const, label: "Cash" },
  { key: "online" as const, label: "Online" },
  { key: "card" as const, label: "Card" },
  { key: "mixed" as const, label: "Cash + Online" },
];
```

Disable the submit button when `!advMixedOk`: change `disabled={pending}` to `disabled={pending || !advMixedOk}`.

- [ ] **Step 2: Add the folio Advances block**

In `folio-client.tsx`, beside the existing charges list, render for an **active** stay:

- each `view.advances` row: date, method label, amount (a negative row reads "Refund"), and the note;
- the net held, as `Advance held`;
- an *Add advance* form posting `addRoomAdvance` with the same four fields and the same auto-filling mixed split as Step 1;
- on each row, for an admin only, an edit and a delete control that prompt for the 4-digit Security PIN and call `updateRoomAdvance` / `removeRoomAdvance`.

Follow the existing charge-row markup in this file for spacing and tokens rather than inventing a new visual language.

- [ ] **Step 3: Make checkout show three numbers**

In `CheckOutForm`, after the existing `total` is computed:

```tsx
  // Held is a fact from the server; the payable is what is LEFT after it.
  const held = view.advances.reduce((s, a) => s + a.amount, 0);
  const applied = Math.min(Math.max(held, 0), total);
  const balance = Math.round(Math.max(0, total - applied) * 100) / 100;
  const refundDue = Math.round(Math.max(0, held - total) * 100) / 100;
  const [refundTender, setRefundTender] = useState<"cash" | "online">("cash");
```

Then, mechanically, **replace `total` with `balance`** in: `handleCashChange`, `handleOnlineChange`, `mixedOk`, `creditOk`, `owed`, the `amounts` object, and the `max=` on the mixed inputs. `total` remains only where the SALE is meant — the `discount` hidden field and the Payable panel's breakdown.

Render the breakdown in place of the single "Payable now" row:

```tsx
      {applied > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border px-4 py-3"
             style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
          <div className="flex items-baseline justify-between">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Bill total</span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>{rupee(total)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>Advance received</span>
            <span className="text-sm tabular" style={{ color: "var(--color-ink)" }}>- {rupee(applied)}</span>
          </div>
        </div>
      )}
```

and when `refundDue > 0`, replace the method chips entirely with a refund panel — there is nothing to collect:

```tsx
      {refundDue > 0 ? (
        <>
          <input type="hidden" name="refund_cash" value={(refundTender === "cash" ? refundDue : 0).toFixed(2)} />
          <input type="hidden" name="refund_online" value={(refundTender === "online" ? refundDue : 0).toFixed(2)} />
          <div className="flex items-baseline justify-between rounded-lg border px-4 py-3"
               style={{ borderColor: "var(--color-amber)", background: "rgba(245,158,11,0.06)" }}>
            <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Refund due</span>
            <span className="text-xl tabular" style={{ fontWeight: 300 }}>{rupee(refundDue)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["cash", "online"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setRefundTender(t)}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: refundTender === t ? "var(--color-primary)" : "var(--color-hairline)",
                  background: refundTender === t ? "var(--color-primary)" : "var(--color-canvas)",
                  color: refundTender === t ? "#fff" : "var(--color-ink)",
                }}>
                {t === "cash" ? "Return cash" : "Transfer back"}
              </button>
            ))}
          </div>
        </>
      ) : (
        /* … the existing "Payable now" panel, showing `balance`, and the method chips … */
      )}
```

Keep `<input type="hidden" name="refund_cash" value="0" />` and its online twin rendered in the non-refund branch too, so the action always receives both fields.

- [ ] **Step 4: Pass the advance through to the printed bill**

Wherever this file builds `BillTicket` props from `folioToBill(...)`, add:

```tsx
        advancePaid={bill.advancePaid}
        balanceDue={bill.balanceDue}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean, with `/employee/room/[stayId]` and `/employee/dashboard` still in the route list.

---

### Task 9: Finance surfaces

**Files:**
- Modify: `lib/finance.ts` (`FinanceReport` type)
- Modify: `app/actions/finance.ts` (row → `FinanceReport` mapping, CSV export)
- Modify: `app/(admin)/admin/finance/_components/finance-client.tsx`
- Modify: `lib/reports/daily-summary.ts`, `lib/reports/daily-summary-pdf.ts`

**Interfaces:**
- Consumes: `finance_report`'s four new columns, `finance_transactions`' `room_advance` kind (Task 5)
- Produces: `FinanceReport.advancesReceived`, `.advancesRefunded`, `.openingAdvancesHeld`, `.closingAdvancesHeld`

- [ ] **Step 1: Extend the type**

In `lib/finance.ts`, add to `FinanceReport` beside the credit fields:

```ts
  /** Deposits taken in the period, and any returned. Cash movement, not sales. */
  advancesReceived: number;
  advancesRefunded: number;
  /**
   * Guests' money sitting in the till: taken but not yet applied to a bill. A
   * liability, derived like the credit balances, so one period's closing figure IS
   * the next period's opening figure.
   */
  openingAdvancesHeld: number;
  closingAdvancesHeld: number;
```

- [ ] **Step 2: Map them**

In `app/actions/finance.ts`, wherever the RPC row is mapped into `FinanceReport` (beside `salesCash: num(f?.sales_cash)`), add:

```ts
    advancesReceived: num(f?.advances_received),
    advancesRefunded: num(f?.advances_refunded),
    openingAdvancesHeld: num(f?.opening_advances_held),
    closingAdvancesHeld: num(f?.closing_advances_held),
```

Add matching rows to the CSV export in the same file, next to the credit rows.

- [ ] **Step 3: Show them**

In `finance-client.tsx`, add an **Advances held** figure to the balances group (beside credit-to-us / credit-by-us) and an **Advances received** line to the money-in group, using that section's existing row component. Label the held figure explicitly as guests' money, e.g. `Advance held (guests' money)` — an owner reading a cash figure needs to know part of it is not theirs yet.

Also render the new ledger kind: map `room_advance` to a label such as `Advance` (and `Advance refund` when the amount is negative) wherever `finance_transactions` kinds are labelled.

- [ ] **Step 4: Put them in the daily report**

In `lib/reports/daily-summary.ts`, carry the four fields through the summary model; in `daily-summary-pdf.ts`, add an "Advances" line to the cash section and the held figure to the balances table. Keep the wording identical to the on-screen labels — the PDF and the screen disagreeing is a support call.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

Then open `/admin/finance` on DEV for a period containing a test advance and confirm: the advance appears in the ledger as its own row, `Advances held` matches `sum(room_advances.amount) − sum(payments.advance_amount)` for that restaurant, and the CSV carries the same numbers as the screen.

---

### Task 10: Full verification and Memory Bank

**Files:**
- Modify: `memory-bank/current-task.md`, `memory-bank/changelog.md`, `memory-bank/modules/rooms.md`, `memory-bank/modules/finance.md`, `memory-bank/database.md`

- [ ] **Step 1: Run every automated gate**

```bash
npx tsc --noEmit
npm run build
node --test lib/room-billing.test.ts
node --test lib/billing/room-bill.test.ts
node --test lib/mock-bill/isolation.test.ts
```

Expected: all clean. Report the actual output — do not claim a pass without it.

- [ ] **Step 2: Regression — prove nothing without an advance moved**

On DEV: close one **table** bill (cash), one **walk-in** bill, and one **room checkout with no advance**. For each, confirm `payments.advance_amount = 0`, the printed bill has no "Advance received" line, and the Finance closing cash moves by exactly the amount tendered.

- [ ] **Step 3: In-app QA on DEV**

1. Check in with a 5,000 cash advance → the room card and folio show it; Finance cash +5,000, Sales +0.
2. Add a further 2,000 online advance from the folio → held reads 7,000.
3. Order room service, add an extra charge, check out with a bill above 7,000 → balance payable is the remainder; the printed bill shows all three lines; Sales books the full bill.
4. A stay whose bill is **under** the advance → Refund due appears, checkout records the negative row, cash falls by the refund.
5. A **credit** checkout with an advance → the credit account's balance rises by `total − advance − paid`, not by `total − paid`.
6. As a non-admin, confirm the advance edit/delete controls are absent; as an admin with a wrong PIN, confirm refusal; both attempts visible in Admin → Settings → Security activity.
7. Phone portrait and the installed PWA: the check-in advance section and the folio block are reachable and the modal is not trapped off-screen.

- [ ] **Step 4: Update the Memory Bank**

- `current-task.md` — replace the Mock Bill entry as the current feature (move that summary to `completed.md` only if the user confirms it is done), describing this feature, what is verified, and that **production migrations `20260811000000`–`20260811000300` are pending and the user will apply them**.
- `changelog.md` — the user-facing change: advances at check-in and mid-stay, deducted at checkout, refundable.
- `modules/rooms.md` — a Features entry and a Business Rule for the advance, and the `room_advances` relation.
- `modules/finance.md` — the fifth balance and its derivation formula.
- `database.md` — `room_advances` and `payments.advance_amount`, including the lockstep-readers warning.

- [ ] **Step 5: Hand back**

Report to the user: what was verified with what output, that **nothing is committed**, and that the four migrations are applied on **DEV only** and still pending on production.

---

## Self-Review

**Spec coverage:** signed `room_advances` (Task 2) · `payments.advance_amount` and every lockstep reader (Tasks 2, 4) · cash-on-the-day / sale-at-checkout (Tasks 4, 5) · `finance_report` cash legs, two reported figures and the fifth balance (Task 5) · `finance_transactions` branch and sale-branch fix (Task 5) · `dashboard_stats` deliberately untouched (no task) · folio maths (Task 1) · `folioToBill` + `BillTicket` (Task 7) · check-in section, folio block, checkout with refund (Task 8) · permissions on `check_in`/`close_bills`, `edit_room_advance` PIN, no migration for the audit union (Tasks 3, 6) · pure tests + the three DB assertions + the no-advance regression (Tasks 1, 5, 10) · DB-before-app and named arguments (Global Constraints).

**Known deviations from the spec, both deliberate:** three migration files rather than one, so each is independently appliable and verifiable; and `check_out_room` gains `p_refund_cash`/`p_refund_online` rather than the refund being derived server-side alone — the amount is still *validated* against the database-held figure, so the client cannot choose the size of the refund, only where it goes.

**Type consistency:** `advancePaid` / `balanceDue` / `refundDue` are used under those exact names in `RoomFolio` (Task 1), `RoomBillView` (Task 7) and `BillTicket` props (Task 7). The server-side row type is `RoomAdvance` with `amount/cash/online/card/method/note/created_at` (Task 6) and is consumed under that shape in Task 8. SQL parameters are `p_advance_*` at check-in, `p_advance` on `close_bill_with_credit`, and `p_refund_cash`/`p_refund_online` at checkout.
