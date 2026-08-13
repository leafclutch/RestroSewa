"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { periodBounds } from "@/lib/finance";
import type { FinancePeriod } from "@/lib/finance";
import { resolveSplit } from "@/lib/payment-split";
import { expenseCategoryLabel, isSpendingCategory } from "@/lib/expenses";
import type { ExpenseCategory, ExtraExpense, SavingTitle } from "@/lib/expenses";

export type ActionResult = { error: string } | null;

const SELECT =
  "id, category, note, amount, payment_method, cash_amount, online_amount, created_at, updated_at, saving_title_id, " +
  "restaurant_users!extra_expenses_created_by_fkey ( display_name ), " +
  "saving_titles ( name )";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapExpenses(data: any): ExtraExpense[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    category: r.category as ExpenseCategory,
    categoryLabel: expenseCategoryLabel(r.category),
    note: r.note ?? null,
    amount: Number(r.amount ?? 0),
    method: r.payment_method,
    cash: Number(r.cash_amount ?? 0),
    online: Number(r.online_amount ?? 0),
    createdAt: r.created_at,
    createdByName: r.restaurant_users?.display_name ?? null,
    updatedAt: r.updated_at ?? null,
    savingTitleId: r.saving_title_id ?? null,
    savingTitleName: r.saving_titles?.name ?? null,
  }));
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/**
 * The period's expenses, newest first.
 *
 * Periods resolve through `periodBounds` on the restaurant's own closing hour,
 * exactly like the Finance report — so the list on this page and the "Extra
 * expenses" figure on the report always cover the same hours. Working the day
 * out here instead would eventually disagree with the report and there would be
 * no way to tell which was right.
 */
export async function listExtraExpenses(params?: {
  period?: FinancePeriod;
  from?: string | null;
  to?: string | null;
}): Promise<ExtraExpense[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewExpenses(ru)) return [];

  const period = params?.period ?? "month";
  const { from, to } = periodBounds(period, ru.closingHour, params?.from, params?.to);

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("extra_expenses")
    .select(SELECT)
    .eq("restaurant_id", ru.restaurant_id)
    // Savings are excluded: they have their own section, where they are grouped
    // by pot. Listing them here too would show the same money twice.
    .neq("category", "saving")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .order("created_at", { ascending: false });

  return mapExpenses(data);
}

// ─── Writing ──────────────────────────────────────────────────────────────────

/**
 * Parse and validate the form's amount + tender split.
 *
 * `resolveSplit` is the shared parser every other tender in the app uses, so the
 * tolerance and the wording of a mismatch are identical here. It returns nulls
 * for a non-mixed method — meaning "derive it from the method" — which the
 * DB functions handle but a plain insert does not, so the two single-tender
 * cases are resolved explicitly below.
 */
function resolveExpenseSplit(
  amount: number,
  method: string,
  formData: FormData
): { cash: number; online: number } | { error: string } {
  if (method === "cash") return { cash: amount, online: 0 };
  if (method === "online") return { cash: 0, online: amount };

  const split = resolveSplit(
    "mixed",
    amount,
    String(formData.get("cash_amount") ?? ""),
    String(formData.get("online_amount") ?? "")
  );
  if (!split.ok) return { error: split.error };
  return { cash: split.cash ?? 0, online: split.online ?? 0 };
}

export async function addExtraExpense(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You don't have permission to record expenses." };
  }

  const category = String(formData.get("category") ?? "").toLowerCase();
  const note = String(formData.get("note") ?? "").trim();
  const amount = parseFloat(String(formData.get("amount") ?? "0")) || 0;
  const method = String(formData.get("method") ?? "cash").toLowerCase();

  // `saving` is rejected here on purpose: a saving needs a pot to file it under,
  // and this form has no way to choose one. It is recorded from the Saving
  // section instead, via `addSaving`.
  if (!isSpendingCategory(category)) return { error: "Choose what the expense was for." };
  if (amount <= 0) return { error: "Enter the amount." };
  if (!["cash", "online", "mixed"].includes(method)) {
    return { error: "Choose how it was paid." };
  }

  const split = resolveExpenseSplit(amount, method, formData);
  if ("error" in split) return { error: split.error };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("extra_expenses").insert({
    restaurant_id: ru.restaurant_id,
    category,
    note: note || null,
    amount,
    payment_method: method,
    cash_amount: split.cash,
    online_amount: split.online,
    created_by: ru.id,
  });

  if (error) {
    // The CHECK constraint is the backstop behind `resolveSplit`; if it fires,
    // the two figures disagreed by more than the shared tolerance.
    if ((error.message ?? "").includes("extra_expenses_split_check")) {
      return { error: "Cash and online together must equal the amount." };
    }
    return { error: "Could not save the expense. Please try again." };
  }

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/finance");
  return null;
}

