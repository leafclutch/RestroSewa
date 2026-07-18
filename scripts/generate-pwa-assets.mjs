// Generates every PWA raster asset from the HRestroSewa logo.
//
// The brand mark is `public/hrestrosewa-logo.png` (1024², the one canonical emblem asset, shared
// with in-app <PlatformLogo>) — a square emblem on its OWN rounded navy tile (a white "H" house, a
// serving cloche and a fork/spoon, on navy #19204f). 1024² is ample: the largest output is a ~512px
// icon / ~860px splash mark. Because the tile is
// baked into the art, the launcher icons are essentially the logo itself; the only field we ever
// add is the SAME navy, bled to the edge for the surfaces that must be full-bleed (maskable +
// apple-touch, which the platform crops or squircle-masks and which do not honour transparency).
// Wrapping it in any OTHER colour would read as a tile-inside-a-tile.
//
// Everything is committed to public/, so this is a one-shot generator, not part of the build.
// Re-run only when the logo or the device list changes:
//
//     node scripts/generate-pwa-assets.mjs
//
// sharp comes in with Next (it powers next/image), so there is no new dependency.

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// sharp is a CJS/native module; import it through a require rooted at the project so this runs the
// same whether invoked directly or with a stray NODE_PATH set.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const sharp = require("sharp");

const PUBLIC = join(ROOT, "public");
const LOGO = join(PUBLIC, "hrestrosewa-logo.png");

const NAVY = "#19204f"; // the logo tile's own navy — the ONLY field colour we add
const CANVAS = "#f6f9fc"; // --color-canvas-soft, the app's own background (splash, matches the app)
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// The logo carries ~7% transparent margin around its tile. Trim it ONCE so the navy tile fills its
// own buffer edge-to-edge; every icon then scales this tight tile down (scale <= 1), which keeps the
// composite input no larger than the canvas (sharp refuses a larger overlay).
const TILE = await sharp(LOGO).trim({ threshold: 10 }).png().toBuffer();

