import { test } from "node:test";
import assert from "node:assert/strict";
import { PERMISSIONS, PERMISSION_GROUPS, STOCK_ACCESS, PAYROLL_ACCESS } from "./permissions.ts";

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
