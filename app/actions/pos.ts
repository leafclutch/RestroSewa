"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";

export type ActionResult = { error: string } | null;

// ─── Types ────────────────────────────────────────────────────────────────────

export type TableStatus = {
  id: string;
  number: string;
  group_id: string | null;
  session_id: string | null;
  session_opened_at: string | null;
};

export type OrderItemRow = {
  id: string;
  item_name: string;
  item_price: number;
  workstation_name: string | null;
  quantity: number;
  item_status: "pending" | "ready" | "served";
  notes: string | null;
  created_at: string;
  order_id: string;
};

export type SessionDetail = {
  id: string;
  type: string;
  status: string;
  table_id: string | null;
  room_id: string | null;
  table_number: string | null;
  room_number: string | null;
  opened_at: string;
  customer_pin: string | null;
  items: OrderItemRow[];
  total: number;
};

export type QueueItem = OrderItemRow & {
  table_number: string | null;
  room_number: string | null;
  session_type: string | null;
};

export type CartItem = {
  menu_item_id: string;
  variant_id: string | null;
  item_name: string;
  item_price: number;
  workstation_id: string;
  workstation_name: string;
  quantity: number;
  notes: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Table Status Overview ────────────────────────────────────────────────────

export async function getTableStatusOverview(
  restaurantId: string
): Promise<TableStatus[]> {
  const service = createServiceClient();

  const [tablesRes, sessionsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("restaurant_tables")
      .select("id, number, group_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("number"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)
      .from("sessions")
      .select("id, table_id, opened_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active"),
  ]);

  const tables = (tablesRes.data ?? []) as {
    id: string;
    number: string;
    group_id: string | null;
  }[];
  const sessions = (sessionsRes.data ?? []) as {
    id: string;
    table_id: string;
    opened_at: string;
  }[];

  return tables.map((t) => {
    const session = sessions.find((s) => s.table_id === t.id) ?? null;
    return {
      id: t.id,
      number: t.number,
      group_id: t.group_id,
      session_id: session?.id ?? null,
      session_opened_at: session?.opened_at ?? null,
    };
  });
}

// ─── Open / Navigate to Session ──────────────────────────────────────────────

export async function openTableSession(tableId: string) {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // Check for existing active session on this table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("sessions")
    .select("id")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("table_id", tableId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    redirect(`/employee/session/${existing.id}`);
  }

  // Create new session with a customer ordering PIN
  const customer_pin = String(Math.floor(1000 + Math.random() * 9000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error } = await (service as any)
    .from("sessions")
    .insert({
      restaurant_id: ru.restaurant_id,
      type: "table",
      table_id: tableId,
      customer_pin,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  redirect(`/employee/session/${session.id}`);
}

export async function openRoomSession(roomId: string) {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("sessions")
    .select("id")
    .eq("restaurant_id", ru.restaurant_id)
    .eq("room_id", roomId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    redirect(`/employee/session/${existing.id}`);
  }

  const customer_pin = String(Math.floor(1000 + Math.random() * 9000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error } = await (service as any)
    .from("sessions")
    .insert({
      restaurant_id: ru.restaurant_id,
      type: "room_service",
      room_id: roomId,
      customer_pin,
    })
    .select("id")
    .single();

  if (error) redirect("/employee/dashboard");
  redirect(`/employee/session/${session.id}`);
}

export async function openWalkInSession() {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  const customer_pin = String(Math.floor(1000 + Math.random() * 9000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error } = await (service as any)
    .from("sessions")
    .insert({
      restaurant_id: ru.restaurant_id,
      type: "walk_in",
      customer_pin,
    })
    .select("id")
    .single();

  if (error) redirect("/employee/dashboard");
  redirect(`/employee/session/${session.id}`);
}

// ─── Session Detail ───────────────────────────────────────────────────────────

export async function getSessionDetail(
  sessionId: string
): Promise<SessionDetail | null> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select(`id, type, status, opened_at, customer_pin, table_id, room_id, restaurant_tables ( number ), rooms ( number )`)
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orders } = await (service as any)
    .from("session_orders")
    .select("id")
    .eq("session_id", sessionId);

  const orderIds = ((orders ?? []) as { id: string }[]).map((o) => o.id);
  let items: OrderItemRow[] = [];

  if (orderIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: itemsData } = await (service as any)
      .from("session_order_items")
      .select(
        "id, item_name, item_price, workstation_name, quantity, item_status, notes, created_at, order_id"
      )
      .in("order_id", orderIds)
      .order("created_at");
    items = (itemsData as OrderItemRow[]) ?? [];
  }

  const total = items.reduce(
    (sum, i) => sum + Number(i.item_price) * i.quantity,
    0
  );

  return {
    id: session.id,
    type: session.type,
    status: session.status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table_id: (session as any).table_id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room_id: (session as any).room_id ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table_number: (session as any).restaurant_tables?.number ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room_number: (session as any).rooms?.number ?? null,
    opened_at: session.opened_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer_pin: (session as any).customer_pin ?? null,
    items,
    total,
  };
}

// ─── Submit Order ─────────────────────────────────────────────────────────────

export async function submitOrder(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();

  if (!hasPermission(ru, PERMISSIONS.CREATE_ORDERS)) {
    return { error: "You don't have permission to create orders." };
  }

  const service = createServiceClient();

  const sessionId = formData.get("session_id") as string;
  const itemsJson = formData.get("items") as string;

  let cartItems: CartItem[];
  try {
    cartItems = JSON.parse(itemsJson);
  } catch {
    return { error: "Invalid order data." };
  }

  if (!cartItems?.length) return { error: "No items selected." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: order, error: orderErr } = await (service as any)
    .from("session_orders")
    .insert({
      session_id: sessionId,
      restaurant_id: ru.restaurant_id,
      created_by: ru.id,
    })
    .select("id")
    .single();

  if (orderErr) return { error: "Failed to create order." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: itemsErr } = await (service as any)
    .from("session_order_items")
    .insert(
      cartItems.map((item) => ({
        order_id: order.id,
        menu_item_id: item.menu_item_id,
        variant_id: item.variant_id,
        workstation_id: item.workstation_id,
        item_name: item.item_name,
        item_price: item.item_price,
        workstation_name: item.workstation_name,
        quantity: item.quantity,
        notes: item.notes,
      }))
    );

  if (itemsErr) return { error: "Failed to add items." };

  redirect(`/employee/session/${sessionId}`);
}

// ─── Update Item Status ───────────────────────────────────────────────────────

export async function updateOrderItemStatus(
  itemId: string,
  status: "pending" | "ready" | "served"
) {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("session_order_items")
    .update({ item_status: status })
    .eq("id", itemId);
  revalidatePath("/employee/queue");
}

// ─── Close Session with Payment ───────────────────────────────────────────────

export async function closeSessionWithPayment(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();

  if (!hasPermission(ru, PERMISSIONS.CLOSE_BILLS)) {
    return { error: "You don't have permission to close bills." };
  }

  const service = createServiceClient();

  const sessionId   = formData.get("session_id") as string;
  const method      = (formData.get("payment_method") as string) || "cash";
  const cashAmount  = parseFloat(formData.get("cash_amount")   as string) || 0;
  const onlineAmount = parseFloat(formData.get("online_amount") as string) || 0;
  const totalAmount  = parseFloat(formData.get("total_amount")  as string);

  const validMethods = ["cash", "online", "mixed"];
  if (!validMethods.includes(method)) return { error: "Invalid payment method." };
  if (isNaN(totalAmount) || totalAmount < 0) return { error: "Invalid total amount." };
  if (cashAmount < 0 || onlineAmount < 0) return { error: "Amounts cannot be negative." };

  if (method === "mixed") {
    if (Math.abs(cashAmount + onlineAmount - totalAmount) > 0.01) {
      return { error: "The combined Cash and Online amounts must equal the total payable amount." };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).from("payments").insert({
    restaurant_id:  ru.restaurant_id,
    session_id:     sessionId,
    amount:         totalAmount,
    cash_amount:    cashAmount,
    online_amount:  onlineAmount,
    total_amount:   totalAmount,
    payment_method: method,
    created_by:     ru.id,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("sessions")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", sessionId);

  revalidatePath("/employee/dashboard");
  revalidatePath(`/employee/session/${sessionId}`);
  redirect("/employee/dashboard");
}

// ─── Customer PIN Management (Super Admin) ────────────────────────────────────

export type ActiveSessionPin = {
  id: string;
  type: string;
  customer_pin: string | null;
  opened_at: string;
  table_number: string | null;
};

export async function getActiveSessionsWithPins(
  restaurantId: string
): Promise<ActiveSessionPin[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("sessions")
    .select("id, type, customer_pin, opened_at, restaurant_tables ( number )")
    .eq("restaurant_id", restaurantId)
    .eq("status", "active")
    .order("opened_at", { ascending: false });

  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((s) => ({
    id: s.id,
    type: s.type,
    customer_pin: s.customer_pin,
    opened_at: s.opened_at,
    table_number: s.restaurant_tables?.number ?? null,
  }));
}

export async function regenerateSessionPin(sessionId: string): Promise<ActionResult> {
  const service = createServiceClient();
  const new_pin = String(Math.floor(1000 + Math.random() * 9000));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("sessions")
    .update({ customer_pin: new_pin })
    .eq("id", sessionId);
  if (error) return { error: "Failed to regenerate PIN." };
  revalidatePath("/superadmin/restaurants");
  return null;
}

export async function clearSessionPin(sessionId: string): Promise<ActionResult> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("sessions")
    .update({ customer_pin: null })
    .eq("id", sessionId);
  if (error) return { error: "Failed to clear PIN." };
  revalidatePath("/superadmin/restaurants");
  return null;
}

// ─── Force Close Session ─────────────────────────────────────────────────────

export async function forceCloseSession(sessionId: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (
    !hasPermission(ru, PERMISSIONS.CLOSE_BILLS) &&
    !hasPermission(ru, PERMISSIONS.MANAGE_TABLES)
  ) {
    return { error: "Permission denied." };
  }

  const service = createServiceClient();

  // Verify ownership and get table/room context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select("id, restaurant_id, table_id, room_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // Clear pending notifications for this table or room
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifQuery = (service as any)
    .from("notifications")
    .update({ status: "completed" })
    .eq("restaurant_id", ru.restaurant_id)
    .in("status", ["new", "acknowledged"]);

  if (session.table_id) {
    await notifQuery.eq("table_id", session.table_id);
  } else if (session.room_id) {
    await notifQuery.eq("room_id", session.room_id);
  }

  // Close the session
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("sessions")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", sessionId);

  revalidatePath("/employee/dashboard");
  redirect("/employee/dashboard");
}

// ─── Effective Waiter Resolution ─────────────────────────────────────────────
// Individual assignment overrides group/type. Returns [] if no restriction (anyone can see PIN).

export async function getEffectiveWaiters(
  tableId: string | null,
  roomId: string | null
): Promise<string[]> {
  const service = createServiceClient();

  if (tableId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: individual } = await (service as any)
      .from("restaurant_user_tables")
      .select("restaurant_user_id")
      .eq("restaurant_table_id", tableId);
    if ((individual as { restaurant_user_id: string }[] | null)?.length) {
      return (individual as { restaurant_user_id: string }[]).map((r) => r.restaurant_user_id);
    }
    // Fall back to group assignment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tbl } = await (service as any)
      .from("restaurant_tables")
      .select("group_id")
      .eq("id", tableId)
      .maybeSingle();
    if (tbl?.group_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: grp } = await (service as any)
        .from("restaurant_user_table_groups")
        .select("restaurant_user_id")
        .eq("table_group_id", tbl.group_id);
      return ((grp as { restaurant_user_id: string }[] | null) ?? []).map((r) => r.restaurant_user_id);
    }
    return [];
  }

  if (roomId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: individual } = await (service as any)
      .from("restaurant_user_rooms")
      .select("restaurant_user_id")
      .eq("room_id", roomId);
    if ((individual as { restaurant_user_id: string }[] | null)?.length) {
      return (individual as { restaurant_user_id: string }[]).map((r) => r.restaurant_user_id);
    }
    // Fall back to room type assignment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rm } = await (service as any)
      .from("rooms")
      .select("room_type_id")
      .eq("id", roomId)
      .maybeSingle();
    if (rm?.room_type_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: ta } = await (service as any)
        .from("restaurant_user_room_types")
        .select("restaurant_user_id")
        .eq("room_type_id", rm.room_type_id);
      return ((ta as { restaurant_user_id: string }[] | null) ?? []).map((r) => r.restaurant_user_id);
    }
    return [];
  }

  return [];
}

// ─── Workstation Queue ────────────────────────────────────────────────────────

export async function getWorkstationQueue(
  restaurantId: string
): Promise<QueueItem[]> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (service as any)
    .from("session_order_items")
    .select(
      "id, item_name, item_price, workstation_name, quantity, item_status, notes, created_at, order_id"
    )
    .eq("restaurant_id", restaurantId)
    .in("item_status", ["pending", "ready"])
    .order("created_at");

  if (!items?.length) return [];

  // Fetch session info for table numbers
  const orderIds = [...new Set((items as OrderItemRow[]).map((i) => i.order_id))];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orders } = await (service as any)
    .from("session_orders")
    .select("id, session_id")
    .in("id", orderIds);

  const sessionIds = [...new Set(((orders ?? []) as { id: string; session_id: string }[]).map((o) => o.session_id))];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sessions } = await (service as any)
    .from("sessions")
    .select("id, type, table_id, room_id, restaurant_tables ( number ), rooms ( number )")
    .in("id", sessionIds)
    .eq("status", "active");

  const orderMap = new Map(((orders ?? []) as { id: string; session_id: string }[]).map((o) => [o.id, o.session_id]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionMap = new Map(((sessions ?? []) as any[]).map((s) => [s.id, s]));

  return (items as OrderItemRow[])
    .filter((item) => {
      const sid = orderMap.get(item.order_id);
      return sid && sessionMap.has(sid);
    })
    .map((item) => {
      const sid = orderMap.get(item.order_id)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = sessionMap.get(sid) as any;
      return {
        ...item,
        table_number: session?.restaurant_tables?.number ?? null,
        room_number: session?.rooms?.number ?? null,
        session_type: session?.type ?? null,
      };
    });
}

// ─── My Orders (filtered by assigned workstations) ────────────────────────────

export async function getMyOrders(
  restaurantUserId: string,
  restaurantId: string
): Promise<QueueItem[]> {
  const service = createServiceClient();

  // Find which workstations this employee is assigned to
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: assignments } = await (service as any)
    .from("restaurant_user_workstations")
    .select("workstation_id")
    .eq("restaurant_user_id", restaurantUserId);

  const assignedIds: string[] = (assignments ?? []).map(
    (a: { workstation_id: string }) => a.workstation_id
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (service as any)
    .from("session_order_items")
    .select("id, item_name, item_price, workstation_name, quantity, item_status, notes, created_at, order_id, workstation_id")
    .eq("restaurant_id", restaurantId)
    .in("item_status", ["pending", "ready"])
    .order("created_at");

  if (assignedIds.length > 0) {
    query = query.in("workstation_id", assignedIds);
  }

  const { data: items } = await query;
  if (!items?.length) return [];

  const orderIds = [...new Set((items as (OrderItemRow & { workstation_id: string })[]).map((i) => i.order_id))];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orders } = await (service as any)
    .from("session_orders")
    .select("id, session_id")
    .in("id", orderIds);

  const sessionIds = [...new Set(((orders ?? []) as { id: string; session_id: string }[]).map((o) => o.session_id))];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sessions } = await (service as any)
    .from("sessions")
    .select("id, type, table_id, room_id, restaurant_tables ( number ), rooms ( number )")
    .in("id", sessionIds)
    .eq("status", "active");

  const orderMap = new Map(((orders ?? []) as { id: string; session_id: string }[]).map((o) => [o.id, o.session_id]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionMap = new Map(((sessions ?? []) as any[]).map((s) => [s.id, s]));

  return (items as OrderItemRow[])
    .filter((item) => {
      const sid = orderMap.get(item.order_id);
      return sid && sessionMap.has(sid);
    })
    .map((item) => {
      const sid = orderMap.get(item.order_id)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = sessionMap.get(sid) as any;
      return {
        ...item,
        table_number: session?.restaurant_tables?.number ?? null,
        room_number: session?.rooms?.number ?? null,
        session_type: session?.type ?? null,
      };
    });
}

// ─── Recent Sales ─────────────────────────────────────────────────────────────

export type PaymentRow = {
  id: string;
  total_amount: number;
  payment_method: string;
  cash_amount: number;
  online_amount: number;
  created_at: string;
  table_number: string | null;
  room_number: string | null;
  session_type: string | null;
};

export async function getRecentSales(
  restaurantId: string,
  limit = 50
): Promise<PaymentRow[]> {
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("payments")
    .select("id, total_amount, payment_method, cash_amount, online_amount, created_at, sessions ( type, restaurant_tables ( number ), rooms ( number ) )")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((p) => ({
    id: p.id,
    total_amount: p.total_amount,
    payment_method: p.payment_method,
    cash_amount: p.cash_amount,
    online_amount: p.online_amount,
    created_at: p.created_at,
    table_number: p.sessions?.restaurant_tables?.number ?? null,
    room_number: p.sessions?.rooms?.number ?? null,
    session_type: p.sessions?.type ?? null,
  }));
}
