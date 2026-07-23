"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { hasAnyPermission, PERMISSIONS } from "@/lib/permissions";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { buildVisibilityFilter } from "@/lib/assignments";
import type { RestaurantUserCtx } from "@/lib/auth/get-restaurant-user";

/**
 * Session Transfer — moving a live party to another table, or a live stay to another
 * room. The heavy lifting is the `transfer_session` DB function
 * (20260723000000_session_transfer.sql), which does the whole move in one transaction.
 *
 * What lives HERE and nowhere else: who is allowed to do it, which destinations they
 * are allowed to see, and turning the function's error codes into sentences. Everything
 * that must be ATOMIC lives in the function.
 *
 * Its own file rather than more weight in pos.ts, which is already ~2,000 lines.
 */

export type TransferTarget = { id: string; label: string };

export type TransferOptions = {
  kind: "table" | "room";
  current_label: string;
  targets: TransferTarget[];
};

export type TransferInput = {
  sessionId: string;
  destTableId?: string | null;
  destRoomId?: string | null;
  reason?: string | null;
  /** Room moves only: an optional one-off charge for an upgrade. */
  upgradeAmount?: number | null;
};

/**
 * Printing gates on billing permissions; so does this. A waiter holds VIEW_TABLES but
 * none of these, which is what §1 asks for — moving a party rearranges a live bill.
 * MANAGE_TABLES / MANAGE_ROOMS carry a manager; PROCESS_PAYMENTS + CLOSE_BILLS carry a
 * cashier and a receptionist.
 */
function mayTransfer(ru: RestaurantUserCtx, kind: "table" | "room"): boolean {
  return hasAnyPermission(ru, [
    kind === "table" ? PERMISSIONS.MANAGE_TABLES : PERMISSIONS.MANAGE_ROOMS,
    PERMISSIONS.PROCESS_PAYMENTS,
    PERMISSIONS.CLOSE_BILLS,
  ]);
}

/**
 * Every raise in transfer_session, as something a cashier can act on.
 *
 * SQLSTATE 23505 is the one that is NOT a raise: it means the unique index caught a
 * transfer that lost a race by microseconds. The user does not care which mechanism
 * refused them, only that the table went to someone else.
 */
function explain(message: string, code?: string): string {
  if (code === "23505") return "That place was taken a moment ago. Pick another.";

  const map: Record<string, string> = {
    SESSION_NOT_FOUND: "That session no longer exists.",
    SESSION_CLOSED: "This bill has already been settled, so it can't be moved.",
    SAME_LOCATION: "That's where this session already is.",
    TRANSFER_TARGET_REQUIRED: "Pick somewhere to move to.",
    TRANSFER_KIND_MISMATCH: "A table session can only move to a table, and a room to a room.",
    WALK_IN_TRANSFER_UNSUPPORTED: "Walk-in sessions can't be moved yet.",
    SESSION_HAS_NO_STAY: "This room session has no guest stay attached, so it can't be moved.",
    TABLE_NOT_FOUND: "That table no longer exists.",
    TABLE_INACTIVE: "That table isn't in service.",
    TABLE_OCCUPIED: "That table already has a session open on it.",
    TABLE_NEEDS_CLEANING: "That table still needs cleaning. Mark it clean first.",
    ROOM_NOT_FOUND: "That room no longer exists.",
    ROOM_OCCUPIED: "That room is already occupied.",
    ROOM_NEEDS_CLEANING: "That room is still being made up.",
    ROOM_UNAVAILABLE: "That room is out of service.",
    STAY_NOT_FOUND: "That guest stay no longer exists.",
    STAY_ALREADY_CLOSED: "That guest has already checked out.",
  };

  for (const key of Object.keys(map)) {
    if (message.includes(key)) return map[key];
  }
  return "Could not move this session. Please try again.";
}

/**
 * Where may THIS session move, for THIS user?
 *
 * Mirrors every predicate transfer_session enforces, so the modal never offers a
 * destination the server is about to refuse. The function remains the authority — this
 * is the courtesy layer.
 */
