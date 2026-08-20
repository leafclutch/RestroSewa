"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { PAYROLL_ACCESS, STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { resolveSplit } from "@/lib/payment-split";
import { periodBounds } from "@/lib/finance";
import type { FinancePeriod } from "@/lib/finance";
import {
  ATTENDANCE_FRACTION,
  EMPTY_PAYROLL_SUMMARY,
  monthKey,
  payrollError,
  payrollStatus,
} from "@/lib/payroll";
import type {
  AttendanceDay,
  AttendanceStatus,
  PayrollCycleRow,
  PayrollCycleSheet,
  PayrollHistoryMonth,
  PayrollRow,
  PayrollSheet,
  PayrollSummary,
  SalaryPayment,
} from "@/lib/payroll";

export type ActionResult = { error: string } | null;

const num = (v: unknown) => Number(v ?? 0);

/** A payroll month is always the 1st. Anything else is a caller bug, not input. */
function normaliseMonth(raw: string | null | undefined): string {
  if (!raw) return monthKey();
  const m = /^(\d{4})-(\d{2})/.exec(raw);
  if (!m) return monthKey();
  return `${m[1]}-${m[2]}-01`;
}

// ─── The payroll sheet for one month ──────────────────────────────────────────
// `payroll_month` returns every staff member ON payroll. The staff who are NOT
// yet on it are fetched alongside, because "who still needs a salary set" is the
// first question an admin opening this screen has — and the answer is the
// difference between the two lists.

const EMPTY_SHEET = (month: string): PayrollSheet => ({
  month,
  rows: [],
  notOnPayroll: [],
  totalSalary: 0,
  totalAdvance: 0,
  totalPaid: 0,
  totalRemaining: 0,
});

