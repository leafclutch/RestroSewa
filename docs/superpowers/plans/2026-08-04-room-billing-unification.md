# Room Billing Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture guest identity at check-in, and make the room bill the *same document* before and after payment by rendering it through the existing table-bill component.

**Architecture:** A room stay is already a `session` and checkout already writes an ordinary `payments` row, so nothing is rebuilt. `BillTicket` gains two optional props (`stay`, `sections`); one new pure mapper `folioToBill()` feeds it from both the unpaid folio and the paid Sales bill, so the two can never drift. Three columns land on `room_stays`.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), TypeScript, Supabase Postgres (plpgsql RPCs), Tailwind v4 tokens, `node --test` for pure modules.

## Global Constraints

- **Prices are tax-inclusive.** No restaurant sets `tax_percent` or `service_charge_percent`; both are 0. Do not add tax lines. The unified rule is **discount before tax**: `taxable = subtotal − discount`, tax/service computed on `taxable`.
- **Every new RPC parameter MUST have a DEFAULT, and every call site MUST pass arguments BY NAME.** Migration `20260717140000` records that adding a parameter without a default broke every hotel credit checkout, because the caller used 11 positional arguments.
- **Never re-create an RPC body from memory.** Dump the live definition with `pg_get_functiondef`, and change only the signature line plus the specific statements named in the task.
- **`lib/billing/room-bill.ts` must be erasable-syntax TypeScript** — no enums, no parameter properties, and only `import type` from other modules — or `node --test` cannot run it.
- **Money rule:** the NET amount (after discount) IS the sale. Never store or report a gross/net split.
- **Migrations run through `node scripts/migrate.mjs up`** (DEV by default; production needs `--prod --yes`). Never `supabase db push`.
- **Receipt rules (do not regress):** everything on paper is `#000` (a thermal head is one bit — grey dithers into an unreadable smudge); no logo on paper; the page width is the PRINTABLE width (72mm / 48mm), never the roll width.
- There is **no test framework** in this repo. Only Task 4 has automated tests (a pure module via `node --test`). Every other task is verified by `npx tsc --noEmit`, `npm run lint`, `npm run build`, and the explicit manual/DB checks written into its steps.
- **Production has exactly one hotel client** ("Sanjib") with 8 stays, 7 closed. Old stays have no identity fields and must keep rendering.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260804000000_room_guest_identity.sql` | Guest identity columns + constraint; `check_in_room` signature |
| `supabase/migrations/20260804010000_room_checkout_discount.sql` | `check_out_room` gains `p_discount`, writes `payments.discount_amount` |
| `lib/billing/room-bill.ts` | **New.** Pure mapper: `RoomFolio` + guest/stay facts → `BillTicket` props. No I/O, no React |
| `lib/billing/room-bill.test.ts` | **New.** `node --test` coverage of the mapper's money and grouping rules |
| `app/(employee)/employee/_components/bill-ticket.tsx` | Optional `stay` + `sections` props; `customer` gains ID fields; discount-before-tax |
| `app/actions/rooms.ts` | `checkInRoom` validates + forwards identity; `checkOutRoom` forwards `p_discount` |
| `app/(employee)/employee/dashboard/_components/rooms-grid.tsx` | Check-in form fields |
| `app/(employee)/employee/room/[stayId]/_components/folio-client.tsx` | Bill preview/print switches to `BillTicket`; the working panel is untouched |
| `app/actions/pos.ts` | `getPaidBill` reloads the frozen stay for room sessions and uses the same mapper |

---

### Task 1: Guest identity columns and `check_in_room`

**Files:**
- Create: `supabase/migrations/20260804000000_room_guest_identity.sql`

**Interfaces:**
- Produces: `room_stays.guest_id_type` (`'citizenship' | 'nid' | null`), `room_stays.guest_id_number` (text), `room_stays.guest_address` (text); `check_in_room(..., p_guest_id_type text default null, p_guest_id_number text default null, p_guest_address text default null)`.

- [ ] **Step 1: Capture the CURRENT live function body**

Run this and keep the output — the migration must reproduce it verbatim except for the parts this task changes:

```bash
node --input-type=module <<'EOF'
import fs from "node:fs";
import pg from "pg";
const t = fs.readFileSync(".env.local","utf8");
const u = t.match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,"");
const m = u.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);
const c = new pg.Client({user:m[1],password:m[2],host:m[3],port:Number(m[4]),database:m[5],ssl:{rejectUnauthorized:false}});
await c.connect();
const r = await c.query("select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='check_in_room'");
console.log(r.rows[0].def);
await c.end();
EOF
```

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260804000000_room_guest_identity.sql`. Paste the body from Step 1 where marked; change ONLY the signature and the `insert into room_stays` column list.

