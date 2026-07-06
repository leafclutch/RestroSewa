import { requireAdminOrPermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/permissions";
import { getRoomTypesWithRooms } from "@/app/actions/rooms-admin";
import { getRestaurantSlug } from "@/app/actions/tables-admin";
import { createServiceClient } from "@/lib/supabase/service";
import { RoomsClient } from "./_components/rooms-client";

export type EmployeeOption = { id: string; display_name: string };

export default async function RoomsPage() {
  const { restaurantUser } = await requireAdminOrPermission(PERMISSIONS.MANAGE_ROOMS);
  const { restaurant_id } = restaurantUser;
  const service = createServiceClient();

  const [{ types, totalRooms }, restaurantSlug, employeesResult] = await Promise.all([
    getRoomTypesWithRooms(restaurant_id),
    getRestaurantSlug(restaurant_id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_users")
      .select("id, display_name")
      .eq("restaurant_id", restaurant_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("display_name"),
  ]);

  const employees: EmployeeOption[] = (employeesResult.data as EmployeeOption[]) ?? [];

  // Fetch many-to-many room and room-type assignments for these employees
  const employeeIds = employees.map((e) => e.id);
  const assignedByRoom: Record<string, string[]> = {};
  const assignedByRoomType: Record<string, string[]> = {};
  if (employeeIds.length > 0) {
    const [roomAssignRes, typeAssignRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any)
        .from("restaurant_user_rooms")
        .select("restaurant_user_id, room_id")
        .in("restaurant_user_id", employeeIds),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any)
        .from("restaurant_user_room_types")
        .select("restaurant_user_id, room_type_id")
        .in("restaurant_user_id", employeeIds),
    ]);
    for (const a of (roomAssignRes.data ?? []) as { restaurant_user_id: string; room_id: string }[]) {
      if (!assignedByRoom[a.room_id]) assignedByRoom[a.room_id] = [];
      assignedByRoom[a.room_id].push(a.restaurant_user_id);
    }
    for (const a of (typeAssignRes.data ?? []) as { restaurant_user_id: string; room_type_id: string }[]) {
      if (!assignedByRoomType[a.room_type_id]) assignedByRoomType[a.room_type_id] = [];
      assignedByRoomType[a.room_type_id].push(a.restaurant_user_id);
    }
  }

  return (
    <div className="p-4 md:p-8">
      <h1
        className="text-xl mb-1"
        style={{ color: "var(--color-ink)", fontWeight: 300, letterSpacing: "-0.4px" }}
      >
        Rooms
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-ink-mute)" }}>
        Manage room types and individual rooms. Each room gets a unique QR code for guest ordering.
      </p>

      <RoomsClient
        types={types}
        totalRooms={totalRooms}
        restaurantId={restaurant_id}
        restaurantSlug={restaurantSlug ?? ""}
        employees={employees}
        assignedByRoom={assignedByRoom}
        assignedByRoomType={assignedByRoomType}
      />
    </div>
  );
}
