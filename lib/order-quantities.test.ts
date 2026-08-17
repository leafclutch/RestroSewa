import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderedQuantity,
  cancelledQuantity,
  servedQuantity,
  activeQuantity,
  cancellableQuantity,
  lineTotal,
  isFullyCancelled,
  isPartiallyCancelled,
  describeLine,
} from "./order-quantities.ts";

// The worked examples from the brief, as tests.

test("a plain line: nothing cancelled, nothing served", () => {
  const line = { quantity: 3 };
  assert.equal(orderedQuantity(line), 3);
  assert.equal(activeQuantity(line), 3);
  assert.equal(cancellableQuantity(line), 3);
  assert.equal(describeLine(line), null, "an unremarkable line needs no explanation");
});

test("Momo x3, cancel 1: two remain and only two are billed", () => {
  const line = { quantity: 3, cancelled_quantity: 1, active_quantity: 2 };
  assert.equal(activeQuantity(line), 2);
  assert.equal(cancellableQuantity(line), 2);
  assert.equal(lineTotal({ ...line, item_price: 100 }), 200, "Rs.300 becomes Rs.200");
  assert.equal(isPartiallyCancelled(line), true);
  assert.equal(isFullyCancelled(line), false);
});

test("Momo x5, cancel 2 then 1: three cancelled, two remain", () => {
  const line = { quantity: 5, cancelled_quantity: 3, active_quantity: 2 };
  assert.equal(activeQuantity(line), 2);
  assert.equal(cancelledQuantity(line), 3);
});

test("cancelling every unit takes the line off the bill", () => {
  const line = { quantity: 3, cancelled_quantity: 3, active_quantity: 0 };
  assert.equal(activeQuantity(line), 0);
  assert.equal(lineTotal({ ...line, item_price: 100 }), 0);
  assert.equal(isFullyCancelled(line), true);
  assert.equal(isPartiallyCancelled(line), false, "fully cancelled is not partly cancelled");
});

test("SERVED units are never cancellable — the eaten-food guard", () => {
  // Ordered 3, served 2, none cancelled. Only the 1 that never arrived may go back.
  const line = { quantity: 3, served_quantity: 2, active_quantity: 3 };
  assert.equal(activeQuantity(line), 3, "served food is still billed");
  assert.equal(
    cancellableQuantity(line),
    1,
    "offering 3 here would put two eaten momos back on the shelf"
  );
});

test("serve 2 of 3 then cancel the last: all three accounted for", () => {
  const line = { quantity: 3, served_quantity: 2, cancelled_quantity: 1, active_quantity: 2 };
  assert.equal(activeQuantity(line), 2);
  assert.equal(cancellableQuantity(line), 0, "nothing left to cancel");
  assert.equal(lineTotal({ ...line, item_price: 100 }), 200);
});

test("cancel 1 of 3 then serve the remaining 2", () => {
  const line = { quantity: 3, cancelled_quantity: 1, served_quantity: 2, active_quantity: 2 };
  assert.equal(cancellableQuantity(line), 0);
  assert.equal(activeQuantity(line), 2);
});

test("the stored generated column wins over the subtraction", () => {
  // If the two ever disagree the DATABASE is right — it is the one enforcing the
  // constraint. Trusting the local subtraction would paper over real corruption.
  const line = { quantity: 5, cancelled_quantity: 1, active_quantity: 2 };
  assert.equal(activeQuantity(line), 2);
});

test("active_quantity is derived when the caller did not select it", () => {
  assert.equal(activeQuantity({ quantity: 5, cancelled_quantity: 2 }), 3);
});

test("counts never go negative, whatever they are handed", () => {
  assert.equal(activeQuantity({ quantity: 2, cancelled_quantity: 5 }), 0);
  assert.equal(cancellableQuantity({ quantity: 2, served_quantity: 9, active_quantity: 2 }), 0);
  assert.equal(orderedQuantity({ quantity: -3 }), 0);
});

test("null and undefined counts read as zero, not NaN", () => {
  const line = { quantity: 4, cancelled_quantity: null, served_quantity: undefined };
  assert.equal(cancelledQuantity(line), 0);
  assert.equal(servedQuantity(line), 0);
  assert.equal(activeQuantity(line), 4);
  assert.equal(lineTotal({ ...line, item_price: "50" }), 200, "a string price still multiplies");
});

test("describeLine says what happened, and only when something did", () => {
  assert.equal(
    describeLine({ quantity: 3, cancelled_quantity: 1, active_quantity: 2 }),
    "Ordered 3 · Cancelled 1 · Remaining 2"
  );
  assert.equal(
    describeLine({ quantity: 5, cancelled_quantity: 1, served_quantity: 2, active_quantity: 4 }),
    "Ordered 5 · Cancelled 1 · Served 2 · Remaining 4"
  );
  // Fully served is not worth calling out — the status chip already says "Served".
  assert.equal(describeLine({ quantity: 3, served_quantity: 3, active_quantity: 3 }), null);
  assert.equal(describeLine({ quantity: 1 }), null);
});
