import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getPurchases, getPurchaseSummary, getVendorOptions } from "@/app/actions/purchases";
import { getProductOptions } from "@/app/actions/stock";
import { PurchasesClient } from "./_components/purchases-client";

// Stock & Finance → Purchases. Viewing needs any stock/purchases right; recording
// a purchase needs `manage_purchases` (it moves stock, money and debt), split out
// of `manage_stock` and separate from `manage_vendors`. `restaurant_admin` passes.
export default async function PurchasesPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewPurchases(restaurantUser)) {
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
      canManage={STOCK_ACCESS.canManagePurchases(restaurantUser)}
    />
  );
}
