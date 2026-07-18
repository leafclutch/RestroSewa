import { getWalkInStatusOverview } from "@/app/actions/pos";
import type { RestaurantUserContext } from "@/lib/auth/guards";
import { WalkInsGrid } from "./walkins-grid";

// Walk-ins are fixed workspaces (W1, W2, W3 …) that behave like tables — a slot stays
// occupied until its bill is closed. Unlike tables they have no table group, so every
// staff member who can work tables sees all of them.
//
// Server component does the first fetch (in the HTML, no loading flash); WalkInsGrid keeps
// it live from there off the same "tables" realtime topic a session change already emits.
export async function WalkInsSection({ restaurantUser }: { restaurantUser: RestaurantUserContext }) {
  const walkIns = await getWalkInStatusOverview(restaurantUser.restaurant_id);
  return <WalkInsGrid initial={walkIns} />;
}
