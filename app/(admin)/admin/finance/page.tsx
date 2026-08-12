import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import {
  getFinanceReport,
  getFinanceTransactions,
  getOpeningBalance,
  getPeriodPurchases,
} from "@/app/actions/finance";
import { getPayrollSummary } from "@/app/actions/payroll";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { hasRooms } from "@/lib/business-type";
import { FinanceClient } from "./_components/finance-client";

// Stock & Finance → Daily Finance. Gated on `view_finance`, which is deliberately
// separate from the stock permissions: this page exposes takings, margins and
// every outstanding debt, which a storekeeper has no business seeing.
export default async function FinancePage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewFinance(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  const [report, opening, purchases, payroll, ledger, config] = await Promise.all([
    getFinanceReport({ period: "today" }),
    getOpeningBalance(),
    getPeriodPurchases({ period: "today" }),
    // The aggregate wage bill. Gated on `view_finance` like everything else here —
    // it is a company expense, not a window onto any individual's salary.
    getPayrollSummary({ period: "today" }),
    getFinanceTransactions({ period: "today" }),
    // Cached — the same config every other screen reads. Only the business type is
    // wanted here, to decide whether the hotel side of the sheet exists at all.
    getRestaurantConfig(restaurantUser.restaurant_id),
  ]);

  return (
    <FinanceClient
      initial={report}
      initialOpening={opening}
      initialPurchases={purchases}
      initialPayroll={payroll}
      initialLedger={ledger}
      // Seeding the opening balance re-bases every balance, so it needs write access.
      canManage={STOCK_ACCESS.canManageStock(restaurantUser)}
      // A restaurant-only client has no rooms, so the Room sales and Room advances
      // blocks are not shown at all — the same `hasRooms` gate the sidebar,
      // /admin/rooms and the staff dashboard already use.
      showRooms={hasRooms(config.businessType)}
    />
  );
}
