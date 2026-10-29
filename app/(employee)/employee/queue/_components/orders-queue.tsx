"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getMyOrderQueue, updateOrderItemStatus } from "@/app/actions/pos";
import type { QueueOrder, QueueOrderItem } from "@/app/actions/pos";
import { useRealtime } from "@/lib/realtime/use-realtime";
import Link from "next/link";
import { Armchair, BedDouble, ChevronRight, Clock, ConciergeBell, ShoppingBag, User } from "lucide-react";
import { useCurrency } from "@/components/currency-provider";
import { SECTION_ACCENT } from "@/lib/section-colors";

// Orders now arrive by push. This is a safety net for a dropped SSE stream only.
const FALLBACK_POLL_MS = 60_000;

// Tokens, not hex. These cards sit on the dashboard, which is dark when dark mode is on — the
// old orange / cream / white literals painted a bright cream header band and a white status
// pill onto a dark card the moment a pending order arrived (the "colour mix-max" bug). The
// warning tokens flip with the theme; `border` uses color-mix so the subtle tinted edge (the
// old alpha-suffixed border) also flips instead of concatenating alpha onto a var(), which isn't a colour.
const STATUS_META: Record<QueueOrder["status"], { label: string; color: string; bg: string; border: string }> = {
  pending: {
    label: "Pending",
    color: "var(--color-warning)",
    bg: "var(--color-warning-bg)",
    border: "color-mix(in srgb, var(--color-warning) 30%, transparent)",
  },
  served: {
    label: "Served",
    color: "var(--color-ink-mute)",
    bg: "var(--color-canvas-soft)",
    border: "var(--color-hairline)",
  },
};

function timeSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

/** Where the order came from, in that section's own colour and icon — a table order reads
 *  Tables-blue, a room order Rooms-teal, a walk-in Walk-ins-purple, same as the dashboard. */
function originOf(o: QueueOrder) {
  if (o.room_number) return { ...SECTION_ACCENT.rooms, Icon: BedDouble };
  if (o.session_type === "walk_in") return { ...SECTION_ACCENT.walkins, Icon: ShoppingBag };
  return { ...SECTION_ACCENT.tables, Icon: Armchair };
}

function locationLabel(o: QueueOrder) {
  if (o.table_number) return `Table ${o.table_number}`;
  if (o.room_number) return `Room ${o.room_number}`;
  if (o.session_type === "walk_in") return "Walk-in";
  return "Order";
}

function ItemRow({
  item,
  canManage,
  onUpdate,
  busy,
}: {
  item: QueueOrderItem;
  canManage: boolean;
  onUpdate: (id: string, status: "served") => void;
  busy: boolean;
}) {
  // One tap. There is no middle state to advance through any more: an item is
  // pending until it reaches the guest, and then it is served.
  const next = item.item_status === "pending" ? "served" : null;
  const meta = STATUS_META[item.item_status];

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0" style={{ borderColor: "var(--color-hairline)" }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: "var(--color-ink)", opacity: item.item_status === "served" ? 0.5 : 1 }}>
          {item.quantity > 1 && (
            <span
              className="mr-1.5 inline-flex items-center justify-center min-w-[24px] h-5 px-1 rounded-md text-xs font-semibold tabular align-middle"
              style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)", border: "1px solid var(--color-hairline)" }}
            >
              ×{item.quantity}
            </span>
          )}
          {item.item_name}
          {item.is_custom && (
            <span
              className="ml-1.5 px-1 rounded align-middle"
              style={{ fontSize: "9px", lineHeight: "14px", background: "var(--color-canvas-soft)", color: "var(--color-primary)", letterSpacing: "0.04em" }}
            >
              CUSTOM
            </span>
          )}
        </p>
        {item.workstation_name && (
          <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{item.workstation_name}</p>
        )}
        {item.notes && (
          <p className="text-xs italic" style={{ color: "var(--color-ink-mute)" }}>{item.notes}</p>
        )}
      </div>

      <span className="text-xs shrink-0 min-w-[52px] text-center" style={{ color: meta.color }}>
        {meta.label}
      </span>

      {canManage && next ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdate(item.id, next)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium shrink-0 disabled:opacity-50"
          // A SOLID green button with white text — stays a fixed mid-green in both themes on
          // purpose. It must NOT use --color-success/--st-available: those flip to a light green
          // in dark mode (tuned for text), and white text on light green is unreadable. A solid
          // saturated fill reads fine on both a light and a dark card, so it's not the bug here.
          style={{ background: "#1a7a4a", color: "#fff" }}
        >
          Served
        </button>
      ) : (
        <span className="w-[76px] shrink-0" />
      )}
    </div>
  );
}

