import { ChevronLeft } from "lucide-react";
import { MenuSkeleton } from "./_components/menu-skeleton";

/**
 * The add-items screen's shell, painted the instant "Add order" is tapped — from a
 * room or a table alike — so the tap is acknowledged while the menu loads, instead
 * of the previous screen sitting frozen. Same full-height column and header as
 * `page.tsx`, and the menu's own skeleton (`MenuSkeleton`, the current menu design),
 * so the real menu lands exactly where the skeleton was.
 */
export default function AddItemsLoading() {
  return (
    <div
      className="flex flex-col rs-wait-in"
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

      <MenuSkeleton cards={8} />
    </div>
  );
}
