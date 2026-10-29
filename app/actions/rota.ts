"use server";

// Advanced payout — rota-based hourly payroll. See lib/rota.ts for the maths and
// 20261014000000_rota_payroll.sql for the tables and the money functions.
//
// Every action re-checks two things for itself: the caller's payroll right, and that
// the restaurant is actually on advanced payout. A server action is a POST endpoint in
// its own right, so the screen hiding a button is never the guard.

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { PAYROLL_ACCESS } from "@/lib/permissions";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { getCurrencyFor } from "@/lib/currency-server";
import { resolveSplit } from "@/lib/payment-split";
import { businessToday } from "@/lib/business-day";
import { payrollError } from "@/lib/payroll";
import { ROTA_PERIOD_ANCHOR } from "@/lib/payout-mode";
import {
  addDays,
  hhmm,
  normaliseWeek,
  shiftPaidHours,
  shiftPay,
  toMinutes,
  weekDays,
} from "@/lib/rota";
import type {
  HourlyRate,
  RotaPayrollRow,
  RotaPayrollSheet,
  RotaShift,
  RotaStaff,
  RotaWeek,
  ShiftKind,
} from "@/lib/rota";

export type RotaResult = { error: string } | null;

const num = (v: unknown) => Number(v ?? 0);

function today(): string {
  return businessToday(0);
}

function isoDay(raw: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})$/.exec(String(raw ?? "").trim());
  return m ? m[1] : null;
}

/** The caller, if the restaurant is on advanced payout. */
async function rotaContext() {
  const ru = await getRestaurantUser();
  const config = await getRestaurantConfig(ru.restaurant_id);
  return { ru, config, advanced: config.payoutMode === "advanced" };
}

function revalidateRota() {
  revalidatePath("/admin/staff");
  revalidatePath("/employee/payroll");
  revalidatePath("/employee/rota");
  revalidatePath("/employee/dashboard");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapShift(r: any): RotaShift {
  return {
    id: r.id,
    staff_id: r.restaurant_user_id,
    date: r.shift_date,
    kind: r.kind as ShiftKind,
    role_code: r.role_code ?? null,
    planned_start: hhmm(r.planned_start),
    planned_end: hhmm(r.planned_end),
    actual_start: hhmm(r.actual_start),
    actual_end: hhmm(r.actual_end),
    break_minutes: num(r.break_minutes),
    break_paid: r.break_paid === true,
    paid_hours: r.paid_hours == null ? null : num(r.paid_hours),
    notes: r.notes ?? null,
  };
}

const SHIFT_COLUMNS =
  "id, restaurant_user_id, shift_date, kind, role_code, planned_start, planned_end, actual_start, actual_end, break_minutes, break_paid, paid_hours, notes";

/** Latest rate on or before `day`, per staff member, from rows ordered oldest first. */
function rateOn(
  rates: { restaurant_user_id: string; hourly_rate: number; effective_from: string }[],
  staffId: string,
  day: string
): number | null {
  let rate: number | null = null;
  for (const r of rates) {
    if (r.restaurant_user_id === staffId && r.effective_from <= day) rate = num(r.hourly_rate);
  }
  return rate;
}

// ─── The rota board: one week ─────────────────────────────────────────────────

export async function getRotaWeek(week?: string | null): Promise<RotaWeek | null> {
  const { ru, advanced } = await rotaContext();
  if (!advanced || !PAYROLL_ACCESS.canViewPayroll(ru)) return null;

  const now = today();
  const weekStart = normaliseWeek(week, now);
  const days = weekDays(weekStart);
  const weekEnd = days[6];

  const service = createServiceClient();
  const [staffRes, shiftRes, rateRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_users")
      .select("id, display_name, title, is_active")
      .eq("restaurant_id", ru.restaurant_id)
      .is("deleted_at", null)
      .order("display_name"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("rota_shifts")
      .select(SHIFT_COLUMNS)
      .eq("restaurant_id", ru.restaurant_id)
      .gte("shift_date", weekStart)
      .lte("shift_date", weekEnd),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("staff_hourly_rates")
      .select("restaurant_user_id, hourly_rate, effective_from")
      .eq("restaurant_id", ru.restaurant_id)
      .lte("effective_from", weekEnd)
      .order("effective_from", { ascending: true }),
  ]);

  if (staffRes.error || shiftRes.error || rateRes.error) {
    throw new Error(
      `getRotaWeek: ${(staffRes.error ?? shiftRes.error ?? rateRes.error).message}`
    );
  }

  const shifts = (shiftRes.data ?? []).map(mapShift);
  const withShifts = new Set(shifts.map((s: RotaShift) => s.staff_id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staff: RotaStaff[] = (staffRes.data ?? [])
    // An inactive member stays on a week they actually worked, and nowhere else.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((s: any) => s.is_active || withShifts.has(s.id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({
      id: s.id,
      display_name: s.display_name,
      title: s.title ?? null,
      is_active: s.is_active,
      hourly_rate: rateOn(rateRes.data ?? [], s.id, weekEnd),
    }));

  return { weekStart, days, today: now, staff, shifts };
}

