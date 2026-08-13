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

// ── A cancelled stay ─────────────────────────────────────────────────────────
// The bill is the cancellation charge and nothing else. These assertions matter
// because `getPaidBill` rebuilds a paid room bill from the frozen stay: if this
// branch ever regresses, the Sales reprint of a cancelled stay shows the nights
// it would have cost against a payment that never matched them.

const cancelledStay = {
  check_in_at: "2026-08-01T06:00:00.000Z",
  check_out_at: "2026-08-03T06:00:00.000Z",
  room_rate: 2500,
  cancelled: true,
  cancellation_charge: 2000,
};

const someExtras = [{ id: "e1", type: "laundry" as const, description: "Laundry", amount: 300 }];
const someFood = [{ id: "f1", item_name: "Momo", item_price: 150, quantity: 2 }];

test("a cancelled stay bills the charge, not the nights", () => {
  const f = buildFolio(cancelledStay, someExtras, someFood, {});
  assert.equal(f.nights, 0);
  assert.equal(f.roomTotal, 2000);
  assert.equal(f.room.label, "Cancellation charge");
  assert.equal(f.grandTotal, 2000);
});

test("a cancellation writes off the food and the extras", () => {
  const f = buildFolio(cancelledStay, someExtras, someFood, {});
  assert.deepEqual(f.extras, []);
  assert.deepEqual(f.food, []);
  assert.equal(f.extrasTotal, 0);
  assert.equal(f.foodTotal, 0);
  // The same stay NOT cancelled would have billed all of it — proving the
  // branch is what changed the answer, not the inputs.
  const normal = buildFolio({ ...cancelledStay, cancelled: false }, someExtras, someFood, {});
  assert.equal(normal.grandTotal, 5000 + 300 + 300);
});

test("a cancellation charge carries no tax and no service charge", () => {
  // It is a retention out of a deposit, not a service rendered — and
  // cancel_room_stay records a payment of EXACTLY the charge, so tax on top
  // would print a bill that cannot reconcile to its own sale.
  const f = buildFolio(cancelledStay, [], [], { taxPercent: 13, servicePercent: 10 });
  assert.equal(f.tax, 0);
  assert.equal(f.service, 0);
  assert.equal(f.grandTotal, 2000);
});

test("the retained deposit settles the cancellation charge exactly", () => {
  // The shape cancel_room_stay writes: held 5,000, kept 2,000, refunded 3,000.
  // The advance covers the whole charge, so nothing is left to collect and
  // nothing is owed — which is what keeps a cancellation out of receivables.
  const f = buildFolio(cancelledStay, [], [], { advancePaid: 2000 });
  assert.equal(f.grandTotal, 2000);
  assert.equal(f.advancePaid, 2000);
  assert.equal(f.balanceDue, 0);
  assert.equal(f.refundDue, 0);
});

test("a full refund leaves a zero bill", () => {
  const f = buildFolio({ ...cancelledStay, cancellation_charge: 0 }, someExtras, someFood, {});
  assert.equal(f.grandTotal, 0);
  assert.equal(f.balanceDue, 0);
});

test("a missing or negative charge is treated as zero, never as nights", () => {
  const noCharge = buildFolio({ ...cancelledStay, cancellation_charge: undefined }, [], [], {});
  assert.equal(noCharge.grandTotal, 0);
  const negative = buildFolio({ ...cancelledStay, cancellation_charge: -500 }, [], [], {});
  assert.equal(negative.grandTotal, 0);
});
