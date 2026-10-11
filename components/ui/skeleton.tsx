import type { CSSProperties } from "react";

/**
 * A pulsing placeholder in the shape of what is loading. Same look as the
 * route-level `loading.tsx` skeletons (canvas-soft, rounded, animate-pulse), so
 * an in-place refetch and a page load read as the same thing.
 */
export function Skeleton({
  w = "100%",
  h = 14,
  className = "",
  style,
  onSoft = false,
}: {
  w?: number | string;
  h?: number | string;
  className?: string;
  style?: CSSProperties;
  /** Sitting on a canvas-soft surface already: use the hairline tone so it shows. */
  onSoft?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={`rounded-lg animate-pulse ${className}`}
      style={{ width: w, height: h, background: onSoft ? "var(--color-hairline)" : "var(--color-canvas-soft)", ...style }}
    />
  );
}
