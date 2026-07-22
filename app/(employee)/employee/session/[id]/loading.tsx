/**
 * The session screen's shell, painted the instant the navigation starts.
 *
 * Opening a table used to show the dashboard, frozen, for as long as the whole request
 * took — a tap with no acknowledgement, which on a busy floor gets tapped again. This
 * costs one file and turns that dead time into an obviously-loading screen, so the
 * remaining latency reads as "working" rather than "broken".
 *
 * Deliberately mirrors the real layout — same container width, same header block, same
 * card rhythm — so the paint doesn't jump when the data lands.
 */
export default function SessionLoading() {
  const bar = (w: string, h = 14) => (
    <div
      className="rounded-lg animate-pulse"
      style={{ height: h, width: w, background: "var(--color-canvas-soft)" }}
    />
  );

  return (
    <div className="p-4 sm:p-5 max-w-lg mx-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading table…</span>

      {/* back link */}
      <div className="mb-4">{bar("64px", 12)}</div>

      {/* title + status pill */}
      <div className="flex items-center justify-between mb-5">
        {bar("40%", 22)}
        {bar("56px", 18)}
      </div>

      {/* the items card */}
      <div
        className="rounded-2xl border px-4 py-4 mb-4 flex flex-col gap-3"
        style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
        aria-hidden
      >
        {bar("70%")}
        {bar("55%")}
        {bar("62%")}
      </div>

      {/* action buttons */}
      <div className="flex flex-col gap-2.5" aria-hidden>
        {bar("100%", 40)}
        {bar("100%", 40)}
      </div>
    </div>
  );
}
