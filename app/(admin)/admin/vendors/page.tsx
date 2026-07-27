import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getVendors, getVendorSummary } from "@/app/actions/vendors";
import { VendorsClient } from "./_components/vendors-client";

// Stock & Finance → Vendors. Viewing needs any stock/vendors right; creating/
// editing/paying/deleting vendors needs `manage_vendors` (split out of
// `manage_stock`, and kept separate from `manage_purchases`). `restaurant_admin`
// passes either. Every vendor action re-checks the same rules server-side, so this
// guard is convenience, not the security boundary.
export default async function VendorsPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewVendors(restaurantUser)) {
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
      canManage={STOCK_ACCESS.canManageVendors(restaurantUser)}
    />
  );
}