function OrderCard({
  order,
  canManage,
  onUpdate,
  busyItems,
}: {
  order: QueueOrder;
  canManage: boolean;
  onUpdate: (id: string, status: "served") => void;
  busyItems: Set<string>;
}) {
  const cur = useCurrency();
  const meta = STATUS_META[order.status];
  const origin = originOf(order);
  return (
    <div
      className="rounded-2xl border-[1.5px] overflow-hidden flex flex-col"
      style={{ background: "var(--color-canvas)", borderColor: origin.color, boxShadow: "var(--shadow-card)" }}
    >
      {/* Header — tinted in the origin's colour, the solid icon tile says where at a glance.
          The whole header is a link to that table / walk-in / room's own screen (a room
          stay's session page hands straight on to the room screen). */}
      <Link
        href={`/employee/session/${order.session_id}`}
        title={`Open ${locationLabel(order)}`}
        className="group flex items-center gap-3 px-4 py-3 border-b transition-[filter] hover:brightness-[0.97]"
        style={{ borderColor: "var(--color-hairline)", background: origin.soft }}
      >
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: origin.fill, color: "#fff" }}
        >
          <origin.Icon size={19} strokeWidth={1.9} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold truncate" style={{ color: "var(--color-ink)" }}>
            {locationLabel(order)}
          </p>
          <p className="text-xs flex items-center gap-2 flex-wrap" style={{ color: "var(--color-ink-mute)" }}>
            <span className="inline-flex items-center gap-1"><Clock size={12} />{timeSince(order.created_at)}</span>
            {order.customer_name && (
              <span className="inline-flex items-center gap-1"><User size={12} />{order.customer_name}{order.customer_phone ? ` · ${order.customer_phone}` : ""}</span>
            )}
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-semibold shrink-0 border"
          style={{ color: meta.color, background: meta.bg, borderColor: meta.color }}
        >
          <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
          {meta.label}
        </span>
        <ChevronRight
          size={18}
          aria-hidden
          className="shrink-0 -mr-1 transition-transform group-hover:translate-x-0.5"
          style={{ color: origin.color }}
        />
      </Link>

      {/* Items */}
      <div className="flex-1">
        {order.items.map((it) => (
          <ItemRow key={it.id} item={it} canManage={canManage} onUpdate={onUpdate} busy={busyItems.has(it.id)} />
        ))}
      </div>

      {/* Footer total */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t" style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}>
        <span className="text-xs" style={{ color: "var(--color-ink-mute)" }}>{order.items.length} item{order.items.length !== 1 ? "s" : ""}</span>
        <span className="text-sm font-semibold tabular" style={{ color: origin.color }}>{cur.money(order.total)}</span>
      </div>
    </div>
  );
}

export type OrdersStats = { total: number; pending: number };

/**
 * The column arrangements, 1 to 6, and when each one shows. A column needs ~300px plus
 * the 12px gap, so N columns fit from (312·N − 12)px of box width; each arrangement shows
 * from its own threshold up to the next one's. Literal class strings, so Tailwind
 * generates them.
 */
const COLUMN_LAYOUTS = [
  { n: 1, show: "flex @min-[612px]:hidden" },
  { n: 2, show: "hidden @min-[612px]:flex @min-[924px]:hidden" },
  { n: 3, show: "hidden @min-[924px]:flex @min-[1236px]:hidden" },
  { n: 4, show: "hidden @min-[1236px]:flex @min-[1548px]:hidden" },
  { n: 5, show: "hidden @min-[1548px]:flex @min-[1860px]:hidden" },
  { n: 6, show: "hidden @min-[1860px]:flex" },
] as const;

