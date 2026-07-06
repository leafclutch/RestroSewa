"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";

export type NotificationRow = {
  id: string;
  type: "call_waiter" | "request_bill";
  status: string;
  table_id: string | null;
  table_number: string | null;
  room_id: string | null;
  room_number: string | null;
  session_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
};

export async function getActiveNotifications(
  restaurantId: string
): Promise<NotificationRow[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("notifications")
    .select("id, type, status, table_id, room_id, session_id, created_at, acknowledged_at, restaurant_tables ( number ), rooms ( number )")
    .eq("restaurant_id", restaurantId)
    .in("status", ["new", "acknowledged"])
    .order("created_at", { ascending: false });

  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((n) => ({
    id: n.id,
    type: n.type,
    status: n.status ?? "new",
    table_id: n.table_id,
    table_number: n.restaurant_tables?.number ?? null,
    room_id: n.room_id,
    room_number: n.rooms?.number ?? null,
    session_id: n.session_id,
    created_at: n.created_at,
    acknowledged_at: n.acknowledged_at ?? null,
  }));
}

export async function getNotificationCount(restaurantId: string): Promise<number> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (service as any)
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("status", "new");
  return count ?? 0;
}

export async function acknowledgeNotification(id: string): Promise<void> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("notifications")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/employee/notifications");
}

export async function completeNotification(id: string): Promise<void> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("notifications")
    .update({ status: "completed" })
    .eq("id", id);
  revalidatePath("/employee/notifications");
}
