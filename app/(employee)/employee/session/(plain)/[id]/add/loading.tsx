import { ChevronLeft } from "lucide-react";

/**
 * The add-items screen's shell, painted the instant "Add order" is tapped — from a
 * room or a table alike — so the tap is acknowledged while the menu loads, instead
 * of the previous screen sitting frozen. Same full-height column, header and menu
 * rhythm as `page.tsx`, so the real menu lands where the skeleton was.
 */
export default function AddItemsLoading() {
  const bar = (w: string, h = 14) => (
    <div
      className="rounded-lg animate-pulse"
      style={{ height: h, width: w, background: "var(--color-canvas-soft)" }}
    />
  );

  return (
    <div
      className="flex flex-col"
      style={{ height: "calc(100dvh - 56px - env(safe-area-inset-top, 0px))" }}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading menu…</span>

      {/* Header — real text, not a skeleton: it never changes, so it may as well be readable. */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      >
        <span
          className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 -ml-1 rounded-lg"
          style={{ color: "#fff", background: "var(--color-primary)" }}
        >
          <ChevronLeft size={15} />
          Back
        </span>
        <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
          Add items
        </span>
      </div>

      <div className="flex-1 min-h-0 p-4 flex flex-col gap-4" aria-hidden>
        {/* search */}
        {bar("100%", 38)}
        {/* category chips */}
        <div className="flex gap-2 overflow-hidden">
          {["72px", "96px", "64px", "88px", "80px"].map((w, i) => (
            <div key={i} className="shrink-0">{bar(w, 30)}</div>
          ))}
        </div>
        {/* items */}
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl animate-pulse"
              style={{ height: 100, background: "var(--color-canvas-soft)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
