"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { fetchFloor } from "@/lib/floor-client";
import { usePathname, useRouter } from "next/navigation";
import { addWalkIn, openWalkInSlot } from "@/app/actions/pos";
import type { WalkInOpenResult, WalkInStatus } from "@/app/actions/pos";
import { walkInLabel, EXTRA_WALK_IN_MAX } from "@/lib/walk-ins";
import { SECTION_ACCENT } from "@/lib/section-colors";
import { usePublishSectionBadges } from "./section-badges";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { Plus, ShoppingBag } from "lucide-react";
import { TILE, TILE_SHADOW, TILE_MIN_HEIGHT, TILE_FREE_STYLE, TileTop, TileStatus } from "./floor-tile";

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
        className={compact ? `${card} hover:brightness-110` : `${TILE} hover:brightness-110`}
        // Constant purple FILL (see the --fill-* block): the flipping --sec-walkins token goes
        // light in dark and white text can't sit on it, so the solid card uses the fixed fill.
        style={{
          minHeight: compact ? minHeight : TILE_MIN_HEIGHT,
          background: "var(--fill-purple)",
          borderColor: "var(--fill-purple)",
          boxShadow: isCurrent ? CURRENT_RING : compact ? undefined : TILE_SHADOW,
        }}
      >
        {compact ? (
          <span className={NUMBER} style={{ ...numberStyle, color: "#fff" }}>{label}</span>
        ) : (
          <>
            <TileTop icon={ShoppingBag} number={label} fg="#fff" />
            <TileStatus label={slot.customer_name || "Active"} fg="rgba(255,255,255,0.92)" dot="#4ade80" />
          </>
        )}
      </Link>
    );
  }

  // Free. Neutral grey on the dashboard (the purple stays in the dot), so the
  // solid purple busy lanes are what stand out; the compact rail keeps its purple tint.
  const a = SECTION_ACCENT.walkins;
  if (!compact) {
    const body = (
      <>
        <TileTop icon={ShoppingBag} number={label} fg="var(--color-ink)" />
        <TileStatus label="Free" fg="var(--color-ink-mute)" dot={a.color} />
      </>
    );
    // Read-only (View Walk-ins without Manage): status only, can't be opened. The server
    // (openWalkInSlot) enforces this too.
    if (!canManage) {
      return (
        <div title={`Walk-in ${label} — free`} className={TILE} style={{ minHeight: TILE_MIN_HEIGHT, ...TILE_FREE_STYLE }}>
          {body}
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
        className={`${TILE} hover:brightness-95`}
        style={{ minHeight: TILE_MIN_HEIGHT, ...TILE_FREE_STYLE, opacity: opening ? 0.5 : 1 }}
      >
        {body}
      </button>
    );
  }
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
      // On the dashboard: the same TILE box as the lanes (same height, same rhythm — a
      // top row, a short line under it), dashed so it reads as an action, not a lane.
      className={compact ? `${CARD_COMPACT} hover:brightness-95` : `${TILE} items-center hover:brightness-95`}
      style={{
        minHeight: compact ? 44 : TILE_MIN_HEIGHT,
        background: "transparent",
        borderColor: a.color,
        borderStyle: "dashed",
        opacity: adding ? 0.5 : 1,
      }}
    >
      {compact ? (
        <Plus aria-hidden size={16} style={{ color: a.color }} />
      ) : (
        <>
          <span className="flex items-center justify-center h-6">
            <Plus aria-hidden size={18} strokeWidth={2.2} style={{ color: a.color }} />
          </span>
          <span className="text-[12px] font-semibold whitespace-nowrap truncate max-w-full" style={{ color: a.color }}>
            {adding ? "Adding…" : "Add walk-in"}
          </span>
        </>
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

  usePublishSectionBadges(
    compact
      ? null
      : [
          { n: walkIns.length, label: "total", variant: "soft" },
          { n: active, label: "active", variant: "solid", fill: "var(--fill-purple)" },
          { n: free, label: "free", variant: "muted" },
        ]
  );

  return (
    <div>
      {compact ? (
        // Rail header — same shape as the tables rail's.
        <div
          className="sticky top-0 z-10 mb-2 pb-2 border-b"
          style={{ background: "var(--color-canvas-soft)", borderColor: "var(--color-hairline)" }}
        >
          <p className="text-[12px] font-medium uppercase tracking-wide" style={{ color: SECTION_ACCENT.walkins.color }}>
            Walk-ins
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            {active} active · {free} free
          </p>
        </div>
      ) : (
      <p className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink)" }}>Walk-ins</p>
      )}

      {error && (
        <p className="text-xs mb-2" style={{ color: "var(--color-ruby)" }}>{error}</p>
      )}

      <div
        className={compact ? "grid gap-1.5" : "grid gap-2.5"}
        style={
          compact
            ? { gridTemplateColumns: "repeat(auto-fill, 48px)" }
            : { gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))" }
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
