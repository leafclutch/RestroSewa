import { requireRestaurantStaff } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { STOCK_ACCESS } from "@/lib/permissions";
import { AdminSidebar } from "./admin/_components/admin-sidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Layout allows any active staff member — individual pages guard their own permissions.
  const { restaurantUser } = await requireRestaurantStaff();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("name")
    .eq("id", restaurantUser.restaurant_id)
    .single();

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-canvas-soft)" }}>
      <AdminSidebar
        restaurantName={restaurant?.name ?? "Restaurant"}
        // Don't advertise links that would only bounce the user. Finance is gated
        // separately from stock, so a storekeeper sees Stock but not Finance.
        showStock={STOCK_ACCESS.canViewStock(restaurantUser)}
        showFinance={STOCK_ACCESS.canViewFinance(restaurantUser)}
      />
      {/* Only this column scrolls — the sidebar is sticky and stays put.
          pt-12 offsets the fixed mobile top bar; md:pt-0 on desktop, where the
          sidebar replaces it. `min-w-0` keeps wide tables from stretching the row. */}
      <main className="flex-1 min-w-0 pt-12 md:pt-0">{children}</main>
    </div>
  );
}
