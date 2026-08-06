import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { getDeductionReport } from "@/app/actions/deductions";
import { getWorkstations } from "@/app/actions/workstations";
import { DeductionsClient } from "./_components/deductions-client";

// Stock & Finance → Deduction Report. A READ of stock, so it is gated on
// `view_stock` exactly like the Stock page — the rows it lists are written from
// there, behind `manage_stock`. Nothing on this screen writes.
export default async function DeductionsPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewStock(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [report, workstations] = await Promise.all([
    // A month by default: deductions are reviewed in arrears, and a single day is
    // usually empty enough to look like the feature is broken.
    getDeductionReport({ period: "month" }),
    getWorkstations(restaurantUser.restaurant_id),
  ]);

  return <DeductionsClient initialReport={report} workstations={workstations} />;
}
