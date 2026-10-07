// Client-side reads of the floor plan through /api/floor — see that route for why these
// are plain fetches and not server-action calls (server actions queue behind, and in
// front of, navigation).

export type FloorPart = "tables" | "rooms" | "walkins";

/** Fetch one grid's live list. Throws on failure so callers keep their last list. */
export async function fetchFloor<T>(part: FloorPart): Promise<T> {
  const res = await fetch(`/api/floor?part=${part}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`floor ${part}: ${res.status}`);
  return (await res.json()) as T;
}

/** Which rail a session belongs to, or null if it isn't this restaurant's. */
export async function fetchSessionKind(sessionId: string): Promise<"tables" | "walkins" | null> {
  const res = await fetch(`/api/floor?part=kind&session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return ((await res.json()) as { kind: "tables" | "walkins" | null }).kind;
}
