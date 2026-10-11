// THE definition of a business day. Every report, filter and day picker in the
// app resolves its dates through this file and nowhere else.
//
// WHY IT EXISTS: a restaurant that serves until 2am treats those sales as part
// of the previous night's trading. The books said otherwise — a 00:45 bill
// landed on the next calendar day, splitting one evening's takings across two
// reports. So the boundary is configurable per restaurant
// (`restaurants.settings.business_closing_hour`, whole hours 0–23, default 0 =
// midnight = the old behaviour).
//
// A closing hour can sit on EITHER side of midnight, and which side decides which
// calendar date the 24-hour window is named after — the one holding most of it:
//
//   before noon (0–11)  late close: the small hours belong to the night before
//       business day D  =  [ D h:00 , D+1 h:00 )            e.g. 2 AM
//   noon or later (12–23)  early close: after closing is already tomorrow
//       business day D  =  [ D-1 h:00 , D h:00 )            e.g. 10 PM
//
// Both are the same formula with a signed OFFSET from midnight (h, or h − 24):
//
//   business day D  =  [ D offset , D+1 offset )
//
// The day-maths functions below take a `DayRule`. A plain number is a raw offset
// (the room-night rules use that form, where 12 means noon of that date, not the
// day before); a restaurant's closing hour reaches them as a `BusinessDayRule`
// built by `businessDayRule(settings)`, which does the flip and also carries…
//
// ── EARLY CLOSES ──────────────────────────────────────────────────────────────
// "Close today's business" ends the current day at the instant it is pressed.
// It is stored per business date (`settings.business_early_closes`, date → ISO
// instant) and only moves THAT day's end — and so the next day's start. The day
// after reverts to the normal closing hour without anyone touching anything.
// It is kept forever on purpose: forgetting it would quietly pull the evening's
// later bills back into the day that was closed.
//
// ── TIMEZONE: PINNED TO NEPAL, NOT THE SERVER ────────────────────────────────
// This used to compute in the SERVER's local timezone, which was fine on a
// Nepal-based dev machine but WRONG in production: hosted on a UTC (or US) server,
// "today" was the server's calendar day, so at 2am Nepal the server still thought
// it was yesterday and dumped the previous evening's sales into today's total —
// the "yesterday shows in my today's sales" bug.
//
// Every restaurant is in Nepal, and Nepal Standard Time is a FIXED UTC+05:45 with
// NO daylight saving (year-round, since 1986). So a constant offset is exactly
// correct and, crucially, independent of where the server runs. All arithmetic
// below is done on Nepal wall-clock date STRINGS (calendar maths, tz-free) and
// only converted to an absolute instant at the very end, through the offset.
//
// THE RULE THAT IS EASY TO GET WRONG: every period is derived from
// `businessDate(now, h)` — the business day we are *currently inside* — never
// from `now`'s calendar date. At 01:00 on 1 August with h=3 we are still inside
// business day 31 July, so "This Month" must mean JULY.
//
// The upper bound is always EXCLUSIVE, which is what makes the carry-forward
// exact: one period's closing and the next period's opening are the same instant.
//
// Client components must not compute business days themselves — the browser's
// clock is yet another clock. Format timestamps there; bucket them here.

export const DEFAULT_CLOSING_HOUR = 0;

// Nepal Standard Time = UTC+05:45, no DST. A single constant is fully correct.
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/**
 * Coerce whatever is sitting in the settings jsonb into a usable hour.
 *
 * Settings are free-form JSON, so this may be a number, a string, absent, or
 * nonsense. Anything that isn't a whole hour in 0–23 collapses to the default,
 * which is midnight — i.e. a bad value degrades to the behaviour the app had
 * before this feature, never to a random boundary.
 */
export function normalizeClosingHour(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 23) return DEFAULT_CLOSING_HOUR;
  return n;
}

/**
 * A restaurant's business-day boundary, resolved. `offset` is signed hours from
 * Nepal midnight (−12…11); `earlyCloses` maps a business date to the instant it
 * was closed early.
 */
export type BusinessDayRule = {
  hour: number;
  offset: number;
  earlyCloses: Readonly<Record<string, string>>;
};

/** A `BusinessDayRule`, or a bare offset in hours (no early closes). */
export type DayRule = number | BusinessDayRule;

