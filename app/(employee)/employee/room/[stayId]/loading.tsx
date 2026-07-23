/**
 * The room folio's shell, painted immediately on navigation — same reasoning as the
 * session screen's loading.tsx. The folio is the heavier of the two pages (stay, charges,
 * orders and the tax/service maths all resolve server-side), so it benefits more.
 *
 * Mirrors FolioClient's container (max-w-2xl, px-3 sm:px-5) and its card rhythm so the
 * real content lands in the same places the skeleton occupied.
 */
export default function RoomLoading() {
  const bar = (w: string, h = 14) => (
    <div
      className="rounded-lg animate-pulse"
      style={{ height: h, width: w, background: "var(--color-canvas-soft)" }}
    />
  );

  const card = (rows: string[]) => (
    <div
      className="rounded-2xl border px-4 py-4 flex flex-col gap-3"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
      aria-hidden
    >
      {rows.map((w, i) => (
        <div key={i}>{bar(w)}</div>
      ))}
    </div>
  );

  return (
    <div
      className="max-w-2xl mx-auto px-3 sm:px-5 py-4 pb-16 flex flex-col gap-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading room…</span>
      <div>{bar("72px", 12)}</div>
      {card(["45%", "60%"])}
      {card(["100%", "80%"])}
      {card(["55%", "70%", "40%"])}
    </div>
  );
}
