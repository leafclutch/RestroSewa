"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useState, useTransition } from "react";
import { getMyTables, openTableSession, markTableClean } from "@/app/actions/pos";
import type { TableStatus } from "@/app/actions/pos";
import { STATUS_STYLE, cleaningFor } from "@/lib/status-colors";
import { SECTION_ACCENT } from "@/lib/section-colors";
import { CountPill } from "@/components/ui/count-pill";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { TransferModal } from "@/app/(employee)/employee/_components/transfer-modal";
import { Sparkles, LayoutGrid, MoveRight } from "lucide-react";

const CARD =
  "flex flex-col items-center justify-center rounded-xl border w-full p-2 text-center transition-all";

// The table number is the card's whole point, so it's the one thing that should be readable
// from arm's length across a busy floor — bumped a step, and to weight 400 so it doesn't look
// faint against the tinted panel. (Inter 400/500/600 are real cuts now, not faux-bold.)
const NUMBER = "font-normal leading-tight break-words line-clamp-2 w-full";
const NUMBER_STYLE = { letterSpacing: "-0.3px", fontSize: "clamp(1.05rem, 3.6vw, 1.6rem)" } as const;

/**
 * `memo` so refetching the list re-renders only the cards whose data actually
 * moved — one table opening shouldn't repaint all 55.
 *
 * A FREE table submits a server action; it does not navigate.
 *
 * It used to link to /employee/open-table/[id], a page whose only job was to
 * create a session and redirect. That made opening a table a GET request that
 * mutates — and Next cannot follow a redirect inside an RSC fetch, so every tap
 * logged "Failed to fetch RSC payload", threw away the client-side navigation and
 * did a full page load instead. It worked, slowly, and shouted about it. The
 * route still exists for QR and deep links; the dashboard no longer goes through
 * it, and `openTableSession` redirects cleanly from an action.
 */