export function OrdersQueue({
  initialOrders,
  canManage,
  onStats,
}: {
  initialOrders: QueueOrder[];
  canManage: boolean;
  // Reports the live order counts so a parent (the dashboard Orders section) can
  // auto-collapse when empty and expand when orders arrive.
  onStats?: (s: OrdersStats) => void;
}) {
  const [orders, setOrders] = useState<QueueOrder[]>(initialOrders);
  const [busyItems, setBusyItems] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getMyOrderQueue();
      if (activeRef.current) setOrders(next);
    } catch {
      // keep last known state on transient failure
    }
  }, []);

  // A new order, or the kitchen flipping an item to ready/served, lands here
  // immediately instead of up to 8s later.
  useRealtime(["orders"], refresh);

  // `useState` seeds once, so a route refresh (pull-to-refresh) would re-run this
  // section's query and then discard it. Adopt the fresh props — see tables-grid.
  useEffect(() => setOrders(initialOrders), [initialOrders]);

  useEffect(() => {
    activeRef.current = true;
    refresh();
    const iv = setInterval(refresh, FALLBACK_POLL_MS);
    return () => {
      activeRef.current = false;
      clearInterval(iv);
    };
  }, [refresh]);

  const handleUpdate = useCallback((id: string, status: "served") => {
    setBusyItems((prev) => new Set(prev).add(id));
    // Optimistic update
    setOrders((prev) =>
      prev.map((o) => ({
        ...o,
        items: o.items.map((it) => (it.id === id ? { ...it, item_status: status } : it)),
      }))
    );
    startTransition(async () => {
      const res = await updateOrderItemStatus(id, status);
      if (res?.error) {
        // Roll back by refetching the true state.
        await refresh();
      } else {
        await refresh();
      }
      setBusyItems((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    });
  }, [refresh]);

  // The queue only ever holds orders that still have a pending item — an order
  // whose items have all gone out drops off it — so every order here is pending.
  // NEWEST first: the order that just came in is the one staff look for, so it leads the
  // list (top-left). The server hands them over oldest first; this flips that for display
  // only — every fetch, push and poll goes through here, so the order always holds.
  const pendingOrders = useMemo(() => [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ), [orders]);

  // Report live counts upward (dashboard uses this to auto-collapse when empty).
  useEffect(() => {
    onStats?.({ total: orders.length, pending: pendingOrders.length });
  }, [orders.length, pendingOrders.length, onStats]);

  if (orders.length === 0) {
    return (
      <div
        className="rounded-xl border-2 px-4 py-8 text-center flex flex-col items-center gap-2"
        style={{ borderStyle: "dashed", borderColor: "var(--color-hairline-input)", background: "var(--color-canvas-soft)" }}
      >
        <ConciergeBell size={24} strokeWidth={1.6} style={{ color: "var(--color-ink-mute)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>No active orders.</p>
        <p className="text-xs" style={{ color: "var(--color-ink-mute)" }}>New orders from tables, rooms and walk-ins appear here.</p>
      </div>
    );
  }

  // Pending first. It used to be "Ready to serve" on top, because that was the
  // list somebody had to act on; with `ready` gone, the outstanding work IS the
  // pending list, so it takes the top slot.
  return (
    <div className="flex flex-col gap-6">
      {pendingOrders.length > 0 && (
        <section>
          <p className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
            Pending
            <span
              className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-xs font-semibold"
              style={{ background: "var(--fill-amber)", color: "#fff" }}
            >
              {pendingOrders.length}
            </span>
          </p>
          {/* Newest first, packed. The orders (newest first) are DEALT across the columns
              like cards — 1, 2, 3 along the top, 4, 5, 6 under them — so the list reads left
              to right from the latest order down to the oldest. Each column stacks its own
              cards, so a long order only makes its own column longer; the short ones beside
              it sit under one another instead of in a row as tall as the long one.

              How many columns fit is decided by CSS, not JavaScript: every arrangement from
              1 to 6 columns is in the page, and a container query shows only the one that
              fits this box (~300px a column). So the very first paint — the server's HTML —
              is already the final layout; nothing is measured and re-dealt afterwards, which
              is what made the queue jump while the dashboard loaded. */}
          <div className="@container">
            {COLUMN_LAYOUTS.map(({ n, show }) => (
              <div key={n} className={`${show} items-start gap-3`}>
                {Array.from({ length: n }, (_, c) => (
                  <div key={c} className="flex-1 min-w-0 flex flex-col gap-5">
                    {pendingOrders
                      .filter((_, i) => i % n === c)
                      .map((o) => (
                        <OrderCard key={o.order_id} order={o} canManage={canManage} onUpdate={handleUpdate} busyItems={busyItems} />
                      ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