```sql
-- Guest identity on a room stay.
--
-- A hotel register needs an identity document and a permanent address. These live on
-- room_stays, NOT on sessions.customer_address: that column belongs to the walk-in
-- customer-details feature and dies with the session, while this must stay attached to the
-- booking history and to every bill derived from the stay.
--
-- Nullable on purpose. Production holds 8 stays (7 closed) that cannot be backfilled with
-- documents nobody recorded; `checkInRoom` enforces presence for every NEW check-in.
alter table room_stays
  add column if not exists guest_id_type   text,
  add column if not exists guest_id_number text,
  add column if not exists guest_address   text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'room_stays_guest_id_type_check'
  ) then
    alter table room_stays
      add constraint room_stays_guest_id_type_check
      check (guest_id_type is null or guest_id_type in ('citizenship','nid'));
  end if;
end $$;

-- check_in_room gains three parameters, all DEFAULT NULL so the existing 8-argument call
-- keeps resolving while the app is redeployed. See migration 20260717140000 for what a
-- parameter without a default did to hotel checkout.
create or replace function check_in_room(
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
  p_guest_address   text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $function$
  -- >>> PASTE THE BODY FROM STEP 1 HERE, UNCHANGED, EXCEPT:
  --     the `insert into room_stays (...) values (...)` gains
  --       guest_id_type, guest_id_number, guest_address
  --     and
  --       p_guest_id_type, p_guest_id_number, p_guest_address
  $function$;
```

- [ ] **Step 3: Apply to DEV and verify the schema**

```bash
node scripts/migrate.mjs up
```

Then assert both the columns and the new signature exist:

```bash
node --input-type=module <<'EOF'
import fs from "node:fs";
import pg from "pg";
const t = fs.readFileSync(".env.local","utf8");
const u = t.match(/^SUPABASE_DB_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,"");
const m = u.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:/]+):(\d+)\/(.+)$/);
const c = new pg.Client({user:m[1],password:m[2],host:m[3],port:Number(m[4]),database:m[5],ssl:{rejectUnauthorized:false}});
await c.connect();
console.log((await c.query("select column_name from information_schema.columns where table_schema='public' and table_name='room_stays' and column_name like 'guest_%'")).rows);
console.log((await c.query("select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='check_in_room'")).rows);
await c.end();
EOF
```

Expected: `guest_name`, `guest_phone`, `guest_id_type`, `guest_id_number`, `guest_address`; and 11 arguments ending in three `default null`s.

- [ ] **Step 4: Verify the OLD call still works (the regression this migration risks)**

The app has not been changed yet, so it still calls with 8 named arguments. Check a guest in through the running dev app (staff PIN `1234` on the dev database) and confirm the stay is created. If this fails, the defaults are wrong — fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260804000000_room_guest_identity.sql
git commit -m "feat(rooms): store guest ID type, ID number and permanent address on a stay"
```

---

### Task 2: Check-in captures identity

**Files:**
- Modify: `app/actions/rooms.ts` (`checkInRoom`)
- Modify: `app/(employee)/employee/dashboard/_components/rooms-grid.tsx` (check-in form)

**Interfaces:**
- Consumes: the three columns and the 11-argument `check_in_room` from Task 1.
- Produces: every new stay carries `guest_id_type`, `guest_id_number`, `guest_address`.

- [ ] **Step 1: Add the form fields**

In the check-in form in `rooms-grid.tsx`, after the existing phone field, add a select and two inputs. Follow the surrounding markup exactly — same `Input` component, same label styling, same `var(--color-*)` tokens. Do not introduce new colour literals.

```tsx
<label className="text-xs" style={{ color: "var(--color-ink-mute)" }}>ID type</label>
<select
  name="guest_id_type"
  required
  defaultValue="citizenship"
  className="w-full rounded-lg border px-3 py-2 text-sm"
  style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)", color: "var(--color-ink)" }}
