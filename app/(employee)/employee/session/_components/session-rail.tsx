"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { fetchSessionKind } from "@/lib/floor-client";

/**
 * The session screen's left rail shows the list the open session belongs to:
 * tables for a table, walk-ins for a walk-in.
 *
 * The rail lives in `(split)/layout.tsx`, above `[id]`, so it stays mounted while
 * staff hop between sessions — which also means it can't read the session itself.
 * Sources, best first:
 *
 *  1. `RailKind`, rendered by the session page, which KNOWS what it is showing.
 *  2. The open table / walk-in session ids the layout fetched.
 *  3. A one-query lookup (`/api/floor?part=kind`) for an id neither knows.
 *
 * (2) is often STALE: Next caches this layout — it is prefetched from the dashboard's
 * links and reused across sessions — so a walk-in added a moment ago is missing from
 * it. That used to fall back to "tables", which is exactly the tables list flashing
 * before the walk-ins on opening a walk-in. An id we can't place now shows a
 * placeholder while (3) answers, never a guessed list.
 */
export type RailKindValue = "tables" | "walkins";

// What the session pages have said, keyed by session id. Module-level so the page
// (deep below) and the rail (in the layout) share it without a context provider.
const told = new Map<string, RailKindValue>();
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const remember = (id: string, kind: RailKindValue) => {
  if (told.get(id) === kind) return;
  told.set(id, kind);
  version++;
  listeners.forEach((fn) => fn());
};

/** Rendered by the session page: "this session is a table / a walk-in". */
export function RailKind({ sessionId, kind }: { sessionId: string; kind: RailKindValue }) {
  useEffect(() => remember(sessionId, kind), [sessionId, kind]);
  return null;
}

export function SessionRail({
  tables,
  walkins,
  walkInSessionIds,
  tableSessionIds,
}: {
  tables: React.ReactNode;
  walkins: React.ReactNode;
  /** Open walk-in / table sessions when the layout rendered — possibly stale (see above). */
  walkInSessionIds: string[];
  tableSessionIds: string[];
}) {
  const pathname = usePathname();
  const sessionId = pathname?.startsWith("/employee/session/") ? pathname.split("/")[3] : undefined;
  // Re-render whenever any page reports its kind.
  useSyncExternalStore(subscribe, () => version, () => 0);
  // The last list actually shown — kept while an unknown id is being looked up, so
  // hopping between walk-ins in this rail never blanks it.
  const [lastShown, setLastShown] = useState<RailKindValue | null>(null);

  const known: RailKindValue | null = !sessionId
    ? null
    : told.get(sessionId) ??
      (walkInSessionIds.includes(sessionId) ? "walkins" : tableSessionIds.includes(sessionId) ? "tables" : null);

  // Unplaceable id — ask. Whichever of this or the page's RailKind lands first wins;
  // they agree.
  useEffect(() => {
    if (!sessionId || known) return;
    let alive = true;
    fetchSessionKind(sessionId).then((k) => { if (alive && k) remember(sessionId, k); });
    return () => { alive = false; };
  }, [sessionId, known]);

  useEffect(() => { if (known) setLastShown(known); }, [known]);

  const kind = known ?? lastShown;

  // Both lists stay mounted (each keeps its own live data); only one is visible.
  return (
    <>
      {!kind && (
        <div className="flex flex-col gap-1.5 p-1" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg animate-pulse"
              style={{ height: 44, width: 48, background: "var(--color-canvas-soft)" }}
            />
          ))}
        </div>
      )}
      <div hidden={kind !== "tables"}>{tables}</div>
      <div hidden={kind !== "walkins"}>{walkins}</div>
    </>
  );
}
