"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { buildVisibilityFilter } from "@/lib/assignments";
import type { StaffViewer } from "@/lib/assignments";

export type NotificationType = "call_waiter" | "request_bill" | "new_order";

export type NotificationRow = {
  id: string;
  type: NotificationType;
  status: string;
  table_id: string | null;
  table_number: string | null;
  room_id: string | null;
  room_number: string | null;
  session_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
};

// Viewer context used to route table/room notifications by table group.
export type NotificationViewer = StaffViewer;

export async function getActiveNotifications(
  restaurantId: string,
  viewer: NotificationViewer
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

  const visibility = await buildVisibilityFilter(restaurantId, viewer);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data as any[]).filter(
    (n) =>
      visibility.seesAll ||
      (visibility.canSeeTable(n.table_id) && visibility.canSeeRoom(n.room_id))
  );

  return rows.map((n) => ({
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

export async function getNotificationCount(
  restaurantId: string,
  viewer: NotificationViewer
): Promise<number> {
  const service = createServiceClient();

  const visibility = await buildVisibilityFilter(restaurantId, viewer);
  if (visibility.seesAll) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (service as any)
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("status", "new");
    return count ?? 0;
  }

  // Non-managers: only count notifications routed to their table groups.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("notifications")
    .select("table_id, room_id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "new");

  const rows = (data ?? []) as { table_id: string | null; room_id: string | null }[];
  return rows.filter(
    (n) => visibility.canSeeTable(n.table_id) && visibility.canSeeRoom(n.room_id)
  ).length;
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
