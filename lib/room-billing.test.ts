import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFolio } from "./room-billing.ts";

// 2 nights at 2,500 = 5,000. No extras, no food, no tax — so every assertion below
// is about the advance and nothing else.
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
  const f = buildFolio({ ...stay, room_rate: 1666.67 }, [], [], { advancePaid: 1000.005 });
  assert.equal(f.grandTotal, 3333.34);
  assert.equal(f.balanceDue, 2333.33);
});
