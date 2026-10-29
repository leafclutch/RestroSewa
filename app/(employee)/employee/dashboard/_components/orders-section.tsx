"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ListOrdered, ChevronDown } from "lucide-react";
import { SECTION_ACCENT } from "@/lib/section-colors";
import { OrdersQueue } from "../../queue/_components/orders-queue";
import type { OrdersStats } from "../../queue/_components/orders-queue";
import type { QueueOrder } from "@/app/actions/pos";

// The Orders dashboard section. Unlike the other cards it self-manages its
// height: collapsed to just the header (a compact "No active orders" state) when
// the live queue is empty, and auto-expanding — with a smooth animation — the
// moment an order arrives. A manual tap can override, but a change in order count
// hands control back to the automatic behavior.
export function OrdersSection({
  initialOrders,
  canManage,
}: {
  initialOrders: QueueOrder[];
  canManage: boolean;
}) {
  const [stats, setStats] = useState<OrdersStats>({ total: initialOrders.length, pending: 0 });
  const [override, setOverride] = useState<boolean | null>(null);
  const [flash, setFlash] = useState(false);
  const prevTotal = useRef(stats.total);
  const seeded = useRef(false);

  const handleStats = useCallback((s: OrdersStats) => setStats(s), []);

  useEffect(() => {
    if (stats.total !== prevTotal.current) {
      // A new order arriving is the alert — flash the header briefly. (We skip
      // the very first stats update so we don't flash for pre-existing orders.)
      if (seeded.current && stats.total > prevTotal.current) setFlash(true);
      seeded.current = true;
      // Order count changed → resume automatic expand/collapse.
      setOverride(null);
      prevTotal.current = stats.total;
    }
  }, [stats.total]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const open = override ?? stats.total > 0;
  const hasOrders = stats.total > 0;
  const subtitle = hasOrders
    ? `${stats.pending} pending · live`
    : "No active orders";

  // Orders is a `bare` section, so it hand-rolls the chrome SectionCard gives the others —
  // which means the amber identity has to be applied here too, or Orders would be the one
  // section without a colour.
  const accent = SECTION_ACCENT.orders;

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      // Mirrors SectionCard: a full outline in the section's amber, and the big-card shadow.
      style={{
        background: "var(--color-canvas)",
        borderColor: accent.color,
        borderWidth: 2,
        boxShadow: "var(--shadow-card-lg)",
      }}
    >
      <button
        type="button"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left transition-colors hover:bg-canvas-soft"
      >
        <span
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border"
          style={{ background: accent.soft, color: accent.color, borderColor: accent.color }}
        >
          <ListOrdered size={21} strokeWidth={1.9} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-lg font-semibold" style={{ color: "var(--color-ink)" }}>Orders</span>
          <span className="block text-sm truncate" style={{ color: "var(--color-ink-mute)" }}>
            {hasOrders ? "Live kitchen & bar queue" : subtitle}
          </span>
        </span>
        {/* Header counts, in the same badge style as Tables / Walk-ins / Rooms. */}
        {hasOrders && (
          <span className="hidden sm:inline-flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border whitespace-nowrap"
              style={{ background: accent.soft, color: accent.color, borderColor: accent.color }}
            >
              <span className="tabular font-semibold">{stats.total}</span> total
            </span>
            <span
              className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border whitespace-nowrap"
              style={{ background: "var(--fill-amber)", color: "#fff", borderColor: "var(--fill-amber)" }}
            >
              <span className="tabular font-semibold">{stats.pending}</span> pending
            </span>
          </span>
        )}
        {flash && (
          <span
            // Green = "something new arrived and it's good news", not the section's amber —
            // this badge is an event, not an identity. Constant green FILL so white text stays
            // readable in dark (st-available flips to a light green white can't sit on).
            className="shrink-0 text-[12px] font-semibold px-2 py-0.5 rounded-full animate-pulse"
            style={{ background: "var(--fill-green)", color: "#fff" }}
          >
            New order
          </span>
        )}
        {hasOrders && (
          <span
            // Phones: the single count badge (the two header badges above are sm+). Constant
            // amber FILL, not accent.color: in dark the accent flips to a light amber that
            // white text can't sit on.
            className={`sm:hidden shrink-0 min-w-[24px] h-[24px] px-1.5 rounded-full text-sm font-semibold flex items-center justify-center ${flash ? "animate-pulse" : ""}`}
            style={{ background: "var(--fill-amber)", color: "#fff" }}
          >
            {stats.total}
          </span>
        )}
        <ChevronDown
          size={20}
          strokeWidth={2}
          className="shrink-0 transition-transform duration-300"
          style={{ color: "var(--color-ink)", transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
        />
      </button>

      {/* Animated expand/collapse via the grid-rows 0fr→1fr technique. */}
      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.3s ease" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div data-section-body className="mx-4 sm:mx-5 border-t py-4" style={{ borderColor: "var(--color-hairline)" }}>
            <OrdersQueue initialOrders={initialOrders} canManage={canManage} onStats={handleStats} />
          </div>
        </div>
      </div>
    </div>
  );
}