export async function getPayrollSheet(month?: string | null): Promise<PayrollSheet> {
  const ru = await getRestaurantUser();
  const key = normaliseMonth(month);
  if (!PAYROLL_ACCESS.canViewPayroll(ru)) return EMPTY_SHEET(key);

  const service = createServiceClient();

  const [sheetRes, staffRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("payroll_month", {
      p_restaurant_id: ru.restaurant_id,
      p_month: key,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_users")
      .select("id, display_name, title")
      .eq("restaurant_id", ru.restaurant_id)
      .is("deleted_at", null)
      .order("display_name"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: PayrollRow[] = ((sheetRes.data ?? []) as any[]).map((r) => {
    const salary = r.monthly_salary == null ? null : num(r.monthly_salary);
    const totalPaid = num(r.total_paid);
    return {
      staff_id: r.restaurant_user_id,
      display_name: r.display_name,
      title: r.title ?? null,
      is_active: !!r.is_active,
      joining_date: r.joining_date,
      salary_type: r.salary_type,
      monthly_salary: salary,
      advancePaid: num(r.advance_paid),
      salaryPaid: num(r.salary_paid),
      totalPaid,
      remaining: num(r.remaining),
      paymentCount: Number(r.payment_count ?? 0),
      status: payrollStatus(salary ?? 0, totalPaid),
    };
  });

  const onPayroll = new Set(rows.map((r) => r.staff_id));

  return {
    month: key,
    rows,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notOnPayroll: ((staffRes.data ?? []) as any[])
      .filter((s) => !onPayroll.has(s.id))
      .map((s) => ({ id: s.id, display_name: s.display_name, title: s.title ?? null })),
    totalSalary: rows.reduce((n, r) => n + (r.monthly_salary ?? 0), 0),
    totalAdvance: rows.reduce((n, r) => n + r.advancePaid, 0),
    totalPaid: rows.reduce((n, r) => n + r.totalPaid, 0),
    totalRemaining: rows.reduce((n, r) => n + r.remaining, 0),
  };
}

// ─── One staff member's history ───────────────────────────────────────────────
// Every month from the one they joined to the one we are in, each with the
// payments behind it. Assembled here rather than in SQL: the row count is one
// per staff-month (a couple of hundred at most, for years of history), and doing
// it in TypeScript keeps the month walk readable.
//
// A month with no payments still appears, as Unpaid — that is precisely the month
// an admin is looking for.

export async function getPayrollHistory(
  staffId: string
): Promise<PayrollHistoryMonth[]> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canViewPayroll(ru)) return [];

  const service = createServiceClient();

  // Tenant scope: the profile must be ours. Every query below is filtered by the
  // same restaurant_id, so a staff id from another restaurant returns nothing.
  const [profileRes, salaryRes, payRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("staff_payroll")
      .select("joining_date")
      .eq("restaurant_user_id", staffId)
      .eq("restaurant_id", ru.restaurant_id)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("staff_salaries")
      .select("monthly_salary, effective_from")
      .eq("restaurant_user_id", staffId)
      .eq("restaurant_id", ru.restaurant_id)
      .order("effective_from", { ascending: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("salary_payments")
      .select("id, salary_month, amount, kind, method, notes, created_at, paid_by")
      .eq("restaurant_user_id", staffId)
      .eq("restaurant_id", ru.restaurant_id)
      .order("created_at", { ascending: false }),
  ]);

  if (!profileRes.data) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revisions = ((salaryRes.data ?? []) as any[]).map((s) => ({
    from: String(s.effective_from).slice(0, 10),
    salary: num(s.monthly_salary),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPayments = (payRes.data ?? []) as any[];

  // Resolve "Paid by" in one round trip rather than one per payment.
  const payerIds = [...new Set(rawPayments.map((p) => p.paid_by).filter(Boolean))];
  const payerName = new Map<string, string>();
  if (payerIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: users } = await (service as any)
      .from("restaurant_users")
      .select("id, display_name")
      .in("id", payerIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of (users ?? []) as any[]) payerName.set(u.id, u.display_name);
  }

  const byMonth = new Map<string, SalaryPayment[]>();
  for (const p of rawPayments) {
    const key = String(p.salary_month).slice(0, 10);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push({
      id: p.id,
      salary_month: key,
      amount: num(p.amount),
      kind: p.kind,
      method: p.method,
      notes: p.notes ?? null,
      created_at: p.created_at,
      paid_by_name: p.paid_by ? payerName.get(p.paid_by) ?? null : null,
    });
  }

  // The salary in force for a month: the newest revision starting on or before
  // it. Same rule as `salary_for_month` in the database — the screen and the
  // ledger must agree on what someone was owed.
  const salaryFor = (month: string): number | null => {
    let found: number | null = null;
    for (const r of revisions) {
      if (r.from <= month) found = r.salary;
      else break;
    }
    return found;
  };

  const joined = String(profileRes.data.joining_date).slice(0, 10);
  const start = new Date(Number(joined.slice(0, 4)), Number(joined.slice(5, 7)) - 1, 1);
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 1);

  const months: PayrollHistoryMonth[] = [];
  for (let d = new Date(end); d >= start; d.setMonth(d.getMonth() - 1)) {
    const key = monthKey(d);
    const payments = byMonth.get(key) ?? [];
    const salary = salaryFor(key);
    const advancePaid = payments
      .filter((p) => p.kind === "advance")
      .reduce((n, p) => n + p.amount, 0);
    const salaryPaid = payments
      .filter((p) => p.kind === "salary")
      .reduce((n, p) => n + p.amount, 0);
    const totalPaid = advancePaid + salaryPaid;

    months.push({
      month: key,
      monthly_salary: salary,
      advancePaid,
      salaryPaid,
      totalPaid,
      remaining: Math.max((salary ?? 0) - totalPaid, 0),
      status: payrollStatus(salary ?? 0, totalPaid),
      payments,
    });
  }

  return months;
}

// ─── Set (or revise) a salary ─────────────────────────────────────────────────

export async function setStaffSalary(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to set salaries." };
  }

  const staffId = (formData.get("staff_id") as string) || "";
  const salaryRaw = (formData.get("monthly_salary") as string) || "";
  const joining = ((formData.get("joining_date") as string) || "").trim();
  const effective = normaliseMonth((formData.get("effective_from") as string) || null);

  const salary = salaryRaw === "" ? NaN : parseFloat(salaryRaw);

  if (!staffId) return { error: "Choose a staff member." };
  if (isNaN(salary) || salary < 0) return { error: "Enter a monthly salary of zero or more." };
  if (!joining) return { error: "Choose the date this staff member joined." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_staff_salary", {
    p_restaurant_id: ru.restaurant_id,
    p_staff_id: staffId,
    p_monthly_salary: salary,
    p_joining_date: joining,
    p_effective_from: effective,
    p_by: ru.id,
  });

  if (error) {
    return { error: payrollError(error.message ?? "", "Could not save the salary. Please try again.") };
  }

  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  return null;
}

// ─── Pay a salary, or an advance against it ───────────────────────────────────
// The amount check, the overpay guard and the insert all happen inside
// `record_salary_payment`, in one transaction — so two admins paying the same
// person at the same moment cannot both spend the same remaining balance.

export async function recordSalaryPayment(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to record salary payments." };
  }

  const staffId = (formData.get("staff_id") as string) || "";
  const month = normaliseMonth((formData.get("salary_month") as string) || null);
  const amountRaw = (formData.get("amount") as string) || "";
  const kind = ((formData.get("kind") as string) || "salary").toLowerCase();
  const method = ((formData.get("method") as string) || "cash").toLowerCase();
  const notes = ((formData.get("notes") as string) || "").trim();

  const amount = amountRaw === "" ? NaN : parseFloat(amountRaw);

  if (!staffId) return { error: "Staff member not found." };
  if (isNaN(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!["advance", "salary"].includes(kind)) {
    return { error: "Choose whether this is an advance or a salary payment." };
  }
  if (!["cash", "online", "mixed"].includes(method)) {
    return { error: "Choose how the money was paid — cash, online, or both." };
  }

  const split = resolveSplit(
    method,
    amount,
    formData.get("cash_amount") as string | null,
    formData.get("online_amount") as string | null
  );
  if (!split.ok) return { error: split.error };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("record_salary_payment", {
    p_restaurant_id: ru.restaurant_id,
    p_staff_id: staffId,
    p_month: month,
    p_amount: amount,
    p_kind: kind,
    p_method: method,
    p_notes: notes || null,
    p_by: ru.id,
    p_cash: split.cash,
    p_online: split.online,
  });

  if (error) {
    return {
      error: payrollError(error.message ?? "", "Could not record the payment. Please try again."),
    };
  }

  // The money has moved, so the finance sheet is stale too.
  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/dashboard");
  return null;
}

// ─── Staff Salary Expenses, for the Finance screen ────────────────────────────
// Gated on `view_finance`, NOT on payroll: this is the aggregate wage bill on the
// company's books, which is a different thing from what any individual earns.
// Someone who can read the finance report can see the total; only payroll holders
// can see whose salary it is.

export async function getPayrollSummary(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<PayrollSummary> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewFinance(ru)) return EMPTY_PAYROLL_SUMMARY;

  const { from, to } = periodBounds(
    params?.period ?? "today",
    ru.closingHour,
    params?.from,
    params?.to
  );

  const service = createServiceClient();
  // "Today" and "this month" are passed IN rather than derived in SQL: the
  // database would compute them with `now()` in its own timezone (UTC), which
  // disagreed with every other figure in the same row, and it has no way to know
  // the restaurant's closing hour.
  const today = periodBounds("today", ru.closingHour);
  const month = periodBounds("month", ru.closingHour);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("payroll_summary", {
    p_restaurant_id: ru.restaurant_id,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_today_from: today.from.toISOString(),
    p_month_from: month.from.toISOString(),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (Array.isArray(data) ? data[0] : data) as any;
  if (error || !row) return EMPTY_PAYROLL_SUMMARY;

  return {
    periodSalary: num(row.period_salary),
    periodAdvance: num(row.period_advance),
    periodTotal: num(row.period_total),
    periodCash: num(row.period_cash),
    periodOnline: num(row.period_online),
    todayTotal: num(row.today_total),
    monthTotal: num(row.month_total),
    allTimeTotal: num(row.all_time_total),
    allTimeAdvance: num(row.all_time_advance),
    outstandingLiability: num(row.outstanding_liability),
    staffOnPayroll: Number(row.staff_on_payroll ?? 0),
  };
}

// ─── The cycle sheet ──────────────────────────────────────────────────────────
// `payroll_cycle_sheet` is the cycle-aware replacement for `payroll_month`. It is
// VOLATILE on purpose: it materialises any missing cycle for anchored staff, so
// the outstanding-liability walk never finds a hole because nobody happened to
// open this screen that month.
//
// A staff member with no anchor still gets a row — their window is simply the
// calendar month, which is exactly what they did before cycles existed.

const EMPTY_CYCLE_SHEET = (asOf: string): PayrollCycleSheet => ({
  asOf,
  rows: [],
  notOnPayroll: [],
  totalPayable: 0,
  totalAdvance: 0,
  totalPaid: 0,
  totalRemaining: 0,
});

/** `YYYY-MM-DD` for today, in the server's own calendar — never via toISOString(). */
function todayKey(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

function normaliseDay(raw: string | null | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((raw ?? "").trim());
  return m ? m[1] : todayKey();
}

export async function getPayrollCycleSheet(
  asOf?: string | null
): Promise<PayrollCycleSheet> {
  const ru = await getRestaurantUser();
  const day = normaliseDay(asOf);
  if (!PAYROLL_ACCESS.canViewPayroll(ru)) return EMPTY_CYCLE_SHEET(day);

  const service = createServiceClient();

  const [sheetRes, staffRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("payroll_cycle_sheet", {
      p_restaurant_id: ru.restaurant_id,
      p_as_of: day,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_users")
      .select("id, display_name, title")
      .eq("restaurant_id", ru.restaurant_id)
      .is("deleted_at", null)
      .order("display_name"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: PayrollCycleRow[] = ((sheetRes.data ?? []) as any[]).map((r) => {
    const payable = num(r.payable_amount);
    const totalPaid = num(r.total_paid);
    return {
      staff_id: r.restaurant_user_id,
      display_name: r.display_name,
      title: r.title ?? null,
      is_active: !!r.is_active,
      joining_date: r.joining_date,
      cycle_id: r.cycle_id ?? null,
      cycle_kind: r.cycle_kind,
      cycle_start: r.cycle_start,
      cycle_end: r.cycle_end,
      totalDays: Number(r.total_days ?? 0),
      monthly_salary: r.monthly_salary == null ? null : num(r.monthly_salary),
      payableDays: num(r.payable_days),
      absentDays: num(r.absent_days),
      payableAmount: payable,
      advancePaid: num(r.advance_paid),
      salaryPaid: num(r.salary_paid),
      totalPaid,
      remaining: num(r.remaining),
      paymentCount: Number(r.payment_count ?? 0),
      attendanceVerified: !!r.attendance_verified,
      // Status is read against what the cycle OWES, not the headline salary —
      // otherwise a cycle with ten absences could never read as fully paid.
      status: payrollStatus(payable, totalPaid),
    };
  });

  const onPayroll = new Set(rows.map((r) => r.staff_id));

  return {
    asOf: day,
    rows,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notOnPayroll: ((staffRes.data ?? []) as any[])
      .filter((s) => !onPayroll.has(s.id))
      .map((s) => ({ id: s.id, display_name: s.display_name, title: s.title ?? null })),
    totalPayable: rows.reduce((n, r) => n + r.payableAmount, 0),
    totalAdvance: rows.reduce((n, r) => n + r.advancePaid, 0),
    totalPaid: rows.reduce((n, r) => n + r.totalPaid, 0),
    totalRemaining: rows.reduce((n, r) => n + r.remaining, 0),
  };
}

// ─── Attendance ───────────────────────────────────────────────────────────────
// Only exceptions are stored, so this returns the days that are NOT plain
// present days. Everything else in the window is present by omission.

export async function getCycleAttendance(
  staffId: string,
  from: string,
  to: string
): Promise<AttendanceDay[]> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canViewPayroll(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("staff_attendance_days")
    .select("work_date, status, day_fraction, notes")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("restaurant_user_id", staffId)
    .gte("work_date", normaliseDay(from))
    .lte("work_date", normaliseDay(to))
    .order("work_date");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((d) => ({
    work_date: d.work_date,
    status: d.status,
    day_fraction: num(d.day_fraction),
    notes: d.notes ?? null,
  }));
}

/**
 * Mark one day. Passing `present` clears the row rather than storing it, so the
 * table keeps holding exceptions only — which is what lets a future attendance
 * module write every day without changing any total.
 */
export async function setAttendanceDay(
  staffId: string,
  workDate: string,
  status: AttendanceStatus
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to change attendance." };
  }
  if (!staffId) return { error: "Choose a staff member." };

  const fraction = ATTENDANCE_FRACTION[status];
  if (fraction === undefined) return { error: "That is not a valid attendance status." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_attendance_day", {
    p_restaurant_id: ru.restaurant_id,
    p_staff_id: staffId,
    p_date: normaliseDay(workDate),
    p_status: status,
    p_fraction: fraction,
    p_notes: null,
    p_by: ru.id,
  });

  if (error) {
    return {
      error: payrollError(error.message ?? "", "Could not save that day. Please try again."),
    };
  }

  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  return null;
}

/** Sign off (or reopen) a cycle's attendance. A verified cycle refuses day edits. */
export async function verifyCycleAttendance(
  cycleId: string,
  verified: boolean
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to verify attendance." };
  }
  if (!cycleId) return { error: "That salary cycle no longer exists." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("verify_cycle_attendance", {
    p_restaurant_id: ru.restaurant_id,
    p_cycle_id: cycleId,
    p_verified: verified,
    p_by: ru.id,
  });

  if (error) {
    return {
      error: payrollError(error.message ?? "", "Could not update the cycle. Please try again."),
    };
  }

  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  return null;
}

// ─── The cycle anchor ─────────────────────────────────────────────────────────
// Moving an anchor only ever affects the FUTURE: `set_cycle_anchor` pushes the
// new start past any cycle that already exists, so history cannot be reshaped
// under a payment that has already been made.

export async function setCycleAnchor(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to set salary cycles." };
  }

  const staffId = (formData.get("staff_id") as string) || "";
  const anchor = ((formData.get("cycle_start") as string) || "").trim();
  const lengthRaw = ((formData.get("cycle_length") as string) || "30").trim();
  const length = parseInt(lengthRaw, 10);

  if (!staffId) return { error: "Choose a staff member." };
  if (!anchor) return { error: "Choose the date this staff member's salary cycle starts." };
  if (isNaN(length) || length < 1 || length > 366) {
    return { error: "A salary cycle must be between 1 and 366 days long." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("set_cycle_anchor", {
    p_restaurant_id: ru.restaurant_id,
    p_staff_id: staffId,
    p_anchor: normaliseDay(anchor),
    p_length: length,
  });

  if (error) {
    return {
      error: payrollError(error.message ?? "", "Could not save the salary cycle. Please try again."),
    };
  }

  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  return null;
}
