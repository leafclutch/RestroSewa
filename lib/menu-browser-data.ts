import "server-only";
import { getMenuCategories, getAllMenuItems, getAvailableVariants } from "@/app/actions/menu";
import type { CategoryRow, MenuItemRow, VariantRow } from "@/app/actions/menu";
import { getWorkstations } from "@/app/actions/workstations";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import type { RestaurantUserContext } from "@/lib/auth/guards";

export type AddItemsMenuData = {
  categories: CategoryRow[];
  items: MenuItemRow[];
  variants: VariantRow[];
  canAddCustom: boolean;
  workstations: { id: string; name: string }[];
};

/**
 * Everything `MenuBrowser` needs to render, in one call. Factored out of
 * `session/[id]/add/page.tsx` (the standalone mobile route) so the
 * desktop/tablet split-view (`session/[id]/page.tsx`) can fetch the identical
 * data without copying the fetch-and-filter logic a second time — the two
 * surfaces must always see the same menu, never two independently-assembled
 * versions of it.
 */
export async function getAddItemsMenuData(
  restaurantUser: Pick<RestaurantUserContext, "restaurant_id" | "role" | "permissions">
): Promise<AddItemsMenuData> {
  const { restaurant_id } = restaurantUser;

  // Custom (off-menu) items are gated by their own permission and can be routed to a
  // workstation. Fetch the stations for the picker only when the user may add them.
  const canAddCustom = hasPermission(restaurantUser, PERMISSIONS.MANAGE_CUSTOM_ITEMS);

  // ONE round trip. This used to be categories → one items query PER category →
  // variants → workstations, each waiting on the last, and it sat on the path of
  // every tap from a room (or table) into its menu. None of them depends on
  // another: the whole menu comes back in one query and is filtered here instead.
  const [categories, allItems, variants, workstations] = await Promise.all([
    getMenuCategories(restaurant_id),
    getAllMenuItems(restaurant_id),
    // Variants for the whole menu in one query — a staff member taking an order
    // needs to pick the size at the counter, same as a guest does on their phone.
    getAvailableVariants(restaurant_id),
    canAddCustom ? getWorkstations(restaurant_id) : Promise.resolve([]),
  ]);

  const activeCategories = categories.filter((c) => c.is_active);

  // Same result the per-category queries produced: only active categories, grouped
  // in category order, each group in the items' own (sort_order, created_at) order —
  // which `getAllMenuItems` already returns and a stable sort preserves.
  const categoryRank = new Map(activeCategories.map((c, i) => [c.id, i]));
  const items: MenuItemRow[] = allItems
    .filter((i) => categoryRank.has(i.category_id) && i.availability_status === "available")
    .sort((a, b) => categoryRank.get(a.category_id)! - categoryRank.get(b.category_id)!);

  return {
    categories: activeCategories,
    items,
    variants,
    canAddCustom,
    workstations: workstations.map((w) => ({ id: w.id, name: w.name })),
  };
}
