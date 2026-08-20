import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  cycleFor,
  cycleContaining,
  cycleLabel,
  dailyRate,
  payableDays,
  payableAmount,
  type Cycle,
} from "./payroll.ts";

// Every date here is a plain calendar date — `YYYY-MM-DD` — because a salary
// cycle is a statement about DAYS, not instants. The maths must never round-trip
// through a local Date, which would shift a boundary across the date line for
// anyone east of UTC and file a day under the wrong cycle.

// ─── Day arithmetic ───────────────────────────────────────────────────────────

test("addDays crosses month and year boundaries without touching month length", () => {
  assert.equal(addDays("2026-08-15", 29), "2026-09-13");
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-09-01", -1), "2026-08-31");
});

test("addDays is exact across a DST transition", () => {
  // Nothing in this codebase runs in a DST zone today, but the arithmetic must
  // not depend on that staying true. 29 March 2026 is the EU spring-forward.
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
});

test("daysBetween counts whole days, signed", () => {
  assert.equal(daysBetween("2026-08-15", "2026-09-13"), 29);
  assert.equal(daysBetween("2026-08-15", "2026-08-15"), 0);
  assert.equal(daysBetween("2026-09-13", "2026-08-15"), -29);
});

// ─── Cycle boundaries ─────────────────────────────────────────────────────────

test("the brief's own example: a 15th anchor runs 15 Aug -> 13 Sep", () => {
  const c = cycleFor("2026-08-15", 0);
  assert.equal(c.start, "2026-08-15");
  assert.equal(c.end, "2026-09-13");
  assert.equal(c.totalDays, 30);
});

test("cycles are contiguous — the next one starts the day after", () => {
  const first = cycleFor("2026-08-15", 0);
  const second = cycleFor("2026-08-15", 1);
  assert.equal(second.start, addDays(first.end, 1));
  assert.equal(second.start, "2026-09-14");
  assert.equal(second.end, "2026-10-13");
});

test("February is structurally irrelevant — a 30-day cycle is always 30 days", () => {
  // Feb 2026 has 28 days, so this cycle spends 28 days in Feb and 2 in March.
  const c = cycleFor("2026-02-01", 0);
  assert.equal(c.start, "2026-02-01");
  assert.equal(c.end, "2026-03-02");
  assert.equal(c.totalDays, 30);
});

test("a leap February shifts the end date, not the day count", () => {
  // 2028 is a leap year: 29 days in Feb, so the same anchor ends a day earlier.
  const c = cycleFor("2028-02-01", 0);
  assert.equal(c.end, "2028-03-01");
  assert.equal(c.totalDays, 30);
});

test("a 31-day month does not stretch the cycle", () => {
  const c = cycleFor("2026-01-01", 0);
  assert.equal(c.end, "2026-01-30"); // NOT 31 Jan
  assert.equal(c.totalDays, 30);
});

test("twelve cycles drift away from the calendar, as a 30-day cycle must", () => {
  // 12 * 30 = 360 days, so a year later the anchor has moved back ~5 days.
  const c = cycleFor("2026-08-15", 12);
  assert.equal(c.start, "2027-08-10");
});

// ─── Locating the cycle a date falls in ───────────────────────────────────────

test("cycleContaining picks the cycle holding the date, inclusive at both ends", () => {
  const anchor = "2026-08-15";
  assert.equal(cycleContaining(anchor, "2026-08-15").index, 0); // first day
  assert.equal(cycleContaining(anchor, "2026-09-13").index, 0); // last day
  assert.equal(cycleContaining(anchor, "2026-09-14").index, 1); // day after
});

test("cycleContaining returns the same window cycleFor would build", () => {
  const anchor = "2026-08-15";
  const found = cycleContaining(anchor, "2026-09-20");
  assert.deepEqual(found, cycleFor(anchor, found.index));
});

test("a date before the anchor yields a negative index rather than silently clamping", () => {
  // Clamping would quietly file pre-joining days into cycle 0 and pay for them.
  assert.equal(cycleContaining("2026-08-15", "2026-08-14").index, -1);
});

test("a non-default cycle length is honoured throughout", () => {
  const c = cycleFor("2026-08-15", 1, 15);
  assert.equal(c.start, "2026-08-30");
  assert.equal(c.end, "2026-09-13");
  assert.equal(c.totalDays, 15);
  assert.equal(cycleContaining("2026-08-15", "2026-08-30", 15).index, 1);
});

// ─── Attendance -> payable days ───────────────────────────────────────────────

const AUG15: Cycle = cycleFor("2026-08-15", 0);

test("no attendance rows means every day is payable", () => {
  // This is what makes the backfill neutral: legacy cycles have no rows, so they
  // pay in full exactly as the month-based system did.
  assert.equal(payableDays(AUG15, {}), 30);
});

test("the brief's own example: 10 absent days leaves 20 payable", () => {
  const absent: Record<string, number> = {};
  for (let i = 0; i < 10; i++) absent[addDays(AUG15.start, i)] = 0;
  assert.equal(payableDays(AUG15, absent), 20);
});

test("half days count as half, not as absent", () => {
  assert.equal(
    payableDays(AUG15, { "2026-08-16": 0.5, "2026-08-17": 0.5 }),
    29
  );
});

test("days outside the cycle are ignored, so a neighbouring cycle cannot bleed in", () => {
  assert.equal(
    payableDays(AUG15, { "2026-08-14": 0, "2026-09-14": 0, "2026-12-01": 0 }),
    30
  );
});

test("an explicit full-present row is a no-op — what a future attendance module writes", () => {
  // The whole forward-compatibility claim rests on this: when real attendance
  // starts recording EVERY day, the present rows must not change any total.
  const everyDayPresent: Record<string, number> = {};
  for (let i = 0; i < 30; i++) everyDayPresent[addDays(AUG15.start, i)] = 1;
  assert.equal(payableDays(AUG15, everyDayPresent), 30);

  everyDayPresent["2026-08-20"] = 0;
  assert.equal(payableDays(AUG15, everyDayPresent), 29);
});

// ─── Money ────────────────────────────────────────────────────────────────────

test("the brief's own example: Rs 30,000 over 30 days pays Rs 1,000 a day", () => {
  assert.equal(dailyRate(30000, 30), 1000);
  assert.equal(payableAmount(1000, 20), 20000);
});

test("a cycle worked in full pays exactly the monthly salary, to the paisa", () => {
  // 25000/30 does not divide evenly; the full cycle must still come back to
  // 25000 rather than 24999.99 and leave a phantom balance owing forever.
  assert.equal(payableAmount(dailyRate(25000, 30), 30), 25000);
});

test("partial amounts round to paisa", () => {
  assert.equal(payableAmount(dailyRate(25000, 30), 20), 16666.67);
});

test("a zero salary stays zero rather than producing NaN", () => {
  assert.equal(dailyRate(0, 30), 0);
  assert.equal(payableAmount(0, 30), 0);
});

// ─── Display ──────────────────────────────────────────────────────────────────

test("cycleLabel reads the way an admin would say it", () => {
  assert.equal(cycleLabel(AUG15), "15 Aug 2026 → 13 Sep 2026");
});
