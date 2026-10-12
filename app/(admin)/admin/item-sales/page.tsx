import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { ITEM_SALES_ACCESS } from "@/lib/permissions";
import { getItemSalesReport } from "@/app/actions/item-sales";
import { ItemSalesClient } from "./_components/item-sales-client";

// Item Sales — units sold per menu item. Gated on `view_item_sales` (owner passes);
// getItemSalesReport re-checks it, so this guard is convenience, not the boundary.
export default async function ItemSalesPage() {
  const { restaurantUser } = await requireRestaurantStaff();
  if (!ITEM_SALES_ACCESS.canView(restaurantUser)) redirect("/employee/dashboard");

  const report = await getItemSalesReport({ period: "today" });
  return <ItemSalesClient initial={report} />;
}
