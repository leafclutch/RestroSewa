import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyFormatter, normalizeCurrency, reportMoney, DEFAULT_CURRENCY } from "./currency.ts";

test("a restaurant that never chose a currency shows Nepali Rupees", () => {
  assert.equal(normalizeCurrency(undefined), DEFAULT_CURRENCY);
  assert.equal(DEFAULT_CURRENCY, "NPR");
  assert.equal(currencyFormatter(undefined).money(150000), "Rs. 1,50,000");
});

test("an unknown stored code falls back instead of breaking", () => {
  assert.equal(normalizeCurrency("XYZ"), DEFAULT_CURRENCY);
  assert.equal(normalizeCurrency(" usd "), "USD");
});

test("each currency groups digits in its own way", () => {
  assert.equal(currencyFormatter("USD").money(150000), "$150,000");
  assert.equal(currencyFormatter("EUR").money2(1234.5), "€1,234.50");
  assert.equal(currencyFormatter("NPR").money(150000), "Rs. 1,50,000");
});

test("letter symbols are spaced from the number, glyph symbols are not", () => {
  assert.equal(currencyFormatter("AED").money(500), "AED 500");
  assert.equal(currencyFormatter("GBP").money(500), "£500");
});

test("signed2 puts the minus before the symbol", () => {
  assert.equal(currencyFormatter("INR").signed2(-1500), "−₹1,500.00");
  assert.equal(currencyFormatter("INR").signed2(1500), "₹1,500.00");
});

test("reports print the ISO code, which the PDF fonts can draw", () => {
  assert.equal(reportMoney("NPR")(1500), "NPR 1,500.00");
  assert.equal(reportMoney("USD")(1500.456), "USD 1,500.46");
});