/** Closing hour → signed offset from midnight. 22 (10 PM) → −2; 3 → 3. */
export function closingOffset(hour: number): number {
  return hour >= 12 ? hour - 24 : hour;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce `settings.business_early_closes` into date → ISO, dropping junk. */
export function normalizeEarlyCloses(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [day, at] of Object.entries(v as Record<string, unknown>)) {
    if (DATE_RE.test(day) && typeof at === "string" && Number.isFinite(Date.parse(at))) {
      out[day] = at;
    }
  }
  return out;
}

/** The restaurant's rule, from its `settings` jsonb. */
export function businessDayRule(
  settings: { business_closing_hour?: unknown; business_early_closes?: unknown } | null | undefined
): BusinessDayRule {
  const hour = normalizeClosingHour(settings?.business_closing_hour);
  return {
    hour,
    offset: closingOffset(hour),
    earlyCloses: normalizeEarlyCloses(settings?.business_early_closes),
  };
}

const offsetOf = (rule: DayRule) => (typeof rule === "number" ? rule : rule.offset);

/**
 * The instant `day` was closed early, if it was — and only while that instant
 * still lies inside the day's normal window. An early close is recorded against
 * the closing hour in force at the time; if the hour is changed later the stored
 * instant can fall outside the day it names (past its new end, or before its new
 * start). Honouring it then would make `businessDate` and the day bounds disagree
 * about the same bill, so it is ignored and the day runs to its normal hour.
 */
