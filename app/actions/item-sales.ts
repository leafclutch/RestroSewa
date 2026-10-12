"use server";

import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { createServiceClient } from "@/lib/supabase/service";
import { ITEM_SALES_ACCESS } from "@/lib/permissions";
import { businessPeriodBounds, businessToday } from "@/lib/business-day";

/** "day" = one business day the viewer picked with the date chooser. */
export type ItemSalesPeriod = "today" | "yesterday" | "month" | "year" | "all" | "day";

export type ItemSalesRow = {
  /** Stable React key: item + variant, or the name for a line no longer on the menu. */
  key: string;
  name: string;
  categoryId: string | null;
  /** "Custom items" for off-menu lines, "Uncategorized" for items since deleted. */
  categoryName: string;
  quantity: number;
  /** Gross — item price × units, before any bill-level discount. */
  revenue: number;
  /** How many bills it appeared on. */
  bills: number;
};

export type ItemSalesCategory = {
  id: string | null;
  name: string;
  quantity: number;
  revenue: number;
  items: ItemSalesRow[];
};

export type ItemSalesReport = {
  period: ItemSalesPeriod;
  /** The business day shown when period = "day". */
  day: string | null;
  totalQuantity: number;
  totalRevenue: number;
  /** Best sellers by units, across every category. */
  top: ItemSalesRow[];
  /** Categories ordered by units sold, each with its items by units sold. */
  categories: ItemSalesCategory[];
  businessToday: string;
};

const TOP_COUNT = 3;

// Self-authing, like getSalesReport: the restaurant comes from the session and the
// permission is re-checked here, so the client may re-query on every filter change.
export async function getItemSalesReport(params?: {
  period?: ItemSalesPeriod;
  day?: string | null;
}): Promise<ItemSalesReport> {
  const ru = await getRestaurantUser();
  const period = params?.period ?? "today";
  const today = businessToday(ru.dayRule);
  const day = period === "day" ? params?.day || today : null;

  const empty: ItemSalesReport = {
    period,
    day,
    totalQuantity: 0,
    totalRevenue: 0,
    top: [],
    categories: [],
    businessToday: today,
  };
  if (!ITEM_SALES_ACCESS.canView(ru)) return empty;

  const bounds =
    period === "all"
      ? null
      : period === "day"
      ? businessPeriodBounds("custom", ru.dayRule, day, day)
      : businessPeriodBounds(period, ru.dayRule);

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any).rpc("item_sales_report", {
    p_restaurant_id: ru.restaurant_id,
    p_from: bounds ? bounds.from.toISOString() : null,
    p_to: bounds ? bounds.to.toISOString() : null,
  });
  if (error) throw new Error(`Could not load item sales: ${error.message}`);

  const rows: ItemSalesRow[] = (
    (data ?? []) as {
      menu_item_id: string | null;
      variant_id: string | null;
      item_name: string;
      category_id: string | null;
      category_name: string | null;
      is_custom: boolean;
      quantity: number;
      revenue: number;
      bills: number;
    }[]
  ).map((r) => ({
    key: r.menu_item_id ? `${r.menu_item_id}:${r.variant_id ?? ""}` : `${r.is_custom ? "custom" : "gone"}:${r.item_name}`,
    name: r.item_name,
    categoryId: r.category_id,
    categoryName: r.category_name ?? (r.is_custom ? "Custom items" : "Uncategorized"),
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
    bills: Number(r.bills),
  }));

  const byCategory = new Map<string, ItemSalesCategory>();
  for (const r of rows) {
    const k = r.categoryId ?? `name:${r.categoryName}`;
    let c = byCategory.get(k);
    if (!c) {
      c = { id: r.categoryId, name: r.categoryName, quantity: 0, revenue: 0, items: [] };
      byCategory.set(k, c);
    }
    c.quantity += r.quantity;
    c.revenue += r.revenue;
    c.items.push(r); // rows arrive sorted by units, so each category's list is too
  }

  return {
    ...empty,
    totalQuantity: rows.reduce((s, r) => s + r.quantity, 0),
    totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
    top: rows.slice(0, TOP_COUNT),
    categories: [...byCategory.values()].sort((a, b) => b.quantity - a.quantity),
  };
}
