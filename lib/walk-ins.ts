// Plain (non-server) walk-in constants + helpers, so they can be imported by both the
// server actions in app/actions/pos.ts and client components. A "use server" module may
// only export async functions, so these can't live there.

/** How many fixed walk-in workspaces the dashboard shows (W1, W2, W3 …). One place to raise. */
export const WALK_IN_SLOT_COUNT = 3;

/** The slot's short label, e.g. 1 → "W1". */
export const walkInLabel = (no: number) => `W${no}`;
