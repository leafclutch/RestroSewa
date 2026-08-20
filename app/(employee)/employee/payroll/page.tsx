import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { PAYROLL_ACCESS } from "@/lib/permissions";
import { getPayrollCycleSheet } from "@/app/actions/payroll";
import { PayrollClient } from "@/app/(admin)/admin/staff/_components/payroll-client";

// The staff-surface Payroll page. Same PayrollClient the admin Staff screen uses.
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

  const sheet = await getPayrollCycleSheet();

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

      <PayrollClient
        initial={sheet}
        canManage={PAYROLL_ACCESS.canManagePayroll(restaurantUser)}
      />
    </div>
  );
}
