import { requireRestaurantStaff } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
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
      <AdminSidebar restaurantName={restaurant?.name ?? "Restaurant"} />
      {/* pt-12: offset for mobile fixed top bar; md:pt-0: no offset on desktop with sidebar */}
      <main className="flex-1 min-w-0 overflow-auto pt-12 md:pt-0">{children}</main>
    </div>
  );
}
