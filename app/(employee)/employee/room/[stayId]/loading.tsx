import { ChevronLeft } from "lucide-react";
import { NAV_HEIGHT } from "@/app/(employee)/employee/session/_components/layout-metrics";
import { MenuSkeleton } from "@/app/(employee)/employee/session/(plain)/[id]/add/_components/menu-skeleton";

/**
 * The room screen's shell, painted immediately on navigation — same reasoning as the
 * session screen's loading.tsx. The room is the heavier of the two pages (stay, charges,
 * orders and the tax/service maths all resolve server-side), so it benefits more.
 *
 * It is the CURRENT room layout drawn in grey, in the room's own teal (`.room-surface`):
 * on a desktop the room column on the left and the menu on the right, fixed under the
 * top bar exactly like `FolioClient`; on a phone the one column. Same widths, same cards
 * — the teal stay band, the quick actions, Orders, Room charges, the Bill — so nothing
 * jumps when the real screen replaces this one (including after a phone-width window is
 * widened and the add-items page hands back to this screen).
 */
const bar = (w: string | number, h = 12, extra = "") => (
  <div
    className={`rounded-md animate-pulse ${extra}`}
    style={{ height: h, width: w, background: "var(--color-hairline)" }}
  />
);

/** A section card: icon chip · title · figure, then a few lines. */
function CardSkeleton({ rows }: { rows: (string | number)[] }) {
  return (
    <div
      className="rounded-2xl border overflow-hidden shrink-0"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: "var(--color-hairline)" }}>
        <div className="w-8 h-8 rounded-lg" style={{ background: "color-mix(in srgb, var(--room-ink) 14%, var(--color-canvas))" }} />
        <div className="flex-1">{bar("38%", 14)}</div>
        {bar(64, 14)}
      </div>
      <div className="px-4 py-3.5 flex flex-col gap-3">
        {rows.map((w, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            {bar(w)}
            {bar(54)}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomColumnSkeleton() {
  return (
    <>
      {/* Back — real, it never changes */}
      <span
        className="self-start inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 -ml-1 rounded-lg shrink-0"
        style={{ color: "#fff", background: "var(--color-primary)" }}
      >
        <ChevronLeft size={15} />
        Back
      </span>

      {/* The stay: the teal band, the guest, four tiles */}
      <div
        className="rounded-2xl border overflow-hidden shrink-0"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", boxShadow: "var(--shadow-card)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ background: "var(--room-fill)" }}>
          <div className="w-11 h-11 rounded-xl" style={{ background: "rgba(255,255,255,0.18)" }} />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-4 w-28 rounded-md animate-pulse" style={{ background: "rgba(255,255,255,0.35)" }} />
            <div className="h-3 w-20 rounded-md animate-pulse" style={{ background: "rgba(255,255,255,0.25)" }} />
          </div>
          <div className="h-6 w-20 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
        </div>
        <div className="px-4 pt-3.5 pb-4 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full" style={{ background: "color-mix(in srgb, var(--room-ink) 14%, var(--color-canvas))" }} />
            <div className="flex flex-col gap-1.5">{bar(120, 12)}{bar(80, 10)}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl px-3 py-2.5 flex flex-col gap-2" style={{ background: "var(--color-canvas-soft)" }}>
                {bar("50%", 10)}
                {bar("75%", 12)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2 shrink-0">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border px-2 py-3 flex flex-col items-center gap-2"
            style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", boxShadow: "var(--shadow-card)" }}
          >
            <div className="w-9 h-9 rounded-full" style={{ background: "var(--room-fill)", opacity: 0.85 }} />
            {bar("70%", 10)}
          </div>
        ))}
      </div>

      <CardSkeleton rows={["58%", "46%", "64%"]} />
      <CardSkeleton rows={["52%"]} />
      <CardSkeleton rows={["40%", "48%", "36%"]} />
    </>
  );
}

export default function RoomLoading() {
  return (
    <div className="room-surface" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading room…</span>

      {/* ── Phone / small tablet: the one column, as FolioClient below lg ── */}
      <div className="lg:hidden max-w-2xl mx-auto px-3 sm:px-5 py-4 pb-16 flex flex-col gap-4">
        <RoomColumnSkeleton />
      </div>

      {/* ── Desktop: room column · menu, fixed under the top bar like FolioClient ── */}
      <div
        className="hidden lg:flex lg:fixed lg:gap-3 lg:p-3 z-10"
        style={{ top: NAV_HEIGHT, left: 0, right: 0, bottom: 0 }}
      >
        <div className="w-[460px] xl:w-[500px] shrink-0 overflow-hidden px-1 flex flex-col gap-4">
          <RoomColumnSkeleton />
        </div>
        <div
          className="flex-1 min-w-0 flex flex-col rounded-xl border overflow-hidden"
          style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas)", boxShadow: "var(--shadow-card)" }}
        >
          <MenuSkeleton />
        </div>
      </div>
    </div>
  );
}
