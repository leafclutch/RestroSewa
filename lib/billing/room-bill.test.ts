import { test } from "node:test";
import assert from "node:assert/strict";
import { folioToBill } from "./room-bill.ts";

// A folio as buildFolio returns it: 2 nights at 2,500 + a 300 extra + 300 of food,
// with 600 knocked off. buildFolio has already done every sum here — the mapper's job
// is to arrange them, never to recompute them.
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
  roomTotal: 5000,
  extrasTotal: 300,
  foodTotal: 300,
  subtotal: 5600,
  discount: 600,
  taxPercent: 0,
  tax: 0,
  servicePercent: 0,
  service: 0,
  grandTotal: 5000,
};

test("groups the folio into Room, Extras and Food sections", () => {
  const bill = folioToBill({ folio, roomType: "Deluxe" });
  assert.deepEqual(
    bill.sections.map((s) => s.title),
    ["Room charge", "Extras", "Food & beverages"]
  );
  assert.equal(bill.sections[0].lines[0].item_price, 5000);
  assert.equal(bill.sections[2].lines[0].item_name, "Momo (2 × ₹150)");
});

test("omits a section that has no lines", () => {
  const bill = folioToBill({ folio: { ...folio, extras: [], extrasTotal: 0 }, roomType: "Deluxe" });
  assert.deepEqual(bill.sections.map((s) => s.title), ["Room charge", "Food & beverages"]);
});

test("carries the folio's own totals through untouched", () => {
  // The mapper must NEVER re-derive money. buildFolio is the single calculator; a second
  // implementation here is exactly how a bill and the payment beside it come to disagree.
  const bill = folioToBill({ folio, roomType: "Deluxe" });
  assert.equal(bill.subtotal, 5600);
  assert.equal(bill.discount, 600);
  assert.equal(bill.grandTotal, 5000);
});

test("every line sums to the subtotal", () => {
  // The defect this whole change exists to fix: a paid room bill that showed food only,
  // so the printed lines did not add up to the amount charged.
  const bill = folioToBill({ folio, roomType: "Deluxe" });
  const sum = bill.sections
    .flatMap((s) => s.lines)
    .reduce((n, l) => n + l.item_price * l.quantity, 0);
  assert.equal(sum, bill.subtotal);
});

test("exposes the stay block for the hotel header", () => {
  const bill = folioToBill({ folio, roomType: "Deluxe" });
  assert.equal(bill.stay.nights, 2);
  assert.equal(bill.stay.rate, 2500);
  assert.equal(bill.stay.roomType, "Deluxe");
  assert.equal(bill.stay.checkIn, "2026-08-01T06:00:00.000Z");
});

test("a bare room stay with no extras and no food is still a whole bill", () => {
  const bare = { ...folio, extras: [], food: [], extrasTotal: 0, foodTotal: 0, subtotal: 5000, discount: 0, grandTotal: 5000 };
  const bill = folioToBill({ folio: bare, roomType: "Standard" });
  assert.deepEqual(bill.sections.map((s) => s.title), ["Room charge"]);
  assert.equal(bill.grandTotal, 5000);
});
