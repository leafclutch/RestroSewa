"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

export type ActionResult = { error: string } | null;

export type RoomTypeRow = {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  sort_order: number;
};

export type RoomRow = {
  id: string;
  number: string;
  room_type_id: string;
  qr_token: string;
  status: "available" | "occupied" | "cleaning" | "maintenance";
};

export type RoomTypeWithRooms = RoomTypeRow & { rooms: RoomRow[] };

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getRoomTypesWithRooms(
  restaurantId: string
): Promise<{ types: RoomTypeWithRooms[]; totalRooms: number }> {
  const service = createServiceClient();

  const [typesRes, roomsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("room_types")
      .select("id, name, description, base_price, sort_order")
      .eq("restaurant_id", restaurantId)
      .order("sort_order")
      .order("name"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("rooms")
      .select("id, number, room_type_id, qr_token, status")
      .eq("restaurant_id", restaurantId)
      .order("number"),
  ]);

  const allTypes = (typesRes.data as RoomTypeRow[]) ?? [];
  const allRooms = (roomsRes.data as RoomRow[]) ?? [];

  const types: RoomTypeWithRooms[] = allTypes.map((t) => ({
    ...t,
    rooms: allRooms.filter((r) => r.room_type_id === t.id),
  }));

  return { types, totalRooms: allRooms.length };
}

// ─── Room Types ───────────────────────────────────────────────────────────────

export async function createRoomType(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const restaurantId = formData.get("restaurant_id") as string;
  if (restaurantId !== ru.restaurant_id) return { error: "Permission denied." };

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const basePrice = parseFloat(formData.get("base_price") as string) || 0;

  if (!name) return { error: "Room type name is required." };
  if (basePrice < 0) return { error: "Base price must be non-negative." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("room_types")
    .insert({ restaurant_id: restaurantId, name, description, base_price: basePrice });

  if (error) return { error: error.message };
  revalidatePath("/admin/rooms");
  return null;
}

export async function updateRoomType(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const basePrice = parseFloat(formData.get("base_price") as string) || 0;

  if (!name) return { error: "Name is required." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("room_types")
    .select("restaurant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("room_types")
    .update({ name, description, base_price: basePrice })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/admin/rooms");
  return null;
}

export async function deleteRoomType(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("room_types")
    .select("restaurant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("room_types").delete().eq("id", id);
  if (error) {
    if (error.code === "23503")
      return { error: "Remove all rooms in this type first." };
    return { error: error.message };
  }
  revalidatePath("/admin/rooms");
  return null;
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

export async function createRoom(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const restaurantId = formData.get("restaurant_id") as string;
  if (restaurantId !== ru.restaurant_id) return { error: "Permission denied." };

  const number = (formData.get("number") as string)?.trim();
  const roomTypeId = formData.get("room_type_id") as string;

  if (!number || !roomTypeId) return { error: "Room number and type are required." };

  const service = createServiceClient();

  // Enforce max_rooms resource limit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("max_rooms")
    .eq("id", restaurantId)
    .maybeSingle();

  if (restaurant?.max_rooms != null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (service as any)
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId);
    if ((count ?? 0) >= restaurant.max_rooms) {
      return {
        error: `Room limit reached — subscription allows ${restaurant.max_rooms} rooms.`,
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("rooms")
    .insert({ restaurant_id: restaurantId, room_type_id: roomTypeId, number });

  if (error) {
    if (error.code === "23505") return { error: "A room with that number already exists." };
    return { error: error.message };
  }
  revalidatePath("/admin/rooms");
  return null;
}

export async function updateRoom(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const id = formData.get("id") as string;
  const number = (formData.get("number") as string)?.trim();
  const roomTypeId = formData.get("room_type_id") as string;

  if (!number || !roomTypeId) return { error: "Room number and type are required." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("rooms")
    .select("restaurant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("rooms")
    .update({ number, room_type_id: roomTypeId })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: "A room with that number already exists." };
    return { error: error.message };
  }
  revalidatePath("/admin/rooms");
  return null;
}

export async function setRoomStatus(
  roomId: string,
  status: "available" | "occupied" | "cleaning" | "maintenance"
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("rooms")
    .select("restaurant_id")
    .eq("id", roomId)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("rooms")
    .update({ status })
    .eq("id", roomId);
  if (error) return { error: error.message };
  revalidatePath("/admin/rooms");
  return null;
}

export async function deleteRoom(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("rooms")
    .select("restaurant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("rooms").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/rooms");
  return null;
}

export async function regenerateRoomQr(roomId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("rooms")
    .select("restaurant_id")
    .eq("id", roomId)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("rooms")
    .update({ qr_token: crypto.randomUUID() })
    .eq("id", roomId);
  if (error) return { error: error.message };
  revalidatePath("/admin/rooms");
  return null;
}

export async function setRoomTypeWaiters(
  roomTypeId: string,
  userIds: string[]
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("room_types")
    .select("restaurant_id")
    .eq("id", roomTypeId)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("restaurant_user_room_types")
    .delete()
    .eq("room_type_id", roomTypeId);

  if (userIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from("restaurant_user_room_types")
      .insert(userIds.map((uid) => ({ restaurant_user_id: uid, room_type_id: roomTypeId })));
    if (error) return { error: "Failed to save assignments." };
  }

  revalidatePath("/admin/rooms");
  return null;
}

export async function setRoomWaiters(
  roomId: string,
  userIds: string[]
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("rooms")
    .select("restaurant_id")
    .eq("id", roomId)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // Replace all assignments: delete then insert
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("restaurant_user_rooms")
    .delete()
    .eq("room_id", roomId);

  if (userIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from("restaurant_user_rooms")
      .insert(userIds.map((uid) => ({ restaurant_user_id: uid, room_id: roomId })));
    if (error) return { error: "Failed to save assignments." };
  }

  revalidatePath("/admin/rooms");
  return null;
}
