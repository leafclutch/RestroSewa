import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveTotals,
  emptyDraft,
  markBillNumber,
  moveLine,
  newLine,
  parseLocalInputValue,
  toBillItems,
  toCredit,
  toLocalInputValue,
  toTender,
} from "./draft.ts";
import type { MockBillDraft, MockBillSeed } from "./draft.ts";
import { billMethodLabel } from "../billing/payment-method.ts";
import { PERMISSIONS, PERMISSION_GROUPS, STAFF_PRESETS } from "../permissions.ts";

/**
 * ── THE ISOLATION GUARD ───────────────────────────────────────────────────────
 *
 * The mock-bill feature's whole promise is that it touches nothing: no stock, no sale, no
 * finance, no customer or vendor balance, no bill or OT number, no push, no email. That
 * promise is only as good as the module's inability to write, so this file asserts the
 * inability directly — against the SOURCE, not against behaviour, because a write that
 * only fires on some path is exactly the kind a behavioural test misses.
 *
 * If you are here because this test failed, the fix is almost never to relax the list. A
 * mock bill that needs a POS action has stopped being a mock bill.
 */

const ROOT = join(import.meta.dirname, "..", "..");

const MOCK_SOURCES = [
  "app/actions/mock-bill.ts",
  "lib/mock-bill/draft.ts",
  "app/(employee)/employee/mock-bill/page.tsx",
  "app/(employee)/employee/mock-bill/_components/mock-bill-client.tsx",
  "app/(employee)/employee/mock-bill/_components/mock-bill-editor.tsx",
];

/** Modules that can move money, stock or a sequence. None of them may be reachable. */
const FORBIDDEN_IMPORTS = [
  "actions/pos",
  "actions/stock",
  "actions/finance",
  "actions/purchases",
  "actions/vendors",
  "actions/credits",
  "actions/notifications",
  "actions/push",
  "actions/rooms",
  "actions/deductions",
  "actions/analytics",
  "lib/stock",
  "lib/finance",
  "lib/room-billing",
  "lib/billing/room-bill",
  "lib/payment-split",
  "lib/supabase",
];

/**
 * Anything that could reach the database from inside the feature. The Security-PIN service
 * DOES write an audit row, but it does so behind `lib/security/authorize.ts` — which is not
 * part of this module and which no financial, stock or sales report reads.
 */
const FORBIDDEN_CALLS = [
  "createServiceClient",
  "createServerClient",
  ".rpc(",
  ".insert(",
  ".upsert(",
  ".delete(",
  ".from(",
];

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Source with its comments removed, so these guards test the CODE and not the prose about
 * the code (which legitimately names `.rpc(`, `close_bills` and the rest).
 *
 * LINE comments go FIRST, and that order is load-bearing. `dashboard/page.tsx` carries the
 * line `// ?focus=<section> — a tapped push (or a redirected legacy /employee/* page)`; strip
 * block comments first and that `/*` opens a match that runs to the next `*​/` anywhere in
 * the file — 3,689 characters, including the permission check this file exists to assert.
 * The guard passed for the wrong reason and then failed for the wrong reason.
 */
const codeOf = (src: string) =>
  src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every module specifier the file imports at runtime (`import type` is not one). */
