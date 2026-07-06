import { requireRestaurantAdmin } from "@/lib/auth/guards";
import { getMenuCategories, getMenuItemsByCategory } from "@/app/actions/menu";
import { getWorkstations } from "@/app/actions/workstations";
import { MenuClient } from "./_components/menu-client";
import type { MenuItemRow } from "@/app/actions/menu";
import Link from "next/link";

export default async function MenuPage() {
  const { restaurantUser } = await requireRestaurantAdmin();
  const { restaurant_id } = restaurantUser;

  const [categories, workstations] = await Promise.all([
    getMenuCategories(restaurant_id),
    getWorkstations(restaurant_id),
  ]);

  // Fetch items for all categories
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
        Manage categories and items.{" "}
        {workstations.length === 0 && (
          <>
            <Link href="/admin/workstations" style={{ color: "var(--color-primary)" }}>
              Set up workstations
            </Link>{" "}
            before adding categories.
          </>
        )}
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