// ─── Savings ─────────────────────────────────────────────────────────────────
// (see below — deposits, withdrawals and the pots themselves)
//
// A saving is an extra expense with a pot. Everything financial about it is
// already handled by being an `extra_expenses` row — the tender split, the four
// balances, the ledger, the CSV, the PDF, the profit subtraction. The only thing
// added here is the pot, and pots exist ONLY on this page: Finance shows a single
// "Saving" line and never the per-title detail, by design.

/**
 * Every pot with its ALL-TIME total.
 *
 * Deliberately not period-filtered. A pot's size is not a period concept — "how
 * much is in the emergency fund" has one answer, and showing a month's worth of
 * it under the same heading would be actively misleading.
 */
export async function listSavingTitles(): Promise<SavingTitle[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewExpenses(ru)) return [];

  const service = createServiceClient();
  const [titlesRes, rowsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("saving_titles")
      .select("id, name, created_at")
      .eq("restaurant_id", ru.restaurant_id)
      .order("created_at", { ascending: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("extra_expenses")
      .select("saving_title_id, amount, cash_amount, online_amount")
      .eq("restaurant_id", ru.restaurant_id)
      .eq("category", "saving"),
  ]);

  // Totalled here rather than in SQL: an aggregate would need its own RPC, and a
  // restaurant has a handful of pots, not thousands. Two round trips either way.
  const totals = new Map<string, { total: number; cash: number; online: number; n: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (rowsRes?.data ?? []) as any[]) {
    const key = r.saving_title_id as string;
    const t = totals.get(key) ?? { total: 0, cash: 0, online: 0, n: 0 };
    t.total += Number(r.amount ?? 0);
    t.cash += Number(r.cash_amount ?? 0);
    t.online += Number(r.online_amount ?? 0);
    t.n += 1;
    totals.set(key, t);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((titlesRes?.data ?? []) as any[]).map((t) => {
    const agg = totals.get(t.id);
    return {
      id: t.id,
      name: t.name,
      total: agg?.total ?? 0,
      cash: agg?.cash ?? 0,
      online: agg?.online ?? 0,
      entryCount: agg?.n ?? 0,
      createdAt: t.created_at,
    };
  });
}

/** Every saving ever filed, newest first — the list that lives under each pot. */
export async function listSavings(): Promise<ExtraExpense[]> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canViewExpenses(ru)) return [];

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("extra_expenses")
    .select(SELECT)
    .eq("restaurant_id", ru.restaurant_id)
    .eq("category", "saving")
    .order("created_at", { ascending: false });

  return mapExpenses(data);
}

export async function createSavingTitle(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to manage savings." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a name for this saving." };
  if (name.length > 60) return { error: "That name is too long." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("saving_titles")
    .insert({ restaurant_id: ru.restaurant_id, name, created_by: ru.id });

  if (error) {
    // The unique index is case-insensitive, so this also catches "emergency fund"
    // against an existing "Emergency Fund" — which is the whole point of it.
    if ((error.code ?? "") === "23505") {
      return { error: "You already have a saving with that name." };
    }
    return { error: "Could not create the saving. Please try again." };
  }

  revalidatePath("/admin/expenses");
  return null;
}

/**
 * Rename a pot.
 *
 * The reason titles are a table rather than free text: this changes the name
 * everywhere at once, including on savings filed months ago, without touching a
 * single expense row.
 */
export async function renameSavingTitle(id: string, name: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to manage savings." };
  }
  const clean = name.trim();
  if (!clean) return { error: "Enter a name." };
  if (clean.length > 60) return { error: "That name is too long." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("saving_titles")
    .update({ name: clean })
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) {
    if ((error.code ?? "") === "23505") {
      return { error: "You already have a saving with that name." };
    }
    return { error: "Could not rename the saving." };
  }

  revalidatePath("/admin/expenses");
  return null;
}

/**
 * Delete a pot — only ever an empty one.
 *
 * The FK is `on delete restrict`, so a pot with money filed under it cannot be
 * removed even if this check were bypassed. That matters: deleting it silently
 * would strand rows that Finance still counts, and the Saving section would stop
 * agreeing with the "Saving" line on the report.
 */
