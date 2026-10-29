"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { PAYROLL_ACCESS, STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { resolveSplit } from "@/lib/payment-split";
import { getCurrencyFor } from "@/lib/currency-server";
import { periodBounds } from "@/lib/finance";
import { businessToday } from "@/lib/business-day";
import type { FinancePeriod } from "@/lib/finance";
import {
  ATTENDANCE_FRACTION,
  EMPTY_PAYROLL_SUMMARY,
  monthKey,
  shiftMonth,
  addDays,
  periodContaining,
  daysBetween,
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
  PayrollSetup,
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
// One entry per SALARY CYCLE, plus a calendar month for any stretch no cycle
// covers (before an anchor was set, or for staff never put on a cycle).
//
// It used to be months only, which read a different ledger from the sheet above
// it: payments filed against a cycle were bucketed by the month the cycle began,
// and "remaining" was the headline salary minus paid, ignoring absences. So a
// person's history and their row on the sheet could show two different balances
// for the same money. Each entry now owes what the sheet says it owes: a cycle's
// `cycle_payable_amount`, a month's salary scaled by `cycle_payable_days` (the
// very functions `payroll_cycle_sheet` uses).
//
// A period with no payments still appears, as Unpaid: that is precisely the one
// an admin is looking for.

const lastOfMonth = (first: string) => {
  const [y, m] = first.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${first.slice(0, 7)}-${String(d).padStart(2, "0")}`;
};

export async function getPayrollHistory(
  staffId: string
): Promise<PayrollHistoryMonth[]> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canViewPayroll(ru)) return [];

  const service = createServiceClient();

  // Tenant scope: the profile must be ours. Every query below is filtered by the
  // same restaurant_id, so a staff id from another restaurant returns nothing.
  const [profileRes, salaryRes, payRes, cycleRes] = await Promise.all([
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
      .select("id, salary_month, cycle_id, amount, kind, method, notes, created_at, paid_by")
      .eq("restaurant_user_id", staffId)
      .eq("restaurant_id", ru.restaurant_id)
      // Rota (advanced payout) wages share this table but belong to a pay period,
      // not to a salary month — they'd otherwise land in that month's history.
      .is("rota_period_id", null)
      .order("created_at", { ascending: false }),
    // `payable` is a PostgREST computed column: `cycle_payable_amount(salary_cycles)`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("salary_cycles")
      .select("id, cycle_start, cycle_end, monthly_salary_snapshot, payable:cycle_payable_amount")
      .eq("restaurant_user_id", staffId)
      .eq("restaurant_id", ru.restaurant_id)
      .order("cycle_start", { ascending: false }),
  ]);

  if (!profileRes.data) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revisions = ((salaryRes.data ?? []) as any[]).map((s) => ({
    from: String(s.effective_from).slice(0, 10),
    salary: num(s.monthly_salary),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPayments = (payRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cycles = (cycleRes.data ?? []) as any[];

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

  // A payment belongs to its cycle; one filed before cycles existed belongs to
  // its month. Same rule as `payroll_cycle_sheet`.
  const byCycle = new Map<string, SalaryPayment[]>();
  const byMonth = new Map<string, SalaryPayment[]>();
  for (const p of rawPayments) {
    const month = String(p.salary_month).slice(0, 10);
    const bucket = p.cycle_id ? byCycle : byMonth;
    const key: string = p.cycle_id ?? month;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push({
      id: p.id,
      salary_month: month,
      amount: num(p.amount),
      kind: p.kind,
      method: p.method,
      notes: p.notes ?? null,
      created_at: p.created_at,
      paid_by_name: p.paid_by ? payerName.get(p.paid_by) ?? null : null,
    });
  }

  // The salary a month is paid at: the one in force on its 1st, or — someone who
  // joined part-way through — their first salary that month. Same rule as
  // `salary_for_cycle` / `salary_for_month` in the database.
  const salaryFor = (month: string): number | null => {
    let found: number | null = null;
    for (const r of revisions) {
      if (r.from <= month) found = r.salary;
      else break;
    }
    if (found !== null) return found;
    const first = revisions.find((r) => r.from <= lastOfMonth(month));
    return first ? first.salary : null;
  };

  const entry = (
    key: string,
    isCycle: boolean,
    periodStart: string,
    periodEnd: string,
    salary: number | null,
    payable: number,
    payments: SalaryPayment[]
  ): PayrollHistoryMonth => {
    const advancePaid = payments
      .filter((p) => p.kind === "advance")
      .reduce((n, p) => n + p.amount, 0);
    const salaryPaid = payments
      .filter((p) => p.kind === "salary")
      .reduce((n, p) => n + p.amount, 0);
    const totalPaid = advancePaid + salaryPaid;
    return {
      month: key,
      isCycle,
      periodStart,
      periodEnd,
      monthly_salary: salary,
      payable,
      advancePaid,
      salaryPaid,
      totalPaid,
      remaining: Math.max(payable - totalPaid, 0),
      status: payrollStatus(payable, totalPaid),
      payments,
    };
  };

  const out: PayrollHistoryMonth[] = cycles.map((c) =>
    entry(
      c.id,
      true,
      String(c.cycle_start).slice(0, 10),
      String(c.cycle_end).slice(0, 10),
      num(c.monthly_salary_snapshot),
      num(c.payable),
      byCycle.get(c.id) ?? []
    )
  );

  // Calendar months: every month from joining to now that no cycle touches, and
  // any month still holding cycle-less payments (filed before an anchor was set).
  const overlapsCycle = (from: string, to: string) =>
    cycles.some(
      (c) => String(c.cycle_start).slice(0, 10) <= to && String(c.cycle_end).slice(0, 10) >= from
    );
  // Walk from the first salary's month, not the joining month: the joining date
  // is a record only, and nothing before the salary starts is owed or listed.
  const salaryStart = revisions[0]?.from ?? null;
  const firstMonth = salaryStart ? `${salaryStart.slice(0, 7)}-01` : "9999-12-01";
  const thisMonth = `${todayKey().slice(0, 7)}-01`;
  const months: string[] = [];
  for (let m = thisMonth; m >= firstMonth; m = shiftMonth(m, -1)) {
    if (byMonth.has(m) || !overlapsCycle(m, lastOfMonth(m))) months.push(m);
  }
  // A stray cycle-less payment outside the joined..now walk still has to show.
  for (const m of byMonth.keys()) if (!months.includes(m)) months.push(m);

  // Attendance applies to plain months too, exactly as on the sheet.
  const monthPayable = await Promise.all(
    months.map(async (m) => {
      const salary = salaryFor(m);
      if (salary == null) return { m, salary, payable: 0 };
      const end = lastOfMonth(m);
      const days = Number(end.slice(8, 10));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (service as any).rpc("cycle_payable_days", {
        p_staff_id: staffId,
        p_start: m,
        p_end: end,
        p_total: days,
      });
      const payableDays = data == null ? days : num(data);
      return { m, salary, payable: Math.round((salary * payableDays * 100) / days) / 100 };
    })
  );
  for (const { m, salary, payable } of monthPayable) {
    out.push(entry(m, false, m, lastOfMonth(m), salary, payable, byMonth.get(m) ?? []));
  }

  // Newest first, cycles and months interleaved by when they began.
  return out.sort((a, b) =>
    a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : 0
  );
}

// ─── Payroll setup: joining date, cycle and salary, as one ─────────────────────
// These used to be two unrelated forms (Edit salary on the row, Set salary cycle
// inside it) that each saved half the arrangement and showed figures the other
// did not update. One read, one save, one preview, and every figure on the sheet,
// in the cycle panel and in history comes from the same database rule
// (`salary_for_cycle`, see 20261012000000_payroll_setup_unit.sql).

/** Saved, with an optional note for the admin (e.g. a paid cycle kept its salary). */
export type SetupResult = { error: string } | { notice: string } | null;

const keptNotice = (kept: number) =>
  kept > 0
    ? `${kept} cycle${kept === 1 ? " was" : "s were"} already paid more than the new salary ` +
      `owes, so ${kept === 1 ? "it keeps" : "they keep"} the old salary.`
    : null;

export async function getPayrollSetup(staffId: string): Promise<PayrollSetup | null> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canViewPayroll(ru)) return null;
  const service = createServiceClient();

  const [profileRes, salaryRes, cycleRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("staff_payroll")
      .select("joining_date, cycle_anchor_date, cycle_length_days")
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
    // The cycles that hold something — a payment or verified attendance. The last
    // one's end is where a new cycle start gets pushed past.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("salary_cycles")
      .select("cycle_end, attendance_verified_at, salary_payments(count)")
      .eq("restaurant_user_id", staffId)
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  const p = profileRes.data;
  let lockedUntil: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of (cycleRes.data ?? []) as any[]) {
    const paid = Number(c.salary_payments?.[0]?.count ?? 0) > 0;
    if (!paid && !c.attendance_verified_at) continue;
    const end = String(c.cycle_end).slice(0, 10);
    if (!lockedUntil || end > lockedUntil) lockedUntil = end;
  }

  const today = todayKey();
  const anchor = p?.cycle_anchor_date ? String(p.cycle_anchor_date).slice(0, 10) : null;
  const length = Number(p?.cycle_length_days ?? 30);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revisions = ((salaryRes.data ?? []) as any[]).map((s) => ({
    effectiveFrom: String(s.effective_from).slice(0, 10),
    salary: num(s.monthly_salary),
  }));

  // Before the anchor (someone moved onto cycles after a paid month) the
  // "current" cycle is the first one, still to come.
  const currentCycle = anchor
    ? today >= anchor
      ? periodContaining(today, anchor, length)
      : { start: anchor, end: addDays(anchor, length - 1) }
    : null;
  const nextCycle = currentCycle
    ? { start: addDays(currentCycle.end, 1), end: addDays(currentCycle.end, length) }
    : null;

  // The rule `salary_for_cycle` applies: in force on the cycle's first day, else
  // the first salary at all.
  let salaryNow: number | null = null;
  if (currentCycle) {
    for (const r of revisions) if (r.effectiveFrom <= currentCycle.start) salaryNow = r.salary;
    if (salaryNow === null) {
      salaryNow = revisions.find((r) => r.effectiveFrom <= currentCycle.end)?.salary ?? null;
    }
  }

  return {
    staffId,
    joiningDate: p ? String(p.joining_date).slice(0, 10) : null,
    anchor,
    length,
    revisions,
    lockedUntil,
    today,
    currentCycle,
    nextCycle,
    salaryNow,
  };
}

/**
 * Save a staff member's payroll arrangement.
 *
 * ONE date drives the money: the SALARY START — the first salary and the first
 * cycle begin on it, and nothing before it is owed. The joining date is only a
 * record of when the person joined; it is saved on its own and changes nothing
 * else. After setup, a salary change starts at a cycle boundary only: "this
 * cycle" or "next cycle", never an arbitrary day, so the figure on the sheet
 * always matches the salary the cycle is paid at. Moving the salary start is a
 * correction, offered separately: while nothing has been paid or verified the
 * first salary moves with it; afterwards it only re-times cycles still to come.
 */
export async function savePayrollSetup(
  _prev: SetupResult,
  formData: FormData
): Promise<SetupResult> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to set salaries." };
  }

  const staffId = (formData.get("staff_id") as string) || "";
  const salaryRaw = ((formData.get("monthly_salary") as string) || "").trim();
  const applies = (formData.get("applies") as string) === "next" ? "next" : "current";
  const changeCycle = formData.get("change_cycle") === "1";
  const startRaw = ((formData.get("start_date") as string) || "").trim();
  const length = parseInt(((formData.get("cycle_length") as string) || "30").trim(), 10);
  const joiningRaw = ((formData.get("joining_date") as string) || "").trim();

  const salary = salaryRaw === "" ? NaN : parseFloat(salaryRaw);
  const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (!staffId) return { error: "Choose a staff member." };
  if (isNaN(salary) || salary < 0) return { error: "Enter a monthly salary of zero or more." };

  const before = await getPayrollSetup(staffId);
  if (!before) return { error: "That staff member no longer exists." };
  const isNew = before.joiningDate === null;

  // The joining date is a record only — never a payroll input.
  if (!isDay(joiningRaw)) return { error: "Choose the date this staff member joined." };
  if (joiningRaw > before.today) return { error: "The joining date cannot be in the future." };

  if (isNew || changeCycle) {
    if (!isDay(startRaw)) return { error: "Choose the salary start date." };
    if (startRaw > before.today) return { error: "The salary start cannot be in the future." };
    if (isNaN(length) || length < 1 || length > 366) {
      return { error: "A salary cycle must be between 1 and 366 days long." };
    }
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, args: Record<string, unknown>) => (service as any).rpc(fn, args);
  const fail = (e: { message?: string }, fallback: string) => ({
    error: payrollError(e.message ?? "", fallback),
  });
  let kept = 0;

  // ── Someone new: the salary start is their first cycle and first salary ──
  if (isNew) {
    const s = await rpc("set_staff_salary", {
      p_restaurant_id: ru.restaurant_id,
      p_staff_id: staffId,
      p_monthly_salary: salary,
      p_joining_date: joiningRaw,
      p_effective_from: startRaw,
      p_by: ru.id,
    });
    if (s.error) return fail(s.error, "Could not save the salary. Please try again.");
    const a = await rpc("set_cycle_anchor", {
      p_restaurant_id: ru.restaurant_id,
      p_staff_id: staffId,
      p_anchor: startRaw,
      p_length: length,
    });
    if (a.error) return fail(a.error, "Could not save the salary cycle. Please try again.");
  } else {
    // ── Joining date: a record, written on its own ──
    if (joiningRaw !== before.joiningDate) {
      const j = await rpc("set_joining_date", {
        p_restaurant_id: ru.restaurant_id,
        p_staff_id: staffId,
        p_date: joiningRaw,
      });
      if (j.error) return fail(j.error, "Could not save the joining date. Please try again.");
    }

    // ── Correct the salary start / cycle length ──
    if (changeCycle && (startRaw !== before.anchor || length !== before.length)) {
      const first = before.revisions[0];
      if (!before.lockedUntil && first && first.effectiveFrom !== startRaw) {
        // Nothing paid or verified yet: the salary start was simply wrong, so the
        // first salary moves with the cycle. The joining date is not touched.
        const u = await rpc("update_salary_revision", {
          p_restaurant_id: ru.restaurant_id,
          p_staff_id: staffId,
          p_old_from: first.effectiveFrom,
          p_new_from: startRaw,
          p_salary: first.salary,
          p_by: ru.id,
        });
        if (u.error) return fail(u.error, "Could not move the salary start. Please try again.");
        kept += Number(u.data ?? 0);
      }
      const a = await rpc("set_cycle_anchor", {
        p_restaurant_id: ru.restaurant_id,
        p_staff_id: staffId,
        p_anchor: startRaw,
        p_length: length,
      });
      if (a.error) return fail(a.error, "Could not save the salary cycle. Please try again.");
    }

    // ── Keep scheduled salaries on a cycle boundary ──
    // A raise already booked for "next cycle" was dated to the OLD next start.
    // Under new timing that date can land mid-cycle and silently slip a whole
    // cycle; move each future-dated salary to the first new boundary on/after it.
    let now = changeCycle ? await getPayrollSetup(staffId) : before;
    if (changeCycle && now?.anchor && now.currentCycle) {
      const { anchor, length: len, currentCycle } = now;
      for (const r of now.revisions) {
        if (r.effectiveFrom <= currentCycle.start) continue;
        const k = Math.ceil(daysBetween(anchor, r.effectiveFrom) / len);
        const boundary = addDays(anchor, k * len);
        if (boundary === r.effectiveFrom) continue;
        const u = await rpc("update_salary_revision", {
          p_restaurant_id: ru.restaurant_id,
          p_staff_id: staffId,
          p_old_from: r.effectiveFrom,
          p_new_from: boundary,
          p_salary: r.salary,
          p_by: ru.id,
        });
        if (u.error) return fail(u.error, "Could not re-time a scheduled salary. Please try again.");
      }
      now = await getPayrollSetup(staffId);
    }

    // ── Salary, from this cycle or the next ──
    // Read AFTER any cycle change, so "this cycle" means the cycle as it now is.
    const target = applies === "next" ? now?.nextCycle : now?.currentCycle;
    if (!now || !target) return { error: "Could not work out the salary cycle. Please try again." };
    const atTarget = (() => {
      let v: number | null = null;
      for (const r of now.revisions) if (r.effectiveFrom <= target.start) v = r.salary;
      return v;
    })();
    if (atTarget !== salary) {
      const s = await rpc("set_staff_salary", {
        p_restaurant_id: ru.restaurant_id,
        p_staff_id: staffId,
        p_monthly_salary: salary,
        p_joining_date: joiningRaw,
        p_effective_from: target.start,
        p_by: ru.id,
      });
      if (s.error) return fail(s.error, "Could not save the salary. Please try again.");
      kept += Number(s.data ?? 0);
    }
  }

  // Someone cannot have joined after their salary started: if the first salary
  // now begins before the recorded joining date, the record moves back to it
  // (same rule as migration 20261012500000). Pay is unaffected either way.
  const after = await getPayrollSetup(staffId);
  const firstSalary = after?.revisions[0]?.effectiveFrom;
  if (after?.joiningDate && firstSalary && firstSalary < after.joiningDate) {
    const j = await rpc("set_joining_date", {
      p_restaurant_id: ru.restaurant_id,
      p_staff_id: staffId,
      p_date: firstSalary,
    });
    if (j.error) return fail(j.error, "Could not save the joining date. Please try again.");
  }

  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  const note = keptNotice(kept);
  return note ? { notice: note } : null;
}

/** Correct a salary change's amount or start date. */
export async function updateSalaryRevision(
  staffId: string,
  oldFrom: string,
  newFrom: string,
  salary: number
): Promise<SetupResult> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to change salaries." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newFrom)) return { error: "Choose the date this salary starts." };
  if (!Number.isFinite(salary) || salary < 0) {
    return { error: "Enter a monthly salary of zero or more." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createServiceClient() as any).rpc("update_salary_revision", {
    p_restaurant_id: ru.restaurant_id,
    p_staff_id: staffId,
    p_old_from: oldFrom,
    p_new_from: newFrom,
    p_salary: salary,
    p_by: ru.id,
  });
  if (error) {
    return { error: payrollError(error.message ?? "", "Could not change the salary. Please try again.") };
  }
  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  const note = keptNotice(Number(data ?? 0));
  return note ? { notice: note } : null;
}

/** Remove a salary change; the one before it applies again. */
export async function deleteSalaryRevision(staffId: string, from: string): Promise<SetupResult> {
  const ru = await getRestaurantUser();
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to change salaries." };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createServiceClient() as any).rpc("delete_salary_revision", {
    p_restaurant_id: ru.restaurant_id,
    p_staff_id: staffId,
    p_from: from,
  });
  if (error) {
    return { error: payrollError(error.message ?? "", "Could not remove the salary. Please try again.") };
  }
  revalidatePath("/admin/staff");
  revalidatePath("/admin/finance");
  const note = keptNotice(Number(data ?? 0));
  return note ? { notice: note } : null;
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
  // The DAY the sheet is showing, not its month. `record_salary_payment` files the
  // payment against the cycle containing this date; cutting it to the 1st (as this
  // used to) filed any payment on a cycle that doesn't start on the 1st against
  // the PREVIOUS cycle, so an advance vanished from the row it was paid from and
  // only turned up inside that person's history. Anchor-less staff are unaffected:
  // the function truncates to the month itself for them.
  const day = normaliseDay((formData.get("salary_month") as string) || null);
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
    formData.get("online_amount") as string | null,
    (await getCurrencyFor(ru.restaurant_id)).money2
  );
  if (!split.ok) return { error: split.error };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("record_salary_payment", {
    p_restaurant_id: ru.restaurant_id,
    p_staff_id: staffId,
    p_month: day,
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
    ru.dayRule,
    params?.from,
    params?.to
  );

  const service = createServiceClient();
  // "Today" and "this month" are passed IN rather than derived in SQL: the
  // database would compute them with `now()` in its own timezone (UTC), which
  // disagreed with every other figure in the same row, and it has no way to know
  // the restaurant's closing hour.
  const today = periodBounds("today", ru.dayRule);
  const month = periodBounds("month", ru.dayRule);

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

/**
 * `YYYY-MM-DD` for today in NEPAL. It used to read the server's own calendar,
 * which on a UTC host is still yesterday until 05:45 Nepal time — so an early
 * morning payroll screen opened on the previous day (and the previous cycle).
 * A zero offset makes `businessToday` the plain Nepal calendar date.
 */
function todayKey(): string {
  return businessToday(0);
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