const TableCard = memo(function TableCard({
  table,
  busy,
  canShift,
  onOpen,
  onClean,
  onShift,
}: {
  table: TableStatus;
  /** Owned by the GRID, not this card — see the note on TablesGrid.run. */
  busy: boolean;
  canShift: boolean;
  onOpen: (id: string) => void;
  onClean: (id: string) => void;
  onShift: (t: TableStatus) => void;
}) {
  const opening = busy;
  const cleaning = busy;
  const router = useRouter();

  // In use — the one card that's solid-filled. A busy table is the thing a cashier looks for,
  // so it's the loudest state; free tables stay quiet even when there are 55 of them.
  if (table.state === "active" && table.session_id) {
    const s = STATUS_STYLE.active;
    // The Shift control is a SIBLING of the link, not a child: a <button> inside an <a>
    // is invalid HTML, and nesting it would make the whole card's tap target ambiguous.
    return (
      <div className="relative w-full">
        <Link
          href={`/employee/session/${table.session_id}`}
          title={`Table ${table.number} — active`}
          // App Router prefetches every in-viewport Link by default. On a floor with
          // twenty tables open that is twenty concurrent server renders of the session
          // page the moment the dashboard scrolls — all competing with whatever the user
          // is actually waiting for. Warm exactly ONE instead, on pointer-down, which on
          // touch fires ~100ms before the click lands and is plenty.
          prefetch={false}
          onPointerDown={() => router.prefetch(`/employee/session/${table.session_id}`)}
          className={`${CARD} hover:brightness-110`}
          // Constant blue FILL, not s.color: the status token flips to a light blue in dark that
          // the white number can't sit on. This keeps the in-use card a solid readable blue in both.
          style={{ minHeight: 88, background: "var(--fill-blue)", borderColor: "var(--fill-blue)" }}
        >
          <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "#fff" }}>
            {table.number}
          </span>
          <span className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.9)" }}>
            Active
          </span>
        </Link>
        {canShift && (
          <button
            type="button"
            aria-label={`Shift table ${table.number}`}
            title="Shift to another table"
            onClick={() => onShift(table)}
            className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "rgba(255,255,255,0.22)", color: "#fff" }}
          >
            <MoveRight size={12} />
          </button>
        )}
      </div>
    );
  }

  // Just vacated: the bill is settled but the table isn't ready for the next party. It is
  // NOT a link — tapping it must not seat anyone (the server refuses that anyway); the only
  // thing to do here is say it's been wiped.
  if (table.state === "cleaning") {
    const s = STATUS_STYLE.cleaning;
    const waited = cleaningFor(table.cleaning_since);
    return (
      <div
        title={`Table ${table.number} — needs cleaning`}
        className={CARD}
        style={{ minHeight: 88, background: s.soft, borderColor: s.color, opacity: cleaning ? 0.5 : 1 }}
      >
        <span className={NUMBER} style={{ ...NUMBER_STYLE, color: s.color }}>
          {table.number}
        </span>
        <button
          type="button"
          disabled={cleaning}
          onClick={() => onClean(table.id)}
          // nowrap + 11px: at text-xs the label wrapped to two lines inside a 92px card and
          // squashed the number above it. It has to stay one line at the narrowest column.
          className="mt-1 inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded-md border transition-colors"
          style={{ borderColor: s.color, color: s.color, background: "transparent" }}
        >
          <Sparkles size={10} className="shrink-0" />
          {cleaning ? "…" : "Mark clean"}
        </button>
        {waited && (
          <span className="text-[11px] mt-0.5" style={{ color: s.color, opacity: 0.85 }}>
            {waited}
          </span>
        )}
      </div>
    );
  }

  // Free. The section's own blue, but only as a tinted panel and a dot — a floor is mostly
  // free, so filling 55 cards with a saturated fill would drown the handful that actually need
  // attention. A free table stays in the Tables blue (just lighter); activating it deepens the
  // same blue to the solid fill above. Only the INTENSITY changes — the colour family holds.
  const a = SECTION_ACCENT.tables;
  return (
    <button
      type="button"
      disabled={opening}
      title={`Table ${table.number} — free`}
      onClick={() => onOpen(table.id)}
      className={`${CARD} hover:brightness-95`}
      style={{
        minHeight: 88,
        background: a.soft,
        borderColor: a.color,
        opacity: opening ? 0.5 : 1,
      }}
    >
      <span className={NUMBER} style={{ ...NUMBER_STYLE, color: "var(--color-ink)" }}>
        {table.number}
      </span>
      <span className="text-xs mt-1 inline-flex items-center gap-1" style={{ color: a.color }}>
        <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
        Free
      </span>
    </button>
  );
});

/**
 * Still the fix for "waiter activates C1, cashier still sees it free" — but it now
 * refetches ONLY the tables.
 *
 * It used to be `<RealtimeRefresh>`, i.e. `router.refresh()`, which re-runs the
 * entire dashboard route: the sales report, the credit ledger, the whole menu.
 * Those are client components that keep their own state, so every one of those
 * queries was executed and then discarded. One order event cost a full dashboard
 * re-render; two sections were listening, so it cost two.
 */