// ─── Create / edit / clear one cell ───────────────────────────────────────────

export async function saveShift(_prev: RotaResult, formData: FormData): Promise<RotaResult> {
  const { ru, advanced } = await rotaContext();
  if (!advanced) return { error: "This restaurant is not on rota payout." };
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to edit the rota." };
  }

  const staffId = String(formData.get("staff_id") ?? "");
  const date = isoDay(formData.get("date"));
  const kind = String(formData.get("kind") ?? "shift") as ShiftKind;
  const role = String(formData.get("role_code") ?? "").trim().toUpperCase().slice(0, 12) || null;
  const plannedStart = hhmm(String(formData.get("planned_start") ?? "")) ;
  const plannedEnd = hhmm(String(formData.get("planned_end") ?? ""));
  const actualStart = hhmm(String(formData.get("actual_start") ?? ""));
  const actualEnd = hhmm(String(formData.get("actual_end") ?? ""));
  const breakRaw = String(formData.get("break_minutes") ?? "").trim();
  const breakMinutes = breakRaw === "" ? 0 : Number(breakRaw);
  const breakPaid = formData.get("break_paid") === "true";
  const paidRaw = String(formData.get("paid_hours") ?? "").trim();
  const paidHours = paidRaw === "" ? null : Number(paidRaw);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 300) || null;

  if (!staffId) return { error: "Staff member not found." };
  if (!date) return { error: "Choose a date." };
  if (!["shift", "holiday", "sick", "off"].includes(kind)) return { error: "Choose a shift type." };

  if (kind === "shift") {
    if (!plannedStart || !plannedEnd) return { error: "Enter the shift's start and end time." };
    if (toMinutes(plannedStart) === toMinutes(plannedEnd)) {
      return { error: "Start and end time can't be the same." };
    }
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 600) {
      return { error: "Break must be between 0 and 600 minutes." };
    }
    if ((actualStart && !actualEnd) || (!actualStart && actualEnd)) {
      return { error: "Enter both the actual start and end, or neither." };
    }
    if (actualStart && actualEnd && toMinutes(actualStart) === toMinutes(actualEnd)) {
      return { error: "Actual start and end can't be the same." };
    }
  }
  if (kind === "holiday" && paidHours != null && (isNaN(paidHours) || paidHours < 0 || paidHours > 24)) {
    return { error: "Holiday hours must be between 0 and 24." };
  }

  const service = createServiceClient();

  // The staff member must belong to this restaurant — the tenant check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: member } = await (service as any)
    .from("restaurant_users")
    .select("id")
    .eq("id", staffId)
    .eq("restaurant_id", ru.restaurant_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member) return { error: "Staff member not found." };

  const isShift = kind === "shift";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("rota_shifts").upsert(
    {
      restaurant_id: ru.restaurant_id,
      restaurant_user_id: staffId,
      shift_date: date,
      kind,
      role_code: isShift ? role : null,
      planned_start: isShift ? plannedStart : null,
      planned_end: isShift ? plannedEnd : null,
      actual_start: isShift ? actualStart : null,
      actual_end: isShift ? actualEnd : null,
      break_minutes: isShift ? breakMinutes : 0,
      break_paid: isShift && breakMinutes > 0 && breakPaid,
      paid_hours: kind === "holiday" ? paidHours : null,
      notes,
      created_by: ru.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "restaurant_user_id,shift_date" }
  );
  if (error) return { error: "Could not save the shift. Please try again." };

  revalidateRota();
  return null;
}

