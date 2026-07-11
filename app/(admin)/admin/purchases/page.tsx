import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getPurchases, getPurchaseSummary, getVendorOptions } from "@/app/actions/purchases";
import { getProductOptions } from "@/app/actions/stock";
import { PurchasesClient } from "./_components/purchases-client";

// Stock & Finance → Purchases. Viewing needs `view_stock` or `manage_stock`;
// recording a purchase needs `manage_stock` (it moves stock, money and debt).
export default async function PurchasesPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewStock(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [purchases, summary, vendors, products] = await Promise.all([
    getPurchases({ filter: "all" }),
    getPurchaseSummary(),
    getVendorOptions(),
    getProductOptions(),
  ]);

  return (
    <PurchasesClient
      initialPurchases={purchases}
      initialSummary={summary}
      vendors={vendors}
      products={products}
      canManage={STOCK_ACCESS.canManageStock(restaurantUser)}
    />
  );
}
