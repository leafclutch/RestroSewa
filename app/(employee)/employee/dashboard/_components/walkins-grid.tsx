"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { fetchFloor } from "@/lib/floor-client";
import { usePathname, useRouter } from "next/navigation";
import { addWalkIn, openWalkInSlot } from "@/app/actions/pos";
import type { WalkInOpenResult, WalkInStatus } from "@/app/actions/pos";
import { walkInLabel, EXTRA_WALK_IN_MAX } from "@/lib/walk-ins";
import { SECTION_ACCENT } from "@/lib/section-colors";
import { CountPill } from "@/components/ui/count-pill";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Plus, ShoppingBag } from "lucide-react";

const CARD =
  "flex flex-col items-center justify-center rounded-xl border w-full p-2 text-center transition-all";
const NUMBER = "font-normal leading-tight break-words line-clamp-2 w-full";
const NUMBER_STYLE = { letterSpacing: "-0.3px", fontSize: "clamp(1.05rem, 3.6vw, 1.6rem)" } as const;
// The session screen's left rail (see tables-grid's compact mode): label only, small tiles.
const CARD_COMPACT =
  "flex flex-col items-center justify-center rounded-lg border w-full p-1 text-center transition-all";
const NUMBER_STYLE_COMPACT = { letterSpacing: "-0.2px", fontSize: "0.8rem" } as const;
// "You are here" — the same outer ring the tables rail puts on the open table.
const CURRENT_RING = "0 0 0 3px var(--color-canvas), 0 0 0 5px var(--color-primary)";

