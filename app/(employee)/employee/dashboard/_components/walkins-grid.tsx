"use client";

import Link from "next/link";
import { memo, useCallback, useState, useTransition } from "react";
import { getMyWalkIns, openWalkInSlot } from "@/app/actions/pos";
import type { WalkInStatus } from "@/app/actions/pos";
import { walkInLabel } from "@/lib/walk-ins";
import { useRealtime } from "@/lib/realtime/use-realtime";

const CARD =
  "flex flex-col items-center justify-center rounded-xl border w-full p-2 text-center transition-all";
const NUMBER = "font-light leading-tight break-words line-clamp-2 w-full";
const NUMBER_STYLE = { letterSpacing: "-0.3px", fontSize: "clamp(0.9rem, 3.2vw, 1.4rem)" } as const;

// One slot card. Occupied → a link straight back into its session (persists like a table).
// Free → a server action that opens/reopens the slot and redirects.
const WalkInCard = memo(function WalkInCard({
  slot,
  onError,
}: {
  slot: WalkInStatus;
  onError: (msg: string) => void;
}) {
  const [opening, startOpen] = useTransition();
  const label = walkInLabel(slot.no);

  if (slot.session_id) {
    return (
      <Link
        href={`/employee/session/${slot.session_id}`}
        title={`Walk-in ${label}`}
        className={CARD}
        style={{ minHeight: 88, background: "var(--color-primary)", borderColor: "var(--color-primary)" }}
      >
        <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "#fff" }}>{label}</span>
        <span className="text-[11px] mt-1 truncate max-w-full px-1" style={{ color: "rgba(255,255,255,0.75)" }}>
          {slot.customer_name || "Active"}
        </span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={opening}
      title={`Walk-in ${label}`}
      onClick={() =>
        startOpen(async () => {
          // Redirects on success and never returns; only a failure comes back.
          const r = await openWalkInSlot(slot.no);
          if (r && "error" in r) onError((r as { error: string }).error);
        })
      }
      className={CARD}
      style={{
        minHeight: 88,
        background: "var(--color-canvas)",
        borderColor: "var(--color-hairline)",
        opacity: opening ? 0.5 : 1,
      }}
    >
      <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "var(--color-ink)" }}>{label}</span>
      <span className="text-[11px] mt-1" style={{ color: "var(--color-ink-mute)" }}>Free</span>
    </button>
  );
});

export function WalkInsGrid({ initial }: { initial: WalkInStatus[] }) {
  const [walkIns, setWalkIns] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const resync = useCallback(() => {
    startTransition(async () => setWalkIns(await getMyWalkIns()));
  }, []);

  // A walk-in session opening/closing emits the "tables" topic (same sessions trigger),
  // so this stays live across devices exactly like the Tables grid.
  useRealtime(["tables", "orders"], resync);

  const onError = useCallback((msg: string) => setError(msg), []);
  const active = walkIns.filter((w) => w.session_id).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Walk-ins</p>
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>
          {active} active · {walkIns.length} total
        </span>
      </div>

      {error && (
        <p className="text-xs mb-2" style={{ color: "var(--color-ruby)" }}>{error}</p>
      )}

      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}>
        {walkIns.map((w) => (
          <WalkInCard key={w.no} slot={w} onError={onError} />
        ))}
      </div>
    </div>
  );
}