async function logoBuf(px) {
  return sharp(TILE)
    .resize(px, px, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
}

const roundedField = (size, bg, radius) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect width="${size}" height="${size}" rx="${size * radius}" ry="${size * radius}" fill="${bg}"/>
     </svg>`
  );

/**
 * @param size    edge length in px
 * @param bg      field colour, or null for a transparent field (logo's own tile IS the icon)
 * @param scale   fraction of the edge the LOGO spans (scale>1 bleeds the tile past the margin)
 * @param radius  field corner radius as a fraction of the edge (only used when bg is set)
 * @param out     output path under public/
 */
async function makeIcon({ size, bg, scale, radius = 0, out }) {
  const inner = Math.round(size * scale);
  const logo = await logoBuf(inner);
  const layers = [];
  if (bg) layers.push({ input: roundedField(size, bg, radius) });
  layers.push({ input: logo, gravity: "centre" });
  await sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite(layers)
    .png()
    .toFile(join(PUBLIC, out));
}

await mkdir(join(PUBLIC, "icons"), { recursive: true });
await mkdir(join(PUBLIC, "splash"), { recursive: true });

// ── Launcher icons ────────────────────────────────────────────────────────────
// `any` icons are shown as-authored, so the logo's OWN rounded navy tile is the icon (tile filled
// edge-to-edge; its rounded corners are the icon's corners, transparent outside them).
for (const size of [192, 256, 384, 512]) {
  await makeIcon({ size, bg: null, scale: 1.0, out: `icons/icon-${size}.png` });
}

// `maskable` icons are CROPPED by the platform (a circle on Pixel, a squircle on Samsung). Bleed the
// SAME navy to the edge (radius 0) so the crop only ever eats navy, and keep the emblem well inside
// the spec's safe circle (radius 40% of the edge). 0.72 keeps the widest points — the fork and spoon
// tips — comfortably clear of any platform crop (the extra padding is navy, so it's invisible).
for (const size of [192, 512]) {
  await makeIcon({ size, bg: NAVY, scale: 0.72, radius: 0, out: `icons/maskable-${size}.png` });
}

// iOS squircle-masks its icon and does NOT honour transparency (a transparent corner comes out
// black), so this is full-bleed navy too.
await makeIcon({ size: 180, bg: NAVY, scale: 0.92, radius: 0, out: "icons/apple-touch-icon.png" });

// A favicon is read at 16px in a tab strip — the tile fills the frame.
for (const size of [32, 16]) {
  await makeIcon({ size, bg: null, scale: 1.0, out: `icons/favicon-${size}.png` });
}

// ── Apple splash screens ──────────────────────────────────────────────────────
// iOS will not show a launch image unless a <link> matches the device EXACTLY — width, height,
// pixel ratio and orientation. Miss by one and you get a blank white screen. Hence the device table.
const DEVICES = [
  { w: 430,  h: 932,  dpr: 3 }, // iPhone 15/16 Pro Max
  { w: 393,  h: 852,  dpr: 3 }, // iPhone 14/15/16 Pro
  { w: 428,  h: 926,  dpr: 3 }, // iPhone 12–14 Pro Max
  { w: 390,  h: 844,  dpr: 3 }, // iPhone 12/13/14
  { w: 375,  h: 812,  dpr: 3 }, // iPhone X/XS/11 Pro
  { w: 414,  h: 896,  dpr: 3 }, // iPhone XS Max / 11 Pro Max
  { w: 414,  h: 896,  dpr: 2 }, // iPhone XR / 11
  { w: 414,  h: 736,  dpr: 3 }, // iPhone 8 Plus
  { w: 375,  h: 667,  dpr: 2 }, // iPhone SE / 8
  { w: 1024, h: 1366, dpr: 2 }, // iPad Pro 12.9"
  { w: 834,  h: 1194, dpr: 2 }, // iPad Pro 11"
  { w: 834,  h: 1112, dpr: 2 }, // iPad Pro 10.5"
  { w: 820,  h: 1180, dpr: 2 }, // iPad Air
  { w: 768,  h: 1024, dpr: 2 }, // iPad 9.7"
];

// The mark (the logo tile) sits centred on the app's own LIGHT background, so the launch screen is
// the same surface as the app that follows it — no dark→light flash. The navy tile reads cleanly on
// the light field. Fixed fraction of the SHORT edge, so it's the same size on a phone and an iPad.
async function splash(pxW, pxH, file) {
  const markPx = Math.round(Math.min(pxW, pxH) * 0.42);
  const mark = await logoBuf(markPx);
  await sharp({ create: { width: pxW, height: pxH, channels: 4, background: CANVAS } })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(join(PUBLIC, file));
}

const entries = [];
for (const d of DEVICES) {
  const pw = d.w * d.dpr;
  const ph = d.h * d.dpr;
  const portrait = `splash/${d.w}x${d.h}@${d.dpr}x-portrait.png`;
  const landscape = `splash/${d.w}x${d.h}@${d.dpr}x-landscape.png`;
  await splash(pw, ph, portrait);
  await splash(ph, pw, landscape);
  entries.push(
    {
      href: `/${portrait}`,
      media: `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)`,
    },
    {
      href: `/${landscape}`,
      media: `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: landscape)`,
    }
  );
}

// Emit the <link> table rather than hand-maintaining 28 tags next to a 14-row device list.
await writeFile(
  join(ROOT, "lib", "pwa", "apple-splash.ts"),
  `// GENERATED by scripts/generate-pwa-assets.mjs — do not edit by hand.
// iOS matches a launch image on an exact device-width/height/DPR/orientation query; anything
// unmatched simply gets a blank screen.
export const APPLE_SPLASH: { href: string; media: string }[] = ${JSON.stringify(entries, null, 2)};
`,
  "utf8"
);

console.log(`Wrote ${4 + 2 + 1 + 2} icons and ${entries.length} splash screens, plus lib/pwa/apple-splash.ts`);
