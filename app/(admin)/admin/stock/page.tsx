import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import {
  getMenuItemOptions,
  getProductOptions,
  getStock,
  getStockSummary,
} from "@/app/actions/stock";
import { StockClient } from "./_components/stock-client";

// Stock & Finance → Stock. Viewing needs `view_stock` or `manage_stock`; adding
// products, deducting stock and editing menu links need `manage_stock`. Every
// stock action re-checks this server-side.
export default async function StockPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewStock(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [stock, summary, products, menuItems] = await Promise.all([
    getStock({ filter: "all" }),
    getStockSummary(),
    getProductOptions(),
    // For the product-centric link picker: attach a product to any menu item.
    getMenuItemOptions(),
  ]);

  return (
    <StockClient
      initialStock={stock}
      initialSummary={summary}
      products={products}
      menuItems={menuItems}
      canManage={STOCK_ACCESS.canManageStock(restaurantUser)}
    />
  );
}
