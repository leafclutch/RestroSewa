// Helpers to raise notifications through the shared notifications table.
//
// Note: placing an order does NOT create a notification. Orders live in the
// Orders queue (driven by order rows); the Notifications panel is reserved for
// actionable events (table activation requests, waiter calls, bill requests).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

// Raises a "table activation request" for no-PIN ordering. The customer has
// placed a first order against a `pending_activation` session (invisible to the
// kitchen queue / table overview); this alerts front-of-house staff who can see
// the table so they can Accept (activate + send to kitchen) or Reject it. The
// order_id lets the staff card show the order summary; routing to the right
// table-group happens on read (workstation-only staff never see it).
export async function emitTableActivationRequest(
  service: ServiceClient,
  params: {
    restaurantId: string;
    sessionId: string;
    orderId: string;
    tableId: string | null;
    roomId: string | null;
  }
): Promise<void> {
  await service.from("notifications").insert({
    restaurant_id: params.restaurantId,
    table_id: params.tableId,
    room_id: params.roomId,
    session_id: params.sessionId,
    order_id: params.orderId,
    type: "table_activation_request",
    status: "new",
  });
}

// Raises a customer-facing "order ready" alert through the same notification
// system. Scoped to the session so only the guest who placed the order sees it
// (the customer page polls notifications for its own session). One per order —
// the caller dedups. Staff-facing reads exclude `order_ready`.
export async function emitOrderReadyNotification(
  service: ServiceClient,
  params: {
    restaurantId: string;
    sessionId: string;
    orderId: string;
    tableId: string | null;
    roomId: string | null;
  }
): Promise<void> {
  await service.from("notifications").insert({
    restaurant_id: params.restaurantId,
    table_id: params.tableId,
    room_id: params.roomId,
    session_id: params.sessionId,
    order_id: params.orderId,
    type: "order_ready",
    status: "new",
  });
}
