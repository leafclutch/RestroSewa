import { test } from "node:test";
import assert from "node:assert/strict";
import { pinToAuthPassword, AUTH_MIN_PASSWORD_LENGTH } from "./pin-password.ts";

test("a 4-digit PIN becomes an auth password Supabase will accept", () => {
  const pw = pinToAuthPassword("1234");
  assert.ok(pw.length >= AUTH_MIN_PASSWORD_LENGTH, `"${pw}" is shorter than ${AUTH_MIN_PASSWORD_LENGTH}`);
});

test("the mapping is deterministic and keeps PINs distinct", () => {
  assert.equal(pinToAuthPassword("0420"), pinToAuthPassword("0420"));
  assert.notEqual(pinToAuthPassword("1234"), pinToAuthPassword("4321"));
  // Leading zeros are significant — a PIN is a string, not a number.
  assert.notEqual(pinToAuthPassword("0123"), pinToAuthPassword("123"));
});
