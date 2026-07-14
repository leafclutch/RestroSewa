// A `template` and not a `layout`: a layout is reused across navigations and its
// DOM persists, so an entry animation on one would play exactly once, on first
// load. A template gets a fresh instance per route — which is the only way the
// animation replays as staff move between the floor plan, the queue and a bill.
//
// The cost is that a template cannot hold state across routes. Nothing here does;
// the nav and the notification bell live in the layout above, and deliberately stay
// there so the bell's poll and its unread queue survive a navigation.
export default function EmployeeTemplate({ children }: { children: React.ReactNode }) {
  return <div className="rs-page">{children}</div>;
}
