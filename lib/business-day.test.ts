import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROOM_DOUBLE_HOUR,
  DEFAULT_ROOM_NEW_DAY_HOUR,
  normalizeRoomHour,
  normalizeShiftHours,
  resolveRoomDayRule,
  roomNightBoundary,
  roomNights,
  type RoomDayRule,
} from "./business-day.ts";

// Every case below is written in NEPAL wall-clock time, because that is the only
// clock the rule is stated in — "6 AM" and "noon" mean 6 AM and noon in Nepal, on
// a server that is almost certainly running UTC. `npt` converts, so the tests read
// as a receptionist would state them and still pin an exact absolute instant.
//
// Nepal Standard Time is UTC+05:45 with no DST, so this is exact, not approximate.
const npt = (day: string, hh: number, mm = 0) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - (5 * 60 + 45) * 60 * 1000);
};

/** The default rule: a room day starts at 6 AM, the price steps up at noon. */
const RULE: RoomDayRule = { newDayHour: 6, doubleHour: 12, shiftHours: 0 };

// ── The two cases the feature was specified from ─────────────────────────────
// These are the user's own worked examples, kept verbatim. If either ever fails,
// the feature is wrong no matter what the rest of the file says.

test("arriving in the evening: the price doubles at TOMORROW noon", () => {
  const checkIn = npt("2026-08-14", 20);
  assert.equal(
    roomNightBoundary(checkIn, 1, RULE).toISOString(),
    npt("2026-08-15", 12).toISOString()
  );
  assert.equal(roomNights(checkIn, npt("2026-08-15", 10), RULE), 1);
  assert.equal(roomNights(checkIn, npt("2026-08-15", 13), RULE), 2);
});

test("arriving at 3 AM is LAST night's guest: the price doubles at TODAY noon", () => {
  const checkIn = npt("2026-08-14", 3);
  assert.equal(
    roomNightBoundary(checkIn, 1, RULE).toISOString(),
    npt("2026-08-14", 12).toISOString()
  );
  assert.equal(roomNights(checkIn, npt("2026-08-14", 11), RULE), 1);
  assert.equal(roomNights(checkIn, npt("2026-08-14", 13), RULE), 2);
});

// ── The boundary itself ──────────────────────────────────────────────────────

test("two minutes either side of the new-day hour is a whole night apart", () => {
  // The entire point of the setting, and its sharpest edge: 05:59 belongs to the
  // previous room-day and so is already one night in by the time 06:01 arrives.
  const early = npt("2026-08-14", 5, 59);
  const late = npt("2026-08-14", 6, 1);
  const leaving = npt("2026-08-15", 10);

  assert.equal(roomNights(early, leaving, RULE), 2);
  assert.equal(roomNights(late, leaving, RULE), 1);
});

test("arriving exactly ON the new-day hour counts as the new day", () => {
  const checkIn = npt("2026-08-14", 6);
  assert.equal(
    roomNightBoundary(checkIn, 1, RULE).toISOString(),
    npt("2026-08-15", 12).toISOString()
  );
});

test("leaving exactly ON the boundary is the night it closes, not the next one", () => {
  // Matches the old 24-hour rule's "24h is one night, not two". A guest who walks
  // out as the clock strikes noon has not started another night.
  const checkIn = npt("2026-08-14", 20);
  assert.equal(roomNights(checkIn, npt("2026-08-15", 12), RULE), 1);
  assert.equal(roomNights(checkIn, npt("2026-08-15", 12, 1), RULE), 2);
});

test("a multi-night stay counts every boundary it crosses", () => {
  const checkIn = npt("2026-08-14", 20);
  assert.equal(roomNights(checkIn, npt("2026-08-16", 10), RULE), 2);
  assert.equal(roomNights(checkIn, npt("2026-08-17", 10), RULE), 3);
  assert.equal(roomNights(checkIn, npt("2026-08-24", 10), RULE), 10);
});

test("a stay always costs at least one night", () => {
  const checkIn = npt("2026-08-14", 20);
  assert.equal(roomNights(checkIn, npt("2026-08-14", 21), RULE), 1);
  // Nonsense inputs must not produce 0 or a negative charge.
  assert.equal(roomNights(checkIn, checkIn, RULE), 1);
  assert.equal(roomNights(checkIn, npt("2026-08-13", 10), RULE), 1);
  assert.equal(roomNights(checkIn, "not a date", RULE), 1);
});

// ── Date arithmetic across the awkward rollovers ─────────────────────────────
// The underlying maths is done on date STRINGS, so month and year ends are where
// a naive implementation breaks.

test("the boundary crosses a month end", () => {
  assert.equal(
    roomNightBoundary(npt("2026-08-31", 20), 1, RULE).toISOString(),
    npt("2026-09-01", 12).toISOString()
  );
});

