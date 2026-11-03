import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSIONS, PERMISSION_GROUPS, STOCK_ACCESS, PAYROLL_ACCESS, ROOM_ACCESS, NAV_ACCESS,
  ACCESS_SECTIONS, STAFF_PRESETS, detectLevel, applyLevel, matchPreset,
} from "./permissions.ts";

// The Extra Expenses gates, tested directly.
//
// These decide whether a staff member is shown a saving pot's running balance,
// so "it looked right in the browser" is not evidence. A predicate that quietly
// widens is invisible until someone sees a number they should not have.

const staff = (...permissions: string[]) => ({ role: "restaurant_staff", permissions });
const owner = { role: "restaurant_admin", permissions: [] as string[] };

const ADD = PERMISSIONS.ADD_EXPENSES;
const MANAGE = PERMISSIONS.MANAGE_EXPENSES;
const FINANCE = PERMISSIONS.VIEW_FINANCE;

test("add_expenses opens the page and the add actions, nothing more", () => {
  const u = staff(ADD);
  assert.equal(STOCK_ACCESS.canViewExpenses(u), true);
  assert.equal(STOCK_ACCESS.canAddExpenses(u), true);
  assert.equal(STOCK_ACCESS.canManageExpenses(u), false); // no withdraw, no pot CRUD
  assert.equal(STOCK_ACCESS.expensesTodayOnly(u), true);
});

test("add_expenses does NOT unlock finance or stock", () => {
  const u = staff(ADD);
  assert.equal(STOCK_ACCESS.canViewFinance(u), false);
  assert.equal(STOCK_ACCESS.canViewStock(u), false);
  assert.equal(STOCK_ACCESS.canManagePurchases(u), false);
  assert.equal(STOCK_ACCESS.canManageVendors(u), false);
});

test("a wider right cancels the today-only restriction", () => {
  // Otherwise granting BOTH boxes would leave a manager stuck on today's view —
  // the narrow permission must never subtract from a wider one.
  assert.equal(STOCK_ACCESS.expensesTodayOnly(staff(ADD, MANAGE)), false);
  assert.equal(STOCK_ACCESS.expensesTodayOnly(staff(ADD, FINANCE)), false);
  assert.equal(STOCK_ACCESS.expensesTodayOnly(staff(ADD, MANAGE, FINANCE)), false);
});

test("the owner is never restricted", () => {
  assert.equal(STOCK_ACCESS.expensesTodayOnly(owner), false);
  assert.equal(STOCK_ACCESS.canAddExpenses(owner), true);
  assert.equal(STOCK_ACCESS.canManageExpenses(owner), true);
});

test("someone without add_expenses is not accidentally restricted", () => {
  // expensesTodayOnly must be false for people who cannot see the page at all,
  // and for the full-rights holder — a stray `true` here would hide figures
  // from the very people the page exists for.
  assert.equal(STOCK_ACCESS.expensesTodayOnly(staff()), false);
  assert.equal(STOCK_ACCESS.expensesTodayOnly(staff(MANAGE)), false);
  assert.equal(STOCK_ACCESS.expensesTodayOnly(staff(FINANCE)), false);
});

test("a stock right alone still does not open Extra Expenses", () => {
  // Unlike Purchases and Vendors. Adding add_expenses must not have changed it.
  const u = staff(PERMISSIONS.MANAGE_STOCK);
  assert.equal(STOCK_ACCESS.canViewExpenses(u), false);
  assert.equal(STOCK_ACCESS.canAddExpenses(u), false);
});

test("view_finance is read-only over expenses", () => {
  const u = staff(FINANCE);
  assert.equal(STOCK_ACCESS.canViewExpenses(u), true);
  assert.equal(STOCK_ACCESS.canAddExpenses(u), false); // may look, may not file
  assert.equal(STOCK_ACCESS.canManageExpenses(u), false);
});

test("add_expenses shows the Stock & Finance module", () => {
  // Without this the dashboard section would mount but the admin sidebar group
  // holding the page would not appear.
  assert.equal(STOCK_ACCESS.canSeeModule(staff(ADD)), true);
});

test("the new permission is grantable in the UI", () => {
  // PERMISSION_GROUPS is the single source the staff editor renders from, so a
  // permission missing here can be checked in code and never granted in practice.
  const keys = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
  assert.ok(keys.includes(ADD), "add_expenses must appear in PERMISSION_GROUPS");
  assert.ok(keys.includes(MANAGE));
  assert.equal(new Set(keys).size, keys.length, "no duplicate permission keys");
  // Every advertised key must be a real permission.
  const real = new Set(Object.values(PERMISSIONS));
  for (const k of keys) assert.ok(real.has(k), `${k} is not in PERMISSIONS`);
});

