import { DashboardSkeleton } from "./_components/staff-dashboard";

/**
 * The dashboard's shell while it loads — coming back from a table, a room, Stock, Purchases
 * and the rest. It used to have none, so on a slow load the page you had just left sat there
 * frozen after Back was tapped.
 *
 * It only shows when it is NEEDED: the whole skeleton fades in after a short delay
 * (`.rs-wait-in`), so a quick return — the usual case — goes straight to the dashboard and
 * never flashes a loader; only a load that is actually taking a moment shows one.
 *
 * The shape is the dashboard's own: the sticky section bar, then the section cards
 * (`DashboardSkeleton`, the same one the dashboard shows while it positions itself), at the
 * same paddings as `StaffDashboard`, so the real page lands where the skeleton was.
 */
const bar = (w: string | number, h = 12, extra = "") => (
  <div className={`rounded-md animate-pulse ${extra}`} style={{ height: h, width: w, background: "var(--color-hairline)" }} />
);

export default function DashboardLoading() {
  return (
    <div className="rs-wait-in pb-10 pt-1.5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading dashboard…</span>

      {/* The section bar */}
      <div className="px-3 sm:px-5 lg:px-10 py-2.5">
        <div
          className="w-full flex items-center gap-2 rounded-full border p-2 overflow-hidden"
          style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas)", boxShadow: "var(--shadow-card)" }}
        >
          {[96, 92, 104, 88, 84].map((w, i) => (
            <div key={i} className="shrink-0">{bar(w, 44, "rounded-full")}</div>
          ))}
        </div>
      </div>

      {/* The sections */}
      <DashboardSkeleton />
    </div>
  );
}
