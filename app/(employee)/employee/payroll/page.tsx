import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { PAYROLL_ACCESS } from "@/lib/permissions";
import { getPayrollCycleSheet } from "@/app/actions/payroll";
import { getRotaPayrollSheet, getRotaWeek } from "@/app/actions/rota";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { PayrollClient } from "@/app/(admin)/admin/staff/_components/payroll-client";
import { RotaPayout } from "@/app/(admin)/admin/staff/_components/rota/rota-payout";

// The staff-surface Payroll page. Same PayrollClient the admin Staff screen uses —
// or, for a restaurant on advanced payout, the same rota board and wage sheet.
//
// Viewing needs any payroll right; setting a salary or recording a payment
// re-checks `manage_payroll` server-side, and `canManage` hides those controls
// for a view-only holder. The dashboard SECTION that links here is gated more
// tightly (manage_payroll only) — that is deliberate, and explained there.
export default async function EmployeePayrollPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!PAYROLL_ACCESS.canViewPayroll(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const canManage = PAYROLL_ACCESS.canManagePayroll(restaurantUser);
  const { payoutMode } = await getRestaurantConfig(restaurantUser.restaurant_id);

  let body: React.ReactNode;
  if (payoutMode === "advanced") {
    const [week, sheet] = await Promise.all([getRotaWeek(), getRotaPayrollSheet()]);
    body = week && sheet ? <RotaPayout week={week} sheet={sheet} canManage={canManage} /> : null;
  } else {
    body = <PayrollClient initial={await getPayrollCycleSheet()} canManage={canManage} />;
  }

  return (
    <div className={`p-4 sm:p-5 mx-auto ${payoutMode === "advanced" ? "max-w-6xl" : "max-w-3xl"}`}>
      <Link
        href="/employee/dashboard?focus=payroll"
        className="inline-flex items-center gap-1 text-sm mb-4"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <ChevronLeft size={14} />
        Dashboard
      </Link>

      {body}
    </div>
  );
}
