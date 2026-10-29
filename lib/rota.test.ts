import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shiftMinutes,
  shiftPaidHours,
  shiftPay,
  breakLabel,
  crossesMidnight,
  formatShift,
  hoursLabel,
  weekStartOf,
  weekDays,
  weekdayIndex,
  normaliseWeek,
  dayHeader,
  type RotaShift,
} from "./rota.ts";
import { normalizePayoutMode, normalizeRotaPayPeriod } from "./payout-mode.ts";

const base: Omit<RotaShift, "kind"> = {
  id: "x",
  staff_id: "s",
  date: "2026-10-19",
  role_code: "TL",
  planned_start: null,
  planned_end: null,
  actual_start: null,
  actual_end: null,
  break_minutes: 0,
  break_paid: false,
  paid_hours: null,
  notes: null,
};

// ─── Hours ────────────────────────────────────────────────────────────────────

test("a same-day shift is end − start", () => {
  assert.equal(shiftMinutes("07:00", "16:00"), 540);
});

test("a shift past midnight wraps: 17:00–01:30 is 8½ hours", () => {
  assert.equal(shiftMinutes("17:00", "01:30"), 510);
  assert.equal(crossesMidnight("17:00", "01:30"), true);
  assert.equal(crossesMidnight("07:00", "16:00"), false);
});

test("the unpaid break comes off, and hours never go negative", () => {
  assert.equal(shiftMinutes("17:00", "01:30", 30), 480);
  assert.equal(shiftMinutes("10:00", "10:30", 60), 0);
});

test("Postgres `time` strings with seconds are read the same", () => {
  assert.equal(shiftMinutes("17:00:00", "01:30:00"), 510);
});

test("a paid break is not deducted; an unpaid one is", () => {
  const shift = { ...base, kind: "shift" as const, planned_start: "17:00", planned_end: "01:30", break_minutes: 30 };
  assert.equal(shiftPaidHours({ ...shift, break_paid: false }), 8);
  assert.equal(shiftPaidHours({ ...shift, break_paid: true }), 8.5);
  assert.equal(breakLabel(shift), "30m unpaid break");
  assert.equal(breakLabel({ ...shift, break_paid: true }), "30m paid break");
  assert.equal(breakLabel({ ...shift, break_minutes: 0 }), "");
});

test("actual times override planned ones", () => {
  const h = shiftPaidHours({
    ...base,
    kind: "shift",
    planned_start: "07:00",
    planned_end: "16:00",
    actual_start: "08:00",
    actual_end: "16:00",
  });
  assert.equal(h, 8);
});

test("holiday pays its set hours; sick and off pay nothing", () => {
  assert.equal(shiftPaidHours({ ...base, kind: "holiday", paid_hours: 8 }), 8);
  assert.equal(shiftPaidHours({ ...base, kind: "holiday", paid_hours: null }), 0);
  assert.equal(shiftPaidHours({ ...base, kind: "sick", paid_hours: 8 }), 0);
  assert.equal(shiftPaidHours({ ...base, kind: "off" }), 0);
});

test("pay rounds once, to the cent", () => {
  assert.equal(shiftPay(8.5, 11.44), 97.24);
  assert.equal(shiftPay(7.3333, 12), 88);
});

// ─── Labels ───────────────────────────────────────────────────────────────────

test("formatShift reads like the paper rota", () => {
  assert.equal(
    formatShift({ ...base, kind: "shift", planned_start: "16:00:00", planned_end: "01:30:00" }),
    "TL 16:00–01:30"
  );
  assert.equal(formatShift({ ...base, kind: "holiday" }), "Holiday");
});

test("hoursLabel", () => {
  assert.equal(hoursLabel(8.5), "8h 30m");
  assert.equal(hoursLabel(8), "8h");
});

// ─── Weeks ────────────────────────────────────────────────────────────────────

test("weeks run Monday → Sunday", () => {
  assert.equal(weekdayIndex("2026-10-19"), 0); // Monday
  assert.equal(weekdayIndex("2026-10-25"), 6); // Sunday
  assert.equal(weekStartOf("2026-10-25"), "2026-10-19");
  assert.equal(weekStartOf("2026-10-19"), "2026-10-19");
  assert.deepEqual(weekDays("2026-10-19").at(-1), "2026-10-25");
  assert.equal(dayHeader("2026-10-19"), "Mon 19 Oct");
});

test("a week crossing a year boundary", () => {
  assert.equal(weekStartOf("2027-01-01"), "2026-12-28");
});

test("normaliseWeek snaps to Monday and falls back to today", () => {
  assert.equal(normaliseWeek("2026-10-22", "2026-01-01"), "2026-10-19");
  assert.equal(normaliseWeek("garbage", "2026-10-22"), "2026-10-19");
  assert.equal(normaliseWeek(null, "2026-10-22"), "2026-10-19");
});

// ─── Mode ─────────────────────────────────────────────────────────────────────

test("a restaurant with no setting is on the default payout", () => {
  assert.equal(normalizePayoutMode({}), "standard");
  assert.equal(normalizePayoutMode(null), "standard");
  assert.equal(normalizePayoutMode({ payout_mode: "advanced" }), "advanced");
  assert.equal(normalizeRotaPayPeriod({}), "weekly");
  assert.equal(normalizeRotaPayPeriod({ rota_pay_period: "monthly" }), "monthly");
});
