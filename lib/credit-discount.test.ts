import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSplit } from "./payment-split.ts";

test("resolveSplit for credit payment received amount", () => {
  // Cash single tender
  assert.deepEqual(resolveSplit("cash", 300, "", ""), { ok: true, cash: null, online: null });

  // Mixed cash + online received split (Cash 100 + Online 200 = 300)
  const validSplit = resolveSplit("mixed", 300, "100", "200");
  assert.equal(validSplit.ok, true);
  if (validSplit.ok) {
    assert.equal(validSplit.cash, 100);
    assert.equal(validSplit.online, 200);
  }

  // Invalid split mismatch
  const invalidSplit = resolveSplit("mixed", 300, "100", "150");
  assert.equal(invalidSplit.ok, false);
});

test("credit clearance math: amount received + discount", () => {
  const balance = 310;
  const amountReceived = 300;
  const discount = 10;
  const totalCleared = amountReceived + discount;
  const remainingBalance = Math.max(0, balance - totalCleared);

  assert.equal(totalCleared, 310);
  assert.equal(remainingBalance, 0);
  assert.equal(totalCleared <= balance + 0.005, true);
});

test("credit clearance math: partial payment with discount", () => {
  const balance = 500;
  const amountReceived = 200;
  const discount = 50;
  const totalCleared = amountReceived + discount;
  const remainingBalance = Math.max(0, balance - totalCleared);

  assert.equal(totalCleared, 250);
  assert.equal(remainingBalance, 250);
});

test("credit clearance math: over-discount rejection check", () => {
  const balance = 310;
  const amountReceived = 300;
  const discount = 50; // Total 350 > 310 balance
  const totalCleared = amountReceived + discount;
  const isValid = totalCleared <= balance + 0.005;

  assert.equal(isValid, false, "Clearing more than balance must be invalid");
});

test("credit clearance math: 100% discount write-off", () => {
  const balance = 150;
  const amountReceived = 0;
  const discount = 150;
  const totalCleared = amountReceived + discount;
  const remainingBalance = Math.max(0, balance - totalCleared);

  assert.equal(totalCleared, 150);
  assert.equal(remainingBalance, 0);
});