// One slot card. Occupied → a link straight back into its session (persists like a table).
// Free → a server action that opens/reopens the slot and redirects.
const WalkInCard = memo(function WalkInCard({
  slot,
  canManage,
  onError,
  onResult,
  compact = false,
  isCurrent = false,
}: {
  slot: WalkInStatus;
  canManage: boolean;
  onError: (msg: string) => void;
  /** Handles what the open action returned — navigate, update the list. */
  onResult: (r: WalkInOpenResult, slot: { no: number; extra: boolean }) => void;
  compact?: boolean;
  isCurrent?: boolean;
}) {
  const [opening, startOpen] = useTransition();
  const label = walkInLabel(slot.no);
  const card = compact ? CARD_COMPACT : CARD;
  const numberStyle = compact ? NUMBER_STYLE_COMPACT : NUMBER_STYLE;
  const minHeight = compact ? 44 : 88;

  // In use — the section's own purple, deepened to a solid fill. A free slot is a light purple
  // tint; taking an order fills it solid. Only the intensity changes, so Walk-ins keep their
  // purple identity end to end (an active walk-in is NOT the same blue as an active table).
  if (slot.session_id) {
    return (
      <Link
        href={`/employee/session/${slot.session_id}`}
        title={`Walk-in ${label} — active`}
        className={`${card} hover:brightness-110`}
        // Constant purple FILL (see the --fill-* block): the flipping --sec-walkins token goes
        // light in dark and white text can't sit on it, so the solid card uses the fixed fill.
        style={{
          minHeight,
          background: "var(--fill-purple)",
          borderColor: "var(--fill-purple)",
          boxShadow: isCurrent ? CURRENT_RING : undefined,
        }}
      >
        {!compact && <ShoppingBag aria-hidden size={13} className="mb-0.5" style={{ color: "rgba(255,255,255,0.75)" }} />}
        <span className={NUMBER} style={{ ...numberStyle, color: "#fff" }}>{label}</span>
        {!compact && (
          <span className="text-xs mt-1 truncate max-w-full px-1" style={{ color: "rgba(255,255,255,0.9)" }}>
            {slot.customer_name || "Active"}
          </span>
        )}
      </Link>
    );
  }

  // Free. Purple-tinted rather than green: an idle W-slot isn't a seat someone can be shown
  // to, it's a lane waiting for an order — the purple keeps it distinct from the free tables
  // sitting directly above it in the same page.
  const a = SECTION_ACCENT.walkins;
  // Read-only (View Walk-ins without Manage): show the slot's status but don't let it be
  // opened. The server (openWalkInSlot) enforces this too.
  if (!canManage) {
    return (
      <div
        title={`Walk-in ${label} — free`}
        className={card}
        style={{ minHeight, background: a.soft, borderColor: a.color }}
      >
        {!compact && <ShoppingBag aria-hidden size={13} className="mb-0.5" style={{ color: a.color }} />}
        <span className={NUMBER} style={{ ...numberStyle, color: "var(--color-ink)" }}>{label}</span>
        {!compact && <span className="text-xs mt-1" style={{ color: a.color }}>Free</span>}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={opening}
      title={`Walk-in ${label} — free`}
      onClick={() =>
        startOpen(async () => {
          onError("");
          onResult(await openWalkInSlot(slot.no), { no: slot.no, extra: slot.extra });
        })
      }
      className={`${card} hover:brightness-95`}
      style={{
        minHeight,
        background: a.soft,
        borderColor: a.color,
        opacity: opening ? 0.5 : 1,
      }}
    >
      {!compact && <ShoppingBag aria-hidden size={13} className="mb-0.5" style={{ color: a.color }} />}
      <span className={NUMBER} style={{ ...numberStyle, color: "var(--color-ink)" }}>{label}</span>
      {!compact && <span className="text-xs mt-1" style={{ color: a.color }}>Free</span>}
    </button>
  );
});

// "+ Add walk-in": opens a new walk-in (W4, W5 …) straight into its order screen.
// Dashed outline, so it reads as an action, not as another free slot.
function AddWalkInCard({
  onError,
  onResult,
  compact = false,
}: {
  onError: (msg: string) => void;
  onResult: (r: WalkInOpenResult, slot: { no: number; extra: boolean } | null) => void;
  compact?: boolean;
}) {
  const [adding, startAdd] = useTransition();
  const a = SECTION_ACCENT.walkins;
  return (
    <button
      type="button"
      disabled={adding}
      title="Add another walk-in — it goes away by itself once its bill is closed"
      onClick={() =>
        startAdd(async () => {
          onError("");
          onResult(await addWalkIn(), null);
        })
      }
      className={`${compact ? CARD_COMPACT : CARD} hover:brightness-95`}
      style={{
        minHeight: compact ? 44 : 88,
        background: "transparent",
        borderColor: a.color,
        borderStyle: "dashed",
        opacity: adding ? 0.5 : 1,
      }}
    >
      <Plus aria-hidden size={compact ? 16 : 20} style={{ color: a.color }} />
      {!compact && (
        <span className="text-xs mt-1 font-medium" style={{ color: a.color }}>
          {adding ? "Adding…" : "Add walk-in"}
        </span>
      )}
    </button>
  );
}

export function WalkInsGrid({
  initial,
  canManage,
  compact = false,
}: {
  initial: WalkInStatus[];
  canManage: boolean;
  /** The session screen's left rail, shown while a walk-in is open — see tables-grid. */
  compact?: boolean;
}) {
  const [walkIns, setWalkIns] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  // A plain fetch, not a server action: server actions run one at a time in the same
  // queue as navigation, so every realtime event used to hold up any tap that navigates.
  // `seq` drops a response that lands after a newer one was asked for.
  const seq = useRef(0);
  const resync = useCallback(() => {
    const mine = ++seq.current;
    fetchFloor<WalkInStatus[]>("walkins")
      .then((w) => { if (mine === seq.current) setWalkIns(w); })
      .catch(() => { /* keep the last list */ });
  }, []);

  // A walk-in session opening/closing emits the "tables" topic (same sessions trigger),
  // so this stays live across devices exactly like the Tables grid.
  useRealtime(["tables", "orders"], resync);

  // `useState` seeds once, so a route refresh (pull-to-refresh) would re-run this
  // section's query and then discard it. Adopt the fresh props — see tables-grid.
  useEffect(() => setWalkIns(initial), [initial]);

  const onError = useCallback((msg: string) => setError(msg || null), []);
  const router = useRouter();
  // Which walk-in is open right now, for the rail's "you are here" ring.
  const pathname = usePathname();
  const activeSessionId = pathname?.startsWith("/employee/session/") ? pathname.split("/")[3] : undefined;
  const canAdd = canManage && walkIns.filter((w) => w.extra).length < EXTRA_WALK_IN_MAX;

  // An open/add came back. Go there from the CLIENT (the loading screen shows at once),
  // mark the slot busy right away rather than waiting for a refetch, then refetch to
  // pick up the real details (a new extra walk-in's number, its opened time).
  const onResult = useCallback(
    (r: WalkInOpenResult, slot: { no: number; extra: boolean } | null) => {
      if ("error" in r) {
        setError(r.error);
        resync(); // whatever went wrong, the list was probably stale
        return;
      }
      if (slot) {
        setWalkIns((list) =>
          list.map((w) => (w.no === slot.no ? { ...w, session_id: r.sessionId, session_opened_at: new Date().toISOString() } : w))
        );
      }
      router.push(`/employee/session/${r.sessionId}`);
      resync();
    },
    [router, resync]
  );

  // Refetch on mount. Browser Back restores the dashboard from the router's cache with
  // the list as it was — a walk-in added since would be missing until a manual refresh.
  useEffect(() => { resync(); }, [resync]);

  // Landing on a walk-in this list doesn't have yet (added on this device a moment ago,
  // or on another one) — fetch rather than wait for the realtime event.
  useEffect(() => {
    if (activeSessionId && pathname?.startsWith("/employee/session/") && !walkIns.some((w) => w.session_id === activeSessionId)) {
      resync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // Coming back to the tab/app after a while: whatever happened meanwhile is fetched.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") resync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [resync]);
  const active = walkIns.filter((w) => w.session_id).length;

  const free = walkIns.length - active;

  return (
    <div>
      {compact ? (
        // Rail header — same shape as the tables rail's.
        <div
          className="sticky top-0 z-10 mb-2 pb-2 border-b"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: SECTION_ACCENT.walkins.color }}>
            Walk-ins
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {active} active · {free} free
          </p>
        </div>
      ) : (
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <p className="text-base font-medium" style={{ color: SECTION_ACCENT.walkins.color }}>Walk-ins</p>
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {free > 0 && <CountPill n={free} label="free" tone={SECTION_ACCENT.walkins} />}
          {active > 0 && <CountPill n={active} label="active" tone={SECTION_ACCENT.walkins} fill="var(--fill-purple)" />}
          <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>{walkIns.length} total</span>
        </span>
      </div>
      )}

      {error && (
        <p className="text-xs mb-2" style={{ color: "var(--color-ruby)" }}>{error}</p>
      )}

      <div
        className={compact ? "grid gap-1.5" : "grid gap-2.5"}
        style={
          compact
            ? { gridTemplateColumns: "repeat(auto-fill, 48px)" }
            : { gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }
        }
      >
        {walkIns.map((w) => (
          <WalkInCard
            key={w.no}
            slot={w}
            canManage={canManage}
            onError={onError}
            onResult={onResult}
            compact={compact}
            isCurrent={!!activeSessionId && w.session_id === activeSessionId}
          />
        ))}
        {canAdd && <AddWalkInCard onError={onError} onResult={onResult} compact={compact} />}
      </div>
    </div>
  );
}
