"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { buildVisibilityFilter, getAssignedWorkstationIds } from "@/lib/assignments";
import type { StaffViewer } from "@/lib/assignments";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";

// Only actionable events belong in the Notifications panel. Orders are NOT
// notifications — they live in the Orders queue (driven by order rows).
export type NotificationType =
  | "call_waiter"
  | "request_bill"
  | "table_activation_request";

export type ActivationSummaryItem = { name: string; quantity: number; price: number };

export type NotificationRow = {
  id: string;
  type: NotificationType;
  status: string;
  table_id: string | null;
  table_number: string | null;
  room_id: string | null;
  room_number: string | null;
  session_id: string | null;
  order_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
  // Populated only for `table_activation_request` rows so the staff card can show
  // what the customer is trying to order before approving.
  order_summary?: ActivationSummaryItem[];
  order_total?: number;
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
    .select("id, type, status, table_id, room_id, session_id, order_id, created_at, acknowledged_at, restaurant_tables ( number ), rooms ( number )")
    .eq("restaurant_id", restaurantId)
    .in("status", ["new", "acknowledged"])
    .order("created_at", { ascending: false });

  if (!data) return [];

  // Only actionable, staff-facing events belong here. `new_order` is an
  // operational event surfaced in the Orders queue, and `order_ready` is a
  // customer-facing alert — both are excluded (defensive filter also drops any
  // legacy `new_order` rows written before this change).
  const PANEL_EXCLUDED = new Set(["new_order", "order_ready"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffData = (data as any[]).filter((n) => !PANEL_EXCLUDED.has(n.type));
  if (staffData.length === 0) return [];

  const visibility = await buildVisibilityFilter(restaurantId, viewer);
  const myWorkstations = await getAssignedWorkstationIds(viewer.id);
  const isWorkstationStaff = !visibility.seesAll && myWorkstations.size > 0;

  // Pure workstation staff (kitchen/bar/bakery) work the Orders queue, not
  // front-of-house service calls / activation requests — so no actionable
  // notifications route to them. Everyone else gets table-group-routed events.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = isWorkstationStaff
    ? []
    : staffData.filter(
        (n) =>
          visibility.seesAll ||
          (visibility.canSeeTable(n.table_id) && visibility.canSeeRoom(n.room_id))
      );

  // Attach an order summary to activation requests so the staff card can show
  // what's being ordered before they Accept/Reject.
  const activationOrderIds = [
    ...new Set(
      rows
        .filter((n) => n.type === "table_activation_request" && n.order_id)
        .map((n) => n.order_id as string)
    ),
  ];
  const summaryByOrder = new Map<string, ActivationSummaryItem[]>();
  if (activationOrderIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sumItems } = await (service as any)
      .from("session_order_items")
      .select("order_id, item_name, quantity, item_price")
      .in("order_id", activationOrderIds)
      .is("cancelled_at", null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of (sumItems ?? []) as any[]) {
      if (!summaryByOrder.has(it.order_id)) summaryByOrder.set(it.order_id, []);
      summaryByOrder.get(it.order_id)!.push({
        name: it.item_name,
        quantity: it.quantity,
        price: Number(it.item_price ?? 0),
      });
    }
  }

  return rows.map((n) => {
    const summary = n.order_id ? summaryByOrder.get(n.order_id) : undefined;
    return {
      id: n.id,
      type: n.type,
      status: n.status ?? "new",
      table_id: n.table_id,
      table_number: n.restaurant_tables?.number ?? null,
      room_id: n.room_id,
      room_number: n.rooms?.number ?? null,
      session_id: n.session_id,
      order_id: n.order_id ?? null,
      created_at: n.created_at,
      acknowledged_at: n.acknowledged_at ?? null,
      ...(summary
        ? {
            order_summary: summary,
            order_total: summary.reduce((s, i) => s + i.price * i.quantity, 0),
          }
        : {}),
    };
  });
}

export async function getNotificationCount(
  restaurantId: string,
  viewer: NotificationViewer
): Promise<number> {
  // Derive from the same routing (table-group + workstation) used to display
  // notifications, so the badge always matches what the staff member can see.
  const items = await getActiveNotifications(restaurantId, viewer);
  return items.filter((n) => n.status === "new").length;
}

// Self-authing poll endpoint for the client. Derives the viewer from the
// session (never trusts client input) and returns the actionable notifications
// visible to them plus the count of unacknowledged ones — used to drive the live
// badge and waiter-call / bill-request / activation-request alerts.
export async function getMyNotifications(): Promise<{
  items: NotificationRow[];
  count: number;
}> {
  const ru = await getRestaurantUser();
  const items = await getActiveNotifications(ru.restaurant_id, ru);
  const count = items.filter((n) => n.status === "new").length;
  return { items, count };
}

// A staff member may only act on a notification that belongs to THEIR restaurant
// and to a table/room they are routed (the same rule that decides whether they
// see it at all). Without this a server action taking a bare id would let any
// signed-in user resolve any restaurant's notification.
async function assertCanActOn(id: string) {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: n } = await (service as any)
    .from("notifications")
    .select("id, restaurant_id, table_id, room_id")
    .eq("id", id)
    .maybeSingle();

  if (!n || n.restaurant_id !== ru.restaurant_id) return null;

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (
    !visibility.seesAll &&
    !(visibility.canSeeTable(n.table_id) && visibility.canSeeRoom(n.room_id))
  ) {
    return null;
  }

  return { ru, service };
}

/** Staff has seen it and is on their way (new → acknowledged). */
export async function acknowledgeNotification(id: string): Promise<void> {
  const ctx = await assertCanActOn(id);
  if (!ctx) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx.service as any)
    .from("notifications")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/employee/notifications");
  revalidatePath("/employee/dashboard");
}

/** Handled — clears it from the panel and the badge. */
export async function completeNotification(id: string): Promise<void> {
  const ctx = await assertCanActOn(id);
  if (!ctx) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (ctx.service as any)
    .from("notifications")
    .update({ status: "completed" })
    .eq("id", id);

  revalidatePath("/employee/notifications");
  revalidatePath("/employee/dashboard");
}
