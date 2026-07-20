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
};

export function payrollError(message: string, fallback: string): string {
  for (const [code, text] of Object.entries(PAYROLL_ERRORS)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}
