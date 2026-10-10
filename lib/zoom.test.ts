import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPan, clampScale, zoomAt, IDENTITY } from "./zoom.ts";
import { fitWithin } from "./image-resize.ts";

test("scale stays between 1× and 5×", () => {
  assert.equal(clampScale(0.2), 1);
  assert.equal(clampScale(9), 5);
  assert.equal(clampScale(2.5), 2.5);
});

test("zooming keeps the focal point still", () => {
  const st = zoomAt(IDENTITY, 2, 100, 50);
  // A point at (100, 50) from centre maps to x + 100*scale; it must stay at 100.
  assert.equal(st.x + 100 * st.scale, 100);
  assert.equal(st.y + 50 * st.scale, 50);
});

test("zooming back to 1× recentres the image", () => {
  assert.deepEqual(zoomAt({ scale: 3, x: 120, y: -40 }, 0.5, 10, 10), IDENTITY);
});

test("panning can't drag the image off its box", () => {
  const box = { w: 400, h: 600 };
  const img = { w: 400, h: 300 };
  // At 2× the image is 800×600: 200px slack horizontally, none vertically.
  assert.deepEqual(clampPan({ scale: 2, x: 999, y: 999 }, box, img), { scale: 2, x: 200, y: 0 });
  assert.deepEqual(clampPan({ scale: 2, x: -999, y: 0 }, box, img), { scale: 2, x: -200, y: 0 });
});

test("photos are shrunk to 2000px on the long side, never enlarged", () => {
  assert.deepEqual(fitWithin(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(3000, 6000), { width: 1000, height: 2000 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});