export function TablesGrid({
  initial,
  hasAnyTables,
  canShift = false,
}: {
  initial: TableStatus[];
  hasAnyTables: boolean;
  canShift?: boolean;
}) {
  const [tables, setTables] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [shifting, setShifting] = useState<TableStatus | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [, startTransition] = useTransition();

  const resync = useCallback(() => {
    startTransition(async () => {
      setTables(await getMyTables());
    });
  }, []);

  useRealtime(["tables", "orders"], resync);

  /**
   * THE FIX FOR THE SILENT-TAP BUG.
   *
   * These calls used to live inside TableCard, inside its own `useTransition`. When a
   * realtime resync landed mid-request and flipped a table from available to active, the
   * card re-rendered down a different branch — `<button>` became `<Link>` — the subtree
   * unmounted, and React discarded the pending transition. The POST was aborted and the
   * tap did nothing at all, most often during exactly the busy burst that caused the
   * resync.
   *
   * Two changes, both load-bearing:
   *   1. The request lives HERE, in a component whose lifetime is the page's. Cards may
   *      come and go underneath it; the in-flight action no longer cares.
   *   2. It is NOT wrapped in a transition. A transition is precisely the thing React is
   *      allowed to interrupt — which is correct for rendering and wrong for a POST that
   *      opens a bill.
   *
   * `busy` lives here too, so a resync repainting every card cannot wipe the pending
   * state of the one the user just touched.
   */
  const run = useCallback(
    async (id: string, action: () => Promise<{ error: string } | null | undefined>) => {
      setBusy((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      setError(null);
      try {
        const r = await action();
        // On success openTableSession REDIRECTS and never returns; only failures land here.
        if (r && "error" in r) setError(r.error);
      } catch {
        setError("That didn't go through. Please try again.");
      } finally {
        setBusy((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    []
  );

  // Stable identities, so memoised cards aren't invalidated on every render.
  const onOpen = useCallback((id: string) => run(id, () => openTableSession(id)), [run]);
  const onClean = useCallback((id: string) => run(id, () => markTableClean(id)), [run]);
  const onShift = useCallback((t: TableStatus) => setShifting(t), []);

  const active = tables.filter((t) => t.state === "active").length;
  const dirty = tables.filter((t) => t.state === "cleaning").length;
  const free = tables.filter((t) => t.state === "available").length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <p className="text-base font-medium" style={{ color: SECTION_ACCENT.tables.color }}>Tables</p>
        {/* Counts echo the cards: free = the section's tinted blue (outline), active = the same
            blue solid, cleaning = the cross-cutting orange. Summary and grid teach each other.
            Zero-count states are dropped rather than shown as "0", which is noise on a small screen. */}
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {free > 0 && <CountPill n={free} label="free" tone={SECTION_ACCENT.tables} />}
          {active > 0 && <CountPill n={active} label="active" tone={STATUS_STYLE.active} fill="var(--fill-blue)" />}
          {dirty > 0 && <CountPill n={dirty} label="cleaning" tone={STATUS_STYLE.cleaning} />}
          <span className="text-sm" style={{ color: "var(--color-ink-mute)" }}>{tables.length} total</span>
        </span>
      </div>

      {tables.length === 0 ? (
        <div
          className="rounded-xl border px-8 py-10 text-center flex flex-col items-center gap-3"
          style={{
            borderStyle: "dashed",
            borderColor: SECTION_ACCENT.tables.soft,
            background: "var(--color-canvas)",
          }}
        >
          <span
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: SECTION_ACCENT.tables.soft, color: SECTION_ACCENT.tables.color }}
          >
            <LayoutGrid size={18} strokeWidth={1.6} />
          </span>
          <p className="text-sm" style={{ color: "var(--color-ink-mute)" }}>
            {hasAnyTables
              ? "No tables assigned to you yet. Ask your admin to add you to a table group."
              : "No tables set up yet. Ask your admin to add tables."}
          </p>
        </div>
      ) : (
        <>
          {error && (
            <p className="text-xs mb-2" style={{ color: "var(--color-ruby)" }}>
              {error}
            </p>
          )}
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}
          >
            {tables.map((t) => (
              <TableCard
                key={t.id}
                table={t}
                busy={busy.has(t.id)}
                canShift={canShift}
                onOpen={onOpen}
                onClean={onClean}
                onShift={onShift}
              />
            ))}
          </div>
        </>
      )}

      {shifting?.session_id && (
        <TransferModal
          sessionId={shifting.session_id}
          fallbackLabel={shifting.number}
          onClose={() => setShifting(null)}
          // The move fires rs_ev_sessions, so every OTHER dashboard repaints on its own.
          // This one asked for it, so don't make it wait for the round trip.
          onDone={resync}
        />
      )}
    </div>
  );
}