>
  <option value="citizenship">Citizenship</option>
  <option value="nid">National ID (NID)</option>
</select>

<Input name="guest_id_number" required placeholder="12-01-76-12345" autoComplete="off" />
<Input name="guest_address" required placeholder="Butwal, Rupandehi" autoComplete="off" />
```

- [ ] **Step 2: Validate and forward in the action**

In `checkInRoom` in `app/actions/rooms.ts`, beside the existing `guestName` read:

```ts
const idType = String(formData.get("guest_id_type") ?? "").trim();
const idNumber = String(formData.get("guest_id_number") ?? "").trim();
const address = String(formData.get("guest_address") ?? "").trim();

// Required for every new check-in — a hotel register is not optional. Each field names
// itself in the error, because "invalid input" at a busy front desk is useless.
if (idType !== "citizenship" && idType !== "nid") return { error: "Choose an ID type." };
if (!idNumber) return { error: "Enter the guest's ID number." };
if (!address) return { error: "Enter the guest's permanent address." };
```

and extend the existing `svc.rpc("check_in_room", { ... })` object — **by name, never positionally**:

```ts
    p_guest_id_type: idType,
    p_guest_id_number: idNumber,
    p_guest_address: address,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify end to end against the database**

Start the dev server (`npm run dev`), check a guest into a free room supplying all fields, then:

```sql
select guest_name, guest_id_type, guest_id_number, guest_address
from room_stays order by created_at desc limit 1;
```

Expected: the row carries exactly what was typed. Then attempt a check-in with the ID number blank and confirm the action refuses with "Enter the guest's ID number." and creates no row.

- [ ] **Step 5: Commit**

```bash
git add app/actions/rooms.ts "app/(employee)/employee/dashboard/_components/rooms-grid.tsx"
git commit -m "feat(rooms): require guest ID type, number and address at check-in"
```

---

### Task 3: Record the room discount (`p_discount`)

**Files:**
- Create: `supabase/migrations/20260804010000_room_checkout_discount.sql`
- Modify: `app/actions/rooms.ts` (`checkOutRoom`)

**Interfaces:**
- Produces: `check_out_room(..., p_discount numeric default 0)`, which writes `payments.discount_amount`.

**Why this exists:** the checkout modal already collects a discount and `buildFolio` already applies it to the total, but `check_out_room` has no `p_discount` parameter — so `payments.discount_amount` stays 0 for every room checkout. The guest pays less, and nothing records why. Sales shows no discount and the Finance discount total under-reports.

- [ ] **Step 1: Capture the live body**

Same dump as Task 1 Step 1, with `proname='check_out_room'`. Keep the output.

- [ ] **Step 2: Write the migration**

```sql
-- A room discount that is applied but never recorded.
--
-- checkOutRoom computes folio.grandTotal WITH the discount and passes it as p_total, but
-- there was no p_discount parameter, so payments.discount_amount stayed 0: the discount
-- vanished from Sales and from the Finance discount total.
--
-- DEFAULT 0 so the existing 12-argument call keeps resolving during the deploy window.
create or replace function check_out_room(
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
  p_discount       numeric default 0
) returns void
language plpgsql
security definer
set search_path = public
as $function$
  -- >>> PASTE THE BODY FROM STEP 1 HERE, UNCHANGED, EXCEPT:
  --  1. the `insert into payments (...)` gains `discount_amount` / `coalesce(p_discount, 0)`
  --  2. the `close_bill_with_credit(...)` call gains `p_discount => coalesce(p_discount, 0)`
  --     and is converted to NAMED arguments if it is still positional. close_bill_with_credit
  --     already accepts p_discount (default 0) — see migration 20260717140000.
  $function$;
```

- [ ] **Step 3: Forward the discount from the action**

In `checkOutRoom` in `app/actions/rooms.ts`, the `svc.rpc("check_out_room", { ... })` object gains:

```ts
    p_discount: discountRaw,
```

`discountRaw` is already read and permission-checked (`PERMISSIONS.APPLY_DISCOUNTS`) a few lines above; `folio.grandTotal` already reflects it. Nothing else moves.

- [ ] **Step 4: Apply and verify all three tender paths**

```bash
node scripts/migrate.mjs up
npx tsc --noEmit
```

Then, in the dev app, check out three stays: one **cash** with a discount, one **mixed** (cash+online) with a discount, one **credit** with a part payment and a discount. After each:

