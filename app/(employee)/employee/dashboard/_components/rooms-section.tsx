import { getRoomsOverview } from "@/app/actions/rooms";
import { hasAnyPermission, PERMISSIONS } from "@/lib/permissions";
import type { RestaurantUserContext } from "@/lib/auth/guards";
import { RoomsGrid } from "./rooms-grid";

// Rooms, on their own. Previously a row of identical squares bolted onto the end
// of the Tables section — which said nothing a receptionist needs: not who is in
// the room, not since when, not what they owe.
//
// The first fetch happens here so the cards are in the server HTML; RoomsGrid
// keeps them live by refetching itself, rather than calling router.refresh() and
// dragging the whole dashboard along with it.
export async function RoomsSection({
  canCheckIn,
  restaurantUser,
}: {
  canCheckIn: boolean;
  restaurantUser: RestaurantUserContext;
}) {
  const rooms = await getRoomsOverview();

  // Moving a guest rearranges a live folio, so it gates where billing does. UX only —
  // transferSession re-checks server-side.
  const canShift = hasAnyPermission(restaurantUser, [
    PERMISSIONS.MANAGE_ROOMS,
    PERMISSIONS.PROCESS_PAYMENTS,
    PERMISSIONS.CLOSE_BILLS,
  ]);

  return <RoomsGrid initial={rooms} canCheckIn={canCheckIn} canShift={canShift} />;
}
