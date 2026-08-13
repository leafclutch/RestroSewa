"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getRestaurantConfig, revalidateRestaurantInfo } from "@/lib/restaurant-info";
import { hasRooms } from "@/lib/business-type";
import {
  DEFAULT_ROOM_DOUBLE_HOUR,
  DEFAULT_ROOM_NEW_DAY_HOUR,
  normalizeRoomHour,
} from "@/lib/business-day";

export type ActionResult = { error: string } | null;

// Defense-in-depth: the Rooms module only exists for a hotel / restaurant+hotel
// client. The UI already hides it and the page redirects, but a forged POST must
// not create hotel data on a restaurant-only client. Cheap (config is cached).
async function roomsEnabled(restaurantId: string): Promise<boolean> {
  const cfg = await getRestaurantConfig(restaurantId);
  return hasRooms(cfg.businessType);
}

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
  if (!(await roomsEnabled(ru.restaurant_id))) return { error: "Rooms are not enabled for this business type." };

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
  if (!(await roomsEnabled(ru.restaurant_id))) return { error: "Rooms are not enabled for this business type." };

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

// ─────────────────────────────────────────────────────────────────────────────
// The room night boundary.
//
// Two hours that decide when a room charge steps up: which day an arrival
// belongs to, and the hour each following night begins. Stored in the
// `restaurants.settings` jsonb alongside `business_closing_hour`, so neither
// needs a column of its own.
//
// Kept here rather than in actions/settings.ts because this is a Rooms setting
// gated on `manage_rooms`, and it lives on the Rooms page — the business-day
// hour is an owner-only, whole-app setting and the two should not share a gate.
// ─────────────────────────────────────────────────────────────────────────────

export type RoomDaySettings = { newDayHour: number; doubleHour: number };

export async function getRoomDaySettings(restaurantId: string): Promise<RoomDaySettings> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", restaurantId)
    .maybeSingle();

  return {
    newDayHour: normalizeRoomHour(data?.settings?.room_new_day_hour, DEFAULT_ROOM_NEW_DAY_HOUR),
    doubleHour: normalizeRoomHour(
      data?.settings?.room_price_double_hour,
      DEFAULT_ROOM_DOUBLE_HOUR
    ),
  };
}

export async function updateRoomDaySettings(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_ROOMS)) return { error: "Permission denied." };
  if (!(await roomsEnabled(ru.restaurant_id))) return { error: "Rooms are not enabled." };

  const readHour = (field: string) => {
    const raw = ((formData.get(field) as string) || "").trim();
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  };

  const newDayHour = readHour("new_day_hour");
  const doubleHour = readHour("double_hour");
  if (newDayHour === null || doubleHour === null) return { error: "Choose valid times." };

  const service = createServiceClient();
  // Read-modify-write, not a jsonb patch: `settings` carries every other setting
  // in the app and a bare update would drop them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", ru.restaurant_id)
    .maybeSingle();

  const settings = {
    ...(rest?.settings ?? {}),
    room_new_day_hour: newDayHour,
    room_price_double_hour: doubleHour,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({ settings })
    .eq("id", ru.restaurant_id);

  if (error) return { error: error.message };

  revalidateRestaurantInfo(ru.restaurant_id);
  // Only stays with no snapshot follow this setting, and those are the ones
  // currently in progress — so the folio and the room grid are what can move.
  revalidatePath("/admin/rooms");
  revalidatePath("/employee/dashboard");
  return null;
}