export async function getTransferTargets(
  sessionId: string
): Promise<TransferOptions | { error: string }> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select("id, restaurant_id, status, table_id, room_id, room_stay_id, walk_in_no, restaurant_tables ( number ), rooms ( number )")
    .eq("id", sessionId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();

  if (!session) return { error: "That session no longer exists." };
  if (session.status === "closed") {
    return { error: "This bill has already been settled, so it can't be moved." };
  }
  if (session.walk_in_no != null) {
    return { error: "Walk-in sessions can't be moved yet." };
  }

  const kind: "table" | "room" = session.table_id ? "table" : "room";
  if (kind === "room" && !session.room_id) {
    return { error: "This session isn't on a table or a room." };
  }
  if (!mayTransfer(ru, kind)) {
    return { error: "You don't have permission to move sessions." };
  }

  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  // The SOURCE must be visible too: without this, a stray session id would let a waiter
  // move a table out of a section they cannot see.
  const seesSource =
    kind === "table"
      ? visibility.seesAll || visibility.canSeeTable(session.table_id)
      : visibility.seesAll || visibility.canSeeRoom(session.room_id);
  if (!seesSource) return { error: "That isn't in your section." };

  // Every place already spoken for. `<> 'closed'` for the same reason the unique index
  // uses it: a pending_activation session is a customer's un-approved QR order and it
  // holds real items.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: busy } = await (service as any)
    .from("sessions")
    .select("table_id, room_id")
    .eq("restaurant_id", ru.restaurant_id)
    .neq("status", "closed");
  const takenTables = new Set(
    ((busy ?? []) as { table_id: string | null }[]).map((s) => s.table_id).filter(Boolean)
  );
  const takenRooms = new Set(
    ((busy ?? []) as { room_id: string | null }[]).map((s) => s.room_id).filter(Boolean)
  );

  let targets: TransferTarget[] = [];
  let currentLabel = "";

  if (kind === "table") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tables } = await (service as any)
      .from("restaurant_tables")
      .select("id, number, cleaning_since")
      .eq("restaurant_id", ru.restaurant_id)
      .eq("is_active", true)
      .order("number");

    targets = ((tables ?? []) as { id: string; number: string; cleaning_since: string | null }[])
      .filter(
        (t) =>
          t.id !== session.table_id &&
          !t.cleaning_since &&
          !takenTables.has(t.id) &&
          (visibility.seesAll || visibility.canSeeTable(t.id))
      )
      .map((t) => ({ id: t.id, label: t.number }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentLabel = (session as any).restaurant_tables?.number ?? "—";
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rooms } = await (service as any)
      .from("rooms")
      .select("id, number, status")
      .eq("restaurant_id", ru.restaurant_id)
      .order("number");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stays } = await (service as any)
      .from("room_stays")
      .select("room_id")
      .eq("restaurant_id", ru.restaurant_id)
      .eq("status", "active");
    const stayed = new Set(((stays ?? []) as { room_id: string }[]).map((s) => s.room_id));

    targets = ((rooms ?? []) as { id: string; number: string; status: string }[])
      .filter(
        (r) =>
          r.id !== session.room_id &&
          r.status === "available" &&
          !stayed.has(r.id) &&
          !takenRooms.has(r.id) &&
          (visibility.seesAll || visibility.canSeeRoom(r.id))
      )
      .map((r) => ({ id: r.id, label: r.number }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentLabel = (session as any).rooms?.number ?? "—";
  }

  return { kind, current_label: currentLabel, targets };
}

/** Move the session. One RPC; the function is the transaction. */
export async function transferSession(
  input: TransferInput
): Promise<{ ok: true } | { error: string }> {
  const ru = await getRestaurantUser();
  const service = createServiceClient();

  const { sessionId, destTableId, destRoomId, reason, upgradeAmount } = input;
  if (!destTableId && !destRoomId) return { error: "Pick somewhere to move to." };
  if (destTableId && destRoomId) return { error: "Pick either a table or a room, not both." };

  const kind: "table" | "room" = destTableId ? "table" : "room";
  if (!mayTransfer(ru, kind)) {
    return { error: "You don't have permission to move sessions." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (service as any)
    .from("sessions")
    .select("id, table_id, room_id")
    .eq("id", sessionId)
    .eq("restaurant_id", ru.restaurant_id)
    .maybeSingle();
  if (!session) return { error: "That session no longer exists." };

  // BOTH ends, deliberately. Checking only the source would let someone move a party
  // into a section they cannot see — where it promptly vanishes from their own
  // dashboard, still holding a live bill.
  const visibility = await buildVisibilityFilter(ru.restaurant_id, ru);
  if (!visibility.seesAll) {
    const ok =
      kind === "table"
        ? visibility.canSeeTable(session.table_id) && visibility.canSeeTable(destTableId!)
        : visibility.canSeeRoom(session.room_id) && visibility.canSeeRoom(destRoomId!);
    if (!ok) return { error: "That isn't in your section." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).rpc("transfer_session", {
    p_restaurant_id: ru.restaurant_id,
    p_session_id: sessionId,
    p_dest_table_id: destTableId ?? null,
    p_dest_room_id: destRoomId ?? null,
    p_created_by: ru.id,
    p_reason: reason?.trim() || null,
    p_upgrade_amount: kind === "room" && upgradeAmount ? upgradeAmount : null,
    p_upgrade_description: null,
  });

  if (error) {
    return { error: explain(error.message ?? "", error.code) };
  }

  revalidatePath("/employee/dashboard");
  revalidatePath(`/employee/session/${sessionId}`);
  revalidatePath("/employee/queue");
  return { ok: true };
}
