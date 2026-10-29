// Rota (advanced payout) vocabulary and maths. Shared by the admin board, the
// payroll sheet and the staff "My Rota" page so every screen agrees on hours.
//
// Hours mirror `rota_shift_hours` in 20261014000000_rota_payroll.sql exactly — the
// database decides what is owed when a payment is recorded, this decides what the
// screen shows, and the two must not drift.

import { addDays, daysBetween } from "./payroll.ts";

export type ShiftKind = "shift" | "holiday" | "sick" | "off";

export const SHIFT_KIND_LABEL: Record<ShiftKind, string> = {
  shift: "Shift",
  holiday: "Holiday",
  sick: "Sick",
  off: "Day off",
};

/** Role codes off the paper rota. Free text is allowed; these are the quick picks. */
export const ROLE_PRESETS = ["GM", "AM", "DM", "TL", "TM"] as const;

export const ROLE_HINT: Record<string, string> = {
  GM: "General Manager",
  AM: "Assistant Manager",
  DM: "Duty Manager",
  TL: "Team Leader",
  TM: "Team Member",
};

export type RotaShift = {
  id: string;
  staff_id: string;
  /** The day the shift STARTS, `YYYY-MM-DD`. */
  date: string;
  kind: ShiftKind;
  role_code: string | null;
  /** `HH:MM`, or null for leave/off. */
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  break_minutes: number;
  /** A paid break stays in the paid hours; an unpaid one (the default) comes off. */
  break_paid: boolean;
  /** Holiday only: hours the day is paid at. */
  paid_hours: number | null;
  notes: string | null;
};

/** `"17:00:00"` / `"17:00"` → minutes since midnight. NaN for anything else. */
export function toMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

/** `"17:00:00"` → `"17:00"`. */
export function hhmm(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/**
 * Worked minutes between two clock times, less the unpaid break. An end at or
 * before the start means the shift ran past midnight (17:00 → 01:30 is 8½ hours).
 * Never negative.
 */
export function shiftMinutes(start: string, end: string, breakMinutes = 0): number {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  const span = e > s ? e - s : e - s + 1440;
  return Math.max(span - (breakMinutes || 0), 0);
}

/** Does this shift finish on the following calendar day? */
export function crossesMidnight(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  return toMinutes(end) <= toMinutes(start);
}

/** The hours a rota entry is paid for. Actual times win over planned; a paid break is not deducted. */
export function shiftPaidHours(
  s: Pick<
    RotaShift,
    "kind" | "planned_start" | "planned_end" | "actual_start" | "actual_end" | "break_minutes" | "paid_hours"
  > & { break_paid?: boolean }
): number {
  if (s.kind === "holiday") return s.paid_hours ?? 0;
  if (s.kind !== "shift") return 0;
  const start = s.actual_start ?? s.planned_start;
  const end = s.actual_end ?? s.planned_end;
  if (!start || !end) return 0;
  const unpaidBreak = s.break_paid ? 0 : s.break_minutes;
  return Math.round((shiftMinutes(start, end, unpaidBreak) / 60) * 10000) / 10000;
}

/** "30m unpaid break" / "30m paid break" — empty when there is no break. */
export function breakLabel(s: Pick<RotaShift, "break_minutes" | "break_paid">): string {
  if (!s.break_minutes) return "";
  return `${s.break_minutes}m ${s.break_paid ? "paid" : "unpaid"} break`;
}

/** Money for one shift, rounded to the cent ONCE — the same rule the SQL uses. */
export function shiftPay(hours: number, rate: number): number {
  return Math.round(hours * rate * 100) / 100;
}

/** 8.5 → "8h 30m"; 8 → "8h". */
export function hoursLabel(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "TL 16:00–01:30" — the paper rota's own shorthand. */
export function formatShift(
  s: Pick<RotaShift, "kind" | "role_code" | "planned_start" | "planned_end" | "actual_start" | "actual_end">
): string {
  if (s.kind !== "shift") return SHIFT_KIND_LABEL[s.kind];
  const start = hhmm(s.actual_start ?? s.planned_start);
  const end = hhmm(s.actual_end ?? s.planned_end);
  const time = start && end ? `${start}–${end}` : "";
  return [s.role_code, time].filter(Boolean).join(" ");
}

// ─── Weeks ────────────────────────────────────────────────────────────────────
// Rota weeks run Monday → Sunday, like the paper rota. Plain `YYYY-MM-DD` maths
// via payroll.ts — never a local Date, which shifts across the date line.

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The Monday on or before `iso`. */
export function weekStartOf(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** The seven dates of the week starting `monday`. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 19 Oct" */
export function dayHeader(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAY_SHORT[weekdayIndex(iso)]} ${d} ${MONTH_SHORT[m - 1]}`;
}

/** "19 Oct – 25 Oct 2026" */
export function rangeLabel(start: string, end: string): string {
  const [, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return `${sd} ${MONTH_SHORT[sm - 1]} – ${ed} ${MONTH_SHORT[em - 1]} ${ey}`;
}

/** Normalise any date to its week's Monday; today's week when missing/invalid. */
export function normaliseWeek(raw: string | null | undefined, today: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((raw ?? "").trim());
  return weekStartOf(m ? m[1] : today);
}

export { addDays, daysBetween };

// ─── Shapes the screens read ──────────────────────────────────────────────────

export type RotaStaff = {
  id: string;
  display_name: string;
  title: string | null;
  is_active: boolean;
  /** Rate in force at the end of the week shown; null when never set. */
  hourly_rate: number | null;
};

export type RotaWeek = {
  weekStart: string;
  days: string[];
  today: string;
  staff: RotaStaff[];
  shifts: RotaShift[];
};

export type HourlyRate = { effectiveFrom: string; rate: number };

export type RotaPayrollRow = {
  staff_id: string;
  display_name: string;
  title: string | null;
  is_active: boolean;
  shiftCount: number;
  hours: number;
  rate: number | null;
  gross: number;
  advancePaid: number;
  salaryPaid: number;
  totalPaid: number;
  remaining: number;
  paymentCount: number;
};

export type RotaPayrollSheet = {
  periodId: string | null;
  periodStart: string;
  periodEnd: string;
  frequency: string;
  today: string;
  rows: RotaPayrollRow[];
  totalHours: number;
  totalGross: number;
  totalPaid: number;
  totalRemaining: number;
};
