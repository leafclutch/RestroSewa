import "server-only";
import { requireRestaurantStaff } from "@/lib/auth/guards";
import { getRestaurantConfig } from "@/lib/restaurant-info";
import { currencyFormatter, type CurrencyFormatter } from "@/lib/currency";

/** The restaurant's currency, for code that already knows the restaurant id. */
export async function getCurrencyFor(restaurantId: string): Promise<CurrencyFormatter> {
  const config = await getRestaurantConfig(restaurantId);
  return currencyFormatter(config.currency);
}

/**
 * The signed-in staff member's restaurant currency — for server components and actions.
 * Both the user row (per-request cache) and the config (tenant cache, dropped on every
 * Settings save) are cached, so this costs nothing on a page that already loaded them.
 */
export async function getCurrentCurrency(): Promise<CurrencyFormatter> {
  const { restaurantUser } = await requireRestaurantStaff();
  return getCurrencyFor(restaurantUser.restaurant_id);
}
