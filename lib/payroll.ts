// Shared payroll vocabulary and month maths. Lives outside the "use server"
// action file so the Staff screen, the Finance screen and the CSV export all
// resolve a payroll month identically.

/** Where a staff member stands for one month. Derived — never stored. */
export type PayrollStatus = "unpaid" | "partial" | "paid";

export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  unpaid: "Unpaid",
  partial: "Partially Paid",
  paid: "Paid",
};

export const PAYROLL_STATUS_COLOR: Record<PayrollStatus, string> = {
  unpaid: "#dc2626",
  partial: "#f97316",
  paid: "#1a7a4a",
};

/**
 * Read off the two numbers that actually exist. The same 0.005 rounding slack
 * the rest of the codebase uses, so ₹24,999.999 of a ₹25,000 salary reads as
 * Paid rather than leaving a phantom third of a paisa outstanding.
 */
export function payrollStatus(salary: number, paid: number): PayrollStatus {
  if (paid <= 0.005) return "unpaid";
  if (paid >= salary - 0.005) return "paid";
  return "partial";
}

/** An advance is money paid before the month is up; a salary settles it. */
export type PaymentKind = "advance" | "salary";

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  advance: "Advance",
  salary: "Salary",
};

/** Only the two ways money can actually leave the business. */
export type PayMethod = "cash" | "online" | "mixed";

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: "Cash",
  online: "Online",
  mixed: "Cash + Online",
};

// ─── Months ───────────────────────────────────────────────────────────────────
// A payroll month is identified by the 1st of it, as `YYYY-MM-01`. Formatting it
// by hand rather than via toISOString() keeps it in the server's local calendar —
// toISOString() would shift a month boundary across the date line for anyone east
// of UTC, silently filing a payment under the wrong month.

/** `YYYY-MM-01` for the month containing `d`. */
export function monthKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** Step a `YYYY-MM-01` key forwards or backwards by whole months. */
export function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + by, 1));
}

/** "July 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

/** True when `key` is the month we are currently in — used to stop "next month". */
export function isCurrentMonth(key: string): boolean {
  return key === monthKey();
}

// ─── Salary cycles ────────────────────────────────────────────────────────────
// A cycle is an INDIVIDUAL fixed-length window — 30 days by default — anchored on
// a date the admin picks, not on the calendar. Anchor it to the 15th and it runs
// 15 Aug → 13 Sep, then 14 Sep → 13 Oct, drifting away from the months as it must.
//
// All of it is plain day arithmetic, so February, 31-day months and leap years
// never enter the calculation: a 30-day cycle is 30 days in every year there is.
//
// The maths deliberately does NOT round-trip through a local `Date`. A local date
// shifts at midnight in the server's zone, which for anyone east of UTC files the
// first and last day of a cycle under the wrong window. Everything below works in
// UTC epochs and formats back with UTC getters, so a date is only ever a date.

