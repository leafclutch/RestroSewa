// Plain (non-server) walk-in constants + helpers, so they can be imported by both the
// server actions in app/actions/pos.ts and client components. A "use server" module may
// only export async functions, so these can't live there.

/** How many fixed walk-in workspaces the dashboard shows (W1, W2, W3 …). One place to raise. */
export const WALK_IN_SLOT_COUNT = 3;

/**
 * Extra walk-ins staff can add on a busy day, numbered after the fixed ones (W4, W5 …).
 * An extra one is NOT a stored slot: it exists only as an open walk-in session, so it
 * shows on the dashboard while its order is running and disappears by itself once the
 * bill is closed (or the empty session is closed). One place to raise the cap.
 */
export const EXTRA_WALK_IN_MAX = 12;

/** The highest walk-in number that can ever be in use. */
export const MAX_WALK_IN_NO = WALK_IN_SLOT_COUNT + EXTRA_WALK_IN_MAX;

/** The slot's short label, e.g. 1 → "W1". */
export const walkInLabel = (no: number) => `W${no}`;
