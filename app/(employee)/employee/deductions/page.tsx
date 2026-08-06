import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getDeductionReport } from "@/app/actions/deductions";
import { getWorkstations } from "@/app/actions/workstations";
import { DeductionsClient } from "@/app/(admin)/admin/deductions/_components/deductions-client";

// The staff-surface Deduction Report. Renders the SAME DeductionsClient the
// admin surface uses — no second UI to keep in step — on the employee chrome.
// Read-only either way, gated on `view_stock`.
export default async function EmployeeDeductionsPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewStock(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [report, workstations] = await Promise.all([
    getDeductionReport({ period: "month" }),
    getWorkstations(restaurantUser.restaurant_id),
  ]);

  return (
    <div className="p-4 sm:p-5 max-w-3xl mx-auto">
      <Link
        href="/employee/stock"
        className="inline-flex items-center gap-1 text-sm mb-4"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Stock
      </Link>

      <DeductionsClient initialReport={report} workstations={workstations} />
    </div>
  );
}
