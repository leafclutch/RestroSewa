import { test } from "node:test";
import assert from "node:assert/strict";
import { allergyFlagsForCart } from "./allergy.ts";

const items = [
  { id: "a", name: "Chicken 65", allergy_info: "Contains peanuts" },
  { id: "b", name: "Coke", allergy_info: null },
  { id: "c", name: "Biryani", allergy_info: "Dairy" },
  { id: "d", name: "Momo", allergy_info: "   " },
];

test("a cart with no flagged dish needs no allergy check", () => {
  assert.deepEqual(allergyFlagsForCart(["b"], items), []);
  assert.deepEqual(allergyFlagsForCart([], items), []);
});

test("every flagged dish is listed, in cart order", () => {
  assert.deepEqual(allergyFlagsForCart(["c", "b", "a"], items), [
    { name: "Biryani", allergy: "Dairy" },
    { name: "Chicken 65", allergy: "Contains peanuts" },
  ]);
});

test("a dish in the cart twice (two sizes) is asked about once", () => {
  assert.equal(allergyFlagsForCart(["a", "a"], items).length, 1);
});

test("a whitespace-only note is not a warning", () => {
  assert.deepEqual(allergyFlagsForCart(["d"], items), []);
});

test("an item missing from the menu is ignored, not a crash", () => {
  assert.deepEqual(allergyFlagsForCart(["zzz"], items), []);
});