function earlyCloseOf(rule: DayRule, day: string): Date | null {
  if (typeof rule === "number") return null;
  const raw = rule.earlyCloses[day];
  if (!raw) return null;
  const at = new Date(raw);
  const opens = nepalInstant(day, rule.offset);
  const closes = nepalInstant(addDaysStr(day, 1), rule.offset);
  return at >= opens && at < closes ? at : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The Nepal wall-clock date (YYYY-MM-DD) of an absolute instant. */
function nepalDateStr(at: Date): string {
  // Shift into Nepal time, then read the UTC parts — those ARE the Nepal parts.
  const d = new Date(at.getTime() + NEPAL_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The absolute instant of Nepal-local `day hour:00:00`. */
function nepalInstant(day: string, hour: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  // Build the Nepal wall-clock time as if UTC, then subtract the offset to get
  // the true absolute instant.
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, hour, 0, 0, 0) - NEPAL_OFFSET_MS);
}

/** Calendar add on a date STRING — pure UTC maths, so it is timezone-free. */
function addDaysStr(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const firstOfMonthStr = (day: string) => `${day.slice(0, 7)}-01`;
const firstOfYearStr = (day: string) => `${day.slice(0, 4)}-01-01`;

/**
 * Calendar add/subtract on a YYYY-MM-DD business-day STRING (pure UTC maths, so
 * timezone-free). `addBusinessDays(businessToday(h), -1)` is the previous, fully
 * closed business day — what the daily-summary job reports on.
 */
export function addBusinessDays(day: string, n: number): string {
  return addDaysStr(day, n);
}

/**
 * The instant business day `day` begins: Nepal midnight of that date plus the
 * rule's offset — or, when the day before was closed early, that instant.
 * Accepts a YYYY-MM-DD string, or a Date (read as its Nepal day).
 */
export function businessDayStart(day: string | Date, rule: DayRule): Date {
  const s = typeof day === "string" ? day : nepalDateStr(day);
  return earlyCloseOf(rule, addDaysStr(s, -1)) ?? nepalInstant(s, offsetOf(rule));
}

/** Where `day` would begin on the normal closing hour, ignoring early closes. */
export function businessDayScheduledStart(day: string, rule: DayRule): Date {
  return nepalInstant(day, offsetOf(rule));
}

/**
 * Which business day does this instant belong to?
 *
 * Shifting back by the offset is the whole trick: with 3 AM, a 02:50 stamp moves
 * to 23:50 the previous day and reads off that Nepal date; with 10 PM (−2), a
 * 22:30 stamp moves to 00:30 the next day. Then an early close of that day, if
 * the stamp is past it, hands the stamp to the following day.
 */
export function businessDate(at: Date, rule: DayRule): string {
  let d = nepalDateStr(new Date(at.getTime() - offsetOf(rule) * 60 * 60 * 1000));
  // Bounded: a day can only be closed early once it has started, so at most a
  // couple of consecutive early closes can ever cover one instant.
  for (let i = 0; i < 3; i++) {
    const closed = earlyCloseOf(rule, d);
    if (!closed || at < closed) break;
    d = addDaysStr(d, 1);
  }
  return d;
}

/**
 * The business day we are currently inside, as YYYY-MM-DD.
 *
 * `now` is injectable ONLY so the boundary rules can be tested at instants a
 * test can't otherwise reach — 01:00 on the 1st of a month, or exactly h:00:00.
 * Production callers never pass it.
 */
export function businessToday(rule: DayRule, now: Date = new Date()): string {
  return businessDate(now, rule);
}

/** Bounds for ONE business day (the Nepal date, or today's). */
export function businessDayBounds(
  day: string | null | undefined,
  rule: DayRule
): { from: Date; to: Date } {
  const d = day ?? businessToday(rule);
  return { from: businessDayStart(d, rule), to: businessDayStart(addDaysStr(d, 1), rule) };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ROOM NIGHT BOUNDARY
//
// A hotel night does not run for 24 hours from whenever the guest walked in — it
// ends at CHECKOUT TIME, the same wall-clock hour for everyone in the building.
// Two guests in identical rooms who arrived three hours apart used to cross into
// night two three hours apart, which is not how any front desk works.
//
// Two hours define the rule:
//
//   newDayHour  which DAY an arrival belongs to. Arriving 8 PM on the 14th is
//               the 14th; arriving 3 AM on the 14th is still the 13th's guest —
//               they came in "last night". Exactly the trick businessDate() uses
//               for late trading, applied to arrivals instead of bills.
//   doubleHour  the hour on each following day at which the next night starts.
//
//   night n of a stay ends at   doubleHour on (arrival's room-day + n)
//
// Worked, with newDay 6 AM and double 12 PM:
//   check in 14th 8:00 PM → room-day 14th → night 1 ends 15th 12 PM (tomorrow)
//   check in 14th 3:00 AM → room-day 13th → night 1 ends 14th 12 PM (today)
//
// Both of those are the same single line of arithmetic, which is the reason this
// shape was chosen over special-casing "early morning arrivals".
//
// The whole rule lives HERE and not in room-billing.ts because it is day maths,
// and day maths lives in one file (see the header). room-billing.ts owns money.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ROOM_NEW_DAY_HOUR = 6;
export const DEFAULT_ROOM_DOUBLE_HOUR = 12;

/** The most hours a stay's boundary may be pushed back. See `normalizeShiftHours`. */
export const MAX_ROOM_SHIFT_HOURS = 12;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type RoomDayRule = {
  /** Which day an arrival belongs to (0–23). */
  newDayHour: number;
  /** The hour each following night begins (0–23). */
  doubleHour: number;
  /** Per-stay courtesy: push every boundary this many hours later (0–12). */
  shiftHours: number;
};

/**
 * Coerce a settings/column value into a usable hour, falling back to `fallback`.
 *
 * The twin of `normalizeClosingHour`, and for the same reason: settings are
 * free-form JSON and these two also arrive as nullable smallint columns, so a
 * bad value must land on the documented default rather than on hour 0 — which
 * for `doubleHour` would silently move every night boundary to midnight.
 */
export function normalizeRoomHour(v: unknown, fallback: number): number {
  // Reject the empty-ish values BEFORE Number() sees them. `Number(null)`,
  // `Number("")` and `Number(false)` are all 0 — a perfectly valid hour — so a
  // null column or a blank form field would otherwise resolve to MIDNIGHT and
  // move every boundary with nothing on screen to say so. This is the one
  // degradation that must never happen quietly.
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}

/**
 * Clamp a per-stay shift to 0–12 hours.
 *
 * Capped at 12 on purpose: a shift of 24 or more would step over a whole
 * boundary, so "give them a few more hours" would silently become "give them a
 * free night". The DB carries the same CHECK, this is the front line.
 */
export function normalizeShiftHours(v: unknown): number {
  // Same empty-ish guard as normalizeRoomHour. Here the fallback happens to BE
  // 0, so it changes no answer today — but the two must not drift apart, and a
  // reader should not have to work out that the bug is harmless in this one.
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, MAX_ROOM_SHIFT_HOURS);
}

/**
 * Resolve the rule for one stay.
 *
 * `stayNewDayHour`/`stayDoubleHour` are the SNAPSHOT taken at check-in. They win
 * when present, so an admin who changes the hours next March cannot re-price a
 * bill that was settled today — the same guarantee `room_stays.room_rate` gives
 * against a room-type price rise. Null (a stay that predates the feature) falls
 * back to the restaurant's live setting, which is what lets stays already in
 * progress adopt the new rule the moment it ships.
 */
export function resolveRoomDayRule(args: {
  settings?: { room_new_day_hour?: unknown; room_price_double_hour?: unknown } | null;
  stayNewDayHour?: unknown;
  stayDoubleHour?: unknown;
  shiftHours?: unknown;
}): RoomDayRule {
  const liveNewDay = normalizeRoomHour(
    args.settings?.room_new_day_hour,
    DEFAULT_ROOM_NEW_DAY_HOUR
  );
  const liveDouble = normalizeRoomHour(
    args.settings?.room_price_double_hour,
    DEFAULT_ROOM_DOUBLE_HOUR
  );
  return {
    newDayHour:
      args.stayNewDayHour === null || args.stayNewDayHour === undefined
        ? liveNewDay
        : normalizeRoomHour(args.stayNewDayHour, liveNewDay),
    doubleHour:
      args.stayDoubleHour === null || args.stayDoubleHour === undefined
        ? liveDouble
        : normalizeRoomHour(args.stayDoubleHour, liveDouble),
    shiftHours: normalizeShiftHours(args.shiftHours),
  };
}

/**
 * The instant night `n` of a stay ends — i.e. when the charge steps up to n+1.
 * `n = 1` is the first increment, so this is also "when does the price double".
 */
export function roomNightBoundary(checkIn: Date | string, n: number, rule: RoomDayRule): Date {
  const arrival = new Date(checkIn);
  // Which day did this guest arrive on? Shifting back by newDayHour is the same
  // move businessDate makes: with 6, a 03:00 arrival reads as the previous date.
  const roomDay = businessDate(arrival, rule.newDayHour);
  const at = businessDayStart(addBusinessDays(roomDay, n), rule.doubleHour);
  return new Date(at.getTime() + rule.shiftHours * 60 * 60 * 1000);
}

/**
 * Chargeable nights under the boundary rule.
 *
 * Always at least 1 — a part-night costs a whole one, because the room was
 * unavailable to anyone else for it. That is unchanged from the 24-hour rule.
 *
 * A checkout landing EXACTLY on a boundary is the earlier night, matching the
 * old rule's "24h is one night, not two": the boundary belongs to the period it
 * closes. Every night after the first is exactly 24h long (Nepal has a fixed
 * offset and no DST), so this is one division rather than a loop — a stay left
 * open for a year cannot turn the folio into a spin.
 */
export function roomNights(
  checkIn: Date | string,
  checkOut: Date | string,
  rule: RoomDayRule
): number {
  const to = new Date(checkOut).getTime();
  const first = roomNightBoundary(checkIn, 1, rule).getTime();
  if (!Number.isFinite(to) || !Number.isFinite(first)) return 1;
  const over = to - first;
  if (over <= 0) return 1;
  return 1 + Math.ceil(over / MS_PER_DAY);
}

export type BusinessPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "year"
  | "all"
  | "custom";

/**
 * Resolve a named period to [from, to) business-day bounds.
 *
 * This is the single resolver — Finance, Sales, Stock, Purchases, Credits,
 * Payroll and the dashboard all come through here, so "This Week" cannot mean
 * two different things on two different screens.
 */
export function businessPeriodBounds(
  period: BusinessPeriod,
  rule: DayRule,
  from?: string | null,
  to?: string | null,
  now: Date = new Date()
): { from: Date; to: Date } {
  // Anchor on the Nepal business day we're inside — see the header note.
  const today = businessToday(rule, now);
  const S = (dayStr: string) => businessDayStart(dayStr, rule);
  const tomorrow = S(addDaysStr(today, 1));

  switch (period) {
    case "today":
      return { from: S(today), to: tomorrow };
    case "yesterday":
      return { from: S(addDaysStr(today, -1)), to: S(today) };
    // Week/month/year run up to the end of the current business day, so today's
    // trading is included.
    case "week":
      return { from: S(addDaysStr(today, -6)), to: tomorrow };
    case "month":
      return { from: S(firstOfMonthStr(today)), to: tomorrow };
    case "year":
      return { from: S(firstOfYearStr(today)), to: tomorrow };
    case "all":
      return { from: new Date(0), to: tomorrow };
    case "custom": {
      const f = from ? S(from) : S(today);
      // `to` is a business day the user means to INCLUDE, so push to its end.
      const t = to ? S(addDaysStr(to, 1)) : tomorrow;
      // A `to` before `from` would give an empty or negative window; fall back to
      // the single day `from` names rather than reporting nothing.
      return { from: f, to: t > f ? t : new Date(f.getTime() + 24 * 60 * 60 * 1000) };
    }
  }
}

/**
 * The same resolution as `businessPeriodBounds`, but as YYYY-MM-DD STRINGS
 * rather than instants — for filtering a column that is itself a business-date
 * string (e.g. `report_deliveries.period_key`), not a timestamptz.
 *
 * Deliberately NOT `businessPeriodBounds(...).from.toISOString().slice(0, 10)`:
 * an instant's `toISOString()` reads back in UTC, which can name the WRONG Nepal
 * calendar day (Nepal is UTC+05:45 — the exact class of bug this whole file
 * exists to prevent, see the header note). Staying in string space the entire
 * way sidesteps that conversion instead of relying on getting it right twice.
 */
export function businessPeriodDateBounds(
  period: Exclude<BusinessPeriod, "yesterday" | "custom">,
  rule: DayRule,
  now: Date = new Date()
): { from: string | null; to: string | null } {
  const today = businessToday(rule, now);
  const tomorrow = addDaysStr(today, 1);

  switch (period) {
    case "today":
      return { from: today, to: tomorrow };
    case "week":
      return { from: addDaysStr(today, -6), to: tomorrow };
    case "month":
      return { from: firstOfMonthStr(today), to: tomorrow };
    case "year":
      return { from: firstOfYearStr(today), to: tomorrow };
    case "all":
      return { from: null, to: null };
  }
}

/** The instant `day` was closed early, if that close still applies (see `earlyCloseOf`). */
export function businessDayEarlyClose(day: string, rule: DayRule): Date | null {
  return earlyCloseOf(rule, day);
}

/**
 * The youngest a business day may be and still be closed early.
 *
 * With a closing hour of noon or later the evening after closing already belongs
 * to TOMORROW, so "Close today's business" pressed an hour after a 5 PM close
 * would end a day that started an hour ago — leaving a one-hour day and pushing
 * all of the next calendar day's trade onto the day after. No genuine early close
 * happens this soon after a day began; a 10 PM restaurant closing at 8 PM has
 * been open for 22 hours of business day.
 */
export const MIN_HOURS_BEFORE_EARLY_CLOSE = 6;

/** Whether "Close today's business" and "Reopen" are allowed at `now`. */
export function earlyCloseWindow(rule: BusinessDayRule, now: Date = new Date()) {
  const today = businessToday(rule, now);
  const previous = addDaysStr(today, -1);
  const startedAt = businessDayStart(today, rule);
  const scheduledStart = businessDayScheduledStart(today, rule);
  // Two floors, whichever is later: the day must have reached its normal start
  // (so a second tap right after an early close can't end the brand-new day too),
  // and it must have been open long enough to have trade worth closing.
  const minAge = new Date(startedAt.getTime() + MIN_HOURS_BEFORE_EARLY_CLOSE * 60 * 60 * 1000);
  const closableFrom = minAge > scheduledStart ? minAge : scheduledStart;
  const previousClosedEarlyAt = businessDayEarlyClose(previous, rule);
  return {
    today,
    previous,
    startedAt,
    closableFrom,
    canClose: now >= closableFrom,
    previousClosedEarlyAt,
    // Past its normal closing hour the closed day would have ended anyway, so a
    // reopen would change nothing but the history.
    canReopen: previousClosedEarlyAt !== null && now < scheduledStart,
  };
}