test("payroll on the staff dashboard needs the WRITE right", () => {
  // The dashboard card is gated on manage_payroll alone, tighter than the page.
  assert.equal(PAYROLL_ACCESS.canManagePayroll(staff(PERMISSIONS.VIEW_PAYROLL)), false);
  assert.equal(PAYROLL_ACCESS.canViewPayroll(staff(PERMISSIONS.VIEW_PAYROLL)), true);
  assert.equal(PAYROLL_ACCESS.canManagePayroll(staff(PERMISSIONS.MANAGE_PAYROLL)), true);
  // Write implies read.
  assert.equal(PAYROLL_ACCESS.canViewPayroll(staff(PERMISSIONS.MANAGE_PAYROLL)), true);
});

// Cancelling a checked-in stay. Its own lane, deliberately outside the
// view/check_in/manage ladder: writing off a guest's bill is not a bigger
// version of configuring rooms.

test("cancelling a stay is NOT implied by any other room right", () => {
  const CANCEL = PERMISSIONS.CANCEL_ROOM_STAY;
  for (const p of [PERMISSIONS.VIEW_ROOMS, PERMISSIONS.CHECK_IN, PERMISSIONS.MANAGE_ROOMS]) {
    assert.equal(
      ROOM_ACCESS.canCancelStay(staff(p)),
      false,
      `${p} must not grant cancellation`
    );
  }
  assert.equal(ROOM_ACCESS.canCancelStay(staff(CANCEL)), true);
});

test("the owner is the default canceller", () => {
  // No extra wiring: hasPermission is true for restaurant_admin.
  assert.equal(ROOM_ACCESS.canCancelStay(owner), true);
});

test("cancelling does not leak the other room rights", () => {
  // A cancel-only staffer must not thereby be able to check guests in or edit
  // rooms — the ladder runs one way.
  const u = staff(PERMISSIONS.CANCEL_ROOM_STAY);
  assert.equal(ROOM_ACCESS.canCheckIn(u), false);
  assert.equal(ROOM_ACCESS.canManageRooms(u), false);
  assert.equal(ROOM_ACCESS.canViewRooms(u), false);
});

test("cancel_room_stay is grantable in the UI", () => {
  const keys = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
  assert.ok(keys.includes(PERMISSIONS.CANCEL_ROOM_STAY));
});

// The section editor. Presets, levels and the stored list must round-trip exactly, or
// the editor shows "Custom" for a staffer nobody customised.

test("every preset reads back as a clean level in every section", () => {
  for (const preset of STAFF_PRESETS) {
    for (const section of ACCESS_SECTIONS) {
      assert.notEqual(
        detectLevel(section, preset.permissions),
        "custom",
        `${preset.key} lands on Custom in ${section.key}`
      );
    }
    assert.equal(matchPreset(preset.permissions), preset.key);
  }
});

test("presets are a ladder: each role can do everything the one below it can", () => {
  const byKey = new Map(STAFF_PRESETS.map((p) => [p.key, p.permissions as string[]]));
  const ladder = ["waiter", "cashier", "receptionist", "manager"];
  for (let i = 1; i < ladder.length; i++) {
    const lower = byKey.get(ladder[i - 1])!;
    const upper = byKey.get(ladder[i])!;
    for (const p of lower) assert.ok(upper.includes(p), `${ladder[i]} is missing ${ladder[i - 1]}'s ${p}`);
  }
});

test("a waiter adds items everywhere but can't take money", () => {
  const waiter = staff(...STAFF_PRESETS.find((p) => p.key === "waiter")!.permissions);
  assert.equal(NAV_ACCESS.canSeeTables(waiter), true);
  assert.ok(waiter.permissions.includes(PERMISSIONS.CREATE_ORDERS));
  assert.ok(waiter.permissions.includes(PERMISSIONS.MANAGE_WALKINS));
  assert.equal(ROOM_ACCESS.canViewRooms(waiter), true);
  for (const p of [PERMISSIONS.CLOSE_BILLS, PERMISSIONS.PROCESS_PAYMENTS]) {
    assert.ok(!waiter.permissions.includes(p), `waiter must not hold ${p}`);
  }
  assert.equal(NAV_ACCESS.canSeeSales(waiter), false);
  assert.equal(NAV_ACCESS.canManageCredits(waiter), false);
});

