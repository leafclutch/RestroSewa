"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { businessPeriodBounds } from "@/lib/business-day";
// The period vocabulary is shared, not re-invented: `businessPeriodBounds` is the
// single resolver every screen comes through, and PERIOD_LABEL already names the
// same five periods. A second copy of "This Week" is a second thing to drift.
import { PERIOD_LABEL, type FinancePeriod } from "@/lib/finance";
import { EMPTY_DEDUCTION_SUMMARY, summariseDeductions } from "@/lib/deductions";
import type { DeductionRow, DeductionSummary } from "@/lib/deductions";

export type DeductionReport = {
  period: FinancePeriod;
  periodLabel: string;
  from: string;
  to: string;
  rows: DeductionRow[];
  summary: DeductionSummary;
};

/**
 * Every manual stock movement in a period, with each product's stations.
 *
 * READ ONLY, and it changes nothing about stock: `stock_report` already counts
 * these same `stock_adjustments` rows and is untouched. This just makes them
 * legible as a set instead of one product at a time.
 *
 * Station filtering is deliberately NOT done here. The screen holds the whole
 * period's rows already, so filtering by station is client-side and instant —
 * the same choice Stock and Purchases make. This returns the period; which
 * station you look at within it is the screen's business.
 */
export async function getDeductionReport(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<DeductionReport> {
  const ru = await getRestaurantUser();
  const period = params?.period ?? "month";
  const bounds = businessPeriodBounds(
    period,
    ru.closingHour,
    params?.from ?? null,
    params?.to ?? null
  );
  const shell: DeductionReport = {
    period,
    periodLabel: PERIOD_LABEL[period],
    from: bounds.from.toISOString(),
    to: bounds.to.toISOString(),
    rows: [],
    summary: EMPTY_DEDUCTION_SUMMARY,
  };

  // Same gate as the rest of Stock: seeing what was thrown away is a stock read,
  // not a finance one.
  if (!STOCK_ACCESS.canViewStock(ru)) return shell;

  const service = createServiceClient();
  const [adjRes, stationsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("stock_adjustments")
      .select(
        "id, product_id, kind, qty, notes, created_by, created_at, products ( name, unit, last_unit_cost )"
      )
      .eq("restaurant_id", ru.restaurant_id)
      .gte("created_at", bounds.from.toISOString())
      .lt("created_at", bounds.to.toISOString())
      .order("created_at", { ascending: false })
      .limit(1000),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("product_workstations")
      .select("product_id, workstation_id")
      .eq("restaurant_id", ru.restaurant_id),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adjustments = (adjRes.data ?? []) as any[];
  if (adjustments.length === 0) return shell;

  const stations = new Map<string, string[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (stationsRes.data ?? []) as any[]) {
    const list = stations.get(s.product_id);
    if (list) list.push(s.workstation_id);
    else stations.set(s.product_id, [s.workstation_id]);
  }

  // Who recorded each one — resolved in one query, like `getProductHistory`.
  const staffIds = [...new Set(adjustments.map((a) => a.created_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (staffIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: users } = await (service as any)
      .from("restaurant_users")
      .select("id, display_name")
      .in("id", staffIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const u of (users ?? []) as any[]) names.set(u.id, u.display_name);
  }

  const rows: DeductionRow[] = adjustments.map((a) => {
    const q = Number(a.qty);
    return {
      id: a.id,
      at: a.created_at,
      product_id: a.product_id,
      product_name: a.products?.name ?? "—",
      unit: a.products?.unit ?? "",
      kind: a.kind,
      qty: q,
      value: Math.abs(q) * Number(a.products?.last_unit_cost ?? 0),
      notes: a.notes ?? null,
      staff_name: a.created_by ? names.get(a.created_by) ?? null : null,
      workstation_ids: stations.get(a.product_id) ?? [],
    };
  });

  return { ...shell, rows, summary: summariseDeductions(rows) };
}
