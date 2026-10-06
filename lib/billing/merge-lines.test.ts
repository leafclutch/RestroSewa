import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLines, billLineKey } from "./merge-lines.ts";
import { buildFolio } from "../room-billing.ts";
import { folioToBill } from "./room-bill.ts";

const momo = (id: string, quantity: number, item_price = 150) => ({ id, item_name: "Momo", item_price, quantity });

test("the same dish from three order rounds becomes one line of 3", () => {
  const out = mergeLines([momo("a", 1), momo("b", 1), momo("c", 1)], billLineKey);
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 3);
  assert.equal(out[0].id, "a"); // first occurrence's id is kept
});

test("order is kept — a merged line sits where it first appeared", () => {
  const tea = { id: "t", item_name: "Tea", item_price: 40, quantity: 2 };
  const out = mergeLines([momo("a", 1), tea, momo("b", 2)], billLineKey);
  assert.deepEqual(out.map((l) => [l.item_name, l.quantity]), [["Momo", 3], ["Tea", 2]]);
});

test("a different rate stays its own line — never a blended price", () => {
  const out = mergeLines([momo("a", 1, 150), momo("b", 1, 180)], billLineKey);
  assert.equal(out.length, 2);
});

test("a custom line never merges into a menu line of the same name", () => {
  const out = mergeLines([momo("a", 1), { ...momo("b", 1), is_custom: true }], billLineKey);
  assert.equal(out.length, 2);
});

test("the kitchen key keeps a line with a note apart", () => {
  const key = (l: { item_name: string; item_price: number; notes?: string | null }) =>
    `${billLineKey(l)}\u0000${l.notes ?? ""}`;
  const out = mergeLines(
    [{ ...momo("a", 1), notes: null }, { ...momo("b", 1), notes: "no onion" }, { ...momo("c", 1), notes: null }],
    key
  );
  assert.deepEqual(out.map((l) => [l.quantity, l.notes]), [[2, null], [1, "no onion"]]);
});

test("room folio: repeat orders merge, and the total does not move", () => {
  const stay = { check_in_at: "2026-08-01T06:00:00.000Z", check_out_at: "2026-08-02T06:00:00.000Z", room_rate: 1000 };
  const f = buildFolio(stay, [], [momo("a", 1), momo("b", 2), { id: "t", item_name: "Tea", item_price: 40, quantity: 1 }], {});
  assert.equal(f.food.length, 2);
  assert.equal(f.food[0].quantity, 3);
  assert.equal(f.food[0].amount, 450);
  assert.equal(f.foodTotal, 490);
  assert.equal(f.grandTotal, 1490);

  // ...and the printed room bill shows it in the Qty / Rate columns.
  const bill = folioToBill({ folio: f, roomType: "Deluxe" });
  const food = bill.sections.find((s) => s.title === "Food & beverages")!;
  assert.deepEqual(food.lines[0], { id: "a", item_name: "Momo", item_price: 150, quantity: 3 });
});