test("every level key is a real permission and belongs to one section only", () => {
  const real = new Set<string>(Object.values(PERMISSIONS));
  const home = new Map<string, string>();
  for (const s of ACCESS_SECTIONS) {
    assert.equal(s.levels[0].permissions.length, 0, `${s.key}: first level must be None`);
    for (const l of s.levels) {
      for (const p of l.permissions) {
        assert.ok(real.has(p), `${p} is not in PERMISSIONS`);
        const prev = home.get(p);
        assert.ok(!prev || prev === s.key, `${p} is in both ${prev} and ${s.key}`);
        home.set(p, s.key);
      }
    }
  }
});

test("every permission is grantable from the editor", () => {
  const grantable = new Set<string>(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)));
  for (const p of Object.values(PERMISSIONS)) assert.ok(grantable.has(p), `${p} has no control`);
});

test("changing one section leaves the others alone", () => {
  const orders = ACCESS_SECTIONS.find((s) => s.key === "orders")!;
  const next = applyLevel([PERMISSIONS.VIEW_SALES, PERMISSIONS.VIEW_ORDERS], orders, "full");
  assert.ok(next.includes(PERMISSIONS.VIEW_SALES));
  assert.equal(detectLevel(orders, next), "full");
  assert.equal(detectLevel(orders, applyLevel(next, orders, "kitchen")), "kitchen");
});

test("None clears the section's extras too", () => {
  const orders = ACCESS_SECTIONS.find((s) => s.key === "orders")!;
  assert.deepEqual(applyLevel([PERMISSIONS.VIEW_ORDERS, PERMISSIONS.CANCEL_ORDERS], orders, "none"), []);
});

test("a hand-made list is Custom, not silently rounded to a level", () => {
  const billing = ACCESS_SECTIONS.find((s) => s.key === "billing")!;
  assert.equal(detectLevel(billing, [PERMISSIONS.CLOSE_BILLS]), "custom");
});

test("Sales and Credits are their own permissions, not billing riders", () => {
  const billing = staff(PERMISSIONS.CLOSE_BILLS, PERMISSIONS.PROCESS_PAYMENTS);
  assert.equal(NAV_ACCESS.canSeeSales(billing), false);
  assert.equal(NAV_ACCESS.canManageCredits(billing), false);
  assert.equal(NAV_ACCESS.canSeeSales(staff(PERMISSIONS.VIEW_SALES)), true);
  assert.equal(NAV_ACCESS.canManageCredits(staff(PERMISSIONS.MANAGE_CREDITS)), true);
  // Seeing Sales does not reach customer debt.
  assert.equal(NAV_ACCESS.canManageCredits(staff(PERMISSIONS.VIEW_SALES)), false);
});

test("rooms-only staff do not get the floor plan", () => {
  assert.equal(NAV_ACCESS.canSeeTables(staff(PERMISSIONS.VIEW_ROOMS, PERMISSIONS.CHECK_IN)), false);
  assert.equal(NAV_ACCESS.canSeeTables(staff(PERMISSIONS.VIEW_TABLES)), true);
});

// Sales: Today only. One predicate decides it for the report, the CSV and the bill view.

test("today-only opens Sales but is restricted to today", () => {
  const u = staff(PERMISSIONS.VIEW_SALES_TODAY);
  assert.equal(NAV_ACCESS.canSeeSales(u), true);
  assert.equal(NAV_ACCESS.salesTodayOnly(u), true);
});

test("All days lifts the today-only restriction, and the owner is never restricted", () => {
  assert.equal(NAV_ACCESS.salesTodayOnly(staff(PERMISSIONS.VIEW_SALES)), false);
  assert.equal(NAV_ACCESS.salesTodayOnly(staff(PERMISSIONS.VIEW_SALES, PERMISSIONS.VIEW_SALES_TODAY)), false);
  assert.equal(NAV_ACCESS.salesTodayOnly(owner), false);
});

test("today-only does not reach credits", () => {
  assert.equal(NAV_ACCESS.canManageCredits(staff(PERMISSIONS.VIEW_SALES_TODAY)), false);
});

test("the Sales row offers None / Today only / All days", () => {
  const sales = ACCESS_SECTIONS.find((s) => s.key === "sales")!;
  assert.deepEqual(sales.levels.map((l) => l.key), ["none", "today", "view"]);
  assert.equal(detectLevel(sales, [PERMISSIONS.VIEW_SALES_TODAY]), "today");
  assert.equal(detectLevel(sales, [PERMISSIONS.VIEW_SALES]), "view");
  // Switching up replaces the narrow key rather than stacking both.
  assert.deepEqual(applyLevel([PERMISSIONS.VIEW_SALES_TODAY], sales, "view"), [PERMISSIONS.VIEW_SALES]);
});
