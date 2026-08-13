import { test } from "node:test";
import assert from "node:assert/strict";
import { txLabel, txFlow, txTone, MONEY_IN, MONEY_OUT, MONEY_NONE } from "./finance.ts";

// The ledger's naming rule.
//
// Two kinds carry a SIGNED amount and so mean opposite things in each direction.
// Both used to print their kind's name either way, so a refund read exactly like
// the deposit that created it. These assertions are what stop that returning.

const row = (over: Record<string, unknown> = {}) =>
  ({
    at: "2026-08-13T06:00:00.000Z",
    kind: "sale",
    party: null,
    method: "cash",
    amount: 1000,
    reference: null,
    cashDelta: 1000,
    onlineDelta: 0,
    creditToUsDelta: 0,
    creditByUsDelta: 0,
    source: null,
    sourceLabel: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

test("a room advance REFUND is named as a refund", () => {
  // The reported bug: a ₹1,500 refund read "Room Advance", identical to the
  // deposit it reverses.
  const refund = row({ kind: "room_advance", amount: -1500, cashDelta: -1000, onlineDelta: -500 });
  assert.equal(txLabel(refund, true), "Room Advance Refund");
});

test("a room advance DEPOSIT keeps its own name", () => {
  const deposit = row({ kind: "room_advance", amount: 5000, cashDelta: 3000, onlineDelta: 2000 });
  assert.equal(txLabel(deposit, true), "Room Advance");
});

test("a saving WITHDRAWAL is named as a withdrawal", () => {
  // The same defect on the other signed kind — and this one points the other
  // way, money coming back IN.
  const withdrawal = row({
    kind: "extra_expense", party: "Saving", amount: -500, cashDelta: 0, onlineDelta: 500,
  });
  assert.equal(txLabel(withdrawal, true), "Saving Withdrawal");
});

test("an ordinary extra expense keeps its own name", () => {
  const rent = row({ kind: "extra_expense", party: "Rent", amount: 5000, cashDelta: -5000 });
  assert.equal(txLabel(rent, true), "Extra Expense");
});

test("the label and the colour agree about direction", () => {
  // They are derived from different things on purpose — the label from the row's
  // SIGN, the colour from what actually moved — so it is worth asserting they
  // do not contradict each other on the two rows that invert.
  const refund = row({ kind: "room_advance", amount: -1500, cashDelta: -1000, onlineDelta: -500 });
  assert.equal(txLabel(refund, true), "Room Advance Refund");
  assert.equal(txTone(txFlow(refund)), MONEY_OUT); // money leaves: red

  const withdrawal = row({ kind: "extra_expense", amount: -500, cashDelta: 0, onlineDelta: 500 });
  assert.equal(txLabel(withdrawal, true), "Saving Withdrawal");
  assert.equal(txTone(txFlow(withdrawal)), MONEY_IN); // money returns: green
});

test("a sale names its side of the business, for a hotel", () => {
  assert.equal(txLabel(row({ source: "room" }), true), "Room Sale");
  assert.equal(txLabel(row({ source: "table" }), true), "Restaurant Sale");
  assert.equal(txLabel(row({ source: "walkin" }), true), "Restaurant Sale");
});

test("a restaurant-only client still reads plain Sale", () => {
  assert.equal(txLabel(row({ source: "table" }), false), "Sale");
});

test("a credit sale moves nothing and says so", () => {
  const credit = row({ cashDelta: 0, onlineDelta: 0, creditToUsDelta: 1000 });
  assert.equal(txTone(txFlow(credit)), MONEY_NONE);
});

test("every other kind is unaffected by the sign rule", () => {
  // Only room_advance and extra_expense may go negative; nothing else should
  // acquire a direction-dependent name by accident.
  assert.equal(txLabel(row({ kind: "purchase", amount: 800 }), true), "Purchase");
  assert.equal(txLabel(row({ kind: "salary", amount: 800 }), true), "Salary Payment");
  assert.equal(txLabel(row({ kind: "salary_advance", amount: 800 }), true), "Salary Advance");
  assert.equal(txLabel(row({ kind: "credit_repayment", amount: 800 }), true), "Customer Credit Payment");
  assert.equal(txLabel(row({ kind: "vendor_payment", amount: 800 }), true), "Vendor Credit Repayment");
  assert.equal(txLabel(row({ kind: "vendor_opening", amount: 800 }), true), "Vendor Opening Balance");
});
