import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getVendors, getVendorSummary } from "@/app/actions/vendors";
import { VendorsClient } from "./_components/vendors-client";

// Stock & Finance → Vendors. Viewing needs `view_stock` OR `manage_stock` (a
// manager shouldn't need both); creating/editing/paying needs `manage_stock`.
// `restaurant_admin` passes either. Every vendor action re-checks the same rules
// server-side, so this guard is convenience, not the security boundary.
export default async function VendorsPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewStock(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [vendors, summary] = await Promise.all([
    getVendors({ filter: "all" }),
    getVendorSummary(),
  ]);

  return (
    <VendorsClient
      initialVendors={vendors}
      initialSummary={summary}
      canManage={STOCK_ACCESS.canManageStock(restaurantUser)}
    />
  );
}
