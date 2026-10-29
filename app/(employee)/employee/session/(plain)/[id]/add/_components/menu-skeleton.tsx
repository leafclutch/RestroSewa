/**
 * The menu's loading shape — the SAME layout as `MenuBrowser`, drawn in grey, so the real
 * menu lands exactly where its skeleton was: search + custom-item button, then the
 * categories (a chip row on a narrow pane, a rail down the left on a wide one — the same
 * `@container` switch the real menu makes), then two-up / flowing cards of name · price ·
 * round +. Used by every screen that loads a menu: the phone "Add items" page and the
 * room screen's menu column.
 */
const block = (w: string | number, h: number, extra = "") => (
  <div
    className={`rounded-lg animate-pulse ${extra}`}
    style={{ height: h, width: w, background: "var(--color-hairline)" }}
  />
);

function CardSkeleton() {
  return (
    <div
      className="rounded-xl border-[1.5px] p-2.5 @lg:p-3 flex flex-col gap-2"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start gap-1.5">
        {block(11, 11, "mt-1 shrink-0 rounded-sm")}
        <div className="flex-1 flex flex-col gap-1.5 min-h-[2.75em] pt-0.5">
          {block("85%", 12)}
          {block("55%", 12)}
        </div>
      </div>
      <div className="flex items-center justify-between">
        {block(56, 12)}
        {block(32, 32, "rounded-full")}
      </div>
    </div>
  );
}

export function MenuSkeleton({ cards = 9 }: { cards?: number }) {
  return (
    <div className="@container flex flex-col flex-1 min-h-0" aria-hidden>
      {/* search + custom item */}
      <div className="px-4 pt-3.5 pb-3 shrink-0 flex items-center gap-2 border-b" style={{ borderColor: "var(--color-hairline)" }}>
        <div className="flex-1 h-11 rounded-xl border animate-pulse" style={{ borderColor: "var(--color-hairline-input)", background: "var(--color-canvas-soft)" }} />
        {block(44, 44, "rounded-xl @md:w-32 shrink-0")}
      </div>

      {/* narrow pane: chip row */}
      <div className="@2xl:hidden flex gap-2 overflow-hidden px-4 py-3 border-b shrink-0" style={{ borderColor: "var(--color-hairline)" }}>
        {[52, 92, 78, 104, 70].map((w, i) => (
          <div key={i} className="shrink-0">{block(w, 44, "rounded-full")}</div>
        ))}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* wide pane: category rail */}
        <div className="hidden @2xl:flex flex-col gap-1.5 w-48 shrink-0 p-2.5 border-r" style={{ borderColor: "var(--color-hairline)" }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i}>{block("100%", 44)}</div>
          ))}
        </div>

        {/* cards */}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden px-4 pt-4 pb-5" style={{ background: "var(--color-canvas-soft)" }}>
          <div className="mb-3">{block(140, 36)}</div>
          <div className="grid gap-2.5 grid-cols-2 @lg:gap-3 @lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
            {Array.from({ length: cards }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