```sql
select bill_number, total_amount, discount_amount, payment_method
from payments order by created_at desc limit 1;
```

Expected: `discount_amount` equals what was typed in every case, and `total_amount` is net of it. **The credit case is the one that broke before** — if `close_bill_with_credit` is called positionally anywhere, it will fail here.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260804010000_room_checkout_discount.sql app/actions/rooms.ts
git commit -m "fix(rooms): record the checkout discount on the payment row"
```

---

### Task 4: `folioToBill()` — the one mapper (TDD)

**Files:**
- Create: `lib/billing/room-bill.ts`
- Test: `lib/billing/room-bill.test.ts`

**Interfaces:**
- Consumes: `RoomFolio` (type only) from `lib/room-billing.ts`.
- Produces:

```ts
export type BillSection = { title: string; lines: { id: string; item_name: string; item_price: number; quantity: number }[] };
export type BillStay = { roomType: string; rate: number; nights: number; checkIn: string; checkOut: string; duration: string };
export type RoomBillView = { sections: BillSection[]; stay: BillStay; subtotal: number; discount: number; grandTotal: number };
export function folioToBill(input: RoomBillInput): RoomBillView;
```

**Must be erasable-syntax TS** (no enums, no parameter properties, `import type` only) or `node --test` cannot run it.

- [ ] **Step 1: Write the failing test**

```ts
// lib/billing/room-bill.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { folioToBill } from "./room-bill.ts";

const folio = {
  checkIn: "2026-08-01T06:00:00.000Z",
  checkOut: "2026-08-03T06:00:00.000Z",
  open: false,
  nights: 2,
  duration: "2d",
  rate: 2500,
  room: { key: "room", label: "Room charge", detail: "2 × ₹2,500 per night", amount: 5000 },
  extras: [{ key: "e1", label: "Laundry", amount: 300 }],
  food: [{ key: "f1", label: "Momo", detail: "2 × ₹150", amount: 300 }],
  roomTotal: 5000, extrasTotal: 300, foodTotal: 300,
  subtotal: 5600, discount: 600, taxPercent: 0, tax: 0, servicePercent: 0, service: 0,
  grandTotal: 5000,
};

test("groups the folio into Room, Extras and Food sections", () => {
  const bill = folioToBill({ folio, roomType: "Deluxe" });
  assert.deepEqual(bill.sections.map((s) => s.title), ["Room charge", "Extras", "Food & beverages"]);
  assert.equal(bill.sections[0].lines[0].item_price, 5000);
  assert.equal(bill.sections[2].lines[0].item_name, "Momo");
});

test("omits a section that has no lines", () => {
  const bill = folioToBill({ folio: { ...folio, extras: [], extrasTotal: 0 }, roomType: "Deluxe" });
  assert.deepEqual(bill.sections.map((s) => s.title), ["Room charge", "Food & beverages"]);
});

test("carries the folio's own totals through untouched", () => {
  // The mapper must never re-derive money. buildFolio is the single calculator; a second
  // implementation here is exactly how a bill and its payment come to disagree.
  const bill = folioToBill({ folio, roomType: "Deluxe" });
  assert.equal(bill.subtotal, 5600);
  assert.equal(bill.discount, 600);
  assert.equal(bill.grandTotal, 5000);
});

