import { requireAdminOrPermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/permissions";
import { getMenuCategories, getMenuItemsByCategory } from "@/app/actions/menu";
import { getWorkstations } from "@/app/actions/workstations";
import { MenuClient } from "@/app/(admin)/admin/menu/_components/menu-client";
import type { MenuItemRow } from "@/app/actions/menu";

export default async function EmployeeMenuPage() {
  const { restaurantUser } = await requireAdminOrPermission(PERMISSIONS.MANAGE_MENU);
  const { restaurant_id } = restaurantUser;

  const [categories, workstations] = await Promise.all([
    getMenuCategories(restaurant_id),
    getWorkstations(restaurant_id),
  ]);

  const itemsByCategory = await Promise.all(
    categories.map((c) => getMenuItemsByCategory(restaurant_id, c.id))
  );
  const allItems: MenuItemRow[] = itemsByCategory.flat();

  return (
    <div className="p-4 md:p-8">
      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Menu
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-ink-mute)" }}>
        {workstations.length === 0
          ? "No workstations configured yet — ask your admin to set them up before adding categories."
          : "Manage categories and items."}
      </p>

      <MenuClient
        categories={categories}
        items={allItems}
        workstations={workstations}
        restaurantId={restaurant_id}
      />
    </div>
  );
}