export async function deleteSavingTitle(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to manage savings." };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (service as any)
    .from("extra_expenses")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", ru.restaurant_id)
    .eq("saving_title_id", id);

  if ((count ?? 0) > 0) {
    return { error: "This saving has money in it. Remove its entries first." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("saving_titles")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id);

  if (error) return { error: "Could not delete the saving." };

  revalidatePath("/admin/expenses");
  return null;
}

/** File money into a pot. Identical to an expense in every financial respect. */
export async function addSaving(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to record savings." };
  }

  const titleId = String(formData.get("saving_title_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const amount = parseFloat(String(formData.get("amount") ?? "0")) || 0;
  const method = String(formData.get("method") ?? "cash").toLowerCase();

  if (!titleId) return { error: "Choose which saving this goes into." };
  if (amount <= 0) return { error: "Enter the amount." };
  if (!["cash", "online", "mixed"].includes(method)) return { error: "Choose how it was paid." };

  const split = resolveExpenseSplit(amount, method, formData);
  if ("error" in split) return { error: split.error };

  const service = createServiceClient();
  // Tenancy: the pot must belong to THIS restaurant, or one restaurant could file
  // money into another's. The foreign key alone does not check that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: title } = await (service as any)
    .from("saving_titles")
    .select("id")
    .eq("id", titleId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();
  if (!title) return { error: "That saving no longer exists." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("extra_expenses").insert({
    restaurant_id: ru.restaurant_id,
    category: "saving",
    note: note || null,
    amount,
    payment_method: method,
    cash_amount: split.cash,
    online_amount: split.online,
    saving_title_id: titleId,
    created_by: ru.id,
  });

  if (error) {
    if ((error.message ?? "").includes("extra_expenses_split_check")) {
      return { error: "Cash and online together must equal the amount." };
    }
    return { error: "Could not save. Please try again." };
  }

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/finance");
  return null;
}

/**
 * Take money back out of a pot.
 *
 * A withdrawal is a NEGATIVE saving row — the same shape `room_advances` uses for
 * a refund, and for the same reason: every figure in the app already SUMS these
 * rows, so the signs do all the work. The pot balance, the period total, the two
 * cash balances and the ledger delta all come out right with no second table, no
 * direction flag and no change to either finance function.
 *
 * The form collects a POSITIVE amount — "withdraw 3,000" is what a person means —
 * and it is negated here, once, at the boundary. Letting a negative number reach
 * the form would invite someone to type one into a deposit.
 */
export async function withdrawSaving(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!STOCK_ACCESS.canManageExpenses(ru)) {
    return { error: "You do not have permission to record savings." };
  }

  const titleId = String(formData.get("saving_title_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const amount = parseFloat(String(formData.get("amount") ?? "0")) || 0;
  const method = String(formData.get("method") ?? "cash").toLowerCase();

  if (!titleId) return { error: "Choose which saving to take from." };
  if (amount <= 0) return { error: "Enter the amount." };
  if (!["cash", "online", "mixed"].includes(method)) return { error: "Choose how it was taken." };

  const split = resolveExpenseSplit(amount, method, formData);
  if ("error" in split) return { error: split.error };

  const service = createServiceClient();
  // Tenancy AND balance in one read: the pot must be this restaurant's, and it
  // must actually hold the money. Without the balance check a pot could be taken
  // negative, which would report as money the restaurant never had.
  const [titleRes, rowsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("saving_titles")
      .select("id, name")
      .eq("id", titleId)
      .eq("restaurant_id", ru.restaurant_id)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("extra_expenses")
      .select("amount")
      .eq("restaurant_id", ru.restaurant_id)
      .eq("saving_title_id", titleId),
  ]);

  if (!titleRes?.data) return { error: "That saving no longer exists." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const held = ((rowsRes?.data ?? []) as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0);
  if (amount > held + 0.005) {
    return {
      error:
        held <= 0
          ? "There is nothing in this saving to take out."
          : `This saving only holds ₹${held.toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}.`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("extra_expenses").insert({
    restaurant_id: ru.restaurant_id,
    category: "saving",
    note: note || null,
    amount: -amount,
    payment_method: method,
    cash_amount: -split.cash,
    online_amount: -split.online,
    saving_title_id: titleId,
    created_by: ru.id,
  });

  if (error) {
    if ((error.message ?? "").includes("extra_expenses_split_check")) {
      return { error: "Cash and online together must equal the amount." };
    }
    return { error: "Could not record the withdrawal. Please try again." };
  }

  revalidatePath("/admin/expenses");
  revalidatePath("/admin/finance");
  return null;
}
