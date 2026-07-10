import { requireRestaurantStaff } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveNotifications } from "@/app/actions/notifications";
import { StaffNav } from "./employee/_components/staff-nav";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { restaurantUser } = await requireRestaurantStaff();

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("name")
    .eq("id", restaurantUser.restaurant_id)
    .single();

  // Single unread badge on the (now minimal) top bar — every new alert the staff
  // member is permitted to see. Sections themselves live on the dashboard.
  const notifs = await getActiveNotifications(restaurantUser.restaurant_id, restaurantUser);
  const notificationCount = notifs.filter((n) => n.status === "new").length;

  return (
    <div className="min-h-screen" style={{ background: "var(--color-canvas-soft)" }}>
      <StaffNav
        restaurantName={restaurant?.name ?? "Restaurant"}
        displayName={restaurantUser.display_name}
        notificationCount={notificationCount}
      />
      <main>{children}</main>
    </div>
  );
}