export const DEFAULT_CYCLE_DAYS = 30;

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → UTC epoch for midnight that day. */
function dayEpoch(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** UTC epoch → `YYYY-MM-DD`. */
function isoDay(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getUTCDate()).padStart(2, "0")}`
  );
}

/** Step a calendar date by whole days. Exact across months, years and DST. */
export function addDays(iso: string, n: number): string {
  return isoDay(dayEpoch(iso) + n * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayEpoch(to) - dayEpoch(from)) / DAY_MS);
}

/** One salary period. `end` is INCLUSIVE — the last day the staff member is paid for. */
export type Cycle = {
  /** 0 is the cycle beginning on the anchor itself; negative is before it. */
  index: number;
  start: string;
  end: string;
  totalDays: number;
};

/** The `index`-th cycle from `anchor`. */
export function cycleFor(
  anchor: string,
  index: number,
  length = DEFAULT_CYCLE_DAYS
): Cycle {
  const start = addDays(anchor, index * length);
  return { index, start, end: addDays(start, length - 1), totalDays: length };
}

/**
 * The cycle containing `date`.
 *
 * A date before the anchor returns a NEGATIVE index rather than clamping to 0.
 * Clamping would quietly fold days from before someone joined into their first
 * cycle and pay for them.
 */
export function cycleContaining(
  anchor: string,
  date: string,
  length = DEFAULT_CYCLE_DAYS
): Cycle {
  return cycleFor(anchor, Math.floor(daysBetween(anchor, date) / length), length);
}

/**
 * Payable days for a cycle, given the attendance exceptions inside it.
 *
 * `fractions` maps `YYYY-MM-DD` → how much of that day is payable: 1 present,
 * 0 absent, 0.5 a half day. **A day with no entry counts as fully present**, so
 * only exceptions need storing — and a future attendance module that records
 * every day explicitly, present ones included, produces the same totals.
 *
 * Days outside the window are ignored, so a neighbouring cycle cannot bleed in.
 */
export function payableDays(
  cycle: Cycle,
  fractions: Record<string, number>
): number {
  let days = cycle.totalDays;
  for (const [day, fraction] of Object.entries(fractions)) {
    // ISO dates compare correctly as strings, so no parsing is needed here.
    if (day < cycle.start || day > cycle.end) continue;
    days -= 1 - fraction;
  }
  // Guard float drift from repeated 0.5s; days are never finer than that.
  return Math.round(days * 1000) / 1000;
}

/**
 * What one day of a cycle is worth. Deliberately NOT rounded: rounding here to
 * paisa would make a fully-worked ₹25,000 cycle pay ₹24,999.90 and leave a
 * phantom balance owing forever. Round once, at the end, in `payableAmount`.
 */
export function dailyRate(
  monthlySalary: number,
  length = DEFAULT_CYCLE_DAYS
): number {
  if (!length) return 0;
  return monthlySalary / length;
}

/** The money a cycle actually owes, rounded to paisa exactly once. */
export function payableAmount(rate: number, days: number): number {
  return Math.round(rate * days * 100) / 100;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "15 Aug 2026". Formatted by hand so the output cannot vary with the host's ICU. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** "15 Aug 2026 → 13 Sep 2026" */
export function cycleLabel(cycle: Cycle): string {
  return `${dayLabel(cycle.start)} → ${dayLabel(cycle.end)}`;
}

// ─── The shapes the screens read ──────────────────────────────────────────────

/** One staff member's standing for one month — the Payroll sheet row. */
export type PayrollRow = {
  staff_id: string;
  display_name: string;
  title: string | null;
  is_active: boolean;
  joining_date: string;
  salary_type: string;
  /** null ⇒ no salary was in force for this month (nothing is owed for it). */
  monthly_salary: number | null;
  advancePaid: number;
  salaryPaid: number;
  totalPaid: number;
  remaining: number;
  paymentCount: number;
  status: PayrollStatus;
};

/** A single payment — an advance or a settlement. */
export type SalaryPayment = {
  id: string;
  salary_month: string;
  amount: number;
  kind: PaymentKind;
  method: PayMethod;
  notes: string | null;
  created_at: string;
  paid_by_name: string | null;
};

/** One month of a staff member's payroll history, with the payments behind it. */
export type PayrollHistoryMonth = {
  month: string;
  monthly_salary: number | null;
  advancePaid: number;
  salaryPaid: number;
  totalPaid: number;
  remaining: number;
  status: PayrollStatus;
  payments: SalaryPayment[];
};

/** Staff who have no payroll profile yet — offered in the "Set salary" picker. */
export type UnpaidStaff = {
  id: string;
  display_name: string;
  title: string | null;
};

/** The Staff → Payroll screen, for one month. */
export type PayrollSheet = {
  month: string;
  rows: PayrollRow[];
  /** Staff the Super Admin has created who are not yet on payroll. */
  notOnPayroll: UnpaidStaff[];
  totalSalary: number;
  totalAdvance: number;
  totalPaid: number;
  totalRemaining: number;
};

// ─── The cycle sheet ──────────────────────────────────────────────────────────

/**
 * `calendar_month` is what a staff member with no anchor still does — the real
 * month, of its real length. `rolling_30` is an anchored fixed-length cycle. The
 * two are kept distinct so history reads honestly rather than pretending July
 * was ever a 30-day window.
 */
export type CycleKind = "calendar_month" | "rolling_30";

export type AttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "leave"
  | "holiday";

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  leave: "Leave",
  holiday: "Holiday",
};

/**
 * How much of a day's pay each status earns. Kept beside the label rather than
 * derived from it, because a future 'leave' may be paid at one restaurant and
 * unpaid at another — only this number decides money.
 */
export const ATTENDANCE_FRACTION: Record<AttendanceStatus, number> = {
  present: 1,
  absent: 0,
  half_day: 0.5,
  leave: 0,
  holiday: 1,
};

/** One day that is NOT a plain present day. Absent rows are the only ones stored. */
export type AttendanceDay = {
  work_date: string;
  status: AttendanceStatus;
  day_fraction: number;
  notes: string | null;
};

/** One staff member's standing for the cycle they are currently in. */
export type PayrollCycleRow = {
  staff_id: string;
  display_name: string;
  title: string | null;
  is_active: boolean;
  joining_date: string;
  /** null ⇒ derived calendar month; this staff member has no anchor yet. */
  cycle_id: string | null;
  cycle_kind: CycleKind;
  cycle_start: string;
  cycle_end: string;
  totalDays: number;
  /** null ⇒ no salary in force for this cycle (nothing is owed for it). */
  monthly_salary: number | null;
  payableDays: number;
  absentDays: number;
  /** salary × payable ÷ total, rounded once. THIS is what is owed, not the salary. */
  payableAmount: number;
  advancePaid: number;
  salaryPaid: number;
  totalPaid: number;
  remaining: number;
  paymentCount: number;
  attendanceVerified: boolean;
  status: PayrollStatus;
};

export type PayrollCycleSheet = {
  asOf: string;
  rows: PayrollCycleRow[];
  notOnPayroll: UnpaidStaff[];
  totalPayable: number;
  totalAdvance: number;
  totalPaid: number;
  totalRemaining: number;
};

/** The Staff Salary Expenses block on the Finance screen. */
export type PayrollSummary = {
  /** Money out in the selected period, by what it was and how it left. */
  periodSalary: number;
  periodAdvance: number;
  periodTotal: number;
  periodCash: number;
  periodOnline: number;
  /** Fixed windows the brief asks for by name, whatever period is selected. */
  todayTotal: number;
  monthTotal: number;
  allTimeTotal: number;
  allTimeAdvance: number;
  /** Accrued but unpaid salary, across every month since each person joined. */
  outstandingLiability: number;
  staffOnPayroll: number;
};

export const EMPTY_PAYROLL_SUMMARY: PayrollSummary = {
  periodSalary: 0,
  periodAdvance: 0,
  periodTotal: 0,
  periodCash: 0,
  periodOnline: 0,
  todayTotal: 0,
  monthTotal: 0,
  allTimeTotal: 0,
  allTimeAdvance: 0,
  outstandingLiability: 0,
  staffOnPayroll: 0,
};

/** Maps an RPC error to something an admin can act on. */
export const PAYROLL_ERRORS: Record<string, string> = {
  INVALID_AMOUNT: "Enter an amount greater than zero.",
  INVALID_KIND: "Choose whether this is an advance or a salary payment.",
  INVALID_METHOD: "Choose how the money was paid — cash or online.",
  INVALID_SALARY: "The monthly salary cannot be negative.",
  JOINING_DATE_REQUIRED: "Choose the date this staff member joined.",
  STAFF_NOT_FOUND: "That staff member no longer exists.",
  PAYROLL_NOT_SET: "Set this staff member's salary before paying them.",
  SALARY_NOT_SET: "No salary was in force for that month. Set the salary first.",
  ALREADY_PAID: "This month's salary is already fully paid.",
  AMOUNT_EXCEEDS_REMAINING:
    "That is more than the remaining salary for this month. Reduce the amount.",
  ANCHOR_REQUIRED: "Choose the date this staff member's salary cycle starts.",
  INVALID_CYCLE_LENGTH: "A salary cycle must be between 1 and 366 days long.",
  INVALID_FRACTION: "That is not a valid part of a day.",
  CYCLE_NOT_FOUND: "That salary cycle no longer exists.",
  CYCLE_OVERLAP:
    "That start date falls inside a cycle that already exists. Pick a later date.",
  CYCLE_VERIFIED:
    "This cycle's attendance is verified. Reopen it before changing a day.",
};

export function payrollError(message: string, fallback: string): string {
  for (const [code, text] of Object.entries(PAYROLL_ERRORS)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}