test("the boundary crosses a year end", () => {
  assert.equal(
    roomNightBoundary(npt("2026-12-31", 20), 1, RULE).toISOString(),
    npt("2027-01-01", 12).toISOString()
  );
});

test("a 3 AM arrival on the 1st reaches back into the previous month", () => {
  // room-day is 31 July, so the first boundary is 1 August noon — the same day
  // they arrived, which is the surprising-but-correct half of the rule.
  assert.equal(
    roomNightBoundary(npt("2026-08-01", 3), 1, RULE).toISOString(),
    npt("2026-08-01", 12).toISOString()
  );
});

// ── The per-stay shift ───────────────────────────────────────────────────────

test("a shift pushes every boundary of the stay later", () => {
  const shifted: RoomDayRule = { ...RULE, shiftHours: 3 };
  const checkIn = npt("2026-08-14", 20);

  assert.equal(
    roomNightBoundary(checkIn, 1, shifted).toISOString(),
    npt("2026-08-15", 15).toISOString()
  );
  assert.equal(
    roomNightBoundary(checkIn, 2, shifted).toISOString(),
    npt("2026-08-16", 15).toISOString()
  );
});

test("a shift can save the guest a night", () => {
  const checkIn = npt("2026-08-14", 20);
  const leaving = npt("2026-08-15", 14); // 2 PM — past noon, before 3 PM

  assert.equal(roomNights(checkIn, leaving, RULE), 2);
  assert.equal(roomNights(checkIn, leaving, { ...RULE, shiftHours: 3 }), 1);
});

test("a shift is capped at 12 hours so it can never gift a whole night", () => {
  assert.equal(normalizeShiftHours(24), 12);
  assert.equal(normalizeShiftHours(13), 12);
  assert.equal(normalizeShiftHours(12), 12);
  assert.equal(normalizeShiftHours(-1), 0);
  assert.equal(normalizeShiftHours(1.5), 0);
  assert.equal(normalizeShiftHours(null), 0);
  assert.equal(normalizeShiftHours(undefined), 0);
  assert.equal(normalizeShiftHours("3"), 3);
});

// ── Degrading safely ─────────────────────────────────────────────────────────

test("a nonsense hour falls back to the default, never to midnight", () => {
  // Midnight would be the worst possible silent failure: every boundary moves
  // and nobody sees an error.
  for (const bad of [null, undefined, "noon", -1, 24, 99, 6.5, NaN, {}]) {
    assert.equal(normalizeRoomHour(bad, DEFAULT_ROOM_DOUBLE_HOUR), 12);
    assert.equal(normalizeRoomHour(bad, DEFAULT_ROOM_NEW_DAY_HOUR), 6);
  }
  assert.equal(normalizeRoomHour(0, 12), 0); // a real 0 is still a real hour
  assert.equal(normalizeRoomHour("14", 12), 14);
});

test("the check-in snapshot beats the live setting", () => {
  // The guarantee that stops an admin re-pricing a settled bill next March.
  const rule = resolveRoomDayRule({
    settings: { room_new_day_hour: 4, room_price_double_hour: 10 },
    stayNewDayHour: 6,
    stayDoubleHour: 12,
  });
  assert.deepEqual(rule, { newDayHour: 6, doubleHour: 12, shiftHours: 0 });
});

test("a stay with no snapshot follows the live setting", () => {
  // Which is what lets stays already in progress adopt the rule when it ships.
  const rule = resolveRoomDayRule({
    settings: { room_new_day_hour: 4, room_price_double_hour: 10 },
    stayNewDayHour: null,
    stayDoubleHour: null,
    shiftHours: 2,
  });
  assert.deepEqual(rule, { newDayHour: 4, doubleHour: 10, shiftHours: 2 });
});

test("no settings at all yields 6 AM / noon", () => {
  assert.deepEqual(resolveRoomDayRule({ settings: null }), {
    newDayHour: 6,
    doubleHour: 12,
    shiftHours: 0,
  });
  assert.deepEqual(resolveRoomDayRule({}), {
    newDayHour: 6,
    doubleHour: 12,
    shiftHours: 0,
  });
});

test("the two hours are independent — a hotel can run 4 AM / 11 AM", () => {
  const rule: RoomDayRule = { newDayHour: 4, doubleHour: 11, shiftHours: 0 };
  assert.equal(
    roomNightBoundary(npt("2026-08-14", 3), 1, rule).toISOString(),
    npt("2026-08-14", 11).toISOString()
  );
  assert.equal(
    roomNightBoundary(npt("2026-08-14", 5), 1, rule).toISOString(),
    npt("2026-08-15", 11).toISOString()
  );
});
