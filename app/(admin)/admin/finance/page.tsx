import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import {
  getFinanceReport,
  getOpeningBalance,
  getPeriodPurchases,
} from "@/app/actions/finance";
import { getPayrollSummary } from "@/app/actions/payroll";
import { FinanceClient } from "./_components/finance-client";

// Stock & Finance → Daily Finance. Gated on `view_finance`, which is deliberately
// separate from the stock permissions: this page exposes takings, margins and
// every outstanding debt, which a storekeeper has no business seeing.
export default async function FinancePage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewFinance(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [report, opening, purchases, payroll] = await Promise.all([
    getFinanceReport({ period: "today" }),
    getOpeningBalance(),
    getPeriodPurchases({ period: "today" }),
    // The aggregate wage bill. Gated on `view_finance` like everything else here —
    // it is a company expense, not a window onto any individual's salary.
    getPayrollSummary({ period: "today" }),
  ]);

  return (
    <FinanceClient
      initial={report}
      initialOpening={opening}
      initialPurchases={purchases}
      initialPayroll={payroll}
      // Seeding the opening balance re-bases every balance, so it needs write access.
      canManage={STOCK_ACCESS.canManageStock(restaurantUser)}
    />
  );
}
