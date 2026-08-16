import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFolio } from "./room-billing.ts";
import { resolveSplit } from "./payment-split.ts";

// Stay details for testing folio calculations with advances
const stay = {
  check_in_at: "2026-08-01T06:00:00.000Z",
  check_out_at: "2026-08-03T06:00:00.000Z",
  room_rate: 2500, // 2 nights = 5,000
};

test("resolveSplit handles cash, online, and card single methods", () => {
  assert.deepEqual(resolveSplit("cash", 5000, "", ""), { ok: true, cash: null, online: null });
  assert.deepEqual(resolveSplit("online", 5000, "", ""), { ok: true, cash: null, online: null });
  assert.deepEqual(resolveSplit("card", 5000, "", ""), { ok: true, cash: null, online: null });
});

test("resolveSplit validates mixed cash + online advance payment", () => {
  // Valid split: 2000 cash + 3000 online = 5000 total
  const valid = resolveSplit("mixed", 5000, "2000", "3000");
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.cash, 2000);
    assert.equal(valid.online, 3000);
  }

  // Invalid split: 2000 cash + 2000 online != 5000 total
  const invalid = resolveSplit("mixed", 5000, "2000", "2000");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.match(invalid.error, /must equal/);
  }
});

test("room folio calculates balance due correctly after partial mixed advance", () => {
  // Total bill = 5,000; advance paid = 3,000 (e.g. 1,000 cash + 2,000 online)
  const folio = buildFolio(stay, [], [], { advancePaid: 3000 });
  assert.equal(folio.grandTotal, 5000, "Grand total reflects full room stay");
  assert.equal(folio.advancePaid, 3000, "Advance paid is credited");
  assert.equal(folio.balanceDue, 2000, "Remaining balance due at checkout is 2,000");
  assert.equal(folio.refundDue, 0);
});

test("room folio handles advance larger than total bill cleanly as refund due", () => {
  // Total bill = 5,000; advance paid = 6,000
  const folio = buildFolio(stay, [], [], { advancePaid: 6000 });
  assert.equal(folio.grandTotal, 5000);
  assert.equal(folio.advancePaid, 6000);
  assert.equal(folio.balanceDue, 0, "Balance due is 0");
  assert.equal(folio.refundDue, 1000, "Refund due to guest is 1,000");
});
