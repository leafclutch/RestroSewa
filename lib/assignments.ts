import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

// ─── Table-Group based order/notification visibility ──────────────────────────
//
// Staff are assigned to TABLE GROUPS (e.g. Indoor, Outdoor), never to individual
// tables. Every table belongs to exactly one group, so a table's activity —
// orders, waiter calls, bill requests — is visible only to staff assigned to
// that table's group. Staff in different groups are completely isolated.
//
//   • A staff member sees a table's activity  ⇔  they belong to the table's group.
//   • Admins and staff with MANAGE_TABLES see everything (managers/owners).
//   • Sessions with no table (walk-in) have no group boundary, so they stay
//     visible to all staff — there is nothing to isolate.
//   • Rooms mirror tables: a room's group is its room type. Staff may also be
//     pinned to a single room; either grants visibility.
//
// This is intentionally strict: there is no "individual table" override and no
// "unassigned table falls back to everyone" loophole. An ungrouped table is only
// visible to admins/managers until an admin puts it in a group.

export type StaffViewer = {
  id: string;
  role: string;
  permissions: string[];
};

export type VisibilityFilter = {
  /** True when the viewer sees everything (admin / table manager). */
  seesAll: boolean;
  /** Whether the viewer may see a table session's activity. */
  canSeeTable: (tableId: string | null) => boolean;
  /** Whether the viewer may see a room session's activity. */
  canSeeRoom: (roomId: string | null) => boolean;
};

export function viewerSeesAllGroups(viewer: StaffViewer): boolean {
  return (
    viewer.role === "restaurant_admin" ||
    hasPermission(viewer, PERMISSIONS.MANAGE_TABLES)
  );
}

// ─── Workstation assignment ───────────────────────────────────────────────────
// Kitchen/Bar/Bakery staff are assigned one or more WORKSTATIONS. When a staff
// member has ≥1 workstation they are "workstation staff": they only work items
// routed to their workstation(s), restaurant-wide (a kitchen cooks for every
// table). Staff with no workstation (waiter/supervisor/manager) are unaffected
// and keep seeing full orders per their table-group / permissions.
export const getAssignedWorkstationIds = cache(
  async (userId: string): Promise<Set<string>> => {
    const service = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (service as any)
      .from("restaurant_user_workstations")
      .select("workstation_id")
      .eq("restaurant_user_id", userId);
    return new Set(((data ?? []) as { workstation_id: string }[]).map((r) => r.workstation_id));
  }
);

/**
 * The five reads behind the filter, memoised for the life of one request.
 *
 * Keyed on the two ID STRINGS, deliberately. React's `cache()` keys on argument
 * identity, so passing the `viewer` OBJECT through would miss every single time —
 * each caller builds its own object — and the memo would be decorative. Only
 * primitives cross this boundary.
 *
 * This matters because a Cashier's dashboard called buildVisibilityFilter three
 * times per render (Orders, Tables, Rooms), and each call was five queries: the
 * same fifteen reads, three times over, for an answer that cannot change within a
 * single request.
 */
const loadAssignments = cache(async (restaurantId: string, viewerId: string) => {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  const [myGroupsRes, myRoomTypesRes, myRoomsRes, tablesRes, roomsRes] = await Promise.all([
    svc.from("restaurant_user_table_groups").select("table_group_id").eq("restaurant_user_id", viewerId),
    svc.from("restaurant_user_room_types").select("room_type_id").eq("restaurant_user_id", viewerId),
    svc.from("restaurant_user_rooms").select("room_id").eq("restaurant_user_id", viewerId),
    svc.from("restaurant_tables").select("id, group_id").eq("restaurant_id", restaurantId),
    svc.from("rooms").select("id, room_type_id").eq("restaurant_id", restaurantId),
  ]);

  return {
    myGroups: new Set(
      ((myGroupsRes.data ?? []) as { table_group_id: string }[]).map((r) => r.table_group_id)
    ),
    myRoomTypes: new Set(
      ((myRoomTypesRes.data ?? []) as { room_type_id: string }[]).map((r) => r.room_type_id)
    ),
    myRooms: new Set(((myRoomsRes.data ?? []) as { room_id: string }[]).map((r) => r.room_id)),
    tableGroup: new Map<string, string | null>(
      ((tablesRes.data ?? []) as { id: string; group_id: string | null }[]).map((t) => [t.id, t.group_id])
    ),
    roomTypeOf: new Map<string, string | null>(
      ((roomsRes.data ?? []) as { id: string; room_type_id: string | null }[]).map((r) => [
        r.id,
        r.room_type_id,
      ])
    ),
  };
});

