import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import {
  getFinanceReport,
  getOpeningBalance,
  getPeriodPurchases,
} from "@/app/actions/finance";
import { FinanceClient } from "./_components/finance-client";

// Stock & Finance → Daily Finance. Gated on `view_finance`, which is deliberately
// separate from the stock permissions: this page exposes takings, margins and
// every outstanding debt, which a storekeeper has no business seeing.
export default async function FinancePage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewFinance(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [report, opening, purchases] = await Promise.all([
    getFinanceReport({ period: "today" }),
    getOpeningBalance(),
    getPeriodPurchases({ period: "today" }),
  ]);

  return (
    <FinanceClient
      initial={report}
      initialOpening={opening}
      initialPurchases={purchases}
      // Seeding the opening balance re-bases every balance, so it needs write access.
      canManage={STOCK_ACCESS.canManageStock(restaurantUser)}
    />
  );
}
