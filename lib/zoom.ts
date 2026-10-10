// Zoom/pan math for the customer menu-photo viewer. Pure, zero imports, so it runs
// under `node --test` (lib/zoom.test.ts).
//
// The image is drawn centred in its box at `scale`, shifted by (x, y) px. A focal point
// is given relative to the box CENTRE, which is what keeps the maths symmetric.

export type ZoomState = { scale: number; x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/**
 * Keep the image covering the box: at scale s an image of fitted size (w, h) may move
 * at most half its overflow in each direction, and not at all on an axis it doesn't
 * overflow.
 */
export function clampPan(
  st: ZoomState,
  box: { w: number; h: number },
  img: { w: number; h: number }
): ZoomState {
  const maxX = Math.max(0, (img.w * st.scale - box.w) / 2);
  const maxY = Math.max(0, (img.h * st.scale - box.h) / 2);
  return {
    scale: st.scale,
    x: Math.min(maxX, Math.max(-maxX, st.x)),
    y: Math.min(maxY, Math.max(-maxY, st.y)),
  };
}

/** Zoom to `nextScale`, keeping the point under the finger/cursor (fx, fy) still. */
export function zoomAt(st: ZoomState, nextScale: number, fx: number, fy: number): ZoomState {
  const scale = clampScale(nextScale);
  if (scale === MIN_SCALE) return { ...IDENTITY };
  const k = scale / st.scale;
  return { scale, x: fx - (fx - st.x) * k, y: fy - (fy - st.y) * k };
}