export async function deleteShift(staffId: string, date: string): Promise<RotaResult> {
  const { ru, advanced } = await rotaContext();
  if (!advanced) return { error: "This restaurant is not on rota payout." };
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to edit the rota." };
  }
  const day = isoDay(date);
  if (!day) return { error: "Choose a date." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("rota_shifts")
    .delete()
    .eq("restaurant_id", ru.restaurant_id)
    .eq("restaurant_user_id", staffId)
    .eq("shift_date", day);
  if (error) return { error: "Could not clear the shift. Please try again." };

  revalidateRota();
  return null;
}

/**
 * Copy last week's plan into this week. Only empty cells are filled — anything
 * already rostered this week is left alone — and actual times are NOT copied:
 * they record what happened, which last week cannot know about this one.
 */
export async function copyPreviousWeek(week: string): Promise<{ error: string } | { copied: number }> {
  const { ru, advanced } = await rotaContext();
  if (!advanced) return { error: "This restaurant is not on rota payout." };
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to edit the rota." };
  }

  const weekStart = normaliseWeek(week, today());
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekStart, -1);

  const service = createServiceClient();
  const [prevRes, curRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("rota_shifts")
      .select(SHIFT_COLUMNS)
      .eq("restaurant_id", ru.restaurant_id)
      .gte("shift_date", prevStart)
      .lte("shift_date", prevEnd),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("rota_shifts")
      .select("restaurant_user_id, shift_date")
      .eq("restaurant_id", ru.restaurant_id)
      .gte("shift_date", weekStart)
      .lte("shift_date", addDays(weekStart, 6)),
  ]);
  if (prevRes.error || curRes.error) return { error: "Could not read last week's rota." };

  const taken = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (curRes.data ?? []).map((r: any) => `${r.restaurant_user_id}|${r.shift_date}`)
  );
  const rows = (prevRes.data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => ({ ...r, shift_date: addDays(r.shift_date, 7) }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((r: any) => !taken.has(`${r.restaurant_user_id}|${r.shift_date}`))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => ({
      restaurant_id: ru.restaurant_id,
      restaurant_user_id: r.restaurant_user_id,
      shift_date: r.shift_date,
      kind: r.kind,
      role_code: r.role_code,
      planned_start: r.planned_start,
      planned_end: r.planned_end,
      break_minutes: r.break_minutes,
      break_paid: r.break_paid,
      paid_hours: r.paid_hours,
      notes: r.notes,
      created_by: ru.id,
    }));

  if (rows.length === 0) return { copied: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("rota_shifts").insert(rows);
  if (error) return { error: "Could not copy last week's rota. Please try again." };

  revalidateRota();
  return { copied: rows.length };
}

// ─── Hourly rates ─────────────────────────────────────────────────────────────

export async function getHourlyRates(staffId: string): Promise<HourlyRate[]> {
  const { ru, advanced } = await rotaContext();
  if (!advanced || !PAYROLL_ACCESS.canViewPayroll(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("staff_hourly_rates")
    .select("hourly_rate, effective_from")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("restaurant_user_id", staffId)
    .order("effective_from", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({ effectiveFrom: r.effective_from, rate: num(r.hourly_rate) }));
}

/**
 * Set (or replace) the rate from a date. A rate cannot start on or before the end
 * of a period someone has already been paid for — that would silently change what
 * a settled period owes.
 */
export async function setHourlyRate(
  staffId: string,
  rateRaw: string,
  fromRaw: string
): Promise<RotaResult> {
  const { ru, advanced } = await rotaContext();
  if (!advanced) return { error: "This restaurant is not on rota payout." };
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to set pay rates." };
  }

  const rate = rateRaw.trim() === "" ? NaN : Number(rateRaw);
  const from = isoDay(fromRaw);
  if (isNaN(rate) || rate < 0) return { error: "Enter an hourly rate of zero or more." };
  if (rate > 100000) return { error: "That hourly rate looks wrong — check the amount." };
  if (!from) return { error: "Choose the date the rate starts." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: member } = await (service as any)
    .from("restaurant_users")
    .select("id")
    .eq("id", staffId)
    .eq("restaurant_id", ru.restaurant_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!member) return { error: "Staff member not found." };

  // The latest period this person has a payment in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: paid } = await (service as any)
    .from("salary_payments")
    .select("rota_pay_periods!inner(period_end)")
    .eq("restaurant_user_id", staffId)
    .eq("restaurant_id", ru.restaurant_id)
    .not("rota_period_id", "is", null);
  const lockedUntil = (paid ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => p.rota_pay_periods?.period_end as string)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined;
  if (lockedUntil && from <= lockedUntil) {
    return {
      error: `Wages up to ${lockedUntil} are already paid. Start the new rate after that date.`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("staff_hourly_rates").upsert(
    {
      restaurant_id: ru.restaurant_id,
      restaurant_user_id: staffId,
      hourly_rate: rate,
      effective_from: from,
      created_by: ru.id,
    },
    { onConflict: "restaurant_user_id,effective_from" }
  );
  if (error) return { error: "Could not save the rate. Please try again." };

  revalidateRota();
  return null;
}

// ─── The pay sheet for one period ─────────────────────────────────────────────

export async function getRotaPayrollSheet(day?: string | null): Promise<RotaPayrollSheet | null> {
  const { ru, config, advanced } = await rotaContext();
  if (!advanced || !PAYROLL_ACCESS.canViewPayroll(ru)) return null;

  const now = today();
  const asOf = isoDay(day) ?? now;
  // Don't open a period in the future — nobody can be paid for it yet.
  const target = asOf > now ? now : asOf;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: periodId, error: pErr } = await (service as any).rpc("ensure_rota_period", {
    p_restaurant_id: ru.restaurant_id,
    p_date: target,
    p_frequency: config.rotaPayPeriod,
    p_anchor: ROTA_PERIOD_ANCHOR,
  });
  if (pErr || !periodId) throw new Error(`getRotaPayrollSheet: ${pErr?.message ?? "no period"}`);

  const [periodRes, sheetRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("rota_pay_periods")
      .select("id, period_start, period_end, frequency")
      .eq("id", periodId)
      .single(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).rpc("rota_payroll_sheet", {
      p_restaurant_id: ru.restaurant_id,
      p_period_id: periodId,
    }),
  ]);
  if (periodRes.error || sheetRes.error) {
    throw new Error(`getRotaPayrollSheet: ${(periodRes.error ?? sheetRes.error).message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: RotaPayrollRow[] = (sheetRes.data ?? []).map((r: any) => {
    const gross = num(r.gross);
    const totalPaid = num(r.total_paid);
    return {
      staff_id: r.restaurant_user_id,
      display_name: r.display_name,
      title: r.title ?? null,
      is_active: r.is_active,
      shiftCount: num(r.shift_count),
      hours: num(r.hours),
      rate: r.rate_now == null ? null : num(r.rate_now),
      gross,
      advancePaid: num(r.advance_paid),
      salaryPaid: num(r.salary_paid),
      totalPaid,
      // Negative when a shift was cut after it was paid — shown as "overpaid".
      remaining: Math.round((gross - totalPaid) * 100) / 100,
      paymentCount: num(r.payment_count),
    };
  });

  const sum = (f: (r: RotaPayrollRow) => number) =>
    Math.round(rows.reduce((a, r) => a + f(r), 0) * 100) / 100;

  return {
    periodId,
    periodStart: periodRes.data.period_start,
    periodEnd: periodRes.data.period_end,
    frequency: periodRes.data.frequency,
    today: now,
    rows,
    totalHours: sum((r) => r.hours),
    totalGross: sum((r) => r.gross),
    totalPaid: sum((r) => r.totalPaid),
    totalRemaining: sum((r) => Math.max(r.remaining, 0)),
  };
}

// ─── Pay wages ────────────────────────────────────────────────────────────────

export async function recordRotaPayment(
  _prev: RotaResult,
  formData: FormData
): Promise<RotaResult> {
  const { ru, advanced } = await rotaContext();
  if (!advanced) return { error: "This restaurant is not on rota payout." };
  if (!PAYROLL_ACCESS.canManagePayroll(ru)) {
    return { error: "You don't have permission to record wage payments." };
  }

  const staffId = String(formData.get("staff_id") ?? "");
  const periodId = String(formData.get("period_id") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const kind = String(formData.get("kind") ?? "salary").toLowerCase();
  const method = String(formData.get("method") ?? "cash").toLowerCase();
  const notes = String(formData.get("notes") ?? "").trim();
  const amount = amountRaw === "" ? NaN : parseFloat(amountRaw);

  if (!staffId) return { error: "Staff member not found." };
  if (!periodId) return { error: "Pay period not found." };
  if (isNaN(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!["advance", "salary"].includes(kind)) return { error: "Choose wages or an advance." };
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
  const { error } = await (service as any).rpc("record_rota_payment", {
    p_restaurant_id: ru.restaurant_id,
    p_staff_id: staffId,
    p_period_id: periodId,
    p_amount: amount,
    p_kind: kind,
    p_method: method,
    p_notes: notes || null,
    p_by: ru.id,
    p_cash: split.cash,
    p_online: split.online,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("ALREADY_PAID")) return { error: "This period's wages are already fully paid." };
    if (msg.includes("AMOUNT_EXCEEDS_REMAINING")) {
      return { error: "That is more than the wages still owed for this period. Reduce the amount." };
    }
    return { error: payrollError(msg, "Could not record the payment. Please try again.") };
  }

  revalidateRota();
  revalidatePath("/admin/finance");
  revalidatePath("/admin/dashboard");
  return null;
}

// ─── My Rota (any staff member, own shifts only) ──────────────────────────────

export type MyRota = {
  weekStart: string;
  days: string[];
  today: string;
  shifts: RotaShift[];
  totalHours: number;
  /** Only for someone who may see pay — never for a regular staff member. */
  estimatedPay: number | null;
};

export async function getMyRota(week?: string | null): Promise<MyRota | null> {
  const { ru, advanced } = await rotaContext();
  if (!advanced) return null;

  const now = today();
  const weekStart = normaliseWeek(week, now);
  const days = weekDays(weekStart);

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any)
    .from("rota_shifts")
    .select(SHIFT_COLUMNS)
    .eq("restaurant_id", ru.restaurant_id)
    .eq("restaurant_user_id", ru.id)
    .gte("shift_date", weekStart)
    .lte("shift_date", days[6])
    .order("shift_date");
  if (error) throw new Error(`getMyRota: ${error.message}`);

  const shifts = (data ?? []).map(mapShift);
  const totalHours =
    Math.round(shifts.reduce((a: number, s: RotaShift) => a + shiftPaidHours(s), 0) * 100) / 100;

  let estimatedPay: number | null = null;
  if (PAYROLL_ACCESS.canViewPayroll(ru)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rates } = await (service as any)
      .from("staff_hourly_rates")
      .select("restaurant_user_id, hourly_rate, effective_from")
      .eq("restaurant_user_id", ru.id)
      .lte("effective_from", days[6])
      .order("effective_from", { ascending: true });
    estimatedPay = shifts.reduce(
      (a: number, s: RotaShift) =>
        a + shiftPay(shiftPaidHours(s), rateOn(rates ?? [], ru.id, s.date) ?? 0),
      0
    );
  }

  return { weekStart, days, today: now, shifts, totalHours, estimatedPay };
}
