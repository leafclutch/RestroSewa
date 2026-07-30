import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getPurchases, getPurchaseSummary, getVendorOptions } from "@/app/actions/purchases";
import { getProductOptions } from "@/app/actions/stock";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { PurchasesClient } from "@/app/(admin)/admin/purchases/_components/purchases-client";

// The staff-surface Purchases page. Renders the SAME PurchasesClient the admin surface
// uses — no second UI to keep in step — but on the employee chrome. Viewing needs any
// stock/purchases right; recording a purchase re-checks `manage_purchases` server-side,
// and canManage below hides the write controls for a view-only user.
export default async function EmployeePurchasesPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewPurchases(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [purchases, summary, vendors, products, config] = await Promise.all([
    getPurchases({ filter: "all" }),
    getPurchaseSummary(),
    getVendorOptions(),
    getProductOptions(),
    getRestaurantConfig(restaurantUser.restaurant_id),
  ]);

  return (
    <div className="p-4 sm:p-5 max-w-3xl mx-auto">
      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1 text-sm mb-4"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Dashboard
      </Link>

      <PurchasesClient
        initialPurchases={purchases}
        initialSummary={summary}
        vendors={vendors}
        products={products}
        canManage={STOCK_ACCESS.canManagePurchases(restaurantUser)}
        canEdit={restaurantUser.role === "restaurant_admin"}
        securityEnabled={config.securityEnabled}
      />
    </div>
  );
}
