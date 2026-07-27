import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getVendors, getVendorSummary } from "@/app/actions/vendors";
import { VendorsClient } from "@/app/(admin)/admin/vendors/_components/vendors-client";

// The staff-surface Vendors page. Renders the SAME VendorsClient the admin surface uses —
// no second UI to keep in step — but on the employee chrome. Viewing needs any
// stock/vendors right; creating/editing/paying/deleting a vendor re-checks
// `manage_vendors` server-side, and canManage below hides the write controls for a
// view-only user.
export default async function EmployeeVendorsPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewVendors(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [vendors, summary] = await Promise.all([
    getVendors({ filter: "all" }),
    getVendorSummary(),
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

      <VendorsClient
        initialVendors={vendors}
        initialSummary={summary}
        canManage={STOCK_ACCESS.canManageVendors(restaurantUser)}
      />
    </div>
  );
}
