"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useState, useTransition } from "react";
import { getMyWalkIns, openWalkInSlot } from "@/app/actions/pos";
import type { WalkInStatus } from "@/app/actions/pos";
import { walkInLabel } from "@/lib/walk-ins";
import { SECTION_ACCENT } from "@/lib/section-colors";
import { CountPill } from "@/components/ui/count-pill";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ShoppingBag } from "lucide-react";

const CARD =
  "flex flex-col items-center justify-center rounded-xl border w-full p-2 text-center transition-all";
const NUMBER = "font-normal leading-tight break-words line-clamp-2 w-full";
const NUMBER_STYLE = { letterSpacing: "-0.3px", fontSize: "clamp(1.05rem, 3.6vw, 1.6rem)" } as const;

// One slot card. Occupied → a link straight back into its session (persists like a table).
// Free → a server action that opens/reopens the slot and redirects.
const WalkInCard = memo(function WalkInCard({
  slot,
  canManage,
  onError,
}: {
  slot: WalkInStatus;
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const [opening, startOpen] = useTransition();
  const label = walkInLabel(slot.no);

  // In use — the section's own purple, deepened to a solid fill. A free slot is a light purple
  // tint; taking an order fills it solid. Only the intensity changes, so Walk-ins keep their
  // purple identity end to end (an active walk-in is NOT the same blue as an active table).
  if (slot.session_id) {
    return (
      <Link
        href={`/employee/session/${slot.session_id}`}
        title={`Walk-in ${label} — active`}
        className={`${CARD} hover:brightness-110`}
        // Constant purple FILL (see the --fill-* block): the flipping --sec-walkins token goes
        // light in dark and white text can't sit on it, so the solid card uses the fixed fill.
        style={{ minHeight: 88, background: "var(--fill-purple)", borderColor: "var(--fill-purple)" }}
      >
        <ShoppingBag aria-hidden size={13} className="mb-0.5" style={{ color: "rgba(255,255,255,0.75)" }} />
        <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "#fff" }}>{label}</span>
        <span className="text-xs mt-1 truncate max-w-full px-1" style={{ color: "rgba(255,255,255,0.9)" }}>
          {slot.customer_name || "Active"}
        </span>
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
        className={CARD}
        style={{ minHeight: 88, background: a.soft, borderColor: a.color }}
      >
        <ShoppingBag aria-hidden size={13} className="mb-0.5" style={{ color: a.color }} />
        <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "var(--color-ink)" }}>{label}</span>
        <span className="text-xs mt-1" style={{ color: a.color }}>Free</span>
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
          // Redirects on success and never returns; only a failure comes back.
          const r = await openWalkInSlot(slot.no);
          if (r && "error" in r) onError((r as { error: string }).error);
        })
      }
      className={`${CARD} hover:brightness-95`}
      style={{
        minHeight: 88,
        background: a.soft,
        borderColor: a.color,
        opacity: opening ? 0.5 : 1,
      }}
    >
      <ShoppingBag aria-hidden size={13} className="mb-0.5" style={{ color: a.color }} />
      <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "var(--color-ink)" }}>{label}</span>
      <span className="text-xs mt-1" style={{ color: a.color }}>Free</span>
    </button>
  );
});

export function WalkInsGrid({ initial, canManage }: { initial: WalkInStatus[]; canManage: boolean }) {
  const [walkIns, setWalkIns] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const resync = useCallback(() => {
    startTransition(async () => setWalkIns(await getMyWalkIns()));
  }, []);

  // A walk-in session opening/closing emits the "tables" topic (same sessions trigger),
  // so this stays live across devices exactly like the Tables grid.
  useRealtime(["tables", "orders"], resync);

  // `useState` seeds once, so a route refresh (pull-to-refresh) would re-run this
  // section's query and then discard it. Adopt the fresh props — see tables-grid.
  useEffect(() => setWalkIns(initial), [initial]);

  const onError = useCallback((msg: string) => setError(msg), []);
  const active = walkIns.filter((w) => w.session_id).length;

  const free = walkIns.length - active;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <p className="text-base font-medium" style={{ color: SECTION_ACCENT.walkins.color }}>Walk-ins</p>
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {free > 0 && <CountPill n={free} label="free" tone={SECTION_ACCENT.walkins} />}
          {active > 0 && <CountPill n={active} label="active" tone={SECTION_ACCENT.walkins} fill="var(--fill-purple)" />}
          <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>{walkIns.length} total</span>
        </span>
      </div>

      {error && (
        <p className="text-xs mb-2" style={{ color: "var(--color-ruby)" }}>{error}</p>
      )}

      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}>
        {walkIns.map((w) => (
          <WalkInCard key={w.no} slot={w} canManage={canManage} onError={onError} />
        ))}
      </div>
    </div>
  );
}