type Assignments = Awaited<ReturnType<typeof loadAssignments>>;

/**
 * The rules themselves, in ONE place.
 *
 * Pulled out because there are now two directions of travel through them. The
 * screens ask "given this viewer, which rows may they see?"; web push asks the
 * inverse, "given this row, which staff should be woken?" — and if those two ever
 * answered differently, a push would land on a phone whose owner cannot open the
 * screen it links to. Same predicate, both directions.
 */
function makeFilter(a: Assignments): VisibilityFilter {
  return {
    seesAll: false,
    canSeeTable(tableId) {
      if (!tableId) return true;                 // walk-in / no table → no group boundary
      const groupId = a.tableGroup.get(tableId) ?? null;
      if (!groupId) return false;                // ungrouped table → admins/managers only
      return a.myGroups.has(groupId);
    },
    canSeeRoom(roomId) {
      if (!roomId) return true;                  // no room context → no boundary
      if (a.myRooms.has(roomId)) return true;    // pinned directly to this room
      const typeId = a.roomTypeOf.get(roomId) ?? null;
      return typeId ? a.myRoomTypes.has(typeId) : false;
    },
  };
}

const SEES_EVERYTHING: VisibilityFilter = {
  seesAll: true,
  canSeeTable: () => true,
  canSeeRoom: () => true,
};

export async function buildVisibilityFilter(
  restaurantId: string,
  viewer: StaffViewer
): Promise<VisibilityFilter> {
  // Managers and admins bypass all group filtering — and don't touch the database.
  if (viewerSeesAllGroups(viewer)) return SEES_EVERYTHING;

  return makeFilter(await loadAssignments(restaurantId, viewer.id));
}

/**
 * May this staff member see this actionable notification?
 *
 * The one rule, shared by the Notifications panel (which filters rows for a viewer)
 * and by the push fan-out (which picks viewers for a row). Kitchen/bar staff are
 * excluded outright: they work the Orders queue, and a waiter call or a bill request
 * is not their job — waking a chef's phone for one would be noise, and noise is how
 * a staff member learns to swipe notifications away without reading them.
 */
export function canSeeNotification(
  visibility: VisibilityFilter,
  assignedWorkstationCount: number,
  notif: { table_id: string | null; room_id: string | null }
): boolean {
  const isWorkstationStaff = !visibility.seesAll && assignedWorkstationCount > 0;
  if (isWorkstationStaff) return false;

  return (
    visibility.seesAll ||
    (visibility.canSeeTable(notif.table_id) && visibility.canSeeRoom(notif.room_id))
  );
}

/**
 * The other half of the floor: does this WORKSTATION event belong to this person?
 *
 * The exact inverse of the rule above, and it has to exist separately because the
 * two audiences are disjoint by design. `canSeeNotification` deliberately EXCLUDES
 * workstation staff — a chef should not be pinged because table 6 wants their bill.
 * But that same exclusion is why the chef and the bartender, the two people most
 * likely to have a phone in an apron and their hands full, currently receive nothing
 * at all. A new order for their station is the one thing they DO need.
 *
 * Routed by station, not by table: a kitchen cooks for every table in the building,
 * so table groups are meaningless here. An order with items for the Bar and items for
 * the Kitchen reaches both, and only those.
 *
 * Note who is NOT here: the owner. Restaurant admins see everything else in this
 * system, but they are not given every kitchen ticket — a phone that buzzes on every
 * single order is a phone whose owner learns to ignore it, and that habit is exactly
 * what you cannot afford when the alert that matters finally arrives. An owner who
 * genuinely wants kitchen pings can assign themselves to the Kitchen workstation,
 * which is a deliberate act.
 */
export function canSeeWorkstationEvent(
  assignedWorkstations: Set<string>,
  eventWorkstationIds: string[]
): boolean {
  if (assignedWorkstations.size === 0) return false;
  return eventWorkstationIds.some((id) => assignedWorkstations.has(id));
}
