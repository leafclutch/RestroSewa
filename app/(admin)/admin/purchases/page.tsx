import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import {
  getPurchaseLines,
  getPurchases,
  getPurchaseSummary,
  getVendorOptions,
} from "@/app/actions/purchases";
import { getProductOptions } from "@/app/actions/stock";
import { getWorkstations } from "@/app/actions/workstations";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { PurchasesClient } from "./_components/purchases-client";

// Stock & Finance → Purchases. Viewing needs any stock/purchases right; recording
// a purchase needs `manage_purchases` (it moves stock, money and debt), split out
// of `manage_stock` and separate from `manage_vendors`. `restaurant_admin` passes.
export default async function PurchasesPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewPurchases(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [purchases, lines, summary, vendors, products, workstations, config] = await Promise.all([
    getPurchases({ filter: "all" }),
    // The same bills, broken into lines — what the station view reports on,
    // because a bill's total spans stations and a line's does not.
    getPurchaseLines({ filter: "all" }),
    getPurchaseSummary(),
    getVendorOptions(),
    getProductOptions(),
    getWorkstations(restaurantUser.restaurant_id),
    getRestaurantConfig(restaurantUser.restaurant_id),
  ]);

  return (
    <PurchasesClient
      initialPurchases={purchases}
      initialLines={lines}
      initialSummary={summary}
      vendors={vendors}
      products={products}
      workstations={workstations}
      canManage={STOCK_ACCESS.canManagePurchases(restaurantUser)}
      // Editing a completed purchase is an owner action, gated by the Security PIN.
      canEdit={restaurantUser.role === "restaurant_admin"}
      securityEnabled={config.securityEnabled}
    />
  );
}