function importsOf(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

test("the mock module imports nothing that can move money, stock or a sequence", () => {
  for (const rel of MOCK_SOURCES) {
    for (const spec of importsOf(read(rel))) {
      const normalised = spec.replace(/^@\//, "").replace(/^\.\.?\//, "");
      for (const banned of FORBIDDEN_IMPORTS) {
        assert.ok(
          !normalised.includes(banned),
          `${rel} imports "${spec}" — the mock bill must never reach ${banned}.`
        );
      }
    }
  }
});

test("the mock module contains no database access of its own", () => {
  for (const rel of MOCK_SOURCES) {
    const code = codeOf(read(rel));
    for (const banned of FORBIDDEN_CALLS) {
      assert.ok(!code.includes(banned), `${rel} contains "${banned}" — the mock bill must not touch the database.`);
    }
  }
});

test("the mock bill's server surface is exactly one function", () => {
  const src = read("app/actions/mock-bill.ts");
  const fns = [...src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(fns, ["unlockMockBill"]);
  // A `export const x = async () => …` would be a second server action that the check above
  // would not see.
  assert.ok(!/^export\s+(const|let|var|default)\b/m.test(src), "mock-bill.ts exports something other than unlockMockBill");
});

test("the unlock action gates on print_mock_bills, the Security PIN, and audits both outcomes", () => {
  const src = read("app/actions/mock-bill.ts");
  assert.ok(src.includes("requireRestaurantStaff"), "must establish a staff session");
  // Its OWN permission. If this ever reverts to a broader one (close_bills, process_payments)
  // the feature stops being separately grantable, which is the whole point of it having a key.
  assert.ok(src.includes("PERMISSIONS.PRINT_MOCK_BILLS"), "must require print_mock_bills");
  assert.ok(src.includes("securityEnabled"), "must refuse when no Security PIN is set");
  assert.ok(src.includes("verifySecurityPin"), "must verify the PIN server-side");
  assert.ok(src.includes('outcome: "success"'), "must audit a successful unlock");
  assert.ok(src.includes('outcome: "blocked"'), "must audit a permission block");
});

test("all three gates use the SAME permission, so the button can't diverge from the route", () => {
  // A button shown to one audience and a route guarding another is the classic way a
  // permission change half-lands: staff see an M that bounces them to the dashboard.
  const gates = [
    "app/actions/mock-bill.ts",
    "app/(employee)/employee/mock-bill/page.tsx",
    "app/(employee)/employee/dashboard/page.tsx",
  ];
  for (const rel of gates) {
    assert.ok(
      codeOf(read(rel)).includes("PERMISSIONS.PRINT_MOCK_BILLS"),
      `${rel} must gate on print_mock_bills`
    );
  }
});

test("print_mock_bills is grantable in the super-admin editor and is on NO job preset", () => {
  assert.equal(PERMISSIONS.PRINT_MOCK_BILLS, "print_mock_bills");
  // The super-admin permission picker renders PERMISSION_GROUPS verbatim, so being here IS
  // being a checkbox. Missing ⇒ the permission exists but nobody can ever be granted it.
  const inGroups = PERMISSION_GROUPS.flatMap((g) => g.items).some((i) => i.key === "print_mock_bills");
  assert.ok(inGroups, "print_mock_bills must appear in PERMISSION_GROUPS or it has no checkbox");
  // Deliberately off every preset, like Payroll: nobody acquires the ability to print a
  // convincing receipt by inheriting a job template.
  for (const preset of STAFF_PRESETS) {
    assert.ok(
      !preset.permissions.includes("print_mock_bills"),
      `the ${preset.key} preset must not grant print_mock_bills`
    );
  }
});

test("the editor is not mounted until the server has verified the PIN", () => {
  const src = read("app/(employee)/employee/mock-bill/_components/mock-bill-client.tsx");
  assert.ok(/useState\(false\)/.test(src), "the locked state must start false");
  assert.ok(src.includes("unlockMockBill"), "unlocking must go through the server action");
  // The editor renders behind the unlocked flag rather than being hidden with CSS.
  assert.ok(/if\s*\(unlocked\)\s*return\s*<MockBillEditor/.test(src));
});

// ── the arithmetic, which must agree with what BillTicket prints ──────────────

const SEED: MockBillSeed = {
  name: "Demo Restaurant",
  address: "Thamel, Kathmandu",
  contact_phone: "9800000000",
  pan_vat_number: "123456789",
  paper_width_mm: 80,
  bill_number_label: "bill",
  tax_percent: undefined,
  service_charge_percent: undefined,
};

const draftWith = (patch: Partial<MockBillDraft>): MockBillDraft => ({ ...emptyDraft(SEED), ...patch });

test("the discount comes off BEFORE tax and service, exactly as the bill renders it", () => {
  const draft = draftWith({
    lines: [newLine({ name: "Momo", qty: 2, price: 250 })],
    discount: 100,
    taxPercent: 13,
    servicePercent: 10,
  });
  const t = deriveTotals(draft);
  assert.equal(t.subtotal, 500);
  assert.equal(t.taxable, 400); // 500 − 100, NOT taxed on the discounted money
  assert.equal(t.tax, 52);
  assert.equal(t.service, 40);
  assert.equal(t.computedTotal, 492);
  assert.equal(t.total, 492);
  assert.equal(t.overridden, false);
});

test("a discount larger than the bill floors the taxable amount at zero", () => {
  const t = deriveTotals(draftWith({ lines: [newLine({ name: "Tea", qty: 1, price: 50 })], discount: 500 }));
  assert.equal(t.taxable, 0);
  assert.equal(t.total, 0);
});

test("the manual total replaces the printed figure and reports the derived one alongside", () => {
  const t = deriveTotals(
    draftWith({ lines: [newLine({ name: "Tea", qty: 1, price: 50 })], totalOverride: 9999 })
  );
  assert.equal(t.computedTotal, 50);
  assert.equal(t.total, 9999);
  assert.equal(t.overridden, true);
});

test("unnamed lines never reach the bill", () => {
  const items = toBillItems(
    draftWith({ lines: [newLine({ name: "Momo", qty: 1, price: 100 }), newLine(), newLine({ name: "  ", price: 10 })] })
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].item_name, "Momo");
});

test("a single-tender bill puts the whole total on one tender, so no split line prints", () => {
  const t = toTender(draftWith({ method: "cash", cashier: "Sita" }), 480);
  assert.deepEqual(t, { method: "cash", cashier: "Sita", cash: 480, online: 0, card: 0 });
  // BillTicket shows the split only when more than one part is non-zero.
  assert.equal([t!.cash, t!.online, t!.card].filter((v) => v > 0).length, 1);
});

test("a mixed bill carries both halves, and an unpaid one carries no payment block at all", () => {
  const mixed = toTender(draftWith({ method: "mixed", cash: 300, online: 180 }), 480);
  assert.equal(mixed!.cash, 300);
  assert.equal(mixed!.online, 180);
  // `null` is what makes the editor pass `undefined`, which is what makes BillTicket
  // print "Status: UNPAID".
  assert.equal(toTender(draftWith({ method: "unpaid" }), 480), null);
});

test("a credit bill with nothing handed over is ON CREDIT for the full amount", () => {
  const c = toCredit(draftWith({ method: "credit", creditNumber: "CR-7", creditAccount: "Hotel Everest" }), 480);
  assert.equal(c!.credit_number, "CR-7");
  assert.equal(c!.customer_name, "Hotel Everest");
  assert.equal(c!.tendered, 0);
  assert.equal(c!.balance, 480);
  // Still a tender object (so a split line CAN print), but every part is zero.
  const t = toTender(draftWith({ method: "credit" }), 480);
  assert.deepEqual([t!.cash, t!.online, t!.card], [0, 0, 0]);
});

test("a part-paid credit bill leaves the remainder as the balance", () => {
  const draft = draftWith({ method: "credit", tenderedAs: "online", tendered: 200 });
  assert.equal(toTender(draft, 480)!.online, 200);
  assert.equal(toCredit(draft, 480)!.balance, 280);
});

test("a mixed down payment derives `tendered` from the split, so the two can never disagree", () => {
  const draft = draftWith({ method: "credit", tenderedAs: "mixed", cash: 120, online: 80 });
  const c = toCredit(draft, 480)!;
  assert.equal(c.tendered, 200); // 120 + 80, not a separately-typed number
  assert.equal(c.balance, 280);
});

test("over-tendering a credit bill floors the balance at zero rather than going negative", () => {
  assert.equal(toCredit(draftWith({ method: "credit", tendered: 900 }), 480)!.balance, 0);
});

test("the credit block exists only for a credit bill", () => {
  for (const method of ["cash", "online", "card", "mixed", "unpaid"] as const) {
    assert.equal(toCredit(draftWith({ method }), 480), null, `${method} must not print a credit block`);
  }
});

test("the credit account falls back to the customer name so a half-filled demo still prints", () => {
  const c = toCredit(draftWith({ method: "credit", creditAccount: "", customerName: "Ram" }), 100);
  assert.equal(c!.customer_name, "Ram");
});

test("a mock bill is worded by the same method map a real printed bill uses", () => {
  // Not a re-implementation: this is the shared map, so "Cash + Online" on a mock bill is
  // the same string the Sales reprint and the room folio put on paper.
  assert.equal(billMethodLabel("mixed"), "Cash + Online");
  assert.equal(billMethodLabel("cash"), "Cash");
  assert.equal(billMethodLabel("online"), "Online");
  assert.equal(billMethodLabel("card"), "Card");
});

test("the verification mark is a trailing M on the number and nothing else", () => {
  assert.equal(markBillNumber("1024"), "1024 · M");
  assert.equal(markBillNumber(" 1024 "), "1024 · M");
  // Nothing that would read as DEMO/TEST/MOCK on paper.
  assert.ok(!/mock|demo|test|sample/i.test(markBillNumber("1024")));
});

test("reordering swaps neighbours and refuses to run off either end", () => {
  const a = newLine({ name: "A" });
  const b = newLine({ name: "B" });
  const c = newLine({ name: "C" });
  assert.deepEqual(moveLine([a, b, c], 0, 1).map((l) => l.name), ["B", "A", "C"]);
  assert.deepEqual(moveLine([a, b, c], 2, -1).map((l) => l.name), ["A", "C", "B"]);
  assert.deepEqual(moveLine([a, b, c], 0, -1).map((l) => l.name), ["A", "B", "C"]);
  assert.deepEqual(moveLine([a, b, c], 2, 1).map((l) => l.name), ["A", "B", "C"]);
});

test("the datetime field round-trips as LOCAL time, and a half-typed value never prints Invalid Date", () => {
  const d = new Date(2026, 7, 7, 14, 30);
  assert.equal(toLocalInputValue(d), "2026-08-07T14:30");
  assert.equal(parseLocalInputValue("2026-08-07T14:30").getTime(), d.getTime());
  assert.ok(!Number.isNaN(parseLocalInputValue("2026-08-").getTime()));
  assert.ok(!Number.isNaN(parseLocalInputValue("").getTime()));
});
