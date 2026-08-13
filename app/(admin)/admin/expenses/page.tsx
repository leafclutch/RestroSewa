import { redirect } from "next/navigation";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { STOCK_ACCESS } from "@/lib/permissions";
import { listExtraExpenses, listSavings, listSavingTitles } from "@/app/actions/expenses";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { ExpensesClient } from "./_components/expenses-client";

// Stock & Finance → Extra Expenses. Viewing needs `manage_expenses` or
// `view_finance` (the report already prints every figure this page holds);
// recording needs `manage_expenses`. Correcting or deleting is owner-only AND
// Security-PIN gated, because the row has already moved a day's cash balance.
export default async function ExpensesPage() {
  const { restaurantUser } = await requireRestaurantStaff();

  if (!STOCK_ACCESS.canViewExpenses(restaurantUser)) {
    redirect("/employee/dashboard");
  }

  // Savings are fetched unfiltered: a pot's balance is all-time, not a period
  // figure — see `listSavingTitles`. For an add-only holder those same two
  // actions return today, and no pot balance at all.
  const todayOnly = STOCK_ACCESS.expensesTodayOnly(restaurantUser);
  const [expenses, titles, savings, config] = await Promise.all([
    listExtraExpenses({ period: todayOnly ? "today" : "month" }),
    listSavingTitles(),
    listSavings(),
    getRestaurantConfig(restaurantUser.restaurant_id),
  ]);

  return (
    <ExpensesClient
      initialExpenses={expenses}
      initialTitles={titles}
      initialSavings={savings}
      canManage={STOCK_ACCESS.canManageExpenses(restaurantUser)}
      canAdd={STOCK_ACCESS.canAddExpenses(restaurantUser)}
      todayOnly={todayOnly}
      canEdit={restaurantUser.role === "restaurant_admin"}
      securityEnabled={config.securityEnabled}
    />
  );
}
