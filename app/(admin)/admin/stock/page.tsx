import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import {
  getLinkTargets,
  getProductOptions,
  getStock,
  getStockSummary,
} from "@/app/actions/stock";
import { getWorkstations } from "@/app/actions/workstations";
import { StockClient } from "./_components/stock-client";
import { businessToday } from "@/lib/business-day";

// Stock & Finance → Stock. Viewing needs `view_stock` or `manage_stock`; adding
// products, deducting stock and editing menu links need `manage_stock`. Every
// stock action re-checks this server-side.
export default async function StockPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewStock(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [stock, summary, products, targets, workstations] = await Promise.all([
    getStock({ filter: "all" }),
    getStockSummary(),
    getProductOptions(),
    // For the product-centric link picker: attach a product to any menu item —
    // or to one variant of it, which is how a Large deducts more than a Small.
    getLinkTargets(),
    // Stations, for grouping and filtering the list. Already cached tenant-wide
    // for 5 minutes — it changes a handful of times a year.
    getWorkstations(restaurantUser.restaurant_id),
  ]);

  return (
    <StockClient
      initialStock={stock}
      initialSummary={summary}
      products={products}
      targets={targets}
      workstations={workstations}
      deductionsHref="/admin/deductions"
      // Computed on the SERVER: the day picker used to read the browser's clock,
      // which disagrees with the reports whenever the device is in another
      // timezone — and would disagree every night once a business day can end
      // after midnight.
      today={businessToday(restaurantUser.closingHour)}
      canManage={STOCK_ACCESS.canManageStock(restaurantUser)}
    />
  );
}
