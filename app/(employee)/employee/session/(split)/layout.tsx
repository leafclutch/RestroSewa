import { requireRestaurantStaff } from "@/lib/auth/guards";
import { TablesSection } from "../../dashboard/_components/tables-section";
import { WalkInsSection } from "../../dashboard/_components/walkins-section";
import { getWalkInStatusOverview, getTableStatusOverview } from "@/app/actions/pos";
import { WALKIN_ACCESS } from "@/lib/permissions";
import { SessionRail } from "../_components/session-rail";
import { NAV_HEIGHT, RAIL_BOX_WIDTH } from "../_components/layout-metrics";

/**
 * Deliberately ABOVE `session/[id]/`, not a `layout.tsx` inside it. Next.js
 * remounts a layout that reads the CHANGED dynamic segment on every
 * navigation within it, but preserves one that sits above that segment — so
 * placing the tables rail here, where nothing depends on `params.id`, is
 * what keeps it mounted (no re-fetch, no flash) while a waiter clicks from
 * one table's session page to another's. `session-split-view.tsx` (rendered
 * by `session/[id]/page.tsx`, below this layout) owns the order and menu
 * columns instead, since THOSE are expected to reload per table — see the
 * request that split it out this way.
 *
 * The two pieces share their geometry (`layout-metrics.ts`) so the rail here
 * and the order/menu columns rendered by the page below still read as one
 * continuous strip, even though they're now two independently-`fixed`
 * elements in different parts of the tree.
 *
 * Scoped to the `(split)` route group so it wraps ONLY the table session page.
 * The standalone add-items screen (`(plain)/[id]/add`) sits outside it, because
 * a room stay's "Add order" opens that screen too, and a room must not inherit
 * the tables rail or the split-view loading skeleton.
 */
export default async function SessionLayout({ children }: { children: React.ReactNode }) {
  const { restaurantUser } = await requireRestaurantStaff();
  // A walk-in session shows the walk-ins in this rail, not the tables (see SessionRail).
  // The open session ids are only a first-paint hint (this layout is cached across
  // sessions); the rail looks up anything they don’t cover, and the page confirms.
  // Both reads run in parallel; the tables one is light (one query plus the viewer scope).
  const canSeeWalkIns = WALKIN_ACCESS.canViewWalkins(restaurantUser);
  const [walkIns, tablesOverview] = await Promise.all([
    canSeeWalkIns ? getWalkInStatusOverview(restaurantUser.restaurant_id) : Promise.resolve([]),
    getTableStatusOverview(restaurantUser.restaurant_id),
  ]);
  const walkInSessionIds = walkIns.map((w) => w.session_id).filter((id): id is string => !!id);
  const tableSessionIds = tablesOverview.map((t) => t.session_id).filter((id): id is string => !!id);

  return (
    <>
      {/* `children` (`session/[id]/page.tsx`, via `SessionSplitView`) already
          manages its own mobile/desktop split internally — its mobile block is
          `lg:hidden`, its desktop block is `hidden lg:...`. Rendered once,
          plain, alongside the rail below (which is `hidden lg:block` on its
          own): below `lg` only children's mobile block paints; at `lg` and up
          both the rail and children's desktop block paint, side by side. */}
      {children}

      {/* Desktop/tablet: the persistent rail, fixed to the viewport exactly like
          the split-view's own columns (see that file for why `fixed` rather than
          a computed flow height). */}
      <div
        className="hidden lg:block fixed z-10"
        style={{
          top: NAV_HEIGHT,
          left: 0,
          bottom: 0,
          width: RAIL_BOX_WIDTH,
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 12,
        }}
      >
        <div
          className="h-full overflow-y-auto thin-scrollbar rounded-xl border p-2"
          style={{
            borderColor: "var(--color-hairline-input)",
            background: "var(--color-canvas)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <SessionRail
            tables={<TablesSection restaurantUser={restaurantUser} compact />}
            walkins={canSeeWalkIns ? <WalkInsSection restaurantUser={restaurantUser} compact /> : null}
            walkInSessionIds={walkInSessionIds}
            tableSessionIds={tableSessionIds}
          />
        </div>
      </div>
    </>
  );
}