test("exposes the stay block for the hotel header", () => {
  const bill = folioToBill({ folio, roomType: "Deluxe" });
  assert.equal(bill.stay.nights, 2);
  assert.equal(bill.stay.rate, 2500);
  assert.equal(bill.stay.roomType, "Deluxe");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test lib/billing/room-bill.test.ts`
Expected: FAIL — cannot find module `./room-bill.ts`.

- [ ] **Step 3: Write the mapper**

```ts
// lib/billing/room-bill.ts
import type { RoomFolio, FolioLine } from "@/lib/room-billing";

// The folio, arranged for the shared bill renderer. PURE mapping only: every figure comes
// from buildFolio, which is the single room calculator. Re-deriving anything here would be a
// second implementation of the same rule, and the two would eventually disagree.
//
// `import type` is erased at runtime, which is what lets `node --test` run this file directly.

export type BillSection = {
  title: string;
  lines: { id: string; item_name: string; item_price: number; quantity: number }[];
};

export type BillStay = {
  roomType: string;
  rate: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  duration: string;
};

export type RoomBillView = {
  sections: BillSection[];
  stay: BillStay;
  subtotal: number;
  discount: number;
  grandTotal: number;
};

export type RoomBillInput = { folio: RoomFolio; roomType: string };

// A folio line is already "one thing at one amount", so quantity is 1 and the amount is the
// price: the qty/rate columns are carried inside `detail` ("2 × ₹2,500 per night").
const toLine = (l: FolioLine) => ({
  id: l.key,
  item_name: l.detail ? `${l.label} (${l.detail})` : l.label,
  item_price: l.amount,
  quantity: 1,
});

export function folioToBill({ folio, roomType }: RoomBillInput): RoomBillView {
  const sections: BillSection[] = [];
  sections.push({ title: "Room charge", lines: [toLine(folio.room)] });
  if (folio.extras.length > 0) sections.push({ title: "Extras", lines: folio.extras.map(toLine) });
  if (folio.food.length > 0) sections.push({ title: "Food & beverages", lines: folio.food.map(toLine) });

  return {
    sections,
    stay: {
      roomType,
      rate: folio.rate,
      nights: folio.nights,
      checkIn: folio.checkIn,
      checkOut: folio.checkOut,
      duration: folio.duration,
    },
    subtotal: folio.subtotal,
    discount: folio.discount,
    grandTotal: folio.grandTotal,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test lib/billing/room-bill.test.ts`
Expected: 4 passing.

If Node reports a type-stripping error, the file has non-erasable syntax — remove the enum/parameter property; do not add a build step.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/billing/room-bill.ts lib/billing/room-bill.test.ts
git commit -m "feat(billing): map a room folio onto the shared bill shape"
```

---

### Task 5: `BillTicket` learns sections, the stay block, and ID fields

**Files:**
- Modify: `app/(employee)/employee/_components/bill-ticket.tsx`

**Interfaces:**
- Consumes: `BillSection`, `BillStay` from Task 4.
- Produces: `BillTicket` accepting optional `sections?: BillSection[]`, `stay?: BillStay`; `BillCustomer` gains `idType?: string | null`, `idNumber?: string | null`.

- [ ] **Step 1: Extend the props and the customer type**

`BillCustomer` becomes:

```ts
export type BillCustomer = {
  name: string | null;
  phone: string | null;
  address: string | null;
  idType?: string | null;
  idNumber?: string | null;
};
```

`BillTicket`'s signature gains `sections` and `stay` (both optional, defaulting to undefined). **Do not touch any existing prop** — every table, walk-in and credit call site must keep compiling untouched.

- [ ] **Step 2: Render the stay block and the ID lines**

Immediately after the existing `Date` / `Time` lines, and before the items table:

```tsx
{stay && (
  <>
    <Line label="Room type" value={stay.roomType} />
    <Line label="Check-in" value={new Date(stay.checkIn).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
    <Line label="Check-out" value={new Date(stay.checkOut).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
    <Line label="Nights" value={`${stay.nights} × ${rupee(stay.rate)}`} />
  </>
)}
```

and inside the existing `hasCustomer` block, after the phone line:

```tsx
{customer!.idType && customer!.idNumber && (
  <Line
    label={customer!.idType === "nid" ? "NID No" : "Citizenship No"}
    value={customer!.idNumber}
  />
)}
```

Update `hasCustomer` so an ID-only guest still renders:

```ts
const hasCustomer = !!(customer && (customer.name || customer.phone || customer.address || customer.idNumber));
```

- [ ] **Step 3: Render sections instead of the flat list when present**

Where the component maps `items`, branch: when `sections` is supplied, render each section's title as a bold row followed by that section's lines using the **existing** row markup; otherwise render `items` exactly as today. The subtotal becomes the sum over sections when they are present.

```tsx
const allLines = sections ? sections.flatMap((s) => s.lines) : items;
const subtotal = allLines.reduce((s, i) => s + Number(i.item_price) * i.quantity, 0);
```

- [ ] **Step 4: Move to discount-before-tax**

Replace the total block:

```ts
// Discount comes off BEFORE tax — you are not taxed on money you did not pay. This is the
// same rule lib/room-billing.ts buildFolio uses; the two used to disagree (a stale comment in
// room-billing.ts claimed they matched). Both percentages are 0 for every restaurant today, so
// no printed number moves — this only decides what happens the day VAT is switched on.
const taxable = Math.max(0, subtotal - discount);
const tax = taxable * (taxPct / 100);
const service = taxable * (svcPct / 100);
const grandTotal = taxable + tax + service;
```

- [ ] **Step 5: Prove no table bill moved**

**Capture the baseline BEFORE editing this file** (do this at the start of the task): start the dev app, open a table that has items, open **Print Bill**, and save the rendered text —

```js
document.querySelector('.rs-ticket-print').innerText
```

Repeat the capture after the change and diff the two strings. Expected: **identical** — a table bill has no `sections` and no `stay`, and with tax and service at 0 the reordered formula returns the same number. Also confirm the geometry is undisturbed:

```js
[...document.querySelectorAll('style[data-rs-page]')].map(s => s.textContent).filter(Boolean)
```

Expected: one rule, `@page { size: 72mm <h>mm; margin: 0; }`.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint
git add "app/(employee)/employee/_components/bill-ticket.tsx"
git commit -m "feat(billing): bill ticket supports grouped sections, a stay block and guest ID"
```

---

### Task 6: The unpaid room bill renders through `BillTicket`

**Files:**
- Modify: `app/(employee)/employee/room/[stayId]/_components/folio-client.tsx`
- Modify: `app/actions/rooms.ts` (`RoomFolioView` gains the guest identity + room type)

**Interfaces:**
- Consumes: `folioToBill()` (Task 4), `BillTicket` `sections`/`stay`/`customer` (Task 5).
- Produces: the room's print modal renders `<BillTicket>`; the working folio panel is unchanged.

- [ ] **Step 1: Carry the guest fields through the folio view**

`RoomFolioView` gains `guest_id_type`, `guest_id_number`, `guest_address` (all `string | null`) and `type_name` is already present. Select the three new columns in `loadFolioInputs`'s `room_stays` query and pass them through `getRoomFolio`.

- [ ] **Step 2: Replace the hand-built printed bill**

In `folio-client.tsx`, the `<PrintModal title="Room bill — preview">` block currently emits `TicketLine` rows by hand. Replace its children with:

```tsx
<BillTicket
  restaurant={restaurant}
  billNo={billNo}
  location={`Room ${f.room_number}`}
  at={new Date()}
  items={[]}
  sections={bill.sections}
  stay={bill.stay}
  discount={bill.discount}
  customer={{
    name: f.guest_name,
    phone: f.guest_phone,
    address: f.guest_address,
    idType: f.guest_id_type,
    idNumber: f.guest_id_number,
  }}
/>
```

where `const bill = folioToBill({ folio: f.folio, roomType: f.type_name })`.

**`billNo`:** find what `print-tickets.tsx` passes as `billNo` for an unpaid *table* bill and reuse that helper verbatim. Do not invent a room-only numbering scheme — matching the table workflow is the point of this work.

Remove the now-unused `TicketLine` / `Divider` / `PoweredBy` imports if nothing else in the file uses them. **Leave the folio panel itself alone** — it is the working screen, not a bill.

- [ ] **Step 3: Verify on screen and on paper**

With a stay that has a room charge, at least one extra charge and at least one food order, open the room bill preview. Expected: three grouped sections that sum to the folio total, the hotel block (room type, check-in/out, nights × rate), and the guest's ID line. Then confirm the print geometry is untouched:

```js
[...document.querySelectorAll('style[data-rs-page]')].map(s => s.textContent).filter(Boolean)
```

Expected: exactly one rule, `@page { size: 72mm <h>mm; margin: 0; }`.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit && npm run lint
git add app/actions/rooms.ts "app/(employee)/employee/room/[stayId]/_components/folio-client.tsx"
git commit -m "feat(rooms): render the unpaid room bill through the shared bill ticket"
```

---

### Task 7: The paid room bill in Sales — same mapper, correct lines

**Files:**
- Modify: `app/actions/pos.ts` (`getPaidBill`, `PaidBill` type)
- Modify: `app/(employee)/employee/sales/_components/paid-bill.tsx`

**Interfaces:**
- Consumes: `folioToBill()` (Task 4), `BillTicket` props (Task 5).
- Produces: `PaidBill` gains optional `sections`, `stay`, and the guest identity on `customer`.

**This closes the sharpest defect:** today a paid room bill lists food only — the room charge and extras are absent, so the printed lines do not add up to the amount charged.

- [ ] **Step 1: Extend the query**

`getPaidBill` already selects `sessions ( ..., rooms ( number ) )`. Add `room_stay_id` to the embedded `sessions` selection.

- [ ] **Step 2: Rebuild the room lines from the frozen stay**

After the existing food-items block, when `p.sessions?.room_stay_id` is set: load that `room_stays` row (including the new guest columns and `room_rate`, `check_in_at`, `check_out_at`), load its `room_charges`, and call the **same** `buildFolio` + `folioToBill` used by the folio — passing `discount: Number(p.discount_amount ?? 0)` and the food items already loaded.

Re-deriving is safe because `check_out_at` freezes the folio and `room_rate` was snapshotted at check-in. Do **not** write a second calculator here.

- [ ] **Step 3: Render sections in the Sales bill**

`paid-bill.tsx` passes `sections={bill.sections}` and `stay={bill.stay}` through to `BillTicket` when present, and keeps passing `items` when not (a table bill).

- [ ] **Step 4: The regression test that matters**

Take a room checkout with a room charge, an extra and food. Open the bill from **Sales**. Assert by hand:

> the visible line amounts sum to `payments.total_amount`.

On `main` today this **fails** — that is the proof the defect existed and is fixed. Also confirm the header reads `TAX INVOICE`, the tender split shows, and the discount line appears.

- [ ] **Step 5: Verify old stays still render**

Open the Sales bill for one of the 7 pre-existing production-shaped stays (reproduce one on DEV by nulling the identity columns on a test stay). Expected: renders with no ID line and no crash.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint && npm run build
git add app/actions/pos.ts "app/(employee)/employee/sales/_components/paid-bill.tsx"
git commit -m "fix(sales): a paid room bill shows its room charge and extras"
```

---

### Task 8: Documentation and the final sweep

**Files:**
- Modify: `lib/room-billing.ts` (stale comment)
- Modify: `memory-bank/completed.md`, `memory-bank/modules/rooms.md`, `memory-bank/database.md`

- [ ] **Step 1: Correct the stale comment**

`lib/room-billing.ts` around line 194 claims the folio's tax treatment matches "how the existing table bill ticket already computes them". It did not, until Task 5. Replace with a note that both now take the discount before tax, and that `BillTicket` was the one that moved.

- [ ] **Step 2: Update the memory bank**

Add a `completed.md` entry covering: the three new `room_stays` columns and why they are nullable; `p_discount` (a discount applied but never recorded); the unified renderer; and the rule that a room bill is derived from the frozen stay, never snapshotted. Update `modules/rooms.md` (check-in now captures identity; billing goes through `BillTicket`) and `database.md` (the new columns).

- [ ] **Step 3: Full verification sweep**

```bash
npx tsc --noEmit
npm run lint
npm run build
node --test lib/billing/room-bill.test.ts
```

Expected: clean, clean, compiles, 4 passing.

- [ ] **Step 4: Walk the whole flow once, in one sitting**

Check in a guest with ID → add a room-service order → add an extra charge → open the unpaid bill → check out with a discount → open the same bill in Sales. The two bills must show the same lines, the same hotel block and the same totals; only `BILL` → `TAX INVOICE`, the tender lines and the discount differ.

Then repeat the check-in form and both bill previews at a **390 × 844 viewport** (phone) and at tablet width. The check-in form gains three fields and is the one surface at real risk of overflowing on a small screen; the bills reuse `PrintModal`, which is already responsive, so they should need nothing. Fix by wrapping fields, never by shrinking the print column.

- [ ] **Step 5: Commit**

```bash
git add lib/room-billing.ts memory-bank/
git commit -m "docs(rooms): record the billing unification and the discount fix"
```

---

## Production rollout

Both migrations are additive and their RPC parameters default, so **the database can be migrated before the app is deployed** without breaking the running version. Order:

1. `node scripts/migrate.mjs up --prod --yes`
2. Deploy the app.
3. Immediately check in one test guest and check them out with a small discount on the live hotel client ("Sanjib"), then confirm `payments.discount_amount` and the Sales bill.

Rolling back the app alone is safe — the old code calls the old argument lists, which still resolve.
