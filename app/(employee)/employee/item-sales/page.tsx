import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { ITEM_SALES_ACCESS } from "@/lib/permissions";
import { getItemSalesReport } from "@/app/actions/item-sales";
import { ItemSalesClient } from "@/app/(admin)/admin/item-sales/_components/item-sales-client";

// The staff-surface Item Sales page — the same ItemSalesClient the admin surface uses,
// on the employee chrome. Same `view_item_sales` gate.
export default async function EmployeeItemSalesPage() {
  const { restaurantUser } = await requireRestaurantStaff();
  if (!ITEM_SALES_ACCESS.canView(restaurantUser)) redirect("/employee/dashboard");

  const report = await getItemSalesReport({ period: "today" });
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link
        href="/employee/dashboard"
        className="inline-flex items-center gap-1 text-sm mb-4"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Dashboard
      </Link>
      <ItemSalesClient initial={report} />
    </div>
  );
}
